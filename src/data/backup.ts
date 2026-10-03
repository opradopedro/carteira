import type { Classe, Lancamento, Precos, TipoLanc } from '../core/types';

export interface Backup {
  app: 'carteira';
  versao: 1;
  exportadoEm: string;
  lancs: Lancamento[];
  precosManuais: Precos;
}

/** Monta o backup. Tokens de API ficam de fora de propósito. */
export function buildBackup(lancs: Lancamento[], precos: Precos): Backup {
  const precosManuais: Precos = {};
  for (const [a, p] of Object.entries(precos)) if (p.fonte === 'manual') precosManuais[a] = p;
  return { app: 'carteira', versao: 1, exportadoEm: new Date().toISOString(), lancs, precosManuais };
}

const TIPOS: TipoLanc[] = ['C', 'V', 'P', 'S'];
const CLASSES: Classe[] = ['acao', 'fii', 'cripto', 'tesouro', 'outro'];

/** Valida um backup lido de arquivo. Lança erro com mensagem amigável se não servir. */
export function parseBackup(text: string): Backup {
  let o: unknown;
  try { o = JSON.parse(text); } catch { throw new Error('O arquivo não é um JSON válido.'); }
  const b = o as Partial<Backup>;
  if (!b || b.app !== 'carteira' || !Array.isArray(b.lancs)) throw new Error('Este arquivo não é um backup da Carteira.');
  const lancs: Lancamento[] = [];
  for (const l of b.lancs) {
    const ok = l && typeof l.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.d) && TIPOS.includes(l.t) &&
      typeof l.a === 'string' && CLASSES.includes(l.c) &&
      [l.q, l.p, l.v].every(n => typeof n === 'number' && Number.isFinite(n));
    if (!ok) throw new Error('O backup tem lançamentos com formato inválido.');
    lancs.push({ id: l.id, d: l.d, t: l.t, a: l.a, c: l.c, q: l.q, p: l.p, v: l.v, o: l.o === 'b3' ? 'b3' : 'manual', ...(l.n ? { n: String(l.n) } : {}), ...(l.k0 ? { k0: String(l.k0) } : {}) });
  }
  return { app: 'carteira', versao: 1, exportadoEm: String(b.exportadoEm || ''), lancs, precosManuais: b.precosManuais || {} };
}

export function downloadJson(obj: unknown, nome: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
