import './style.css';
import { registerSW } from 'virtual:pwa-register';
import * as app from './app';
import { model, state } from './app';
import type { Periodo } from './core/analise';
import { buildBackup, downloadJson, parseBackup } from './data/backup';
import type { Classe, TipoLanc } from './core/types';
import { cleanTicker, guessClass, newId, parseNum, today } from './core/util';
import { $, fmtQuando, toast } from './ui/fmt';
import { renderResumo } from './ui/resumo';
import { renderAtivos } from './ui/ativos';
import { renderProventos } from './ui/proventos';
import { renderLancs, setFiltro } from './ui/lancamentos';
import { renderBadge } from './ui/pendencias';
import { renderPagina, tituloPagina } from './ui/paginas';
import { TABS, back, currentPage, initNav, nav, openPage, parsePage, setRenderView, setTab, type Tab } from './ui/nav';

function applyTheme() {
  const t = state.cfg.tema;
  const root = document.documentElement;
  if (t === 'claro') root.dataset.theme = 'light';
  else if (t === 'escuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
}

function renderHeader() {
  const st = $('#status'), bn = $('#banner');
  const online = navigator.onLine;
  const page = currentPage();
  $('#btnBack').hidden = !page;
  document.body.classList.toggle('em-pagina', !!page);
  $('#title').textContent = page ? tituloPagina(page) : 'Minha Carteira';
  if (!state.ready) st.textContent = 'Carregando…';
  else if (state.refreshing) st.textContent = 'Atualizando cotações…';
  else if (state.cotEm) st.textContent = (online ? 'Cotações de ' : 'Offline · cotações de ') + fmtQuando(state.cotEm);
  else st.textContent = online ? 'Cotações ainda não atualizadas' : 'Offline';
  $('#btnRefresh').classList.toggle('spin', state.refreshing);
  ($('#btnRefresh') as HTMLButtonElement).disabled = state.refreshing;

  const msgs: string[] = [];
  if (state.ready && !online && state.lancs.length) msgs.push('Sem internet: mostrando as últimas cotações salvas.');
  msgs.push(...state.falhas);
  if (state.ready && model.tot.semCot) msgs.push(`${model.tot.semCot} ${model.tot.semCot === 1 ? 'ativo está' : 'ativos estão'} sem cotação e aparece${model.tot.semCot === 1 ? '' : 'm'} pelo custo. Veja Pendências.`);
  bn.hidden = !msgs.length || !!page;
  bn.innerHTML = '';
  for (const m of msgs) { const d = document.createElement('div'); d.textContent = m; bn.appendChild(d); }
}

/** Desenha a tela atual: uma página de detalhe (se houver) ou a aba. */
function render() {
  renderHeader();
  renderBadge();
  const page = currentPage();
  $('#page').hidden = !page;
  for (const t of TABS) $('#tab-' + t).hidden = !!page || t !== nav.tab;
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach(b =>
    !page && b.dataset.tab === nav.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (page) { renderPagina($('#page'), page); return; }
  if (nav.tab === 'resumo') renderResumo();
  if (nav.tab === 'ativos') renderAtivos();
  if (nav.tab === 'proventos') renderProventos();
  if (nav.tab === 'lancamentos') renderLancs();
}

/** Re-desenha só a página aberta (após mudar um filtro, por exemplo), mantendo a rolagem. */
function rerenderPagina() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

/* ---------- formulário de lançamento ---------- */
function openForm() {
  if (nav.tab !== 'lancamentos' || currentPage()) setTab('lancamentos');
  $('#formPanel').hidden = false; $('#formErr').hidden = true;
  const fd = $<HTMLInputElement>('#fData');
  if (!fd.value) fd.value = today();
  app.hist.load(state.lancs); // para reconhecer a classe do ativo digitado
  $('#formPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('#fAtivo').focus({ preventScroll: true });
}
function syncForm() {
  const p = $<HTMLSelectElement>('#fTipo').value === 'P';
  $('#wQtd').hidden = p; $('#wPreco').hidden = p; $('#wValor').hidden = !p;
}
function guessFormClass() {
  const a = cleanTicker($<HTMLInputElement>('#fAtivo').value);
  if (!a) return;
  const existente = state.lancs.find(l => l.a === a);
  $<HTMLSelectElement>('#fClasse').value = existente?.c ?? app.hist.classeB3(a) ?? guessClass(a);
}
async function submitForm(e: Event) {
  e.preventDefault();
  const v = (s: string) => $<HTMLInputElement>(s).value;
  const t = v('#fTipo') as TipoLanc, d = v('#fData'), a = cleanTicker(v('#fAtivo')), c = v('#fClasse') as Classe;
  const q = parseNum(v('#fQtd')), p = parseNum(v('#fPreco')), val = parseNum(v('#fValor'));
  const err = !d ? 'Informe a data.' : !a ? 'Informe o ativo.' : d > today() ? 'A data não pode ser no futuro.'
    : t === 'P' ? (val > 0 ? '' : 'Informe o valor recebido.') : (q > 0 && p > 0 ? '' : 'Informe quantidade e preço maiores que zero.');
  if (err) { $('#formErr').textContent = err; $('#formErr').hidden = false; return; }
  const l = t === 'P'
    ? { id: newId(), d, t, a, c, q: 0, p: 0, v: val, o: 'manual' as const }
    : { id: newId(), d, t, a, c, q, p, v: q * p, o: 'manual' as const };
  for (const s of ['#fAtivo', '#fQtd', '#fPreco', '#fValor']) $<HTMLInputElement>(s).value = '';
  $('#formErr').hidden = true; $('#formPanel').hidden = true;
  await app.addLanc(l);
  toast('Lançamento salvo');
  if (t !== 'P' && !state.precos[a] && navigator.onLine) app.refresh('novos');
}

/* ---------- eventos ---------- */
document.addEventListener('click', async e => {
  const target = e.target as HTMLElement;
  // Cards e linhas que abrem uma página de detalhe (exceto toques em gráficos e controles internos).
  const pg = target.closest<HTMLElement>('[data-page]');
  if (pg) {
    const ctl = target.closest('button, input, select, label, .ichart, a');
    if (!ctl || ctl === pg || !pg.contains(ctl)) {
      const p = parsePage(pg.dataset.page!);
      if (p) { openPage(p); return; }
    }
  }
  const t = target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) setTab(ds.tab as Tab);
  else if (t.id === 'btnBack') back();
  else if (t.id === 'btnAdd') openForm();
  else if (t.id === 'btnCancel') $('#formPanel').hidden = true;
  else if (t.id === 'btnRefresh') { if (!navigator.onLine) toast('Sem internet agora.'); else app.refresh('tudo'); }
  else if (ds.editar !== undefined) { state.editando = ds.editar || null; rerenderPagina(); }
  else if (ds.salvarFiltro) {
    const k = ds.salvarFiltro as keyof typeof state.per;
    const v = (sel: string) => document.querySelector<HTMLInputElement>(sel)?.value || '';
    const ini = v(`[data-per-ini="${k}"]`), fim = v(`[data-per-fim="${k}"]`);
    if (!ini || !fim) { toast('Escolha o mês inicial e o final.'); return; }
    const nome = prompt('Nome do filtro (aparece como opção em todas as telas):', `${ini.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}`);
    if (nome == null) return;
    const f = await app.salvarFiltro({ nome, ini, fim });
    state.per[k] = { tipo: 'custom', ini: f.ini, fim: f.fim, salvo: f.id };
    toast('Filtro salvo'); rerenderPagina();
  }
  else if (ds.per === 'salvo' && ds.perChave) {
    const f = state.filtros.find(x => x.id === ds.salvo);
    if (f) { state.per[ds.perChave as keyof typeof state.per] = { tipo: 'custom', ini: f.ini, fim: f.fim, salvo: f.id }; rerenderPagina(); }
  }
  else if (ds.filtroSalvar) {
    const id = ds.filtroSalvar === 'novo' ? undefined : ds.filtroSalvar;
    const v = (campo: string) => document.querySelector<HTMLInputElement>(`[data-filtro-campo="${campo}"][data-filtro-id="${ds.filtroSalvar}"]`)?.value || '';
    if (!v('ini') || !v('fim')) { toast('Escolha o mês inicial e o final.'); return; }
    await app.salvarFiltro({ id, nome: v('nome'), ini: v('ini'), fim: v('fim') });
    toast(id ? 'Filtro alterado' : 'Filtro criado'); rerenderPagina();
  }
  else if (ds.filtroExcluir) {
    if (ds.armed) { await app.excluirFiltro(ds.filtroExcluir); toast('Filtro excluído'); rerenderPagina(); }
    else { ds.armed = '1'; t.textContent = 'Confirmar'; setTimeout(() => { if (t.isConnected) { delete ds.armed; t.textContent = 'Excluir'; } }, 3500); }
  }
  else if (ds.per && ds.perChave) {
    const k = ds.perChave as keyof typeof state.per;
    state.per[k] = ds.per === 'y' ? { tipo: 'y', ano: Number(ds.ano) } : ds.per === 'custom' ? { ...state.per[k], tipo: 'custom' } : { tipo: ds.per as Periodo['tipo'] };
    rerenderPagina();
  }
  else if (ds.venc) {
    const inp = $<HTMLInputElement>('#venc-' + CSS.escape(ds.venc));
    const v = parseNum(inp.value);
    const l = state.lancs.find(x => x.id === ds.venc);
    if (!(v > 0) || !l) { toast('Informe o valor recebido.'); return; }
    await app.updateLanc(l.id, { v, p: v / l.q });
    toast('Valor salvo: o rendimento já entra nos cálculos');
  }
  else if (ds.ignorar) { await app.ignorarPendencia(ds.ignorar); }
  else if (ds.filtrar) { setFiltro(ds.filtrar); setTab('lancamentos'); setTimeout(() => { $<HTMLInputElement>('#filtro').value = ds.filtrar!; renderLancs(); }, 50); }
  else if (t.id === 'btnReverIgnoradas') { await app.reverIgnoradas(); }
  else if (ds.savepx) {
    const p = parseNum($<HTMLInputElement>('#px').value);
    if (p > 0) { state.editando = null; await app.setPrecoManual(ds.savepx, p); toast('Preço salvo'); }
    else toast('Informe um preço maior que zero.');
  }
  else if (ds.autopx) { state.editando = null; await app.setPrecoManual(ds.autopx, null); toast('Voltando à cotação automática'); if (navigator.onLine) app.refresh('novos'); }
  else if (ds.del) {
    if (ds.armed) { await app.removeLanc(ds.del); toast('Lançamento excluído'); }
    else {
      ds.armed = '1'; t.textContent = 'Confirmar';
      setTimeout(() => { if (t.isConnected) { delete ds.armed; t.textContent = 'Excluir'; } }, 3500);
    }
  }
  else if (t.id === 'btnShowKeys') {
    for (const s of ['#cBrapi', '#cCg']) { const i = $<HTMLInputElement>(s); i.type = i.type === 'password' ? 'text' : 'password'; }
  }
  else if (t.id === 'btnExport') exportBackup();
  else if (t.id === 'btnWipe') {
    if (ds.armed) {
      await app.wipe(); applyTheme(); toast('Todos os dados foram apagados'); setTab('resumo');
    } else {
      ds.armed = '1'; t.textContent = 'Tem certeza? Toque de novo para apagar tudo';
      setTimeout(() => { if (t.isConnected) { delete ds.armed; t.textContent = 'Apagar todos os dados'; } }, 5000);
    }
  }
});

document.addEventListener('submit', async e => {
  const f = e.target as HTMLElement;
  if (f.id === 'form') submitForm(e);
  else if (f.id === 'cfgForm') {
    e.preventDefault();
    await app.saveConfig({
      brapiToken: $<HTMLInputElement>('#cBrapi').value.trim() || undefined,
      cgKey: $<HTMLInputElement>('#cCg').value.trim() || undefined,
    });
    toast('Ajustes salvos');
    if (navigator.onLine && state.lancs.length) app.refresh('novos');
  }
});

document.addEventListener('change', async e => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'fTipo') syncForm();
  else if (el.id === 'cls' && el.dataset.cls) { await app.setClasse(el.dataset.cls, el.value as Classe); toast('Classe alterada'); }
  else if (el.id === 'cTema') { await app.saveConfig({ tema: el.value as 'auto' | 'claro' | 'escuro' }); applyTheme(); }
  else if (el.dataset.perIni || el.dataset.perFim) {
    const k = (el.dataset.perIni || el.dataset.perFim) as keyof typeof state.per;
    const v = (sel: string) => (document.querySelector<HTMLInputElement>(sel)?.value || undefined);
    state.per[k] = { tipo: 'custom', ini: v(`[data-per-ini="${k}"]`), fim: v(`[data-per-fim="${k}"]`) };
    rerenderPagina();
  }
  else if (el.id === 'fileB3') {
    const files = [...(el.files || [])]; el.value = '';
    if (!files.length) return;
    const msg = $('#importMsg'); msg.hidden = false; msg.textContent = 'Lendo planilhas…';
    try {
      const msgs = await app.importB3(files);
      msg.innerHTML = ''; for (const m of msgs) { const d = document.createElement('div'); d.textContent = m; msg.appendChild(d); }
      if (navigator.onLine) app.refresh('novos');
    } catch {
      msg.textContent = 'Não foi possível importar. Tente de novo.';
    }
  }
  else if (el.id === 'fileBackup') {
    const f = el.files?.[0]; el.value = '';
    if (!f) return;
    const msg = $('#backupMsg'); msg.hidden = false;
    try {
      const b = parseBackup(await f.text());
      if (state.lancs.length && !confirm(`Restaurar o backup de ${b.exportadoEm ? fmtQuando(b.exportadoEm) : 'data desconhecida'} com ${b.lancs.length} lançamentos? A carteira atual (${state.lancs.length} lançamentos) será substituída.`)) { msg.hidden = true; return; }
      await app.restoreBackup(b.lancs, b.precosManuais);
      msg.textContent = `Backup restaurado: ${b.lancs.length} lançamentos.`;
      if (navigator.onLine) app.refresh('novos');
    } catch (err) {
      msg.textContent = (err as Error).message || 'Não consegui ler o backup.';
    }
  }
});

