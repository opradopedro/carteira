import { describe, expect, it } from 'vitest';
import { buildBackup, juntar, parseBackup, resumoBackup } from '../src/data/backup';
import type { Lancamento } from '../src/core/types';

const L = (id: string, d: string, a = 'PETR4', q = 10, p = 30): Lancamento =>
  ({ id, d, t: 'C', a, c: 'acao', q, p, v: q * p, o: 'manual' });

describe('backup', () => {
  it('exporta e lê de volta com filtros, pendências ignoradas e proventos a receber', () => {
    const b = buildBackup([L('1', '2024-01-02')], { PETR4: { p: 31, em: '2024-01-03T00:00:00Z', fonte: 'manual' }, VALE3: { p: 60, em: 'x', fonte: 'brapi' } }, {
      filtros: [{ id: 'f', nome: '2024', ini: '2024-01', fim: '2024-12' }], pendIgnoradas: ['backup'],
      aReceber: { em: '2024-05-01', itens: [{ a: 'PETR4', d: '2024-05-20', tipo: 'Dividendo', v: 12.3 }] }, tema: 'escuro',
    });
    const r = parseBackup(JSON.stringify(b));
    expect(r.versao).toBe(2);
    expect(Object.keys(r.precosManuais)).toEqual(['PETR4']);
    expect(r.extras).toEqual(b.extras);
  });
  it('aceita backup antigo (versão 1) sem extras', () => {
    const r = parseBackup(JSON.stringify({ app: 'carteira', versao: 1, exportadoEm: '', lancs: [L('1', '2024-01-02')], precosManuais: {} }));
    expect(r.lancs).toHaveLength(1);
    expect(r.extras).toEqual({});
  });
  it('recusa arquivo que não é backup', () => {
    expect(() => parseBackup('{"a":1}')).toThrow(/não é um backup/);
    expect(() => parseBackup('xx')).toThrow(/JSON/);
  });
  it('juntar não duplica: pula o mesmo id e lançamentos iguais com outro id', () => {
    const atuais = [L('1', '2024-01-02'), L('2', '2024-02-02')];
    const vindos = [L('1', '2024-01-02'), L('9', '2024-02-02'), L('3', '2024-03-02', 'VALE3')];
    const r = juntar(atuais, vindos);
    expect(r.added.map(l => l.id)).toEqual(['3']);
    expect(r.dup).toBe(2);
    expect(r.next).toHaveLength(3);
    expect(resumoBackup({ app: 'carteira', versao: 2, exportadoEm: '', lancs: vindos, precosManuais: {} }, atuais))
      .toEqual({ lancs: 3, ativos: 2, de: '2024-01-02', ate: '2024-03-02', novos: 1 });
  });
});
