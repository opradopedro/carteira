// Compra e venda de cripto pagas em dólar ou em outra cripto, convertidas para reais
// pela cotação do dia. Trocar cripto por cripto vira dois lançamentos ligados:
// a compra de uma e a venda da outra, pelo mesmo valor em reais.
import type { Classe, Lancamento } from './types';

export const MOEDAS = ['BRL', 'USD', 'BTC', 'ETH', 'SOL', 'USDT', 'USDC'] as const;
export type Moeda = (typeof MOEDAS)[number];
export const NOME_MOEDA: Record<Moeda, string> = {
  BRL: 'Real (R$)', USD: 'Dólar (US$)', BTC: 'Bitcoin (BTC)', ETH: 'Ethereum (ETH)', SOL: 'Solana (SOL)', USDT: 'Tether (USDT)', USDC: 'USD Coin (USDC)',
};
export const ehCripto = (m: string) => m !== 'BRL' && m !== 'USD';

export interface Operacao {
  t: 'C' | 'V'; d: string; a: string; c: Classe; q: number;
  moeda: Moeda;
  pMoeda: number;  // preço unitário na moeda usada
  cambio: number;  // quantos reais vale 1 unidade da moeda naquele dia
}

export function montarLancamentos(op: Operacao, novoId: () => string): Lancamento[] {
  const p = op.moeda === 'BRL' ? op.pMoeda : op.pMoeda * op.cambio;
  const v = op.q * p;
  const id = novoId();
  const principal: Lancamento = { id, d: op.d, t: op.t, a: op.a, c: op.c, q: op.q, p, v, o: 'manual' };
  if (op.moeda === 'BRL') return [principal];
  principal.moeda = op.moeda; principal.pMoeda = op.pMoeda; principal.cambio = op.cambio;
  if (!ehCripto(op.moeda)) { principal.n = op.t === 'C' ? 'Paga em dólar' : 'Recebida em dólar'; return [principal]; }
  // Pagar com cripto = vender essa cripto; receber cripto numa venda = comprá-la.
  const qPar = op.q * op.pMoeda;
  const par: Lancamento = {
    id: novoId(), d: op.d, t: op.t === 'C' ? 'V' : 'C', a: op.moeda, c: 'cripto', q: qPar, p: op.cambio, v, o: 'manual',
    n: op.t === 'C' ? `Troca por ${op.a}` : `Troca de ${op.a}`, par: id,
  };
  principal.par = par.id;
  principal.n = op.t === 'C' ? `Paga com ${op.moeda}` : `Recebida em ${op.moeda}`;
  return [principal, par];
}
