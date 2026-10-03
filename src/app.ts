// Estado do app e ações que alteram dados. As telas (src/ui/*) só leem daqui.
import type { Classe, Lancamento, Modelo, Precos } from './core/types';
import { compute } from './core/calc';
import { pendencias as calcPendencias, type Pendencia } from './core/pendencias';
import { monthlySeries, type PontoMes } from './core/perf';
import { keyOf, mergeImport, rowsToAReceber, rowsToLancs, type AReceber, type ResultadoLeitura } from './core/b3';
import { today, ymd } from './core/util';
import * as db from './data/db';
import type { Config, Indices } from './data/db';
import { Historico } from './quotes/hist';
import { refreshIndices, refreshQuotes } from './quotes/live';

import type { Periodo } from './core/analise';
export type { Periodo };

export const state = {
  ready: false,
  lancs: [] as Lancamento[],
  precos: {} as Precos,
  indices: null as Indices | null,
  cfg: {} as Config,
  cotEm: '',
  /** Período escolhido em cada página de detalhe. */
  per: { rent: { tipo: '12m' }, evo: { tipo: 'tudo' }, prov: { tipo: '12m' }, classe: { tipo: '12m' } } as Record<'rent' | 'evo' | 'prov' | 'classe', Periodo>,
  refreshing: false,
  histPronto: false,
  falhas: [] as string[],
  avisos: [] as string[],
  persist: false,
  aReceber: null as { em: string; itens: AReceber[] } | null,
  pendIgnoradas: [] as string[],
  ultimoBackup: '',
};

export const hist = new Historico();
export let model: Modelo = compute([], {});
export let serie: PontoMes[] = [];

let onChange: () => void = () => {};
export const setOnChange = (fn: () => void) => { onChange = fn; };

const cacheSeries = new Map<string, PontoMes[]>();

/** Série mensal de um pedaço da carteira (uma classe, um ativo), com cache até o próximo recálculo. */
export function serieDe(chave: string, filtro: (l: Lancamento) => boolean, valorAtual: number): PontoMes[] {
  if (!state.histPronto) return [];
  let s = cacheSeries.get(chave);
  if (!s) {
    s = monthlySeries(state.lancs.filter(filtro), hist.priceAt, today(), { v: valorAtual });
    cacheSeries.set(chave, s);
  }
  return s;
}

export function recompute() {
  cacheSeries.clear();
  model = compute(state.lancs, state.precos);
  serie = state.histPronto
    ? monthlySeries(state.lancs, hist.priceAt, today(), { v: model.tot.value })
    : [];
}

