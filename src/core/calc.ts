import type { Lancamento, Modelo, Posicao, Precos } from './types';
import { ymd } from './util';

const ORDEM = { C: 0, S: 1, P: 2, V: 3 } as const;

/** Ordena por data; no mesmo dia, compras antes de vendas (day trade). */
export const sortLancs = (lancs: Lancamento[]): Lancamento[] =>
  [...lancs].sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : ORDEM[x.t] - ORDEM[y.t]));

interface Acum { a: string; c: Posicao['c']; q: number; cost: number; prov: number; prov12: number; real: number }

/** Direitos de subscrição (ex.: CASH1, XPML12): vendê-los sem posição é ganho, não venda a descoberto. */
export const isDireito = (a: string) => /^[A-Z]{4}(1|2|12|13)$/.test(a);

/**
 * Aplica um lançamento sobre a posição (preço médio pelo custo de aquisição). Devolve o lucro realizado.
 * Vender mais do que se tem abre uma posição vendida (quantidade negativa, custo negativo = valor
 * recebido); a recompra seguinte fecha essa posição e realiza o lucro ou prejuízo.
 */
export function applyLanc(p: { q: number; cost: number }, l: Lancamento, a = l.a): number {
  if (l.t === 'C') {
    let real = 0, q = l.q, v = l.v;
    if (p.q < -1e-9 && q > 0) {
      const qc = Math.min(q, -p.q);
      const pmVenda = p.cost / p.q;          // preço médio da venda a descoberto
      const pago = v * (qc / q);
      real = pmVenda * qc - pago;
      p.q += qc; p.cost += pmVenda * qc;
      q -= qc; v -= pago;
      if (Math.abs(p.q) < 1e-9) { p.q = 0; p.cost = 0; }
    }
    p.q += q; p.cost += v;
    return real;
  }
  if (l.t === 'S') {
    if (l.q < 0 && p.q > 0) {
      // Grupamento/fração: sai quantidade, custo fica (exceto se zerar a posição).
      p.q = Math.max(0, p.q + l.q);
      if (p.q < 1e-9) { p.q = 0; p.cost = 0; }
    } else if (l.q > 0) { p.q += l.q; p.cost += l.v; }
    return 0;
  }
  if (l.t === 'V') {
    const qs = Math.max(0, Math.min(l.q, p.q));
    const pm = qs > 0 ? p.cost / p.q : 0;
    const saiu = pm * qs;
    // Sem valor informado (ex.: vencimento de CDB sem valor na planilha): sai pelo custo.
    if (l.v === 0) { p.q -= qs; p.cost -= saiu; if (Math.abs(p.q) < 1e-9) { p.q = 0; p.cost = 0; } return 0; }
    const vendido = l.q > 0 ? l.v * (qs / l.q) : l.v;
    p.q -= qs; p.cost -= saiu;
    if (Math.abs(p.q) < 1e-9) { p.q = 0; p.cost = 0; }
    const excesso = l.q - qs;
    if (excesso > 1e-9) {
      const recebido = l.v - vendido;
      if (isDireito(a)) return vendido - saiu + recebido; // direito sem custo: tudo é ganho
      p.q -= excesso; p.cost -= recebido;               // abre/aumenta posição vendida
    }
    return vendido - saiu;
  }
  return 0;
}

/** Posições, preço médio, resultado e proventos a partir dos lançamentos e cotações. */
export function compute(lancs: Lancamento[], precos: Precos, hoje: Date = new Date()): Modelo {
  const sorted = sortLancs(lancs);
  const pos: Record<string, Acum> = {};
  const timeline: { d: string; v: number }[] = [];
  let cost = 0, realized = 0;
  const lim12 = ymd(new Date(hoje.getTime() - 365 * 864e5));
  for (const l of sorted) {
    const p = pos[l.a] || (pos[l.a] = { a: l.a, c: l.c, q: 0, cost: 0, prov: 0, prov12: 0, real: 0 });
    p.c = l.c;
    if (l.t === 'P') {
      p.prov += l.v;
      if (l.d >= lim12) p.prov12 += l.v;
      continue;
    }
    const antes = p.cost;
    const r = applyLanc(p, l);
    p.real += r; realized += r;
    cost += p.cost - antes;
    const last = timeline[timeline.length - 1];
    if (last && last.d === l.d) last.v = cost; else timeline.push({ d: l.d, v: cost });
  }
  const list: Posicao[] = Object.values(pos).map(p => {
    const px = precos[p.a] && precos[p.a].p > 0 ? precos[p.a] : null;
    const value = px ? p.q * px.p : p.cost;
    return { ...p, pm: p.q ? p.cost / p.q : 0, px, value, res: value - p.cost };
  }).sort((x, y) => y.value - x.value);
  const open = list.filter(p => p.q > 0);
  // Posições vendidas (a descoberto) ficam em list com q < 0 e aparecem nas pendências.
  const tot = { value: 0, cost: 0, prov: 0, prov12: 0, realized, res: 0, semCot: 0 };
  for (const p of list) { tot.prov += p.prov; tot.prov12 += p.prov12; }
  for (const p of open) { tot.value += p.value; tot.cost += p.cost; if (!p.px) tot.semCot++; }
  tot.res = tot.value - tot.cost;
  return { list, open, tot, timeline, sorted };
}
