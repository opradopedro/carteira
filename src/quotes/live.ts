// Cotações do momento. Só os CÓDIGOS dos ativos saem do aparelho, nunca quantidades ou valores.
import type { Cotacao, Posicao, Precos } from '../core/types';
import { isB3Ticker } from '../core/util';
import type { Config, Indices } from '../data/db';
import type { Historico } from './hist';

export const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin',
  BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
};

export interface ResultadoAtualizacao {
  precos: Precos;
  falhas: string[];   // mensagens curtas para o usuário
  avisos: string[];
  req: { brapi: number; cg: number }; // requisições feitas (para acompanhar o limite gratuito)
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
async function brapi(tickers: string[], token: string, out: Precos, falhas: string[], req: { brapi: number }) {
  let erroToken = false, limite = false, outros = 0;
  const naoAchou: string[] = [];
  await pool(tickers, 4, async t => {
    if (erroToken || limite) return;
    req.brapi++;
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

async function coingecko(tickers: string[], key: string | undefined, out: Precos, falhas: string[], req: { cg: number }) {
  const ids = tickers.map(t => COINGECKO_IDS[t]).filter(Boolean);
  if (!ids.length) return;
  req.cg++;
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
  const req = { brapi: 0, cg: 0 };
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
    if (cfg.brapiToken) tasks.push(brapi(b3, cfg.brapiToken, precos, falhas, req));
    else avisos.push('Sem token da brapi: ações e FIIs mostram o fechamento do último pregão.');
  }
  if (cr.length) tasks.push(coingecko(cr, cfg.cgKey, precos, falhas, req));
  await Promise.all(tasks);
  return { precos, falhas, avisos, req };
}

/**
 * CDI diário, IPCA mensal e Selic. Primeiro o arquivo publicado com o app (gerado 2x por dia
 * a partir do Ipeadata); se estiver velho, consulta o Ipeadata direto. Nada da carteira é enviado.
 */
export async function refreshIndices(atual: Indices | undefined, hist: Historico): Promise<Indices | null> {
  const velho = (ix?: { cdi: [string, number][] } | null) =>
    !ix?.cdi?.length || Date.now() - Date.parse(ix.cdi.at(-1)![0]) > 6 * 864e5;
  const arq = await hist.bcb().catch(() => null);
  if (arq && !velho(arq)) return { cdi: arq.cdi, ipca: arq.ipca, selic: arq.selic, em: new Date().toISOString() };
  try {
    const ipea = async (code: string) => {
      const j = await getJson(`https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='${code}')`, {}, 40000);
      return (j.value as { VALDATA: string; VALVALOR: number | null }[])
        .filter(o => o.VALVALOR != null).map(o => [o.VALDATA.slice(0, 10), o.VALVALOR!] as [string, number]);
    };
    const [cdi, ipca, selic] = await Promise.all([ipea('SGS366_CDI366'), ipea('PRECOS12_IPCAG12'), ipea('BM366_TJOVER366')]);
    const desde = '2016-01-01';
    return { cdi: cdi.filter(x => x[0] >= desde), ipca: ipca.filter(x => x[0] >= desde), selic: selic.at(-1)?.[1] ?? null, em: new Date().toISOString() };
  } catch {
    if (arq) return { cdi: arq.cdi, ipca: arq.ipca, selic: arq.selic, em: new Date().toISOString() };
    return atual ?? null;
  }
}

export type { Cotacao };
