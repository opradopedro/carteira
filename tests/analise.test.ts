import { describe, expect, it } from 'vitest';
import { comparar, ibovCurve, lerPonto, periodRange, pontoMaisProximo, proventosPorMes } from '../src/core/analise';
import { monthlySeries, type PriceAt } from '../src/core/perf';
import type { Lancamento } from '../src/core/types';

let n = 0;
const L = (d: string, t: Lancamento['t'], q: number, v: number, a = 'AAAA3'): Lancamento =>
  ({ id: String(n++), d, t, a, c: 'acao', q, p: q ? v / q : 0, v, o: 'manual' });
const precos: Record<string, Record<string, number>> = {
  AAAA3: { '2025-01': 10, '2025-02': 11, '2025-03': 12.1, '2025-04': 12.1 },
  BOVA11: { '2024-12': 100, '2025-01': 100, '2025-02': 105, '2025-03': 110, '2025-04': 99 },
};
const priceAt: PriceAt = (a, _c, ym) => precos[a]?.[ym] ?? null;

describe('periodRange', () => {
  it('presets', () => {
    expect(periodRange({ tipo: '12m' }, '2020-01', '2026-10')).toEqual(['2025-11', '2026-10']);
    expect(periodRange({ tipo: 'ano' }, '2020-01', '2026-10')).toEqual(['2026-01', '2026-10']);
    expect(periodRange({ tipo: 'anoPassado' }, '2020-01', '2026-10')).toEqual(['2025-01', '2025-12']);
    expect(periodRange({ tipo: 'y', ano: 2024 }, '2024-05', '2026-10')).toEqual(['2024-05', '2024-12']);
    expect(periodRange({ tipo: 'custom', ini: '2019-01', fim: '2030-01' }, '2020-01', '2026-10')).toEqual(['2020-01', '2026-10']);
  });
});

describe('lerPonto', () => {
  const s = monthlySeries([L('2025-01-31', 'C', 100, 1000)], priceAt, '2025-04-30');
  it('rendimento desde a compra, 12 meses e no mês até o ponto tocado', () => {
    const r = lerPonto(s, 2);
    expect(r.v).toBeCloseTo(1210);
    expect(r.desdeInicio).toBeCloseTo(0.21);
    expect(r.rMes).toBeCloseTo(0.1);
    expect(r.meses12).toBe(3);
  });
  it('acha o ponto mais próximo de uma data', () => {
    expect(pontoMaisProximo(s, Date.UTC(2025, 2, 25))).toBe(2);
  });
});

describe('Ibovespa (BOVA11)', () => {
  it('curva acumulada e comparação no período', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 100, 1000)], priceAt, '2025-04-30');
    const c = comparar(s, '2025-02', '2025-03', null, priceAt)!;
    expect(c.r.rent).toBeCloseTo(0.21);
    expect(c.ibov).toBeCloseTo(0.10);
    expect(ibovCurve(c.r.indice, () => null)).toBeNull();
  });
});

describe('proventosPorMes', () => {
  it('soma por mês dentro do período, com média', () => {
    const ls = [L('2025-01-10', 'P', 0, 10), L('2025-01-20', 'P', 0, 5), L('2025-03-10', 'P', 0, 7), L('2024-12-10', 'P', 0, 99)];
    const r = proventosPorMes(ls, '2025-01', '2025-03');
    expect(r.meses.map(m => m.v)).toEqual([15, 0, 7]);
    expect(r.total).toBe(22);
    expect(r.media).toBeCloseTo(22 / 3);
    expect(r.itens.map(l => l.v)).toEqual([7, 5, 10]);
  });
});
