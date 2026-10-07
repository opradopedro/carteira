import { describe, expect, it } from 'vitest';
import { classificar, categoriaPorPalavras, resumoMes, serieMeses, termoDe } from '../src/banco/classificar';
import { converterTx } from '../src/banco/pluggy';
import type { ContaBanco, TxBanco } from '../src/banco/tipos';

const contas: ContaBanco[] = [
  { id: 'mp', item: 'i1', banco: 'Mercado Pago', nome: 'Conta', tipo: 'corrente', saldo: 0, em: '' },
  { id: 'mpc', item: 'i1', banco: 'Mercado Pago', nome: 'Cartão', tipo: 'cartao', saldo: 0, em: '' },
  { id: 'nu', item: 'i2', banco: 'Nubank', nome: 'Conta', tipo: 'corrente', saldo: 0, em: '' },
];
let n = 0;
const tx = (conta: string, d: string, desc: string, v: number, extra: Partial<TxBanco> = {}): TxBanco =>
  ({ id: String(++n), chave: 'k' + n, conta, d, desc, v, ...extra });

// O caso do Mercado Pago: cada compra no crédito vai para a caixinha e volta para pagar a fatura.
const txs = [
  tx('mp', '2026-09-05', 'Pix recebido de EMPRESA LTDA', 2000),
  tx('mpc', '2026-09-06', 'IFOOD *RESTAURANTE', -300),
  tx('mp', '2026-09-06', 'Dinheiro reservado', -300),
  tx('mpc', '2026-09-08', 'SUPERMERCADO BH', -500),
  tx('mp', '2026-09-08', 'Dinheiro reservado', -500),
  tx('mpc', '2026-09-10', 'Estorno SUPERMERCADO BH', 50),
  tx('mp', '2026-09-20', 'Dinheiro retirado', 800),
  tx('mp', '2026-09-20', 'Pagamento de fatura', -800),
  tx('mpc', '2026-09-20', 'Pagamento recebido', 800),
  tx('nu', '2026-09-12', 'Transferência enviada pelo Pix', -1000),
  tx('mp', '2026-09-12', 'Pix recebido', 1000),
  tx('mp', '2026-09-15', 'Rendimentos', 3.21),
  tx('mp', '2026-09-25', 'Pix enviado JOAO', -100),
  tx('mp', '2026-09-26', 'Pix recebido de MARIA', 30, { mesmaPessoa: true }),
];

describe('banco: entradas e saídas de verdade', () => {
  const cls = classificar(txs, { contas, ajustes: {}, regras: [] });
  const nat = (desc: string) => cls.filter(x => x.desc === desc).map(x => x.nat);
  it('caixinha, fatura e transferência entre contas suas não contam', () => {
    expect(nat('Dinheiro reservado')).toEqual(['interna', 'interna']);
    expect(nat('Dinheiro retirado')).toEqual(['interna']);
    expect(nat('Pagamento de fatura')).toEqual(['fatura']);
    expect(nat('Pagamento recebido')).toEqual(['fatura']);
    expect(nat('Transferência enviada pelo Pix')).toEqual(['interna']);
    expect(nat('Pix recebido')).toEqual(['interna']);
    expect(nat('Pix recebido de MARIA')).toEqual(['interna']); // mesmo CPF
  });
  it('resumo do mês mostra a entrada real (salário) e os gastos reais (compras no cartão)', () => {
    const r = resumoMes(cls, '2026-09');
    expect(r.receitas).toBeCloseTo(2003.21);
    expect(r.despesas).toBeCloseTo(300 + 500 - 50 + 100);
    expect(r.internasEntrada).toBeCloseTo(800 + 1000 + 30);
    expect(r.porCategoria.map(c => c.cat)).toEqual(['Mercado', 'Alimentação', 'Transferências']);
    expect(r.porCategoria[0].v).toBeCloseTo(450);
  });
  it('correção manual e regra para as parecidas', () => {
    const regra = { id: 'r', termo: termoDe('Pix enviado JOAO'), cat: 'Moradia', nat: 'despesa' as const };
    const c2 = classificar(txs, { contas, ajustes: { k1: { cat: 'Salário' } }, regras: [regra] });
    expect(c2.find(x => x.chave === 'k1')!.cat).toBe('Salário');
    expect(c2.find(x => x.desc === 'Pix enviado JOAO')!.cat).toBe('Moradia');
    expect(termoDe('PIX ENVIADO 12/09 JOAO 123456')).toBe('pix enviado joao');
  });
  it('série mensal', () => {
    const s = serieMeses(cls, '2026-09', 3);
    expect(s.map(x => x.mes)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(s[2].receitas).toBeCloseTo(2003.21);
  });
});

describe('categorias por palavras', () => {
  it.each([
    ['UBER *TRIP', 'Transporte'], ['MERCADOLIVRE*LOJA', 'Compras'], ['Supermercado Dia', 'Mercado'],
    ['DROGASIL 123', 'Saúde'], ['NETFLIX.COM', 'Assinaturas'], ['Pagamento das contas', null],
  ])('%s → %s', (d, c) => expect(categoriaPorPalavras(d)).toBe(c));
});

describe('conversão da Pluggy', () => {
  const conta = { id: 'c', cartao: false, doc: '12345678900' };
  it('data em horário de Brasília, sinal e mesma pessoa pelo CPF', () => {
    const t = converterTx({ id: 'x', amount: 50, date: '2026-09-02T01:00:00.000Z', description: 'PIX', type: 'CREDIT',
      paymentData: { payer: { documentNumber: { value: '123.456.789-00' } } } }, conta, 1);
    expect(t.d).toBe('2026-09-01');
    expect(t.v).toBe(50);
    expect(t.mesmaPessoa).toBe(true);
  });
  it('compra no cartão vira saída; chave estável pelo id da instituição', () => {
    const t = converterTx({ id: 'y', providerId: 'abc', amount: 120.5, date: '2026-09-02T12:00:00.000Z', description: 'LOJA', category: 'Shopping' }, { ...conta, cartao: true }, 1);
    expect(t.v).toBe(-120.5);
    expect(t.chave).toBe('p:abc');
    expect(t.catP).toBe('Shopping');
  });
});
