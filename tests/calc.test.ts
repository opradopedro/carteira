import { describe, expect, it } from 'vitest';
import { compute } from '../src/core/calc';
import type { Lancamento, Precos } from '../src/core/types';

let n = 0;
const L = (d: string, t: Lancamento['t'], a: string, q: number, p: number, v?: number, c: Lancamento['c'] = 'acao'): Lancamento =>
  ({ id: String(n++), d, t, a, c, q, p, v: v ?? q * p, o: 'manual' });
const hoje = new Date('2026-10-02T12:00:00');

describe('compute — preço médio e resultado', () => {
  it('preço médio ponderado e lucro na venda', () => {
    const m = compute([
      L('2025-01-10', 'C', 'AAAA3', 100, 10),
      L('2025-02-10', 'C', 'AAAA3', 100, 20),
      L('2025-03-10', 'V', 'AAAA3', 50, 30),
    ], {}, hoje);
    const p = m.list[0];
    expect(p.q).toBe(150);
    expect(p.pm).toBeCloseTo(15);
    expect(p.cost).toBeCloseTo(2250);
    expect(p.real).toBeCloseTo(50 * (30 - 15));
    expect(m.tot.realized).toBeCloseTo(750);
  });

  it('vender tudo zera a posição e fecha o custo', () => {
    const m = compute([L('2025-01-10', 'C', 'AAAA3', 10, 10), L('2025-02-10', 'V', 'AAAA3', 10, 12)], {}, hoje);
    expect(m.open).toHaveLength(0);
    expect(m.list[0]).toMatchObject({ q: 0, cost: 0 });
    expect(m.list[0].real).toBeCloseTo(20);
    expect(m.tot.cost).toBe(0);
  });

  it('day trade: compra antes da venda no mesmo dia, mesmo fora de ordem', () => {
    const m = compute([L('2025-01-10', 'V', 'AAAA3', 10, 12), L('2025-01-10', 'C', 'AAAA3', 10, 10)], {}, hoje);
    expect(m.list[0].real).toBeCloseTo(20);
  });

  it('usa a cotação para valor e resultado; sem cotação, avalia pelo custo', () => {
    const precos: Precos = { AAAA3: { p: 15, em: '', fonte: 'manual' } };
    const m = compute([L('2025-01-10', 'C', 'AAAA3', 100, 10), L('2025-01-10', 'C', 'BBBB3', 10, 10)], precos, hoje);
    const a = m.list.find(p => p.a === 'AAAA3')!;
    expect(a.value).toBe(1500);
    expect(a.res).toBe(500);
    expect(m.tot.semCot).toBe(1);
    expect(m.tot.value).toBe(1600);
    expect(m.tot.res).toBe(500);
  });
});

describe('compute — venda a descoberto e direitos', () => {
  it('vender mais do que tem e recomprar zera a posição e realiza o prejuízo da recompra', () => {
    const m = compute([
      L('2025-07-17', 'C', 'AAAA3', 205, 20),
      L('2026-02-18', 'V', 'AAAA3', 205, 25),
      L('2026-02-18', 'V', 'AAAA3', 205, 25.4),   // vendeu sem ter (vira aluguel)
      L('2026-02-23', 'C', 'AAAA3', 205, 26.9),   // recompra para devolver
    ], {}, hoje);
    const p = m.list[0];
    expect(p.q).toBe(0);
    expect(p.cost).toBe(0);
    expect(p.real).toBeCloseTo(205 * 5 + 205 * (25.4 - 26.9));
    expect(m.open).toHaveLength(0);
  });
  it('enquanto não recompra, a posição fica negativa', () => {
    const m = compute([L('2026-02-18', 'V', 'AAAA3', 10, 25)], {}, hoje);
    expect(m.list[0].q).toBe(-10);
    expect(m.open).toHaveLength(0);
  });
  it('vender direito de subscrição sem posição é ganho, não venda a descoberto', () => {
    const m = compute([L('2023-05-04', 'V', 'CASH1', 1, 0.3)], {}, hoje);
    expect(m.list[0].q).toBe(0);
    expect(m.list[0].real).toBeCloseTo(0.3);
  });
});

describe('compute — eventos', () => {
  it('desdobro dobra a quantidade e divide o preço médio', () => {
    const m = compute([L('2025-01-10', 'C', 'AAAA3', 100, 20), L('2025-02-01', 'S', 'AAAA3', 100, 0, 0)], {}, hoje);
    expect(m.list[0].q).toBe(200);
    expect(m.list[0].pm).toBeCloseTo(10);
  });
  it('grupamento reduz a quantidade e mantém o custo', () => {
    const m = compute([L('2025-01-10', 'C', 'AAAA3', 100, 1), L('2025-02-01', 'S', 'AAAA3', -90, 0, 0)], {}, hoje);
    expect(m.list[0].q).toBe(10);
    expect(m.list[0].cost).toBeCloseTo(100);
    expect(m.list[0].pm).toBeCloseTo(10);
  });
  it('bonificação acrescenta quantidade e o custo atribuído', () => {
    const m = compute([L('2025-01-10', 'C', 'AAAA3', 100, 10), L('2025-02-01', 'S', 'AAAA3', 10, 0, 50)], {}, hoje);
    expect(m.list[0].q).toBe(110);
    expect(m.list[0].cost).toBeCloseTo(1050);
  });
});

describe('compute — proventos', () => {
  it('soma proventos totais e dos últimos 12 meses', () => {
    const m = compute([
      L('2024-06-01', 'C', 'FUND11', 100, 10, undefined, 'fii'),
      L('2024-07-15', 'P', 'FUND11', 0, 0, 10, 'fii'),
      L('2025-11-15', 'P', 'FUND11', 0, 0, 12, 'fii'),
      L('2026-09-15', 'P', 'FUND11', 0, 0, 13, 'fii'),
    ], {}, hoje);
    expect(m.tot.prov).toBe(35);
    expect(m.tot.prov12).toBe(25);
    expect(m.list[0].c).toBe('fii');
  });
  it('proventos não alteram custo nem a linha do investido', () => {
    const m = compute([L('2025-01-10', 'C', 'AAAA3', 10, 10), L('2025-02-10', 'P', 'AAAA3', 0, 0, 5)], {}, hoje);
    expect(m.tot.cost).toBe(100);
    expect(m.timeline).toEqual([{ d: '2025-01-10', v: 100 }]);
  });
});
