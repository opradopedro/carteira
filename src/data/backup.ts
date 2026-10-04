import type { Classe, Lancamento, Precos, TipoLanc } from '../core/types';
import type { FiltroSalvo } from '../core/analise';
import { mergeImport, type AReceber } from '../core/b3';

/** O que, além dos lançamentos, vai no backup (versão 2). Tokens de API nunca entram. */
export interface Extras {
  filtros?: FiltroSalvo[];
  pendIgnoradas?: string[];
  aReceber?: { em: string; itens: AReceber[] } | null;
  tema?: 'auto' | 'claro' | 'escuro';
}

export interface Backup {
  app: 'carteira';
  versao: 1 | 2;
  exportadoEm: string;
  lancs: Lancamento[];
  precosManuais: Precos;
  extras?: Extras;
}

/** Monta o backup. Tokens de API ficam de fora de propósito. */
export function buildBackup(lancs: Lancamento[], precos: Precos, extras: Extras = {}): Backup {
  const precosManuais: Precos = {};
  for (const [a, p] of Object.entries(precos)) if (p.fonte === 'manual') precosManuais[a] = p;
  return { app: 'carteira', versao: 2, exportadoEm: new Date().toISOString(), lancs, precosManuais, extras };
}

/** Resumo do backup para mostrar antes de puxar os dados. */
export function resumoBackup(b: Backup, atuais: Lancamento[]) {
  const datas = b.lancs.map(l => l.d).sort();
  return {
    lancs: b.lancs.length,
    ativos: new Set(b.lancs.map(l => l.a)).size,
    de: datas[0] ?? '', ate: datas.at(-1) ?? '',
    novos: juntar(atuais, b.lancs).added.length,
  };
}

/**
 * Junta os lançamentos do backup com os atuais sem duplicar: o que tem o mesmo id já está aqui;
 * do resto, o que for igual (mesma data, ativo, tipo, quantidade e valor) também é pulado.
 */
export function juntar(atuais: Lancamento[], vindos: Lancamento[]) {
  const ids = new Set(atuais.map(l => l.id));
  const fora = vindos.filter(l => !ids.has(l.id));
  const r = mergeImport(atuais, fora);
  return { next: r.next, added: r.added, dup: vindos.length - r.added.length };
}

function lerExtras(e: unknown): Extras {
  if (!e || typeof e !== 'object') return {};
  const x = e as Record<string, unknown>;
  const out: Extras = {};
  if (Array.isArray(x.filtros))
    out.filtros = x.filtros.filter((f): f is FiltroSalvo => !!f && typeof f.id === 'string' && typeof f.nome === 'string' && /^\d{4}-\d{2}$/.test(f.ini) && /^\d{4}-\d{2}$/.test(f.fim))
      .map(f => ({ id: f.id, nome: f.nome.slice(0, 80), ini: f.ini, fim: f.fim }));
  if (Array.isArray(x.pendIgnoradas)) out.pendIgnoradas = x.pendIgnoradas.filter(v => typeof v === 'string');
  const ar = x.aReceber as { em?: unknown; itens?: unknown } | null | undefined;
  if (ar && typeof ar.em === 'string' && Array.isArray(ar.itens))
    out.aReceber = { em: ar.em, itens: ar.itens.filter((i): i is AReceber => !!i && typeof i.a === 'string' && typeof i.d === 'string' && typeof i.tipo === 'string' && Number.isFinite(i.v))
      .map(i => ({ a: i.a, d: i.d, tipo: i.tipo, v: i.v })) };
  if (x.tema === 'auto' || x.tema === 'claro' || x.tema === 'escuro') out.tema = x.tema;
  return out;
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
    lancs.push({ id: l.id, d: l.d, t: l.t, a: l.a, c: l.c, q: l.q, p: l.p, v: l.v, o: l.o === 'b3' ? 'b3' : 'manual', ...(l.n ? { n: String(l.n) } : {}), ...(l.k0 ? { k0: String(l.k0) } : {}),
      ...(l.moeda ? { moeda: String(l.moeda), pMoeda: Number(l.pMoeda), cambio: Number(l.cambio) } : {}), ...(l.par ? { par: String(l.par) } : {}) });
  }
  return { app: 'carteira', versao: b.versao === 2 ? 2 : 1, exportadoEm: String(b.exportadoEm || ''), lancs, precosManuais: lerPrecos(b.precosManuais), extras: lerExtras(b.extras) };
}

/** Só preços manuais válidos. */
function lerPrecos(o: unknown): Precos {
  const out: Precos = {};
  if (!o || typeof o !== 'object') return out;
  for (const [a, p] of Object.entries(o as Record<string, { p?: unknown; em?: unknown }>))
    if (p && typeof p.p === 'number' && Number.isFinite(p.p) && p.p > 0) out[a] = { p: p.p, em: typeof p.em === 'string' ? p.em : new Date().toISOString(), fonte: 'manual' };
  return out;
}

export function downloadJson(obj: unknown, nome: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
