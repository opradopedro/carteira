// Cotações do momento. Só os CÓDIGOS dos ativos saem do aparelho, nunca quantidades ou valores.
import type { Cotacao, Posicao, Precos } from '../core/types';
import { isB3Ticker } from '../core/util';
import type { Config, Indices } from '../data/db';
import type { Historico } from './hist';
import type { SerieDiaria, SerieMensal } from '../core/perf';

export const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin',
  BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
};

export interface ResultadoAtualizacao {
  precos: Precos;
  falhas: string[];   // mensagens curtas para o usuário
  avisos: string[];
}

async function getJson(url: string, headers: Record<string, string> = {}, timeout = 15000) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`) as Error & { status: number };
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Executa tarefas com no máximo `n` em paralelo. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

/** brapi.dev: plano gratuito aceita 1 ativo por requisição. */
async function brapi(tickers: string[], token: string, out: Precos, falhas: string[]) {
  let erroToken = false, limite = false, outros = 0;
  const naoAchou: string[] = [];
  await pool(tickers, 4, async t => {
    if (erroToken || limite) return;
    try {
      const j = await getJson(`https://brapi.dev/api/quote/${encodeURIComponent(t)}`, { Authorization: `Bearer ${token}` });
      const r = j?.results?.[0];
      if (r && r.regularMarketPrice > 0) {
        out[t] = { p: r.regularMarketPrice, em: new Date().toISOString(), fonte: 'brapi', ref: r.regularMarketTime };
      } else naoAchou.push(t);
    } catch (e) {
      const s = (e as { status?: number }).status;
      if (s === 401 || s === 403) erroToken = true;
      else if (s === 429 || s === 402) limite = true;
      else if (s === 404) naoAchou.push(t);
      else outros++;
    }
  });
  if (erroToken) falhas.push('brapi recusou o token. Confira em Ajustes.');
  if (limite) falhas.push('Limite da brapi atingido; usando o fechamento do último pregão.');
  if (outros) falhas.push(`brapi não respondeu para ${outros} ativo(s).`);
  if (naoAchou.length) falhas.push(`brapi não conhece: ${naoAchou.join(', ')}.`);
}

async function coingecko(tickers: string[], key: string | undefined, out: Precos, falhas: string[]) {
  const ids = tickers.map(t => COINGECKO_IDS[t]).filter(Boolean);
  if (!ids.length) return;
  try {
    const j = await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=brl&include_last_updated_at=true`,
      key ? { 'x-cg-demo-api-key': key } : {},
    );
    for (const t of tickers) {
      const o = j?.[COINGECKO_IDS[t]];
      if (o?.brl > 0) out[t] = { p: o.brl, em: new Date().toISOString(), fonte: 'coingecko', ref: o.last_updated_at ? new Date(o.last_updated_at * 1000).toISOString() : undefined };
    }
  } catch (e) {
    const s = (e as { status?: number }).status;
    falhas.push(s === 401 ? 'CoinGecko recusou a chave. Confira em Ajustes.' : s === 429 ? 'CoinGecko pediu para esperar um pouco (limite de consultas).' : 'CoinGecko não respondeu.');
  }
}

/** Atualiza as cotações das posições abertas. Mantém preços manuais. */
export async function refreshQuotes(open: Posicao[], antigos: Precos, cfg: Config, hist: Historico, buscar: (a: string) => boolean = () => true): Promise<ResultadoAtualizacao> {
  const precos: Precos = { ...antigos };
  const falhas: string[] = [], avisos: string[] = [];
  const manual = (a: string) => antigos[a]?.fonte === 'manual';

  // 1) Base: fechamento oficial mais recente (B3 / Tesouro), vindo dos arquivos públicos do app.
  for (const p of open) {
    if (manual(p.a)) continue;
    const h = hist.latest(p.a, p.c);
    if (h && (!precos[p.a] || precos[p.a].fonte === 'b3' || precos[p.a].fonte === 'tesouro' || (precos[p.a].ref ?? '') < h.ref)) {
      precos[p.a] = { p: h.p, em: new Date().toISOString(), fonte: h.fonte, ref: h.ref };
    }
  }

  // 2) Tempo (quase) real.
  const b3 = open.filter(p => !manual(p.a) && buscar(p.a) && p.c !== 'tesouro' && p.c !== 'cripto' && isB3Ticker(p.a)).map(p => p.a);
  const cr = open.filter(p => !manual(p.a) && buscar(p.a) && p.c === 'cripto').map(p => p.a);
  const tasks: Promise<void>[] = [];
  if (b3.length) {
    if (cfg.brapiToken) tasks.push(brapi(b3, cfg.brapiToken, precos, falhas));
    else avisos.push('Sem token da brapi: ações e FIIs mostram o fechamento do último pregão.');
  }
  if (cr.length) tasks.push(coingecko(cr, cfg.cgKey, precos, falhas));
  await Promise.all(tasks);
  return { precos, falhas, avisos };
}

/** CDI diário, IPCA mensal e Selic meta. Tenta o BCB direto; se falhar, usa o arquivo publicado. */
export async function refreshIndices(desde: string, atual: Indices | undefined, hist: Historico): Promise<Indices | null> {
  const fmt = (iso: string) => iso.split('-').reverse().join('/');
  const toIso = (br: string) => br.split('/').reverse().join('-');
  const hoje = new Date().toISOString().slice(0, 10);
  const sgs = async (code: number, ini: string, fim: string) => {
    const arr = await getJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${fmt(ini)}&dataFinal=${fmt(fim)}`, {}, 25000);
    return (arr as { data: string; valor: string }[]).map(o => [toIso(o.data), parseFloat(o.valor)] as [string, number]);
  };
  try {
    // A API aceita no máximo 10 anos por consulta: busca só o que falta, em janelas.
    let cdi: SerieDiaria = atual?.cdi ?? [];
    const ultimoCdi = cdi.at(-1)?.[0];
    let ini = ultimoCdi && ultimoCdi >= desde ? ultimoCdi : desde;
    if (!ultimoCdi || ultimoCdi < desde) cdi = [];
    while (ini <= hoje) {
      const fimJanela = new Date(Date.parse(ini) + 9 * 365 * 864e5).toISOString().slice(0, 10);
      const fim = fimJanela < hoje ? fimJanela : hoje;
      const novos = await sgs(12, ini, fim);
      const set = new Set(cdi.map(x => x[0]));
      cdi = [...cdi, ...novos.filter(x => !set.has(x[0]))];
      ini = new Date(Date.parse(fim) + 864e5).toISOString().slice(0, 10);
    }
    const ipca: SerieMensal = await sgs(433, desde.slice(0, 8) + '01', hoje);
    const selicArr = await sgs(432, new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10), hoje);
    return { cdi, ipca, selic: selicArr.at(-1)?.[1] ?? null, em: new Date().toISOString() };
  } catch {
    const arq = await hist.bcb();
    if (arq && (!atual || arq.em > atual.em)) return { cdi: arq.cdi, ipca: arq.ipca, selic: arq.selic, em: arq.em };
    return null;
  }
}

export type { Cotacao };
