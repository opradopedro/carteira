import type { Lancamento, Modelo } from './types';
import { applyLanc, sortLancs } from './calc';
import { isB3Ticker } from './util';

export type TipoPendencia = 'vencimento' | 'semCotacao' | 'vendida' | 'backup' | 'token';

export interface Pendencia {
  id: string;
  tipo: TipoPendencia;
  a?: string;
  lanc?: Lancamento;
  custo?: number;   // vencimento: valor aplicado que saiu
  q?: number;       // vendida: quantidade negativa
}

interface Contexto { temToken: boolean; ultimoBackup?: string; ignoradas: string[]; agora?: Date }

/** Custo que saiu da posição no lançamento `alvo` (replay dos lançamentos do ativo). */
function custoNaSaida(lancs: Lancamento[], alvo: Lancamento): number {
  const p = { q: 0, cost: 0 };
  for (const l of sortLancs(lancs.filter(x => x.a === alvo.a))) {
    if (l.t === 'P') continue;
    const antes = p.cost;
    applyLanc(p, l);
    if (l.id === alvo.id) return antes - p.cost;
  }
  return 0;
}

/** Coisas que o app não consegue resolver sozinho e que pedem uma ação sua. */
export function pendencias(model: Modelo, lancs: Lancamento[], ctx: Contexto): Pendencia[] {
  const out: Pendencia[] = [];
  for (const l of model.sorted) {
    if (l.t === 'V' && l.v === 0 && l.q > 0)
      out.push({ id: 'venc:' + l.id, tipo: 'vencimento', a: l.a, lanc: l, custo: custoNaSaida(lancs, l) });
  }
  for (const p of model.list) if (p.q < -1e-9) out.push({ id: 'vend:' + p.a, tipo: 'vendida', a: p.a, q: p.q });
  for (const p of model.open) if (!p.px) out.push({ id: 'cot:' + p.a, tipo: 'semCotacao', a: p.a });
  if (!ctx.temToken && model.open.some(p => p.c !== 'tesouro' && p.c !== 'cripto' && isB3Ticker(p.a)))
    out.push({ id: 'token', tipo: 'token' });
  const agora = (ctx.agora ?? new Date()).getTime();
  if (lancs.length && (!ctx.ultimoBackup || agora - Date.parse(ctx.ultimoBackup) > 30 * 864e5))
    out.push({ id: 'backup', tipo: 'backup' });
  return out.filter(p => p.tipo === 'backup' || !ctx.ignoradas.includes(p.id));
}
