// Cotações do momento. Só os CÓDIGOS dos ativos saem do aparelho, nunca quantidades ou valores.
import type { Cotacao, Posicao, Precos } from '../core/types';
import { isB3Ticker } from '../core/util';
import type { Config, Indices } from '../data/db';
import type { Historico } from './hist';
import { precosTD } from '../core/tesouroDireto';

export const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin',
  BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
};

export interface ResultadoAtualizacao {
  precos: Precos;
  falhas: string[];   // mensagens curtas para o usuário
  avisos: string[];
  req: { brapi: number; cg: number; cota?: { limite: number; restante: number } }; // consultas feitas e cota informada pela brapi
  vivos: number;
}

async function getJson(url: string, headers: Record<string, string> = {}, timeout = 12000, tentativas = 2) {
  let erro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
      if (r.ok) return await r.json();
      const err = new Error(`HTTP ${r.status}`) as Error & { status: number };
      err.status = r.status;
      // Erro do pedido (token, limite, ativo inexistente): tentar de novo não adianta.
      if (r.status < 500 && r.status !== 408) throw err;
      erro = err;
    } catch (e) {
      if ((e as { status?: number }).status && (e as { status: number }).status < 500 && (e as { status: number }).status !== 408) throw e;
      erro = e; // sem resposta, tempo esgotado ou instabilidade do servidor
    }
    if (i < tentativas - 1) await new Promise(res => setTimeout(res, 1500 * (i + 1)));
  }
  throw erro;
}

const espera = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * brapi.dev. No plano gratuito: 1 ativo por consulta e 1 consulta por vez (uma segunda consulta
 * simultânea volta com HTTP 429, o mesmo código da cota esgotada). Por isso as consultas são feitas
 * uma de cada vez, e um 429 só é tratado como cota esgotada quando a brapi diz que não sobrou nada.
 */
async function brapi(tickers: string[], token: string, out: Precos, falhas: string[], req: ResultadoAtualizacao['req']) {
  let erroToken = false, cotaAcabou = false, outros = 0;
  const naoAchou: string[] = [], foraDoPlano: string[] = [];
  for (const t of tickers) {
    if (erroToken || cotaAcabou) break;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      req.brapi++;
      let r: Response;
      try {
        r = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(t)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000), cache: 'no-store',
        });
      } catch {
        if (tentativa < 2) { await espera(1500); continue; }
        outros++; break;
      }
      // Cota do mês informada pela brapi (quando vier com limite na escala mensal).
      const lim = Number(r.headers.get('X-RateLimit-Limit') ?? r.headers.get('RateLimit-Limit'));
      const rest = Number(r.headers.get('X-RateLimit-Remaining') ?? r.headers.get('RateLimit-Remaining'));
      if (lim >= 1000 && Number.isFinite(rest)) req.cota = { limite: lim, restante: rest };
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const q = j?.results?.[0];
        if (q && q.regularMarketPrice > 0) out[t] = { p: q.regularMarketPrice, em: new Date().toISOString(), fonte: 'brapi', ref: q.regularMarketTime };
        else naoAchou.push(t);
        break;
      }
      if (r.status === 401) { erroToken = true; break; }
      if (r.status === 403) { foraDoPlano.push(t); break; }
      if (r.status === 404) { naoAchou.push(t); break; }
      if (r.status === 429) {
        if (lim >= 1000 && rest <= 0) { cotaAcabou = true; break; }
        // Limite de consultas simultâneas (ex.: o app aberto em dois lugares): espera e tenta de novo.
        const s = Number(r.headers.get('Retry-After'));
        if (tentativa < 2) { await espera(Math.min(5, s > 0 ? s : 1.5) * 1000); continue; }
        outros++; break;
      }
      if (r.status >= 500 && tentativa < 2) { await espera(1500); continue; }
      outros++; break;
    }
  }
  if (erroToken) falhas.push('brapi recusou o token. Confira em Ajustes.');
  if (cotaAcabou) falhas.push('Acabaram as consultas grátis da brapi deste mês; ações e FIIs usam o fechamento do último pregão até a cota renovar.');
  if (foraDoPlano.length) falhas.push(`O plano gratuito da brapi não inclui: ${foraDoPlano.join(', ')}. Usando o fechamento do último pregão.`);
  if (outros) falhas.push(`brapi não respondeu para ${outros} ativo(s), mesmo tentando de novo; mostrando o último preço salvo.`);
  if (naoAchou.length) falhas.push(`brapi não conhece: ${naoAchou.join(', ')}.`);
}

