import { describe, expect, it } from 'vitest';
import { juntarArquivo, lerArquivoBanco } from '../src/banco/arquivo';
import { classificar, resumoMes } from '../src/banco/classificar';

const arq = (dia: string, transacoes: unknown[], saldo = 100) => JSON.stringify({
  formato: 'finai-banco/1', geradoEm: `${dia}T07:00:00-03:00`,
  contas: [{ id: 'mercadopago-conta', banco: 'Mercado Pago', nome: 'Conta', tipo: 'corrente', saldo },
           { id: 'nubank-cartao', banco: 'Nubank', nome: 'Cartão', tipo: 'cartao', saldo: 50 }],
  transacoes,
});

describe('arquivo finai-banco/1', () => {
  const d1 = arq('2026-10-08', [
    { conta: 'mercadopago-conta', data: '2026-10-07', descricao: 'Pix recebido de EMPRESA', valor: 2000 },
    { conta: 'mercadopago-conta', data: '2026-10-07', descricao: 'Dinheiro reservado', valor: -300 },
    { conta: 'nubank-cartao', data: '2026-10-07', descricao: 'IFOOD', valor: -300 },
    { conta: 'nubank-cartao', data: '2026-10-07', descricao: 'IFOOD', valor: -300 }, // duas iguais no mesmo dia
  ]);
  it('lê contas, tipos e transações', () => {
    const l = lerArquivoBanco(d1);
    expect(l.contas.map(c => [c.id, c.tipo])).toEqual([['arq:mercadopago-conta', 'corrente'], ['arq:nubank-cartao', 'cartao']]);
    expect(l.txs).toHaveLength(4);
    expect(new Set(l.txs.map(t => t.chave)).size).toBe(4);
  });
  it('janelas sobrepostas (rotina de 5 dias) não duplicam; saldo vem do arquivo mais novo', () => {
    let r = juntarArquivo([], [], lerArquivoBanco(d1));
    const d2 = arq('2026-10-09', [
      { conta: 'mercadopago-conta', data: '2026-10-07', descricao: 'Pix recebido de EMPRESA', valor: 2000 },
      { conta: 'mercadopago-conta', data: '2026-10-07', descricao: 'Dinheiro reservado', valor: -300 },
      { conta: 'nubank-cartao', data: '2026-10-07', descricao: 'IFOOD', valor: -300 },
      { conta: 'nubank-cartao', data: '2026-10-07', descricao: 'IFOOD', valor: -300 },
      { conta: 'nubank-cartao', data: '2026-10-08', descricao: 'UBER *TRIP', valor: '-25,90' },
    ], 1700);
    r = juntarArquivo(r.contas, r.txs, lerArquivoBanco(d2));
    expect(r.novas).toBe(1);
    expect(r.txs).toHaveLength(5);
    expect(r.contas.find(c => c.id === 'arq:mercadopago-conta')!.saldo).toBe(1700);
    const res = resumoMes(classificar(r.txs, { contas: r.contas, ajustes: {}, regras: [] }), '2026-10');
    expect(res.receitas).toBe(2000);
    expect(res.despesas).toBeCloseTo(625.9);
  });
  it('recusa arquivo fora do formato e ignora linhas incompletas', () => {
    expect(() => lerArquivoBanco('{"a":1}')).toThrow(/formato do FinAI/);
    const l = lerArquivoBanco(arq('2026-10-08', [{ conta: 'mercadopago-conta', data: 'ontem', valor: 1 }, { data: '2026-10-01', valor: 2 }]));
    expect(l.txs).toHaveLength(0);
    expect(l.avisos[0]).toMatch(/2 transação/);
  });
});