document.addEventListener('input', e => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'filtro') { setFiltro(el.value); renderLancs(); }
});
document.addEventListener('focusout', e => { if ((e.target as HTMLElement).id === 'fAtivo') guessFormClass(); });

async function exportBackup() {
  const b = buildBackup(state.lancs, state.precos);
  const nome = `carteira-backup-${today()}.json`;
  const file = new File([JSON.stringify(b, null, 1)], nome, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup da carteira' });
      await backupFeito(); return;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
  }
  downloadJson(b, nome);
  await backupFeito();
}

async function backupFeito() {
  await app.marcarBackup();
  toast('Backup exportado');
}

window.addEventListener('online', () => { render(); if (state.lancs.length) app.refresh('diario'); });
window.addEventListener('offline', render);
// Só redesenha se a largura mudar (no celular, a barra de endereço muda a altura ao rolar).
let rz = 0, largura = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = window.setTimeout(() => { if (window.innerWidth !== largura) { largura = window.innerWidth; render(); } }, 150);
});

/* ---------- início ---------- */
async function start() {
  app.setOnChange(render);
  setRenderView(render);
  initNav(location.hash.slice(1));
  renderLancs(); syncForm();
  render();
  await app.init();
  applyTheme();
  render();
  if (state.lancs.length) {
    if (navigator.onLine) await app.refresh('diario');
    else await app.loadHist();
  }
}
start();

registerSW({ immediate: true });