async function coingecko(tickers: string[], key: string | undefined, out: Precos, falhas: string[], req: { cg: number }) {
  const ids = tickers.map(t => COINGECKO_IDS[t]).filter(Boolean);
  const faltam = new Set(tickers);
  let motivo = '';
  if (ids.length) {
    req.cg++;
    try {
      const j = await getJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=brl&include_last_updated_at=true`,
        key ? { 'x-cg-demo-api-key': key } : {},
      );
      for (const t of tickers) {
        const o = j?.[COINGECKO_IDS[t]];
        if (o?.brl > 0) {
          out[t] = { p: o.brl, em: new Date().toISOString(), fonte: 'coingecko', ref: o.last_updated_at ? new Date(o.last_updated_at * 1000).toISOString() : undefined };
          faltam.delete(t);
        }
      }
    } catch (e) {
      const s = (e as { status?: number }).status;
      motivo = s === 401 ? 'CoinGecko recusou a chave (confira em Ajustes)' : s === 429 ? 'CoinGecko pediu para esperar (limite de consultas)' : 'CoinGecko não respondeu';
    }
  }
  if (!faltam.size) return;
  // Reserva: Mercado Bitcoin (preço em reais, sem chave).
  const pegos = await mercadoBitcoin([...faltam], out);
  for (const t of pegos) faltam.delete(t);
  if (motivo && pegos.length) falhas.push(`${motivo}; usei o Mercado Bitcoin.`);
  else if (faltam.size) falhas.push(`${motivo || 'Sem cotação de cripto'} para ${[...faltam].join(', ')}; mostrando o último preço salvo.`);
}

async function mercadoBitcoin(tickers: string[], out: Precos): Promise<string[]> {
  try {
    const j = await getJson(`https://api.mercadobitcoin.net/api/v4/tickers?symbols=${tickers.map(t => encodeURIComponent(t) + '-BRL').join(',')}`);
    const ok: string[] = [];
    for (const o of Array.isArray(j) ? j : []) {
      const t = String(o?.pair || '').replace(/-BRL$/, '');
      const p = parseFloat(o?.last);
      if (tickers.includes(t) && p > 0) {
        out[t] = { p, em: new Date().toISOString(), fonte: 'mb', ref: o.date ? new Date(o.date * 1000).toISOString() : undefined };
        ok.push(t);
      }
    }
    return ok;
  } catch { return []; }
}

/** Tesouro Direto: uma consulta traz todos os títulos (nenhum código seu é enviado). */
async function tesouroDireto(titulos: string[], out: Precos, falhas: string[], conhecidos: Set<string>) {
  const base = 'https://www.tesourodireto.com.br/o/rentabilidade/';
  const r = await Promise.allSettled([getJson(base + 'resgatar'), getJson(base + 'investir')]);
  const listas = r.flatMap(x => (x.status === 'fulfilled' ? [x.value] : []));
  if (!listas.length) { falhas.push('O site do Tesouro Direto não respondeu; Tesouro mostra o último preço publicado.'); return; }
  const td = precosTD(listas, conhecidos);
  const fora: string[] = [];
  for (const t of titulos) {
    const v = td[t];
    if (v && v.ref >= (out[t]?.ref ?? '').slice(0, 10)) out[t] = { p: v.p, em: new Date().toISOString(), fonte: 'tesouro', ref: v.ref };
    else if (!v) fora.push(t);
  }
  if (fora.length) falhas.push(`O Tesouro Direto não está negociando agora: ${fora.map(t => t.replace(/^TESOURO /, '')).join(', ')}. Mostrando o último preço publicado.`);
}

/** Atualiza as cotações das posições abertas. Mantém preços manuais. */
export async function refreshQuotes(open: Posicao[], antigos: Precos, cfg: Config, hist: Historico, buscar: (a: string) => boolean = () => true): Promise<ResultadoAtualizacao> {
  const precos: Precos = { ...antigos };
  const inicio = new Date().toISOString();
  const falhas: string[] = [], avisos: string[] = [];
  const req: ResultadoAtualizacao['req'] = { brapi: 0, cg: 0 };
  const manual = (a: string) => antigos[a]?.fonte === 'manual';

  // 1) Base: fechamento oficial mais recente (B3 / Tesouro), vindo dos arquivos públicos do app,
  //    só se for mais novo que o preço que já temos (não troca o preço de hoje pelo de ontem).
  for (const p of open) {
    if (manual(p.a)) continue;
    const h = hist.latest(p.a, p.c);
    if (h && (!precos[p.a] || (precos[p.a].ref ?? '').slice(0, 10) < h.ref)) {
      precos[p.a] = { p: h.p, em: new Date().toISOString(), fonte: h.fonte, ref: h.ref };
    }
  }

  // 2) Tempo (quase) real.
  const b3 = open.filter(p => !manual(p.a) && buscar(p.a) && p.c !== 'tesouro' && p.c !== 'cripto' && isB3Ticker(p.a)).map(p => p.a);
  const cr = open.filter(p => !manual(p.a) && buscar(p.a) && p.c === 'cripto').map(p => p.a);
  const td = open.filter(p => !manual(p.a) && buscar(p.a) && p.c === 'tesouro').map(p => p.a);
  const tasks: Promise<void>[] = [];
  if (b3.length) {
    if (cfg.brapiToken) tasks.push(brapi(b3, cfg.brapiToken, precos, falhas, req));
    else avisos.push('Sem token da brapi: ações e FIIs mostram o fechamento do último pregão.');
  }
  if (cr.length) tasks.push(coingecko(cr, cfg.cgKey, precos, falhas, req));
  if (td.length) tasks.push(tesouroDireto(td, precos, falhas, hist.titulosTesouro()));
  await Promise.all(tasks);
  // Quantos ativos ganharam preço ao vivo agora (para o "Cotações de HH:MM" não mentir).
  const vivos = open.filter(p => buscar(p.a) && precos[p.a] && precos[p.a] !== antigos[p.a] && precos[p.a].em >= inicio
    && ['brapi', 'coingecko', 'mb'].includes(precos[p.a].fonte) || (p.c === 'tesouro' && buscar(p.a) && precos[p.a]?.ref === new Date().toLocaleDateString('en-CA'))).length;
  return { precos, falhas, avisos, req, vivos };
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
