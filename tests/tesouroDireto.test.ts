import { describe, expect, it } from 'vitest';
import { precosTD } from '../src/core/tesouroDireto';
import { aplicarTesouroHoje } from '../scripts/lib.mjs';

const resgatar = { TesouroLegado: [
  { treasuryBondName: 'Tesouro Selic 2031', maturityDate: '2031-03-01T00:00', unitaryRedemptionValue: 19944.02, unitaryInvestmentValue: 0, lastMarketPricingDate: '2026-10-05T13:44:58.720' },
  { treasuryBondName: 'Tesouro Renda+ Aposentadoria Extra 2049', maturityDate: '2068-12-15T00:00', unitaryRedemptionValue: 1500.5, lastMarketPricingDate: '2026-10-05T09:30:00' },
] };
const investir = { TesouroLegado: [
  { treasuryBondName: 'Tesouro Selic 2031', maturityDate: '2031-03-01T00:00', unitaryRedemptionValue: 19944.02, unitaryInvestmentValue: 19952.71, lastMarketPricingDate: '2026-10-05T13:44:58.720' },
] };

describe('Tesouro Direto (site)', () => {
  it('lê o preço de venda de cada título e casa o nome com os arquivos públicos', () => {
    const r = precosTD([resgatar, investir], new Set(['TESOURO SELIC 2031', 'TESOURO RENDA+ APOSENTADORIA EXTRA 2049']));
    expect(r['TESOURO SELIC 2031']).toEqual({ p: 19944.02, ref: '2026-10-05' });
    expect(r['TESOURO RENDA+ APOSENTADORIA EXTRA 2049'].p).toBe(1500.5);
  });
  it('se o nome vier com o ano do vencimento, usa o ano do nome (Renda+ e Educa+)', () => {
    const r = precosTD([{ x: [{ treasuryBondName: 'Tesouro Educa+ 2035', maturityDate: '2035-12-15T00:00', unitaryRedemptionValue: 3000, lastMarketPricingDate: '2026-10-05' }] }],
      new Set(['TESOURO EDUCA+ 2031']));
    expect(Object.keys(r)).toEqual(['TESOURO EDUCA+ 2031']);
  });
  it('ignora respostas estranhas', () => {
    expect(precosTD([null, 'x', { a: 1 }, { b: [{ treasuryBondName: 'Tesouro Selic 2031', unitaryRedemptionValue: 0 }] }])).toEqual({});
  });
  it('completa o CSV (que vai até ontem) com o preço de hoje', () => {
    const res: { ultimo: string; m: string[]; p: Record<string, (number | null)[]>; u: Record<string, [number, string]> } = { ultimo: '2026-10-02', m: ['2026-09', '2026-10'], p: { 'TESOURO SELIC 2031': [19800, 19924.17], 'TESOURO IPCA+ 2035': [2500, 2523.14] },
      u: { 'TESOURO SELIC 2031': [19924.17, '2026-10-02'], 'TESOURO IPCA+ 2035': [2523.14, '2026-10-02'] } };
    const diario: { d: string[]; c: Record<string, (number | null)[]>; v: Record<string, (number | null)[]> } = { d: ['2026-10-02'], c: { 'TESOURO SELIC 2031': [19930], 'TESOURO IPCA+ 2035': [2530] }, v: { 'TESOURO SELIC 2031': [19924.17], 'TESOURO IPCA+ 2035': [2523.14] } };
    expect(aplicarTesouroHoje(res, diario, [resgatar, investir])).toBe(2); // Selic 2031 e o Renda+, título novo nos dados
    expect(res.u['TESOURO SELIC 2031']).toEqual([19944.02, '2026-10-05']);
    expect(res.u['TESOURO IPCA+ 2035']).toEqual([2523.14, '2026-10-02']); // não negociado hoje: fica o último
    expect(res.ultimo).toBe('2026-10-05');
    expect(res.u['TESOURO RENDA+ APOSENTADORIA EXTRA 2049']).toEqual([1500.5, '2026-10-05']);
    expect(res.p['TESOURO SELIC 2031']).toEqual([19800, 19944.02]);
    expect(diario.d).toEqual(['2026-10-02', '2026-10-05']);
    expect(diario.c['TESOURO SELIC 2031']).toEqual([19930, 19952.71]);
    expect(diario.v['TESOURO IPCA+ 2035']).toEqual([2523.14, null]);
  });
});
