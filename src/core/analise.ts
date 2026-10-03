// Cálculos usados pelas telas de detalhe: períodos, comparação com índices,
// leitura de um ponto do gráfico e proventos por mês. Tudo puro e testável.
import type { Lancamento } from './types';
import {
  benchCurves, cdiAcumulado, ipcaAcumulado, periodResult,
  type PontoMes, type PriceAt, type ResultadoPeriodo, type SerieDiaria, type SerieMensal,
} from './perf';
import { addMonths, monthEnd } from './util';

export interface Periodo { tipo: '12m' | 'ano' | 'anoPassado' | 'tudo' | 'y' | 'custom'; ano?: number; ini?: string; fim?: string; salvo?: string }

/** Filtro de período personalizado salvo pelo usuário (vale para todas as telas). */
export interface FiltroSalvo { id: string; nome: string; ini: string; fim: string }

/** Intervalo de meses [ini, fim] de um período, limitado a [first, cur]. */
export function periodRange(p: Periodo, first: string, cur: string): [string, string] {
  let ini = first, fim = cur;
  const ano = parseInt(cur.slice(0, 4), 10);
  if (p.tipo === '12m') ini = addMonths(cur, -11);
  else if (p.tipo === 'ano') ini = `${ano}-01`;
  else if (p.tipo === 'anoPassado') { ini = `${ano - 1}-01`; fim = `${ano - 1}-12`; }
  else if (p.tipo === 'y' && p.ano) { ini = `${p.ano}-01`; fim = `${p.ano}-12`; }
  else if (p.tipo === 'custom') { ini = p.ini || first; fim = p.fim || cur; }
  if (ini < first) ini = first;
  if (fim > cur) fim = cur;
  if (fim < ini) fim = ini;
  return [ini, fim];
}

/** Ibovespa aproximado pelo ETF BOVA11 (fechamento mensal oficial da B3). */
export const IBOV_PROXY = 'BOVA11';

export function ibovCurve(indice: ResultadoPeriodo['indice'], priceAt: PriceAt) {
  const base = priceAt(IBOV_PROXY, 'outro', indice[0].ym);
  if (!base) return null;
  const pts: { d: string; acc: number }[] = [];
  for (const p of indice) {
    const px = priceAt(IBOV_PROXY, 'outro', p.ym);
    if (!px) break;
    pts.push({ d: p.d, acc: px / base - 1 });
  }
  return pts.length > 1 ? pts : null;
}

export interface Indices { cdi: SerieDiaria; ipca: SerieMensal }

export interface Comparacao {
  r: ResultadoPeriodo;
  cdi: number | null;
  ibov: number | null;
  ipca: { acc: number; ultimo: string } | null;
  curvas: { cdi: { d: string; acc: number }[] | null; ipca: { d: string; acc: number }[] | null; ibov: { d: string; acc: number }[] | null };
}

/** Rentabilidade no período comparada a CDI, Ibovespa e IPCA. */
export function comparar(serie: PontoMes[], ini: string, fim: string, ix: Indices | null, priceAt: PriceAt): Comparacao | null {
  const r = periodResult(serie, ini, fim);
  if (!r) return null;
  const d0 = r.indice[0].d, d1 = r.indice.at(-1)!.d;
  let cdi: number | null = null, ipca: Comparacao['ipca'] = null;
  let curvas: Comparacao['curvas'] = { cdi: null, ipca: null, ibov: null };
  if (ix?.cdi?.length && ix.cdi[0][0] <= addDaysIso(d0, 7)) {
    cdi = cdiAcumulado(ix.cdi, d0, d1);
    const b = benchCurves(r.indice, ix.cdi, ix.ipca);
    curvas = { cdi: b.cdi, ipca: b.ipca.length > 1 ? b.ipca : null, ibov: null };
    const ip = ipcaAcumulado(ix.ipca, r.ini, r.fim);
    if (ip.ultimo) ipca = ip;
  }
  const ib = ibovCurve(r.indice, priceAt);
  curvas.ibov = ib;
  const ibov = ib && ib.at(-1)!.d === d1 ? ib.at(-1)!.acc : null;
  return { r, cdi, ibov, ipca, curvas };
}

export interface Janela { ganho: number; base: number; pct: number; meses: number }

