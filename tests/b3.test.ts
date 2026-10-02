import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mergeImport, rowsToLancs } from '../src/core/b3';
import { compute } from '../src/core/calc';

// Dados fictícios, no formato das planilhas da Área do Investidor da B3.
const negociacao = [
  { 'Data do Negócio': '10/03/2025', 'Tipo de Movimentação': 'Compra', 'Mercado': 'Mercado à Vista', 'Prazo/Vencimento': '-', 'Instituição': 'CORRETORA X', 'Código de Negociação': 'ITSA4', 'Quantidade': 300, 'Preço': 9.8, 'Valor': 2940 },
  { 'Data do Negócio': '11/03/2025', 'Tipo de Movimentação': 'Compra', 'Mercado': 'Mercado Fracionário', 'Prazo/Vencimento': '-', 'Instituição': 'CORRETORA X', 'Código de Negociação': 'PETR4F', 'Quantidade': 7, 'Preço': '36,50', 'Valor': '' },
  { 'Data do Negócio': '09/03/2026', 'Tipo de Movimentação': 'Venda', 'Mercado': 'Mercado à Vista', 'Prazo/Vencimento': '-', 'Instituição': 'CORRETORA X', 'Código de Negociação': 'ITSA4', 'Quantidade': 100, 'Preço': 11.2, 'Valor': 1120 },
];

