import { describe, expect, it } from 'vitest';
import { compute } from '../src/core/calc';
import { pendencias } from '../src/core/pendencias';
import { mergeImport } from '../src/core/b3';
import type { Lancamento } from '../src/core/types';

let n = 0;
const L = (d: string, t: Lancamento['t'], a: string, q: number, v: number, c: Lancamento['c'] = 'outro'): Lancamento =>
  ({ id: String(n++), d, t, a, c, q, p: q ? v / q : 0, v, o: 'b3' });
const agora = new Date('2026-10-03T12:00:00');

describe('pendências', () => {
  const lancs = [L('2022-05-13', 'C', 'CDB000FICT', 5000, 5000), L('2022-08-11', 'V', 'CDB000FICT', 5000, 0)];
  it('vencimento sem valor pede o valor recebido, com o valor aplicado', () => {
    const ps = pendencias(compute(lancs, {}), lancs, { temToken: true, ultimoBackup: agora.toISOString(), ignoradas: [], agora });
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ tipo: 'vencimento', a: 'CDB000FICT', custo: 5000 });
  });
  it('depois de informar o valor, a pendência some e o rendimento aparece', () => {
    const corrigido = lancs.map(l => (l.t === 'V' ? { ...l, v: 5120, p: 5120 / 5000 } : l));
    const m = compute(corrigido, {});
    expect(pendencias(m, corrigido, { temToken: true, ultimoBackup: agora.toISOString(), ignoradas: [], agora })).toHaveLength(0);
    expect(m.list[0].real).toBeCloseTo(120);
  });
  it('lançamento corrigido não volta duplicado ao reimportar', () => {
    const corrigido = { ...lancs[1], v: 5120, k0: '2022-08-11|V|CDB000FICT|5000000000|0' };
    const r = mergeImport([lancs[0], corrigido], [L('2022-05-13', 'C', 'CDB000FICT', 5000, 5000), L('2022-08-11', 'V', 'CDB000FICT', 5000, 0)]);
    expect(r.added).toHaveLength(0);
  });
  it('avisa posição vendida, falta de backup e permite ignorar', () => {
    const ls = [L('2026-02-18', 'V', 'AAAA3', 10, 250, 'acao')];
    const ps = pendencias(compute(ls, {}), ls, { temToken: true, ignoradas: [], agora });
    expect(ps.map(p => p.tipo).sort()).toEqual(['backup', 'vendida']);
    const ign = pendencias(compute(ls, {}), ls, { temToken: true, ignoradas: ['vend:AAAA3'], agora });
    expect(ign.map(p => p.tipo)).toEqual(['backup']);
  });
});
