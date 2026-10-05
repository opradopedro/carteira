// Cotações históricas públicas geradas pelo GitHub Actions (scripts/build-data.mjs)
// e publicadas junto com o app. O app baixa os arquivos inteiros: nenhum código de
// ativo seu é enviado para lugar nenhum nessa etapa.
import type { Classe, Lancamento } from '../core/types';
import type { PriceAt } from '../core/perf';
import { addMonths } from '../core/util';

interface Meta { geradoEm: string; inicio: string; b3?: { anos: number[]; ultimo: string }; tesouroUltimo?: string }
interface B3Ano { y: number; ultimo: string; p: Record<string, (number | null)[]>; k: Record<string, 'a' | 'f' | 'o'>; n?: Record<string, string> }
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

  /** Títulos do Tesouro conhecidos nos arquivos públicos (para casar os nomes do site do Tesouro Direto). */
  titulosTesouro(): Set<string> { return new Set(Object.keys(this.tesouro?.u ?? {})); }

  /**
   * Carrega só os anos necessários para os lançamentos existentes. A cada chamada confere se os
   * arquivos públicos foram regerados (meta.json); se sim, descarta o que mudou e baixa de novo.
   */
  async load(lancs: Lancamento[]): Promise<void> {
    cache.delete('meta.json');
    const meta = await getJson<Meta>('meta.json');
    if (meta && this.meta && meta.geradoEm !== this.meta.geradoEm) {
      const anos = meta.b3?.anos ?? [];
      const recentes = new Set(anos.slice(-2)); // anos antigos não mudam
      for (const k of [...cache.keys()]) {
        const y = /^b3\/(\d{4})\.json$/.exec(k)?.[1];
        if (!y || recentes.has(Number(y))) cache.delete(k);
      }
      for (const y of recentes) delete this.b3[y];
      this.tesouro = null; this.cripto = null;
    }
    this.meta = meta ?? this.meta;
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
  /**
   * Preço de um ativo numa data (para preencher o lançamento manual): fechamento do pregão
   * na B3, PU de compra/venda do Tesouro ou fechamento do dia no Mercado Bitcoin.
   * Se a data cair em fim de semana ou feriado, usa o último dia útil anterior.
   */
  async precoNoDia(a: string, c: Classe, iso: string, venda = false): Promise<{ p: number; d: string; fonte: string } | null> {
    const ultimoAte = (dias: string[], vals: (number | null)[]) => {
      for (let i = dias.length - 1; i >= 0; i--) if (dias[i] <= iso && vals[i]) return { p: vals[i]!, d: dias[i] };
      return null;
    };
    const ano = parseInt(iso.slice(0, 4), 10);
    if (c === 'cripto') {
      const d = await getJson<Record<string, { d: string[]; p: number[] }>>('cripto-d.json');
      const s = d?.[a];
      const r = s ? ultimoAte(s.d, s.p) : null;
      return r && r.d >= addDaysIso(iso, -7) ? { ...r, fonte: 'Mercado Bitcoin' } : null;
    }
    for (const y of [ano, ano - 1]) {
      if (c === 'tesouro') {
        const d = await getJson<{ d: string[]; c: Record<string, (number | null)[]>; v: Record<string, (number | null)[]> }>(`tesouro-d/${y}.json`);
        const vals = d ? (venda ? d.v : d.c)[a] : null;
        const r = d && vals ? ultimoAte(d.d, vals) : null;
        if (r) return { ...r, fonte: venda ? 'Tesouro Direto (preço de venda)' : 'Tesouro Direto (preço de compra)' };
      } else {
        const letra = /^[A-Z]/.test(a[0]) ? a[0] : '_';
        const d = await getJson<{ d: string[]; p: Record<string, (number | null)[]> }>(`b3d/${y}/${letra}.json`);
        const vals = d?.p[a];
        const r = d && vals ? ultimoAte(d.d, vals) : null;
        if (r) return r.d >= addDaysIso(iso, -15) ? { ...r, fonte: 'fechamento B3' } : null;
      }
    }
    return null;
  }

  /** Reais por 1 unidade da moeda no dia (dólar comercial ou fechamento da cripto no Mercado Bitcoin). */
  async cambioNoDia(moeda: string, iso: string): Promise<{ taxa: number; d: string; fonte: string } | null> {
    const serie = moeda === 'USD'
      ? await getJson<{ d: string[]; p: number[] }>('usd-d.json')
      : (await getJson<Record<string, { d: string[]; p: number[] }>>('cripto-d.json'))?.[moeda];
    if (!serie) return null;
    for (let i = serie.d.length - 1; i >= 0; i--) {
      if (serie.d[i] <= iso) {
        if (serie.d[i] < addDaysIso(iso, -7)) return null;
        return { taxa: serie.p[i], d: serie.d[i], fonte: moeda === 'USD' ? 'dólar comercial (Banco Central)' : 'Mercado Bitcoin' };
      }
    }
    return null;
  }

  /** Carrega o que a busca de ativos precisa: o ano mais recente da B3 e os títulos do Tesouro. */
  async carregarBusca(): Promise<void> {
    this.meta ||= await getJson<Meta>('meta.json');
    const y = this.meta?.b3?.anos?.at(-1);
    const tasks: Promise<unknown>[] = [];
    if (y && !this.b3[y]) tasks.push(getJson<B3Ano>(`b3/${y}.json`).then(d => { if (d) this.b3[y] = d; }));
    if (!this.tesouro) tasks.push(getJson<Tesouro>('tesouro.json').then(d => { this.tesouro = d; }));
    await Promise.all(tasks);
  }

  /** Todos os ativos conhecidos para a busca: B3 (ano mais recente) e Tesouro Direto em negociação. */
  catalogo(): { a: string; nome: string; c: Classe }[] {
    const out: { a: string; nome: string; c: Classe }[] = [];
    const y = Math.max(...Object.keys(this.b3).map(Number));
    const d = this.b3[y];
    if (d) for (const a of Object.keys(d.p)) {
      const k = d.k[a];
      out.push({ a, nome: d.n?.[a] ?? '', c: k === 'a' ? 'acao' : k === 'f' ? 'fii' : k === 'o' ? 'outro' : 'acao' });
    }
    const t = this.tesouro;
    if (t) {
      const recente = t.ultimo.slice(0, 7);
      for (const [a, [, data]] of Object.entries(t.u)) if (data.slice(0, 7) === recente) out.push({ a, nome: '', c: 'tesouro' });
    }
    return out;
  }

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

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
