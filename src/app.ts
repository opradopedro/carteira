// Estado do app e ações que alteram dados. As telas (src/ui/*) só leem daqui.
import type { Classe, Lancamento, Modelo, Precos } from './core/types';
import { compute } from './core/calc';
import { monthlySeries, type PontoMes } from './core/perf';
import { mergeImport, rowsToLancs, type ResultadoLeitura } from './core/b3';
import { addMonths, today } from './core/util';
import * as db from './data/db';
import type { Config, Indices } from './data/db';
import { Historico } from './quotes/hist';
import { refreshIndices, refreshQuotes } from './quotes/live';

export type Tab = 'resumo' | 'ativos' | 'proventos' | 'lancamentos' | 'ajustes';
export interface Periodo { tipo: '12m' | 'ano' | 'tudo' | 'y' | 'custom'; ano?: number; ini?: string; fim?: string }

export const state = {
  ready: false,
  lancs: [] as Lancamento[],
  precos: {} as Precos,
  indices: null as Indices | null,
  cfg: {} as Config,
  cotEm: '',
  tab: 'resumo' as Tab,
  open: null as string | null,
  periodo: { tipo: '12m' } as Periodo,
  refreshing: false,
  histPronto: false,
  falhas: [] as string[],
  avisos: [] as string[],
  persist: false,
};

export const hist = new Historico();
export let model: Modelo = compute([], {});
export let serie: PontoMes[] = [];

let onChange: () => void = () => {};
export const setOnChange = (fn: () => void) => { onChange = fn; };

export function recompute() {
  model = compute(state.lancs, state.precos);
  serie = state.histPronto
    ? monthlySeries(state.lancs, hist.priceAt, today(), { v: model.tot.value })
    : [];
}

export async function init() {
  const [lancs, precos, cfg, indices, cotEm] = await Promise.all([
    db.getLancs(), db.getKV('precos'), db.getKV('config'), db.getKV('indices'), db.getKV('cotEm'),
  ]);
  state.lancs = lancs;
  state.precos = precos || {};
  state.cfg = cfg || {};
  state.indices = indices || null;
  state.cotEm = cotEm || '';
  state.ready = true;
  recompute();
  onChange();
  db.requestPersist().then(p => { state.persist = p; });
}

/** Carrega o histórico público necessário (funciona offline se já estiver em cache). */
export async function loadHist() {
  await hist.load(state.lancs);
  state.histPronto = true;
  recompute();
  onChange();
}

