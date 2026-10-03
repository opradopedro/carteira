import { describe, expect, it } from 'vitest';
import { anoNoNome, createCotahistAccumulator, monthRange, parseMbCandles, parseMbDiario, parseTesouroCsv, tesouroDiario, tesouroKey } from '../scripts/lib.mjs';

// Linhas no layout oficial do arquivo COTAHIST da B3 (cotações públicas).
const linha = (data: string, bdi: string, ticker: string, nome: string, fech: string) =>
  `01${data}${bdi}${ticker.padEnd(12)}010${nome.padEnd(12)}PN      N2   R$  000000000496600000000050030000000004913000000000497100000000${fech}000000000498047236000000000034127800000000169677372000000000000000009999123100000010000000000000BRPETRACNPR6230`;

describe('COTAHIST', () => {
  it('guarda o último fechamento de cada mês e a classe', () => {
    const acc = createCotahistAccumulator(2026);
    acc.add(linha('20260929', '02', 'PETR4', 'PETROBRAS', '04977'));
    acc.add(linha('20260930', '02', 'PETR4', 'PETROBRAS', '05010'));
    acc.add(linha('20261001', '02', 'PETR4', 'PETROBRAS', '05117'));
    acc.add(linha('20261001', '12', 'MXRF11', 'FII MAXI REN', '00909'));
    acc.add(linha('20261001', '14', 'BOVA11', 'ISHARES BOVA', '18369'));
    acc.add('99COTAHIST.2026BOVESPA 2026100100003014710');
    const r = acc.result();
    expect(r.p.PETR4[8]).toBe(50.10);
    expect(r.p.PETR4[9]).toBe(51.17);
    expect(r.p.MXRF11[9]).toBe(9.09);
    expect(r.k).toEqual({ PETR4: 'a', MXRF11: 'f', BOVA11: 'o' });
    expect(r.ultimo).toBe('2026-10-01');
    expect(r.n.MXRF11).toBe('FII MAXI REN');
    const d = acc.diario();
    expect(d.P.d).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(d.P.p.PETR4).toEqual([49.77, 50.10, 51.17]);
    expect(d.M.p.MXRF11).toEqual([null, null, 9.09]);
  });
});

describe('Tesouro Transparente', () => {
  const csv = [
    'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha',
    'Tesouro IPCA+;15/05/2029;30/09/2026;7,50;7,62;3480,10;3470,22;3470,22',
    'Tesouro IPCA+;15/05/2029;01/10/2026;7,48;7,60;3482,00;3472,50;3472,50',
    'Tesouro IPCA+;15/05/2029;29/08/2026;7,40;7,52;3450,00;3440,00;3440,00',
    'Tesouro Selic;01/03/2029;01/10/2026;0,05;0,06;19985,64;19970,63;19970,63',
  ].join('\n');
  it('pega o último PU de cada mês e o mais recente', () => {
    const r = parseTesouroCsv(csv, '2026-08');
    expect(r.m).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(r.p['TESOURO IPCA+ 2029']).toEqual([3440, 3470.22, 3472.5]);
    expect(r.u['TESOURO SELIC 2029']).toEqual([19970.63, '2026-10-01']);
    expect(r.ultimo).toBe('2026-10-01');
  });
  it('Renda+ e Educa+ usam o ano do nome, não o vencimento final', () => {
    expect(anoNoNome('Tesouro Renda+ Aposentadoria Extra', 2084)).toBe(2065);
    expect(anoNoNome('Tesouro Educa+', 2030)).toBe(2026);
    expect(anoNoNome('Tesouro IPCA+', 2029)).toBe(2029);
  });
  it('diário: PU de compra e de venda por dia, por ano', () => {
    const d = tesouroDiario(csv);
    expect(d['2026'].d).toEqual(['2026-08-29', '2026-09-30', '2026-10-01']);
    expect(d['2026'].c['TESOURO IPCA+ 2029']).toEqual([3450, 3480.10, 3482]);
    expect(d['2026'].v['TESOURO SELIC 2029']).toEqual([null, null, 19970.63]);
  });
  it('a chave casa com o nome que vem da B3', () => {
    expect(tesouroKey('Tesouro IPCA+ com Juros Semestrais 2035')).toBe('TESOURO IPCA+ COM JUROS SEMESTRAIS 2035');
  });
});

describe('utilitários', () => {
  it('monthRange cruza o ano', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('velas diárias do Mercado Bitcoin', () => {
    expect(parseMbDiario({ t: [Date.UTC(2026, 2, 10) / 1000], c: ['350000.5'] })).toEqual({ d: ['2026-03-10'], p: [350000.5] });
  });
  it('velas mensais do Mercado Bitcoin', () => {
    const r = parseMbCandles({ t: [Date.UTC(2026, 8, 1) / 1000], c: ['433994.00'] }, '2026-08', '2026-09');
    expect(r.p).toEqual([null, 433994]);
  });
});