export async function init() {
  const [lancs, precos, cfg, indices, cotEm, aReceber] = await Promise.all([
    db.getLancs(), db.getKV('precos'), db.getKV('config'), db.getKV('indices'), db.getKV('cotEm'), db.getKV('aReceber'),
  ]);
  state.pendIgnoradas = (await db.getKV('pendIgnoradas')) || [];
  state.ultimoBackup = (await db.getKV('ultimoBackup')) || '';
  state.aReceber = aReceber || null;
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

/**
 * Busca cotações e índices, poupando as cotas gratuitas das APIs:
 *  - 'diario': só vai à internet na primeira abertura do dia (senão usa o que está salvo);
 *  - 'tudo': botão Atualizar, busca tudo de novo;
 *  - 'novos': só os ativos que ainda não têm cotação ao vivo de hoje (após importar/lançar).
 */
export type ModoAtualizacao = 'diario' | 'tudo' | 'novos';

const ehHoje = (iso?: string) => !!iso && ymd(new Date(iso)) === today();

export async function refresh(modo: ModoAtualizacao = 'diario') {
  if (state.refreshing) return;
  if (modo === 'diario' && ehHoje(state.cotEm)) {
    // Já atualizou hoje: só carrega o histórico (do cache, se offline) e o fechamento oficial.
    await loadHist();
    if (!ehHoje(state.indices?.em)) await atualizarIndices(false);
    return;
  }
  state.refreshing = true; onChange();
  try {
    await hist.load(state.lancs);
    state.histPronto = true;
    recompute();
    const aoVivo = (a: string) => ['brapi', 'coingecko'].includes(state.precos[a]?.fonte ?? '') && ehHoje(state.precos[a]?.em);
    const r = await refreshQuotes(model.open, state.precos, state.cfg, hist, modo === 'novos' ? a => !aoVivo(a) : undefined);
    state.precos = r.precos;
    state.falhas = r.falhas;
    state.avisos = r.avisos;
    if (modo !== 'novos' || !state.cotEm) state.cotEm = new Date().toISOString();
    await Promise.all([db.setKV('precos', state.precos), db.setKV('cotEm', state.cotEm)]);
    await atualizarIndices(modo === 'tudo');
  } catch {
    state.falhas = ['Não foi possível atualizar agora. Mostrando as últimas cotações salvas.'];
  } finally {
    state.refreshing = false;
    recompute();
    onChange();
  }
}

/** CDI/IPCA/Selic: uma vez por dia. */
async function atualizarIndices(forcar: boolean) {
  if (!forcar && state.indices?.cdi?.length && ehHoje(state.indices.em)) return;
  const ix = await refreshIndices(state.indices ?? undefined, hist);
  if (ix?.cdi?.length) { state.indices = ix; await db.setKV('indices', ix); }
  else state.falhas = [...state.falhas, 'Não consegui buscar CDI/IPCA agora.'];
  onChange();
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
    let eventos: AReceber[] | null = null;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: true });
        const ev = rowsToAReceber(rows);
        if (ev) { eventos = [...(eventos || []), ...ev]; continue; }
        const r = rowsToLancs(rows);
        res.lancs.push(...r.lancs); res.ignored += r.ignored; res.kind = res.kind || r.kind;
      }
    } catch {
      msgs.push(`${f.name}: não consegui ler. Confira se é o .xlsx baixado da B3.`);
      continue;
    }
    if (eventos) {
      // A planilha de Eventos é uma foto do que está para cair: substitui a anterior.
      state.aReceber = { em: new Date().toISOString(), itens: eventos };
      await db.setKV('aReceber', state.aReceber);
      msgs.push(`${f.name} (Eventos): ${eventos.length} proventos a receber, somando ${eventos.reduce((s, e) => s + e.v, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Veja em Proventos.`);
      if (!res.kind) continue;
    }
    if (!res.kind) { msgs.push(`${f.name}: não reconheci. Use o arquivo de Negociação ou de Movimentação da Área do Investidor.`); continue; }
    todos.lancs.push(...res.lancs); todos.ignored += res.ignored;
    msgs.push(`${f.name} (${res.kind}): ${res.lancs.length} linhas úteis` + (res.ignored ? `, ${res.ignored} ignoradas (tipos que o app não usa)` : '') + '.');
  }
  if (!todos.lancs.length) { onChange(); return msgs; }

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
  Object.assign(state, { lancs: [], precos: {}, indices: null, cfg: {}, cotEm: '', falhas: [], avisos: [], aReceber: null, pendIgnoradas: [], ultimoBackup: '' });
  recompute(); onChange();
}

export function listaPendencias(): Pendencia[] {
  if (!state.ready) return [];
  return calcPendencias(model, state.lancs, {
    temToken: !!state.cfg.brapiToken, ultimoBackup: state.ultimoBackup, ignoradas: state.pendIgnoradas,
  });
}

export async function ignorarPendencia(id: string) {
  state.pendIgnoradas = [...new Set([...state.pendIgnoradas, id])];
  await db.setKV('pendIgnoradas', state.pendIgnoradas);
  onChange();
}

export async function marcarBackup() {
  state.ultimoBackup = new Date().toISOString();
  await db.setKV('ultimoBackup', state.ultimoBackup);
  onChange();
}

/** Corrige um lançamento sem perder a identidade da importação (reimportar não duplica). */
export async function updateLanc(id: string, patch: Partial<Pick<Lancamento, 'v' | 'p' | 'q' | 'd'>>) {
  const atual = state.lancs.find(l => l.id === id);
  if (!atual) return;
  const novo: Lancamento = { ...atual, ...patch, k0: atual.k0 ?? keyOf(atual) };
  state.lancs = state.lancs.map(l => (l.id === id ? novo : l));
  await db.putLancs([novo]);
  recompute(); onChange();
}

export async function reverIgnoradas() {
  state.pendIgnoradas = [];
  await db.setKV('pendIgnoradas', []);
  onChange();
}