export interface Leitura {
  ym: string; d: string; v: number; custo: number;
  inicio: string;     // mês em que começou a posição atual (depois de zerada, recomeça)
  comprado: number;   // compras desde o início da posição atual
  vendido: number;    // vendas desde o início da posição atual
  proventos: number;  // proventos desde o início da posição atual
  investido: number;  // total investido = comprado - vendido
  resultado: number;  // valor + vendas + proventos - compras
  pctTotal: number;   // rendimento total = resultado / total investido
  doze: Janela;       // últimos 12 meses até a data
  mes: Janela;        // só o mês da data
}

/**
 * Ganho numa janela de meses, em reais e em % do dinheiro que estava aplicado:
 *   ganho = valor no fim - valor no início - compras + vendas + proventos
 *   base  = valor no início + compras feitas na janela
 */
export function janela(serie: PontoMes[], de: number, ate: number): Janela {
  const vIni = de > 0 ? serie[de - 1].v : 0;
  let compras = 0, vendas = 0, prov = 0;
  for (let k = de; k <= ate; k++) { compras += serie[k].compras; vendas += serie[k].vendas; prov += serie[k].prov; }
  const ganho = serie[ate].v - vIni - compras + vendas + prov;
  const base = vIni + compras;
  return { ganho, base, pct: base > 1e-6 ? ganho / base : 0, meses: ate - de + 1 };
}

/** Primeiro mês da posição que existe no ponto i (se a posição foi zerada antes, começa depois disso). */
export function inicioPosicao(serie: PontoMes[], i: number): number {
  let k = i;
  while (k > 0 && !(Math.abs(serie[k - 1].v) < 0.005 && Math.abs(serie[k - 1].custo) < 0.005)) k--;
  return k;
}

/**
 * O que mostrar ao tocar num ponto do gráfico, calculado sobre o dinheiro aplicado.
 * Se a posição foi vendida inteira e comprada de novo, conta só a partir da recompra.
 */
export function lerPonto(serie: PontoMes[], i: number): Leitura {
  const p = serie[i];
  const k0 = inicioPosicao(serie, i);
  let comprado = 0, vendido = 0, proventos = 0;
  for (let k = k0; k <= i; k++) { comprado += serie[k].compras; vendido += serie[k].vendas; proventos += serie[k].prov; }
  const resultado = p.v + vendido + proventos - comprado;
  const investido = comprado - vendido;
  const base = investido > 1e-6 ? investido : comprado;
  const lim = addMonths(p.ym, -12);
  let de12 = i;
  while (de12 > k0 && serie[de12 - 1].ym > lim) de12--;
  return {
    ym: p.ym, d: p.d, v: p.v, custo: p.custo, inicio: serie[k0].ym, comprado, vendido, proventos, investido, resultado,
    pctTotal: base > 1e-6 ? resultado / base : 0,
    doze: janela(serie, de12, i), mes: janela(serie, i, i),
  };
}

/** Índice do ponto da série mais próximo de uma data (ms). */
export function pontoMaisProximo(serie: { d: string }[], x: number): number {
  let best = 0, dist = Infinity;
  serie.forEach((p, i) => {
    const dd = Math.abs(Date.parse(p.d + 'T00:00:00Z') - x);
    if (dd < dist) { dist = dd; best = i; }
  });
  return best;
}

/** Soma dos proventos por mês no intervalo [ini, fim] (meses "AAAA-MM"). */
export function proventosPorMes(lancs: Lancamento[], ini: string, fim: string) {
  const meses: { ym: string; v: number }[] = [];
  for (let ym = ini; ym <= fim; ym = addMonths(ym, 1)) meses.push({ ym, v: 0 });
  const idx = new Map(meses.map((m, i) => [m.ym, i]));
  const itens: Lancamento[] = [];
  for (const l of lancs) {
    if (l.t !== 'P') continue;
    const i = idx.get(l.d.slice(0, 7));
    if (i == null) continue;
    meses[i].v += l.v;
    itens.push(l);
  }
  const total = meses.reduce((s, m) => s + m.v, 0);
  return { meses, total, media: meses.length ? total / meses.length : 0, itens: itens.sort((a, b) => b.d.localeCompare(a.d)) };
}

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
export { monthEnd };
