import type { Classe, Lancamento } from './types';
import { applyLanc, sortLancs } from './calc';
import { addMonths, monthEnd } from './util';

/** Preço de fechamento do ativo no mês "AAAA-MM" (ou null se desconhecido). */
export type PriceAt = (a: string, c: Classe, ym: string) => number | null;

export interface PontoMes {
  ym: string;
  d: string;          // data do ponto (fim do mês, ou hoje no mês corrente)
  v: number;          // patrimônio a preço de mercado
  custo: number;      // custo das posições abertas (valor investido)
  fluxo: number;      // aportes - retiradas (compras - vendas) no mês
  compras: number;    // valor comprado no mês
  vendas: number;     // valor recebido em vendas no mês
  prov: number;       // proventos recebidos no mês
  r: number;          // rentabilidade do mês (Dietz modificado, com proventos)
  semPreco: string[]; // ativos avaliados pelo custo por falta de cotação
}

const dayOf = (d: string) => parseInt(d.slice(8, 10), 10);

/**
 * Patrimônio no fim de cada mês, desde o primeiro lançamento até o mês atual.
 * O mês corrente usa `atual` (valor com as cotações do momento), se informado.
 */
export function monthlySeries(
  lancs: Lancamento[],
  priceAt: PriceAt,
  hoje: string,
  atual?: { v: number },
): PontoMes[] {
  const sorted = sortLancs(lancs);
  if (!sorted.length) return [];
  const curYm = hoje.slice(0, 7);
  const pos: Record<string, { q: number; cost: number; c: Classe }> = {};
  const out: PontoMes[] = [];
  let i = 0;
  let prevV = 0;
  for (let ym = sorted[0].d.slice(0, 7); ym <= curYm; ym = addMonths(ym, 1)) {
    const fim = ym === curYm ? hoje : monthEnd(ym);
    const dias = dayOf(fim);
    let fluxo = 0, prov = 0, pesado = 0, compras = 0, vendas = 0;
    while (i < sorted.length && sorted[i].d <= fim) {
      const l = sorted[i++];
      const p = pos[l.a] || (pos[l.a] = { q: 0, cost: 0, c: l.c });
      p.c = l.c;
      if (l.t === 'P') { prov += l.v; continue; }
      const custoAntes = p.cost;
      applyLanc(p, l, l.a);
      // Venda sem valor informado (vencimento de CDB) sai pelo custo, como no cálculo da posição.
      const f = l.t === 'C' ? l.v : l.t === 'V' ? -(l.v || custoAntes - p.cost) : 0;
      fluxo += f;
      if (f > 0) compras += f; else vendas -= f;
      pesado += f * (dias - dayOf(l.d)) / dias; // aporte no fim do dia conta pelos dias restantes
    }
    let v = 0, custo = 0;
    const semPreco: string[] = [];
    for (const [a, p] of Object.entries(pos)) {
      if (p.q === 0) continue;
      custo += p.cost;
      const px = priceAt(a, p.c, ym);
      if (px && px > 0) v += p.q * px; // posição vendida (q < 0) entra como dívida
      else { v += p.cost; semPreco.push(a); }
    }
    if (ym === curYm && atual) v = atual.v;
    const base = prevV + pesado;
    const r = base > 1e-6 ? (v - prevV - fluxo + prov) / base : 0;
    out.push({ ym, d: fim, v, custo, fluxo, compras, vendas, prov, r, semPreco });
    prevV = v;
  }
  return out;
}

export interface ResultadoPeriodo {
  ini: string;        // AAAA-MM do primeiro mês do período
  fim: string;        // AAAA-MM do último mês
  vIni: number;       // patrimônio antes do período começar
  vFim: number;
  aportes: number;    // aportes líquidos (compras - vendas)
  prov: number;
  ganho: number;      // vFim - vIni - aportes + proventos
  rent: number;       // rentabilidade encadeada (fração, 0.1 = 10%)
  indice: { ym: string; d: string; acc: number }[]; // rentabilidade acumulada mês a mês
}

/** Rentabilidade e ganho no intervalo de meses [ini, fim] (inclusive). */
export function periodResult(serie: PontoMes[], ini: string, fim: string): ResultadoPeriodo | null {
  const pts = serie.filter(p => p.ym >= ini && p.ym <= fim);
  if (!pts.length) return null;
  const antes = serie.filter(p => p.ym < pts[0].ym).at(-1);
  const vIni = antes ? antes.v : 0;
  let acc = 1, aportes = 0, prov = 0;
  const ymBase = addMonths(pts[0].ym, -1);
  const indice = [{ ym: ymBase, d: monthEnd(ymBase), acc: 0 }];
  for (const p of pts) {
    acc *= 1 + p.r;
    aportes += p.fluxo; prov += p.prov;
    indice.push({ ym: p.ym, d: p.d, acc: acc - 1 });
  }
  const vFim = pts.at(-1)!.v;
  return {
    ini: pts[0].ym, fim: pts.at(-1)!.ym, vIni, vFim, aportes, prov,
    ganho: vFim - vIni - aportes + prov, rent: acc - 1, indice,
  };
}

export type SerieDiaria = [string, number][]; // [AAAA-MM-DD, % no dia]
export type SerieMensal = [string, number][]; // [AAAA-MM-01, % no mês]

/** CDI acumulado entre as datas (exclusiva, inclusiva). */
export function cdiAcumulado(cdi: SerieDiaria, de: string, ate: string): number {
  let f = 1;
  for (const [d, x] of cdi) if (d > de && d <= ate) f *= 1 + x / 100;
  return f - 1;
}

/** IPCA acumulado nos meses (AAAA-MM) do intervalo [ini, fim]. */
export function ipcaAcumulado(ipca: SerieMensal, ini: string, fim: string): { acc: number; ultimo: string } {
  let f = 1, ultimo = '';
  for (const [d, x] of ipca) {
    const ym = d.slice(0, 7);
    if (ym >= ini && ym <= fim) { f *= 1 + x / 100; ultimo = ym; }
  }
  return { acc: f - 1, ultimo };
}

/** Curvas acumuladas de CDI e IPCA alinhadas aos pontos do índice da carteira. */
export function benchCurves(indice: ResultadoPeriodo['indice'], cdi: SerieDiaria, ipca: SerieMensal) {
  const d0 = indice[0].d;
  const cdiPts = indice.map(p => ({ d: p.d, acc: cdiAcumulado(cdi, d0, p.d) }));
  const ipcaPts: { d: string; acc: number }[] = [{ d: d0, acc: 0 }];
  for (const p of indice.slice(1)) {
    const has = ipca.some(([d]) => d.slice(0, 7) === p.ym);
    if (!has) break;
    ipcaPts.push({ d: p.d, acc: ipcaAcumulado(ipca, indice[1].ym, p.ym).acc });
  }
  return { cdi: cdiPts, ipca: ipcaPts };
}