/** Busca cotações e índices. `forcar` ignora a idade dos índices. */
export async function refresh(forcar = false) {
  if (state.refreshing) return;
  state.refreshing = true; onChange();
  try {
    await hist.load(state.lancs);
    state.histPronto = true;
    recompute();
    const r = await refreshQuotes(model.open, state.precos, state.cfg, hist);
    state.precos = r.precos;
    state.falhas = r.falhas;
    state.avisos = r.avisos;
    state.cotEm = new Date().toISOString();
    await Promise.all([db.setKV('precos', state.precos), db.setKV('cotEm', state.cotEm)]);

    const velho = !state.indices || Date.now() - Date.parse(state.indices.em) > 6 * 3600e3;
    const desde = desdeIndices();
    const cobre = state.indices?.cdi?.[0]?.[0] && state.indices.cdi[0][0] <= addDays(desde, 7);
    if (forcar || velho || !cobre) {
      const ix = await refreshIndices(desde, cobre ? state.indices ?? undefined : undefined, hist);
      if (ix) { state.indices = ix; await db.setKV('indices', ix); }
      else state.falhas.push('Não consegui buscar CDI/IPCA no Banco Central agora.');
    }
  } catch {
    state.falhas = ['Não foi possível atualizar agora. Mostrando as últimas cotações salvas.'];
  } finally {
    state.refreshing = false;
    recompute();
    onChange();
  }
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

/** Desde quando precisamos de CDI/IPCA: o primeiro lançamento ou 13 meses atrás. */
function desdeIndices(): string {
  const treze = addMonths(today().slice(0, 7), -13) + '-01';
  const primeiro = state.lancs.reduce((m, l) => (l.d < m ? l.d : m), treze);
  return primeiro < treze ? primeiro.slice(0, 8) + '01' : treze;
}

export async function addLanc(l: Lancamento) {
  state.lancs = [...state.lancs, l];
  await db.putLancs([l]);
  recompute(); onChange();
  if (!state.histPronto || !hist.meta) await loadHist();
  else hist.load(state.lancs).then(() => { recompute(); onChange(); });
}

export async function removeLanc(id: string) {
  state.lancs = state.lancs.filter(l => l.id !== id);
  await db.deleteLanc(id);
  recompute(); onChange();
}

/** Muda a classe de todos os lançamentos de um ativo. */
export async function setClasse(a: string, c: Classe) {
  const alterados = state.lancs.filter(l => l.a === a && l.c !== c).map(l => ({ ...l, c }));
  if (!alterados.length) return;
  const byId = new Map(alterados.map(l => [l.id, l]));
  state.lancs = state.lancs.map(l => byId.get(l.id) || l);
  await db.putLancs(alterados);
  await hist.load(state.lancs);
  recompute(); onChange();
}

export async function setPrecoManual(a: string, p: number | null) {
  const precos = { ...state.precos };
  if (p == null) delete precos[a];
  else precos[a] = { p, em: new Date().toISOString(), fonte: 'manual' };
  state.precos = precos;
  await db.setKV('precos', precos);
  recompute(); onChange();
}

export async function saveConfig(cfg: Config) {
  state.cfg = { ...state.cfg, ...cfg };
  await db.setKV('config', state.cfg);
  onChange();
}

/** Lê planilhas da B3 (xlsx/csv) e importa sem duplicar. */
export async function importB3(files: File[]): Promise<string[]> {
  const XLSX = await import('xlsx');
  const msgs: string[] = [];
  const todos: ResultadoLeitura = { lancs: [], ignored: 0, kind: '' };
  for (const f of files) {
    let res: ResultadoLeitura = { lancs: [], ignored: 0, kind: '' };
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      for (const name of wb.SheetNames) {
        const r = rowsToLancs(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true }));
        res.lancs.push(...r.lancs); res.ignored += r.ignored; res.kind = res.kind || r.kind;
      }
    } catch {
      msgs.push(`${f.name}: não consegui ler. Confira se é o .xlsx baixado da B3.`);
      continue;
    }
    if (!res.kind) { msgs.push(`${f.name}: não reconheci. Use o arquivo de Negociação ou de Movimentação da Área do Investidor.`); continue; }
    todos.lancs.push(...res.lancs); todos.ignored += res.ignored;
    msgs.push(`${f.name} (${res.kind}): ${res.lancs.length} linhas úteis` + (res.ignored ? `, ${res.ignored} ignoradas (tipos que o app não usa)` : '') + '.');
  }
  if (!todos.lancs.length) return msgs;

  // Corrige a classe com a lista oficial da B3 (ex.: TAEE11 é unit/ação, BOVA11 é ETF).
  await hist.load([...state.lancs, ...todos.lancs]);
  for (const l of todos.lancs) {
    if (l.c === 'tesouro' || l.c === 'cripto') continue;
    const c = hist.classeB3(l.a);
    if (c) l.c = c;
  }
  // Se o ativo já existe com classe escolhida pelo usuário, mantém a dele.
  const classeAtual = new Map(state.lancs.map(l => [l.a, l.c]));
  for (const l of todos.lancs) { const c = classeAtual.get(l.a); if (c) l.c = c; }

  const { next, added, dup } = mergeImport(state.lancs, todos.lancs);
  state.lancs = next;
  await db.putLancs(added);
  msgs.push(`Total: ${added.length} lançamentos novos` + (dup ? `, ${dup} já existiam e não foram duplicados` : '') + '.');
  state.histPronto = true;
  recompute(); onChange();
  return msgs;
}

export async function restoreBackup(lancs: Lancamento[], precosManuais: Precos) {
  await db.replaceAllLancs(lancs);
  const precos = { ...precosManuais };
  await db.setKV('precos', precos);
  state.lancs = lancs; state.precos = precos;
  await hist.load(lancs);
  state.histPronto = true;
  recompute(); onChange();
}

export async function wipe() {
  await db.clearAll();
  Object.assign(state, { lancs: [], precos: {}, indices: null, cfg: {}, cotEm: '', falhas: [], avisos: [] });
  recompute(); onChange();
}
