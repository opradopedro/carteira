import { describe, expect, it } from 'vitest';
import { buscarAtivos, CRIPTO_NOMES, type Sugestao } from '../src/core/busca';

const fontes: Sugestao[] = [
  { a: 'PETR4', nome: 'PETROBRAS', c: 'acao', minha: true },
  ...Object.entries(CRIPTO_NOMES).map(([a, nome]) => ({ a, nome, c: 'cripto' as const })),
  { a: 'BITH11', nome: 'BITCOIN HASH', c: 'outro' },
  { a: 'WEGE3', nome: 'WEG', c: 'acao' },
  { a: 'PETR3', nome: 'PETROBRAS', c: 'acao' },
  { a: 'TESOURO IPCA+ 2029', nome: 'Tesouro Direto', c: 'tesouro' },
];

describe('buscarAtivos', () => {
  it('"BIT" sugere o bitcoin', () => {
    const r = buscarAtivos('BIT', fontes).map(s => s.a);
    expect(r[0]).toBe('BTC');
    expect(r).toContain('BITH11');
  });
  it('acha pelo nome da empresa', () => {
    expect(buscarAtivos('weg', fontes)[0].a).toBe('WEGE3');
  });
  it('seus ativos aparecem primeiro', () => {
    expect(buscarAtivos('petr', fontes).map(s => s.a)).toEqual(['PETR4', 'PETR3']);
  });
  it('acha títulos do Tesouro sem acento nem maiúsculas', () => {
    expect(buscarAtivos('tesouro ipca', fontes)[0].a).toBe('TESOURO IPCA+ 2029');
  });
  it('texto vazio não sugere nada', () => {
    expect(buscarAtivos('  ', fontes)).toEqual([]);
  });
});
