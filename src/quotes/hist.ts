// Cotações históricas públicas geradas pelo GitHub Actions (scripts/build-data.mjs)
// e publicadas junto com o app. O app baixa os arquivos inteiros: nenhum código de
// ativo seu é enviado para lugar nenhum nessa etapa.
import type { Classe, Lancamento } from '../core/types';
import type { PriceAt } from '../core/perf';
import { addMonths } from '../core/util';

interface Meta { geradoEm: string; inicio: string; b3?: { anos: number[]; ultimo: string }; tesouroUltimo?: string }
interface B3Ano { y: number; ultimo: string; p: Record<string, (number | null)[]>; k: Record<string, 'a' | 'f' | 'o'> }
interface Tesouro { ultimo: string; m: string[]; p: Record<string, (number | null)[]>; u: Record<string, [number, string]> }
interface Cripto { m: string[]; p: Record<string, (number | null)[]> }
export interface BcbArquivo { cdi: [string, number][]; ipca: [string, number][]; selic: number | null; em: string }

const base = import.meta.env.BASE_URL + 'data/';
const cache = new Map<string, Promise<unknown>>();

function getJson<T>(rel: string): Promise<T | null> {
  if (!cache.has(rel)) {
    const p = fetch(base + rel)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
    cache.set(rel, p);
    p.then(v => { if (v === null) cache.delete(rel); });
  }
  return cache.get(rel) as Promise<T | null>;
}

export class Historico {
  meta: Meta | null = null;
  b3: Record<number, B3Ano> = {};
  tesouro: Tesouro | null = null;
  cripto: Cripto | null = null;

  /** Carrega só os anos necessários para os lançamentos existentes. */
  async load(lancs: Lancamento[]): Promise<void> {
    this.meta = await getJson<Meta>('meta.json');
    const anos = this.meta?.b3?.anos ?? [];
    const primeiro = lancs.reduce((m, l) => (l.d < m ? l.d : m), '9999');
    const y0 = parseInt(primeiro.slice(0, 4), 10);
    const precisaB3 = true; // também serve para o Ibovespa (BOVA11) e para classificar ativos
    const tasks: Promise<unknown>[] = [];
    if (precisaB3 || lancs.length === 0) {
      for (const y of anos) {
        if (y < y0 && lancs.length) continue;
        if (!lancs.length && y !== anos.at(-1)) continue;
        if (this.b3[y]) continue;
        tasks.push(getJson<B3Ano>(`b3/${y}.json`).then(d => { if (d) this.b3[y] = d; }));
      }
    }
    if (lancs.some(l => l.c === 'tesouro') && !this.tesouro)
      tasks.push(getJson<Tesouro>('tesouro.json').then(d => { this.tesouro = d; }));
    if (lancs.some(l => l.c === 'cripto') && !this.cripto)
      tasks.push(getJson<Cripto>('cripto.json').then(d => { this.cripto = d; }));
    await Promise.all(tasks);
  }

  bcb(): Promise<BcbArquivo | null> { return getJson<BcbArquivo>('bcb.json'); }

  /** Fechamento do mês (procura até 12 meses para trás se o ativo não negociou). */
  priceAt: PriceAt = (a: string, c: Classe, ym: string) => {
    for (let k = 0, cur = ym; k < 12; k++, cur = addMonths(cur, -1)) {
      const v = this.rawAt(a, c, cur);
      if (v != null && v > 0) return v;
    }
    return null;
  };

  private rawAt(a: string, c: Classe, ym: string): number | null {
    if (c === 'tesouro') {
      const t = this.tesouro; if (!t) return null;
      const i = t.m.indexOf(ym);
      return i >= 0 ? (t.p[a]?.[i] ?? null) : null;
    }
    if (c === 'cripto') {
      const t = this.cripto; if (!t) return null;
      const i = t.m.indexOf(ym);
      return i >= 0 ? (t.p[a]?.[i] ?? null) : null;
    }
    const y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10) - 1;
    return this.b3[y]?.p[a]?.[m] ?? null;
  }

  /** Último preço conhecido (fechamento do último pregão ou último PU do Tesouro). */
  latest(a: string, c: Classe): { p: number; ref: string; fonte: 'b3' | 'tesouro' | 'mb' } | null {
    if (c === 'tesouro') {
      const u = this.tesouro?.u[a];
      return u ? { p: u[0], ref: u[1], fonte: 'tesouro' } : null;
    }
    if (c === 'cripto') return null;
    const anos = Object.keys(this.b3).map(Number).sort((x, y) => y - x);
    for (const y of anos) {
      const arr = this.b3[y].p[a];
      if (!arr) continue;
      for (let m = 11; m >= 0; m--) if (arr[m]) return { p: arr[m]!, ref: m === lastMonthIdx(this.b3[y]) ? this.b3[y].ultimo : `${y}-${String(m + 1).padStart(2, '0')}`, fonte: 'b3' };
    }
    return null;
  }

  /** Classe segundo a B3 (para separar FIIs de units e ETFs terminados em 11). */
  classeB3(a: string): Classe | null {
    const anos = Object.keys(this.b3).map(Number).sort((x, y) => y - x);
    for (const y of anos) {
      const k = this.b3[y].k[a];
      if (k) return k === 'a' ? 'acao' : k === 'f' ? 'fii' : 'outro';
    }
    return null;
  }

  conhecidoNaB3(a: string): boolean {
    return Object.values(this.b3).some(d => a in d.p);
  }
}

const lastMonthIdx = (d: B3Ano) => (d.ultimo ? parseInt(d.ultimo.slice(5, 7), 10) - 1 : 11);
