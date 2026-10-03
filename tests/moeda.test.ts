import { describe, expect, it } from 'vitest';
import { montarLancamentos } from '../src/core/moeda';
import { compute } from '../src/core/calc';

let n = 0;
const id = () => 'x' + n++;

describe('compra de cripto em outra moeda', () => {
  it('em reais: um lançamento normal', () => {
    const r = montarLancamentos({ t: 'C', d: '2026-03-10', a: 'BTC', c: 'cripto', q: 0.01, moeda: 'BRL', pMoeda: 360000, cambio: 1 }, id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ p: 360000, v: 3600 });
    expect(r[0].moeda).toBeUndefined();
  });
  it('em dólar: converte pelo câmbio do dia', () => {
    const r = montarLancamentos({ t: 'C', d: '2026-03-10', a: 'BTC', c: 'cripto', q: 0.01, moeda: 'USD', pMoeda: 70000, cambio: 5.2 }, id);
    expect(r).toHaveLength(1);
    expect(r[0].p).toBeCloseTo(364000);
    expect(r[0].v).toBeCloseTo(3640);
    expect(r[0]).toMatchObject({ moeda: 'USD', pMoeda: 70000, cambio: 5.2 });
  });
  it('com outra cripto: compra uma e vende a outra pelo mesmo valor', () => {
    // 0,01 BTC a 20 ETH cada = paga 0,2 ETH; ETH a R$ 18.000 → R$ 3.600
    const r = montarLancamentos({ t: 'C', d: '2026-03-10', a: 'BTC', c: 'cripto', q: 0.01, moeda: 'ETH', pMoeda: 20, cambio: 18000 }, id);
    expect(r).toHaveLength(2);
    const [btc, eth] = r;
    expect(btc).toMatchObject({ t: 'C', a: 'BTC', v: 3600, par: eth.id });
    expect(eth).toMatchObject({ t: 'V', a: 'ETH', q: 0.2, p: 18000, v: 3600, par: btc.id, c: 'cripto' });
    // carteira: tinha 1 ETH comprado a R$ 10.000 → vende 0,2 com lucro
    const m = compute([{ id: 'e0', d: '2026-01-01', t: 'C', a: 'ETH', c: 'cripto', q: 1, p: 10000, v: 10000, o: 'manual' }, ...r], {});
    expect(m.list.find(p => p.a === 'ETH')).toMatchObject({ q: 0.8 });
    expect(m.list.find(p => p.a === 'ETH')!.real).toBeCloseTo(3600 - 2000);
    expect(m.list.find(p => p.a === 'BTC')).toMatchObject({ q: 0.01, cost: 3600 });
  });
  it('venda recebendo outra cripto: vende uma e compra a outra', () => {
    const r = montarLancamentos({ t: 'V', d: '2026-03-10', a: 'BTC', c: 'cripto', q: 0.01, moeda: 'USDT', pMoeda: 70000, cambio: 5.2 }, id);
    expect(r[1]).toMatchObject({ t: 'C', a: 'USDT', q: 700, v: 3640 });
  });
});
