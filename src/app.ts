// Estado do app e ações que alteram dados. As telas (src/ui/*) só leem daqui.
import type { Classe, Lancamento, Modelo, Posicao, Precos } from './core/types';
import { compute } from './core/calc';
import { pendencias as calcPendencias, type Pendencia } from './core/pendencias';
import { monthlySeries, type PontoMes } from './core/perf';
import { keyOf, mergeImport, rowsToAReceber, rowsToLancs, type AReceber, type ResultadoLeitura } from './core/b3';
import { isB3Ticker, newId, today, ymd } from './core/util';
import { INTERVALO_TD, deveBuscar, type Motivo } from './core/mercado';
import * as db from './data/db';
import { juntar, type Backup, type Extras } from './data/backup';
import type { AjusteTx, ConfigPluggy, ContaBanco, RegraBanco, TxBanco } from './banco/tipos';
import { classificar, termoDe, type Classificada } from './banco/classificar';
import { sincronizar as sincronizarPluggy } from './banco/pluggy';
import type { Config, Indices, Uso } from './data/db';
import { Historico } from './quotes/hist';
import { refreshIndices, refreshQuotes } from './quotes/live';

import type { FiltroSalvo, Periodo } from './core/analise';
export type { Periodo };

export const state = {
  ready: false,
  lancs: [] as Lancamento[],
  precos: {} as Precos,
  indices: null as Indices | null,
  cfg: {} as Config,
  cotEm: '',
  /** Período escolhido em cada página de detalhe. */
  per: { rent: { tipo: '12m' }, evo: { tipo: 'tudo' }, prov: { tipo: '12m' }, classe: { tipo: '12m' }, ativo: { tipo: 'tudo' } } as Record<'rent' | 'evo' | 'prov' | 'classe' | 'ativo', Periodo>,
  /** Ativo cujos ajustes estão destravados para edição. */
  editando: null as string | null,
  /** Ordem da lista de lançamentos. */
  ordemLanc: 'recentes' as 'recentes' | 'antigos' | 'ativo' | 'valor',
  filtros: [] as FiltroSalvo[],
  refreshing: false,
  histPronto: false,
  falhas: [] as string[],
  avisos: [] as string[],
  persist: false,
  aReceber: null as { em: string; itens: AReceber[] } | null,
  pendIgnoradas: [] as string[],
  ultimoBackup: '',
  uso: { mes: '', brapi: 0, cg: 0 } as Uso,
  banco: {
    contas: [] as ContaBanco[],
    txs: [] as TxBanco[],
    ajustes: {} as Record<string, AjusteTx>,
    regras: [] as RegraBanco[],
    sinc: '',               // última sincronização
    sincronizando: false,
    erros: [] as string[],
    mes: today().slice(0, 7), // mês mostrado na área Banco
  },
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
  state.filtros = (await db.getKV('filtros')) || [];
  state.uso = (await db.getKV('uso')) || state.uso;
  const [bc, bt, ba, br, bs] = await Promise.all([db.getKV('bancoContas'), db.getKV('bancoTxs'), db.getKV('bancoAjustes'), db.getKV('bancoRegras'), db.getKV('bancoSinc')]);
  Object.assign(state.banco, { contas: bc || [], txs: bt || [], ajustes: ba || {}, regras: br || [], sinc: bs || '' });
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
 * Busca cotações e índices, poupando as cotas gratuitas das APIs (regras em core/mercado.ts):
 *  - 'abrir': ao abrir o app ou voltar a ele; cripto sempre, ações e FIIs só com o pregão aberto;
 *  - 'pagina': ao entrar num ativo ou classe (mesma regra, só para eles);
 *  - 'botao': botão Atualizar, busca tudo de novo;
 *  - 'novos': só os ativos que ainda não têm cotação ao vivo de hoje (após importar/lançar).
 */
export type { Motivo };

const ehHoje = (iso?: string) => !!iso && ymd(new Date(iso)) === today();
const mesAtual = () => today().slice(0, 7);
/**
 * Quanto da cota da brapi já foi usado, na escala do plano gratuito (15.000). Usa o número que a
 * própria brapi informa quando disponível; senão, a contagem feita pelo app.
 */
function usoBrapi(): number {
  const c = state.uso.cota;
  return c && c.limite > 0 ? (1 - c.restante / c.limite) * 15_000 : state.uso.brapi;
}

let emCurso: Promise<void> | null = null;
let ultimaTD = 0; // última consulta ao site do Tesouro Direto nesta sessão
export function refresh(motivo: Motivo = 'abrir', so: (p: Posicao) => boolean = () => true): Promise<void> {
  // Pedidos explícitos (botão, lançamento novo) esperam o que estiver em curso; os automáticos são descartados.
  if (emCurso) return motivo === 'botao' || motivo === 'novos' ? emCurso.then(() => refresh(motivo, so)) : emCurso;
  emCurso = atualizar(motivo, so).finally(() => { emCurso = null; });
  return emCurso;
}

async function atualizar(motivo: Motivo, so: (p: Posicao) => boolean) {
  if (state.uso.mes !== mesAtual()) state.uso = { mes: mesAtual(), brapi: 0, cg: 0 };
  const agora = new Date();
  const tdLivre = motivo === 'botao' || motivo === 'novos' || agora.getTime() - ultimaTD >= INTERVALO_TD;
  const alvo = new Set(model.open.filter(p => so(p) && (
    p.c === 'tesouro' ? tdLivre && state.precos[p.a]?.fonte !== 'manual'
    : p.c === 'cripto' ? deveBuscar('cripto', state.precos[p.a], motivo, agora)
      : isB3Ticker(p.a) && deveBuscar('b3', state.precos[p.a], motivo, agora, usoBrapi())
  )).map(p => p.a));
  // Sem nada para buscar ao vivo, ainda aplica o fechamento oficial mais recente (arquivos do app).
  const vaiARede = alvo.size > 0;
  if (vaiARede) { state.refreshing = true; onChange(); }
  try {
    if (!state.histPronto || motivo !== 'pagina') await hist.load(state.lancs);
    state.histPronto = true;
    recompute();
    if (model.open.some(p => p.c === 'tesouro' && alvo.has(p.a))) ultimaTD = Date.now();
    const r = await refreshQuotes(model.open, state.precos, state.cfg, hist, a => alvo.has(a));
    state.precos = r.precos;
    if (vaiARede) { state.falhas = r.falhas; state.avisos = r.avisos; }
    state.uso = { ...state.uso, brapi: state.uso.brapi + r.req.brapi, cg: state.uso.cg + r.req.cg,
      ...(r.req.cota ? { cota: { ...r.req.cota, em: new Date().toISOString() } } : {}) };
    if (r.vivos) state.cotEm = new Date().toISOString();
    await Promise.all([db.setKV('precos', state.precos), db.setKV('cotEm', state.cotEm), db.setKV('uso', state.uso)]);
    if (motivo !== 'pagina') await atualizarIndices(motivo === 'botao');
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

export async function addLancs(ls: Lancamento[]) {
  for (const l of ls) await addLanc(l);
}

/** Exclui o lançamento (e o seu par, se for uma troca de cripto por cripto). */
export async function removeLanc(id: string) {
  const l = state.lancs.find(x => x.id === id);
  const ids = new Set([id, ...(l?.par ? [l.par] : [])]);
  state.lancs = state.lancs.filter(x => !ids.has(x.id));
  for (const i of ids) await db.deleteLanc(i);
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

/**
 * Puxa os dados de um backup.
 *  - 'substituir': a carteira passa a ser exatamente a do backup;
 *  - 'juntar': acrescenta só o que ainda não existe aqui (nada duplica) e soma filtros e preferências.
 */
export async function puxarBackup(b: Backup, modo: 'juntar' | 'substituir'): Promise<{ added: number; dup: number }> {
  const x = b.extras ?? {};
  let added = b.lancs.length, dup = 0;
  if (modo === 'substituir') {
    await db.replaceAllLancs(b.lancs);
    state.lancs = b.lancs;
    state.precos = { ...b.precosManuais };
    state.filtros = x.filtros ?? [];
    state.pendIgnoradas = x.pendIgnoradas ?? [];
    state.aReceber = x.aReceber ?? null;
    if (x.tema) state.cfg = { ...state.cfg, tema: x.tema };
    if (x.banco) Object.assign(state.banco, { contas: x.banco.contas, txs: x.banco.txs, ajustes: x.banco.ajustes, regras: x.banco.regras });
  } else {
    const r = juntar(state.lancs, b.lancs);
    added = r.added.length; dup = r.dup;
    await db.putLancs(r.added);
    state.lancs = r.next;
    // Preço manual: o que já está aqui vale; o do backup só entra para ativos sem preço manual.
    const precos = { ...state.precos };
    for (const [a, p] of Object.entries(b.precosManuais)) if (precos[a]?.fonte !== 'manual') precos[a] = p;
    state.precos = precos;
    const ids = new Set(state.filtros.map(f => f.id));
    state.filtros = [...state.filtros, ...(x.filtros ?? []).filter(f => !ids.has(f.id))];
    state.pendIgnoradas = [...new Set([...state.pendIgnoradas, ...(x.pendIgnoradas ?? [])])];
    if (x.aReceber && (!state.aReceber || x.aReceber.em > state.aReceber.em)) state.aReceber = x.aReceber;
    if (x.tema && !state.cfg.tema) state.cfg = { ...state.cfg, tema: x.tema };
    if (x.banco) {
      const b = state.banco;
      const chaves = new Set(b.txs.map(t => t.chave)), contas = new Set(b.contas.map(c => c.id)), termos = new Set(b.regras.map(r => r.termo));
      b.txs = [...b.txs, ...x.banco.txs.filter(t => !chaves.has(t.chave))].sort((p, q) => p.d.localeCompare(q.d));
      b.contas = [...b.contas, ...x.banco.contas.filter(c => !contas.has(c.id))];
      b.ajustes = { ...x.banco.ajustes, ...b.ajustes };
      b.regras = [...b.regras, ...x.banco.regras.filter(r => !termos.has(r.termo))];
    }
  }
  await Promise.all([
    db.setKV('precos', state.precos), db.setKV('filtros', state.filtros), db.setKV('pendIgnoradas', state.pendIgnoradas),
    db.setKV('config', state.cfg), state.aReceber ? db.setKV('aReceber', state.aReceber) : Promise.resolve(),
    db.setKV('bancoContas', state.banco.contas), db.setKV('bancoTxs', state.banco.txs),
    db.setKV('bancoAjustes', state.banco.ajustes), db.setKV('bancoRegras', state.banco.regras),
  ]);
  clsCache = null;
  await hist.load(state.lancs);
  state.histPronto = true;
  recompute(); onChange();
  return { added, dup };
}

/** Dados que vão no backup além dos lançamentos. */
export const extrasBackup = (): Extras => ({
  filtros: state.filtros, pendIgnoradas: state.pendIgnoradas, aReceber: state.aReceber, tema: state.cfg.tema,
  ...(state.banco.txs.length || state.banco.regras.length
    ? { banco: { contas: state.banco.contas, txs: state.banco.txs, ajustes: state.banco.ajustes, regras: state.banco.regras } } : {}),
});

export async function wipe() {
  await db.clearAll();
  Object.assign(state, { lancs: [], precos: {}, indices: null, cfg: {}, cotEm: '', falhas: [], avisos: [], aReceber: null, pendIgnoradas: [], ultimoBackup: '' });
  Object.assign(state.banco, { contas: [], txs: [], ajustes: {}, regras: [], sinc: '', erros: [] });
  clsCache = null;
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
export async function updateLanc(id: string, patch: Partial<Omit<Lancamento, 'id' | 'o' | 'k0'>>) {
  const atual = state.lancs.find(l => l.id === id);
  if (!atual) return;
  const novo: Lancamento = { ...atual, ...patch, k0: atual.k0 ?? keyOf(atual) };
  if (novo.o === 'manual') delete novo.k0; // só lançamentos importados precisam lembrar a chave original
  state.lancs = state.lancs.map(l => (l.id === id ? novo : l));
  await db.putLancs([novo]);
  recompute(); onChange();
  if (patch.a && patch.a !== atual.a) hist.load(state.lancs).then(() => { recompute(); onChange(); });
}

export async function reverIgnoradas() {
  state.pendIgnoradas = [];
  await db.setKV('pendIgnoradas', []);
  onChange();
}

/** Cria ou altera um filtro de período salvo. */
export async function salvarFiltro(f: Omit<FiltroSalvo, 'id'> & { id?: string }) {
  const ini = f.ini <= f.fim ? f.ini : f.fim, fim = f.ini <= f.fim ? f.fim : f.ini;
  const novo: FiltroSalvo = { id: f.id || newId(), nome: f.nome.trim() || `${ini} a ${fim}`, ini, fim };
  state.filtros = f.id ? state.filtros.map(x => (x.id === f.id ? novo : x)) : [...state.filtros, novo];
  await db.setKV('filtros', state.filtros);
  onChange();
  return novo;
}

export async function excluirFiltro(id: string) {
  state.filtros = state.filtros.filter(x => x.id !== id);
  await db.setKV('filtros', state.filtros);
  onChange();
}

/* ---------- Banco (Open Finance via Meu Pluggy) ---------- */

let clsCache: Classificada[] | null = null;
/** Transações do banco já classificadas (receita, despesa, interna…) e com categoria. */
export function bancoClassificadas(): Classificada[] {
  return (clsCache ||= classificar(state.banco.txs, { contas: state.banco.contas, ajustes: state.banco.ajustes, regras: state.banco.regras }));
}
const mudouBanco = () => { clsCache = null; onChange(); };

export const bancoConfigurado = () => !!(state.cfg.pluggy?.clientId && state.cfg.pluggy.clientSecret && state.cfg.pluggy.itens.length);

export async function salvarPluggy(p: ConfigPluggy) {
  state.cfg = { ...state.cfg, pluggy: p };
  await db.setKV('config', state.cfg);
  onChange();
}

/**
 * Busca contas e transações. Na primeira vez, os últimos 12 meses; depois, refaz a janela recente
 * (o cartão muda transações quando a fatura fecha), mantendo o histórico mais antigo guardado aqui.
 */
export async function sincronizarBanco(): Promise<void> {
  const cfg = state.cfg.pluggy;
  if (!cfg || state.banco.sincronizando) return;
  state.banco.sincronizando = true; state.banco.erros = []; onChange();
  try {
    const ini = state.banco.sinc
      ? ymd(new Date(Date.parse(state.banco.sinc) - 45 * 864e5))
      : ymd(new Date(Date.now() - 365 * 864e5));
    const r = await sincronizarPluggy(cfg, ini);
    const lidas = new Set(r.contasLidas);
    const itens = new Set(cfg.itens);
    const contas = new Map(state.banco.contas.filter(c => itens.has(c.item)).map(c => [c.id, c]));
    for (const c of r.contas) contas.set(c.id, c);
    const txs = [
      ...state.banco.txs.filter(t => contas.has(t.conta) && !(lidas.has(t.conta) && t.d >= ini)),
      ...r.txs,
    ].sort((a, b) => a.d.localeCompare(b.d));
    Object.assign(state.banco, { contas: [...contas.values()], txs, erros: r.erros });
    if (r.contasLidas.length) {
      state.banco.sinc = new Date().toISOString();
      await db.setKV('bancoSinc', state.banco.sinc);
    }
    await Promise.all([db.setKV('bancoContas', state.banco.contas), db.setKV('bancoTxs', state.banco.txs)]);
  } catch (e) {
    state.banco.erros = [(e as Error).message || 'Não foi possível sincronizar agora.'];
  } finally {
    state.banco.sincronizando = false;
    mudouBanco();
  }
}

/**
 * Corrige a categoria e/ou o tipo de uma transação. Com `parecidas`, vira regra para todas as
 * transações com a mesma descrição (sem números), inclusive as que ainda vão chegar.
 */
export async function ajustarTx(tx: TxBanco, a: AjusteTx, parecidas: boolean) {
  if (parecidas) {
    const termo = termoDe(tx.desc);
    if (termo) {
      state.banco.regras = [...state.banco.regras.filter(r => r.termo !== termo), { id: newId(), termo, ...a }];
      await db.setKV('bancoRegras', state.banco.regras);
    }
    // A correção individual antiga desta transação daria conflito com a regra nova.
    const { [tx.chave]: _, ...resto } = state.banco.ajustes;
    state.banco.ajustes = resto;
  } else {
    state.banco.ajustes = { ...state.banco.ajustes, [tx.chave]: a };
  }
  await db.setKV('bancoAjustes', state.banco.ajustes);
  mudouBanco();
}

export async function voltarAutomatico(tx: TxBanco) {
  const { [tx.chave]: _, ...resto } = state.banco.ajustes;
  state.banco.ajustes = resto;
  await db.setKV('bancoAjustes', resto);
  mudouBanco();
}

export async function removerRegra(id: string) {
  state.banco.regras = state.banco.regras.filter(r => r.id !== id);
  await db.setKV('bancoRegras', state.banco.regras);
  mudouBanco();
}

/** Remove a conexão e apaga do aparelho as contas e transações (as regras ficam). */
export async function desconectarBanco() {
  const { pluggy: _, ...cfg } = state.cfg;
  state.cfg = cfg;
  Object.assign(state.banco, { contas: [], txs: [], sinc: '', erros: [] });
  await Promise.all([db.setKV('config', state.cfg), db.setKV('bancoContas', []), db.setKV('bancoTxs', []), db.setKV('bancoSinc', '')]);
  mudouBanco();
}

export function setMesBanco(mes: string) { state.banco.mes = mes; onChange(); }