const movimentacao = [
  { 'Entrada/Saída': 'Credito', 'Data': '14/11/2025', 'Movimentação': 'Rendimento', 'Produto': 'MXRF11 - MAXI RENDA FUNDO DE INVESTIMENTO IMOBILIARIO', 'Instituição': 'CORRETORA X', 'Quantidade': 400, 'Preço unitário': 0.09, 'Valor da Operação': 36 },
  { 'Entrada/Saída': 'Credito', 'Data': '21/11/2025', 'Movimentação': 'Dividendo', 'Produto': 'PETR4 - PETROLEO BRASILEIRO S/A PETROBRAS', 'Instituição': 'CORRETORA X', 'Quantidade': 100, 'Preço unitário': 1.42, 'Valor da Operação': 142 },
  { 'Entrada/Saída': 'Debito', 'Data': '21/11/2025', 'Movimentação': 'Dividendo', 'Produto': 'PETR4 - PETROLEO BRASILEIRO S/A PETROBRAS', 'Instituição': 'CORRETORA X', 'Quantidade': 100, 'Preço unitário': 1.42, 'Valor da Operação': 142 },
  { 'Entrada/Saída': 'Credito', 'Data': '28/08/2026', 'Movimentação': 'Juros Sobre Capital Próprio', 'Produto': 'ITSA4 - ITAUSA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 200, 'Preço unitário': 0.32, 'Valor da Operação': 64 },
  { 'Entrada/Saída': 'Credito', 'Data': '12/03/2025', 'Movimentação': 'Transferência - Liquidação', 'Produto': 'ITSA4 - ITAUSA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 300, 'Preço unitário': '-', 'Valor da Operação': '-' },
  { 'Entrada/Saída': 'Credito', 'Data': '20/06/2025', 'Movimentação': 'Compra', 'Produto': 'Tesouro IPCA+ 2029', 'Instituição': 'CORRETORA X', 'Quantidade': 1.5, 'Preço unitário': 3120, 'Valor da Operação': 4680 },
  { 'Entrada/Saída': 'Debito', 'Data': '15/05/2026', 'Movimentação': 'Resgate', 'Produto': 'Tesouro Selic 2026', 'Instituição': 'CORRETORA X', 'Quantidade': 0.5, 'Preço unitário': 17000, 'Valor da Operação': 8500 },
  { 'Entrada/Saída': 'Credito', 'Data': '15/01/2026', 'Movimentação': 'Juros', 'Produto': 'Tesouro IPCA+ com Juros Semestrais 2035', 'Instituição': 'CORRETORA X', 'Quantidade': 2, 'Preço unitário': 50, 'Valor da Operação': 100 },
  { 'Entrada/Saída': 'Credito', 'Data': '02/04/2025', 'Movimentação': 'Desdobro', 'Produto': 'ABCD3 - EMPRESA FICTICIA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 100, 'Preço unitário': '-', 'Valor da Operação': '-' },
  { 'Entrada/Saída': 'Debito', 'Data': '03/04/2025', 'Movimentação': 'Grupamento', 'Produto': 'WXYZ3 - OUTRA FICTICIA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 90, 'Preço unitário': '-', 'Valor da Operação': '-' },
  { 'Entrada/Saída': 'Credito', 'Data': '04/04/2025', 'Movimentação': 'Bonificação em Ativos', 'Produto': 'ITSA4 - ITAUSA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 15, 'Preço unitário': 18.5, 'Valor da Operação': '' },
  { 'Entrada/Saída': 'Credito', 'Data': '05/04/2025', 'Movimentação': 'Direito de Subscrição', 'Produto': 'ITSA1 - ITAUSA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 3, 'Preço unitário': '-', 'Valor da Operação': '-' },
];

describe('rowsToLancs — Negociação', () => {
  const r = rowsToLancs(negociacao);
  it('reconhece o arquivo e lê compras e vendas', () => {
    expect(r.kind).toBe('Negociação');
    expect(r.lancs).toHaveLength(3);
    expect(r.lancs.map(l => l.t)).toEqual(['C', 'C', 'V']);
  });
  it('tira o F do fracionário e calcula o valor quando falta', () => {
    const p = r.lancs[1];
    expect(p.a).toBe('PETR4');
    expect(p.d).toBe('2025-03-11');
    expect(p.v).toBeCloseTo(7 * 36.5);
    expect(p.c).toBe('acao');
  });
  it('aceita datas como Date (leitura do xlsx com cellDates)', () => {
    const x = rowsToLancs([{ ...negociacao[0], 'Data do Negócio': new Date(Date.UTC(2025, 2, 10)) }]);
    expect(x.lancs[0].d).toBe('2025-03-10');
  });
});

describe('rowsToLancs — Movimentação', () => {
  const r = rowsToLancs(movimentacao);
  const by = (n: string) => r.lancs.filter(l => (l.n || '') === n || l.a === n);
  it('reconhece o arquivo', () => expect(r.kind).toBe('Movimentação'));
  it('lê proventos em crédito e ignora débitos', () => {
    const prov = r.lancs.filter(l => l.t === 'P');
    expect(prov.map(l => l.v).sort((a, b) => a - b)).toEqual([36, 64, 100, 142]);
    expect(prov.find(l => l.a === 'MXRF11')!.c).toBe('fii');
  });
  it('lê compra e resgate do Tesouro', () => {
    const c = by('TESOURO IPCA+ 2029')[0];
    expect(c).toMatchObject({ t: 'C', c: 'tesouro', q: 1.5, v: 4680 });
    const rs = by('TESOURO SELIC 2026')[0];
    expect(rs).toMatchObject({ t: 'V', q: 0.5, v: 8500, n: 'Resgate' });
  });
  it('trata juros semestrais do Tesouro como provento', () => {
    expect(by('TESOURO IPCA+ COM JUROS SEMESTRAIS 2035')[0]).toMatchObject({ t: 'P', v: 100 });
  });
  it('transforma desdobro, grupamento e bonificação em ajustes de quantidade', () => {
    expect(by('ABCD3')[0]).toMatchObject({ t: 'S', q: 100, v: 0 });
    expect(by('WXYZ3')[0]).toMatchObject({ t: 'S', q: -90, v: 0 });
    const bon = r.lancs.find(l => l.t === 'S' && l.a === 'ITSA4')!;
    expect(bon.q).toBe(15);
    expect(bon.v).toBeCloseTo(15 * 18.5);
  });
  it('ignora liquidações e tipos que o app não usa', () => {
    expect(r.lancs.some(l => l.a === 'ITSA1')).toBe(false);
    expect(r.ignored).toBe(3); // débito de dividendo, liquidação, direito de subscrição
  });
});

describe('rowsToLancs — casos vistos em extrato real (valores fictícios)', () => {
  const linhas = [
    { 'Entrada/Saída': 'Credito', 'Data': '21/09/2026', 'Movimentação': 'Reembolso', 'Produto': 'ABCD4 - EMPRESA FICTICIA S.A.        ', 'Instituição': 'CORRETORA X', 'Quantidade': 0, 'Preço unitário': '-', 'Valor da Operação': 43.38 },
    { 'Entrada/Saída': 'Credito', 'Data': '01/09/2026', 'Movimentação': 'Empréstimo', 'Produto': 'ABCD4 - EMPRESA FICTICIA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 150, 'Preço unitário': '-', 'Valor da Operação': 6282 },
    { 'Entrada/Saída': 'Credito', 'Data': '24/08/2026', 'Movimentação': 'Atualização', 'Produto': 'ABCD4 - EMPRESA FICTICIA S.A.', 'Instituição': 'CORRETORA X', 'Quantidade': 150, 'Preço unitário': '-', 'Valor da Operação': '-' },
    { 'Entrada/Saída': 'Credito', 'Data': '13/05/2022', 'Movimentação': 'COMPRA / VENDA', 'Produto': 'CDB - CDB000FICT - BANCO FICTICIO S/A', 'Instituição': 'CORRETORA X', 'Quantidade': 500, 'Preço unitário': 1, 'Valor da Operação': 500 },
    { 'Entrada/Saída': 'Debito', 'Data': '11/08/2022', 'Movimentação': 'VENCIMENTO', 'Produto': 'CDB - CDB000FICT - BANCO FICTICIO S/A', 'Instituição': 'CORRETORA X', 'Quantidade': 500, 'Preço unitário': 0, 'Valor da Operação': 0 },
    { 'Entrada/Saída': 'Credito', 'Data': '02/01/2026', 'Movimentação': 'Compra', 'Produto': 'Tesouro Renda+ Aposentadoria Extra 2065', 'Instituição': 'CORRETORA X', 'Quantidade': 0.75, 'Preço unitário': 178.24, 'Valor da Operação': 133.68 },
  ];
  const r = rowsToLancs(linhas);
  it('reembolso de proventos de ações emprestadas conta como provento', () => {
    expect(r.lancs.find(l => l.t === 'P')).toMatchObject({ a: 'ABCD4', v: 43.38, n: 'Reembolso (ações emprestadas)' });
  });
  it('empréstimo de ações e atualização não mexem na posição', () => {
    expect(r.lancs.filter(l => l.a === 'ABCD4')).toHaveLength(1);
  });
  it('CDB usa o código do título; vencimento sem valor sai pelo custo', () => {
    const cdb = r.lancs.filter(l => l.a === 'CDB000FICT');
    expect(cdb.map(l => [l.t, l.c, l.q, l.v])).toEqual([['C', 'outro', 500, 500], ['V', 'outro', 500, 0]]);
    const m = compute(cdb, {});
    expect(m.list[0]).toMatchObject({ q: 0, real: 0 });
  });
  it('Renda+ mantém o nome com o ano da aposentadoria', () => {
    expect(r.lancs.at(-1)).toMatchObject({ a: 'TESOURO RENDA+ APOSENTADORIA EXTRA 2065', c: 'tesouro', t: 'C' });
  });
});

describe('rowsToLancs — arquivo desconhecido', () => {
  it('não reconhece planilha qualquer', () => {
    const r = rowsToLancs([{ Nome: 'x', Valor: 1 }]);
    expect(r.kind).toBe('');
    expect(r.lancs).toHaveLength(0);
  });
});

describe('mergeImport — reimportar não duplica', () => {
  it('reimportar o mesmo arquivo não acrescenta nada', () => {
    const a = rowsToLancs(negociacao).lancs;
    const first = mergeImport([], a);
    expect(first.added).toHaveLength(3);
    const again = mergeImport(first.next, rowsToLancs(negociacao).lancs);
    expect(again.added).toHaveLength(0);
    expect(again.dup).toBe(3);
  });
  it('mantém dois negócios idênticos no mesmo dia, e não os duplica ao reimportar', () => {
    const rows = [negociacao[0], negociacao[0]];
    const first = mergeImport([], rowsToLancs(rows).lancs);
    expect(first.added).toHaveLength(2);
    const again = mergeImport(first.next, rowsToLancs(rows).lancs);
    expect(again.added).toHaveLength(0);
  });
  it('arquivo com período sobreposto só acrescenta o que é novo', () => {
    const first = mergeImport([], rowsToLancs(negociacao.slice(0, 2)).lancs);
    const second = mergeImport(first.next, rowsToLancs(negociacao).lancs);
    expect(second.added).toHaveLength(1);
    expect(second.added[0].t).toBe('V');
  });
});

describe('leitura de .xlsx real', () => {
  it('lê planilha gerada no formato da B3', () => {
    const ws = XLSX.utils.json_to_sheet(negociacao);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Negociação');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const back = XLSX.read(buf, { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(back.Sheets[back.SheetNames[0]], { defval: '', raw: true });
    const r = rowsToLancs(rows);
    expect(r.kind).toBe('Negociação');
    expect(r.lancs).toHaveLength(3);
  });
});
