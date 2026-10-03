import { describe, expect, it } from 'vitest';
import { comparar, ibovCurve, janela, lerPonto, periodRange, pontoMaisProximo, proventosPorMes } from '../src/core/analise';
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

describe('lerPonto (sobre o dinheiro aplicado)', () => {
  it('resultado total = valor + vendas + proventos - total comprado', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 100, 1000)], priceAt, '2025-04-30');
    const r = lerPonto(s, 2);
    expect(r.v).toBeCloseTo(1210);
    expect(r.comprado).toBe(1000);
    expect(r.resultado).toBeCloseTo(210);
    expect(r.pctTotal).toBeCloseTo(0.21);
    expect(r.mes.pct).toBeCloseTo(0.1);
    expect(r.doze.meses).toBe(3);
  });
  it('compra pequena que cai e compra grande depois: a % segue o dinheiro, não a média dos meses', () => {
    // Comprou R$ 1.000 a 10, caiu para 5 (−50%), comprou R$ 9.000 a 5 e o preço voltou a 6.
    const p2: Record<string, number> = { '2025-01': 10, '2025-02': 5, '2025-03': 6 };
    const pa: PriceAt = (_a, _c, ym) => p2[ym] ?? null;
    const s = monthlySeries([L('2025-01-31', 'C', 100, 1000), L('2025-02-28', 'C', 1800, 9000)], pa, '2025-03-31');
    const r = lerPonto(s, 2);
    expect(r.comprado).toBe(10000);
    expect(r.v).toBeCloseTo(1900 * 6);
    expect(r.pctTotal).toBeCloseTo(0.14);                // ganhou 1.400 sobre 10.000
    const twr = s.reduce((a, p) => a * (1 + p.r), 1) - 1; // a rentabilidade "por cota" seria −40%
    expect(twr).toBeCloseTo(-0.4);
  });
  it('vendeu tudo e comprou de novo: conta só a posição atual', () => {
    const p3: Record<string, number> = { '2025-01': 10, '2025-02': 12, '2025-03': 20, '2025-04': 21, '2025-05': 22 };
    const pa: PriceAt = (_a, _c, ym) => p3[ym] ?? null;
    const s = monthlySeries([
      L('2025-01-31', 'C', 10, 100),      // compra antiga
      L('2025-02-15', 'V', 10, 120),      // vende tudo
      L('2025-04-30', 'C', 100, 2100),    // compra de novo
    ], pa, '2025-05-31');
    const r = lerPonto(s, s.length - 1);
    expect(r.inicio).toBe('2025-04');
    expect(r.comprado).toBe(2100);
    expect(r.investido).toBe(2100);
    expect(r.resultado).toBeCloseTo(2200 - 2100);
    expect(r.pctTotal).toBeCloseTo(100 / 2100);
  });
  it('total investido = compras - vendas da posição atual', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 100, 1000), L('2025-03-15', 'V', 50, 600)], priceAt, '2025-04-30');
    const r = lerPonto(s, 3);
    expect(r.investido).toBe(400);
    expect(r.resultado).toBeCloseTo(50 * 12.1 + 600 - 1000);
    expect(r.pctTotal).toBeCloseTo((50 * 12.1 + 600 - 1000) / 400);
  });
  it('acha o ponto mais próximo de uma data', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 100, 1000)], priceAt, '2025-04-30');
    expect(pontoMaisProximo(s, Date.UTC(2025, 2, 25))).toBe(2);
  });
});

describe('janela', () => {
  it('ganho e base de um período com venda e provento', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 100, 1000), L('2025-03-15', 'V', 50, 600), L('2025-04-10', 'P', 0, 20)], priceAt, '2025-04-30');
    const j = janela(s, 1, 3); // fev a abr
    // início 1000; fim 50 × 12,1 = 605; vendas 600; proventos 20 → ganho 225 sobre base 1000
    expect(j.ganho).toBeCloseTo(605 - 1000 + 600 + 20);
    expect(j.base).toBe(1000);
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
