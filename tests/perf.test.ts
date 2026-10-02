import { describe, expect, it } from 'vitest';
import { cdiAcumulado, ipcaAcumulado, monthlySeries, periodResult, type PriceAt } from '../src/core/perf';
import type { Lancamento } from '../src/core/types';

let n = 0;
const L = (d: string, t: Lancamento['t'], q: number, p: number, v?: number): Lancamento =>
  ({ id: String(n++), d, t, a: 'AAAA3', c: 'acao', q, p, v: v ?? q * p, o: 'manual' });

const precos: Record<string, number> = { '2025-01': 100, '2025-02': 110, '2025-03': 121, '2025-04': 121 };
const priceAt: PriceAt = (_a, _c, ym) => precos[ym] ?? null;

describe('monthlySeries', () => {
  it('compra no último dia do mês não distorce: só os meses seguintes contam', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 10, 100)], priceAt, '2025-03-31');
    expect(s.map(p => p.ym)).toEqual(['2025-01', '2025-02', '2025-03']);
    expect(s[0].v).toBe(1000);
    expect(s[0].r).toBe(0);
    expect(s[1].r).toBeCloseTo(0.10);
    expect(s[2].r).toBeCloseTo(0.10);
  });

  it('aporte no meio do mês entra pela fração de dias (Dietz modificado)', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 10, 100), L('2025-02-14', 'C', 10, 105)], priceAt, '2025-02-28');
    // V_ini 1000, aporte 1050 no dia 14 (peso 14/28), V_fim 20*110 = 2200
    expect(s[1].v).toBe(2200);
    expect(s[1].r).toBeCloseTo((2200 - 1000 - 1050) / (1000 + 1050 * 14 / 28));
  });

  it('proventos contam como rendimento', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 10, 100), L('2025-04-10', 'P', 0, 0, 50)], priceAt, '2025-04-30');
    // abril: preço parado (121), recebeu 50 sobre 1210
    expect(s[3].r).toBeCloseTo(50 / 1210);
  });

  it('mês corrente usa o valor atual informado', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 10, 100)], priceAt, '2025-02-10', { v: 1050 });
    expect(s.at(-1)!.v).toBe(1050);
    expect(s.at(-1)!.d).toBe('2025-02-10');
  });

  it('sem cotação histórica, avalia pelo custo e avisa', () => {
    const s = monthlySeries([L('2025-01-31', 'C', 10, 100)], () => null, '2025-02-28');
    expect(s[1].v).toBe(1000);
    expect(s[1].semPreco).toEqual(['AAAA3']);
  });
});

describe('periodResult', () => {
  const s = monthlySeries([
    L('2025-01-31', 'C', 10, 100),
    L('2025-03-31', 'V', 5, 121),
    L('2025-04-10', 'P', 0, 0, 20),
  ], priceAt, '2025-04-30');

  it('encadeia a rentabilidade mensal', () => {
    const r = periodResult(s, '2025-02', '2025-03')!;
    expect(r.rent).toBeCloseTo(1.1 * 1.1 - 1);
    expect(r.vIni).toBe(1000);
  });

  it('ganho = patrimônio final - inicial - aportes + proventos', () => {
    const r = periodResult(s, '2025-02', '2025-04')!;
    expect(r.aportes).toBeCloseTo(-605);
    expect(r.prov).toBe(20);
    expect(r.vFim).toBeCloseTo(605);
    expect(r.ganho).toBeCloseTo(605 - 1000 + 605 + 20);
    expect(r.indice[0]).toMatchObject({ ym: '2025-01', d: '2025-01-31', acc: 0 });
  });
});

describe('índices de referência', () => {
  it('CDI acumula juros compostos diários no intervalo', () => {
    const cdi: [string, number][] = [['2025-01-02', 0.05], ['2025-01-03', 0.05], ['2025-01-06', 0.05]];
    expect(cdiAcumulado(cdi, '2025-01-02', '2025-01-06')).toBeCloseTo(1.0005 ** 2 - 1, 10);
  });
  it('IPCA acumula os meses do intervalo e informa o último disponível', () => {
    const ipca: [string, number][] = [['2025-01-01', 0.16], ['2025-02-01', 1.31], ['2025-03-01', 0.56]];
    const r = ipcaAcumulado(ipca, '2025-02', '2025-06');
    expect(r.acc).toBeCloseTo(1.0131 * 1.0056 - 1, 10);
    expect(r.ultimo).toBe('2025-03');
  });
});
