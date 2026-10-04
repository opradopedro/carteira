import './style.css';
import { registerSW } from 'virtual:pwa-register';
import * as app from './app';
import { model, state } from './app';
import type { Periodo } from './core/analise';
import { buildBackup, downloadJson } from './data/backup';
import { puxarDeArquivo } from './ui/puxarBackup';
import type { Classe, TipoLanc } from './core/types';
import { cleanTicker, guessClass, newId, parseNum, today } from './core/util';
import { CRIPTO_NOMES, buscarAtivos, type Sugestao } from './core/busca';
import { ehCripto, montarLancamentos, type Moeda } from './core/moeda';
import { CLASSES } from './core/types';
import { LIMITE_BRAPI, mercadoAberto } from './core/mercado';
import { abrirMenu, fecharMenu } from './ui/menu';
import { $, brl, fmtD, fmtQuando, privacidade, toast } from './ui/fmt';
import { renderResumo } from './ui/resumo';
import { renderAtivos } from './ui/ativos';
import { renderProventos } from './ui/proventos';
import { renderLancs, setFiltro } from './ui/lancamentos';
import { renderBadge } from './ui/pendencias';
import { renderPagina, tituloPagina } from './ui/paginas';
import * as seg from './seguranca/bloqueio';
import { bloqueioAberto, mostrarBloqueio } from './seguranca/tela';
import { TABS, back, currentPage, initNav, nav, openPage, parsePage, setRenderView, setTab, type Page, type Tab } from './ui/nav';

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
  $('#menuStatus').textContent = state.refreshing ? 'Atualizando…' : state.cotEm ? 'Última: ' + fmtQuando(state.cotEm) : 'Busca tudo agora';
  const usoB = state.uso.mes === today().slice(0, 7) ? state.uso.brapi : 0;
  $('#menuNota').innerHTML = (mercadoAberto(new Date())
    ? 'Pregão aberto: ações e FIIs atualizam sozinhos ao abrir o app ou entrar no ativo (no máximo a cada 15 min).'
    : 'Pregão fechado: ações e FIIs mostram o último preço; voltam a atualizar sozinhos das 10h às 18h em dias úteis.')
    + ' Cripto atualiza sempre que você abre o app.'
    + (state.cfg.brapiToken ? `<br>brapi este mês: ${usoB.toLocaleString('pt-BR')} de ${LIMITE_BRAPI.toLocaleString('pt-BR')} consultas grátis.` : '');

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
  if (page) { renderPagina($('#page'), page); if (page.k === 'lanc' && document.getElementById('eTipo')) syncEdit(); return; }
  if (nav.tab === 'resumo') renderResumo();
  if (nav.tab === 'ativos') renderAtivos();
  if (nav.tab === 'proventos') renderProventos();
  if (nav.tab === 'lancamentos') renderLancs();
}

function erroSeg(m: string) { const e = $('#segErr'); e.textContent = m; e.hidden = false; }

function atualizarOlho() {
  const b = $('#btnOlho');
  b.classList.toggle('ativo', privacidade.oculto);
  b.setAttribute('aria-pressed', String(privacidade.oculto));
  b.setAttribute('aria-label', privacidade.oculto ? 'Mostrar valores' : 'Ocultar valores');
  b.innerHTML = privacidade.oculto
    ? '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19c1.8 0 3.4-.6 4.7-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
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
  app.hist.carregarBusca();   // lista de ativos para as sugestões
  $('#formPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('#fAtivo').focus({ preventScroll: true });
}
function syncForm() {
  const p = $<HTMLSelectElement>('#fTipo').value === 'P';
  $('#wQtd').hidden = p; $('#wPreco').hidden = p; $('#wValor').hidden = !p;
  // "Pago em" só para cripto: dá para pagar em reais, dólar ou outra cripto.
  const cripto = !p && $<HTMLSelectElement>('#fClasse').value === 'cripto';
  const selM = $<HTMLSelectElement>('#fMoeda');
  $('#wMoeda').hidden = !cripto;
  if (!cripto) selM.value = 'BRL';
  const a = cleanTicker($<HTMLInputElement>('#fAtivo').value);
  for (const o of [...selM.options]) o.hidden = o.value === a; // não paga BTC com BTC
  if (selM.value === a) selM.value = 'BRL';
  const m = selM.value as Moeda;
  $('#fPrecoLabel').textContent = m === 'BRL' ? 'Preço unitário (R$)' : m === 'USD' ? 'Preço unitário (US$)' : `Preço unitário (em ${m})`;
  $('#wMoeda label').textContent = $<HTMLSelectElement>('#fTipo').value === 'V' ? 'Recebido em' : 'Pago em';
}
const moedaForm = () => ($('#wMoeda').hidden ? 'BRL' : $<HTMLSelectElement>('#fMoeda').value) as Moeda;
const fmtMoeda = (m: Moeda, x: number) => m === 'BRL' ? brl.format(x) : privacidade.oculto ? '••••• ' + m : m === 'USD'
  ? 'US$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x)
  : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(x) + ' ' + m;
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
  const m = moedaForm();
  let novos;
  if (t === 'P') novos = [{ id: newId(), d, t, a, c, q: 0, p: 0, v: val, o: 'manual' as const }];
  else {
    let cambio = 1;
    if (m !== 'BRL') {
      const cb = await app.hist.cambioNoDia(m, d).catch(() => null);
      if (!cb) { $('#formErr').textContent = `Não achei a cotação de ${m} em ${fmtD(d)}. Informe o preço em reais.`; $('#formErr').hidden = false; return; }
      cambio = cb.taxa;
    }
    novos = montarLancamentos({ t: t as 'C' | 'V', d, a, c, q, moeda: m, pMoeda: p, cambio }, newId);
  }
  for (const s of ['#fAtivo', '#fQtd', '#fPreco', '#fValor']) $<HTMLInputElement>(s).value = '';
  $('#fPrecoNota').hidden = true;
  $<HTMLSelectElement>('#fMoeda').value = 'BRL'; syncForm();
  $('#formErr').hidden = true; $('#formPanel').hidden = true;
  await app.addLancs(novos);
  toast(novos.length > 1 ? `Troca salva: ${novos[0].a} e ${novos[1].a}` : 'Lançamento salvo');
  if (t !== 'P' && !state.precos[a] && navigator.onLine) app.refresh('novos');
}

/* ---------- preço do dia no lançamento manual ---------- */
let buscaPreco = 0;
let cambioAtual: { m: Moeda; taxa: number; d: string; fonte: string } | null = null;
async function sugerirPreco() {
  const tipo = $<HTMLSelectElement>('#fTipo').value, d = $<HTMLInputElement>('#fData').value;
  const a = cleanTicker($<HTMLInputElement>('#fAtivo').value), c = $<HTMLSelectElement>('#fClasse').value as Classe;
  const inp = $<HTMLInputElement>('#fPreco'), nota = $('#fPrecoNota');
  if (tipo === 'P' || !a || !d) { atualizarTotal(); return; }
  const id = ++buscaPreco;
  nota.hidden = false; nota.textContent = 'Buscando o preço do dia…';
  const m = moedaForm();
  const [rBrl, cb] = await Promise.all([
    app.hist.precoNoDia(a, c, d, tipo === 'V').catch(() => null),
    m === 'BRL' ? Promise.resolve({ taxa: 1, d, fonte: '' }) : app.hist.cambioNoDia(m, d).catch(() => null),
  ]);
  if (id !== buscaPreco) return; // o usuário mudou algo enquanto buscava
  cambioAtual = cb ? { m, taxa: cb.taxa, d: cb.d, fonte: cb.fonte } : null;
  const r = rBrl && cb ? { ...rBrl, p: rBrl.p / cb.taxa } : null;
  // Decide só agora: se o usuário digitou um preço enquanto buscava, ele é mantido.
  const pode = !inp.value || inp.dataset.auto === '1';
  if (!r) {
    nota.textContent = !cb ? `Não achei a cotação de ${m} nesse dia. Escolha outra moeda ou informe em reais.` : 'Não achei o preço desse dia para esse ativo. Informe o preço que você pagou.';
  } else {
    if (pode) {
      const casas = m === 'BRL' || m === 'USD' ? 2 : 8;
      inp.value = String(Number(r.p.toFixed(casas))).replace('.', ',');
      inp.dataset.auto = '1';
    }
    const outroDia = r.d !== d ? ` (último dia com negociação antes de ${fmtD(d)})` : '';
    const conv = m === 'BRL' ? '' : ` = ${brl.format(rBrl!.p)} ÷ ${brl.format(cb!.taxa)} por ${m} (${cb!.fonte})`;
    nota.textContent = `${pode ? 'Preenchido com' : 'Referência:'} ${fmtMoeda(m, r.p)} — ${r.fonte} em ${fmtD(r.d)}${outroDia}${conv}. Se pagou outro preço, é só trocar.`;
  }
  atualizarTotal();
}
function atualizarTotal() {
  const q = parseNum($<HTMLInputElement>('#fQtd').value), p = parseNum($<HTMLInputElement>('#fPreco').value);
  const nota = $('#fPrecoNota');
  nota.querySelector('.total')?.remove();
  if (q > 0 && p > 0 && $<HTMLSelectElement>('#fTipo').value !== 'P') {
    const m = moedaForm();
    const emReais = m === 'BRL' ? '' : cambioAtual && cambioAtual.m === m ? ` ≈ ${brl.format(q * p * cambioAtual.taxa)}` : '';
    const troca = ehCripto(m) ? ` Também será lançada a ${$<HTMLSelectElement>('#fTipo').value === 'C' ? 'venda' : 'compra'} de ${fmtMoeda(m, q * p)}.` : '';
    const t = document.createElement('b'); t.className = 'total'; t.textContent = ` Total da operação: ${fmtMoeda(m, q * p)}${emReais}.${troca}`;
    nota.hidden = false; nota.appendChild(t);
  }
}

/* ---------- sugestões do campo Ativo ---------- */
function fontesBusca(): Sugestao[] {
  const minhas = new Map<string, Sugestao>();
  for (const l of state.lancs) if (!minhas.has(l.a)) minhas.set(l.a, { a: l.a, nome: CRIPTO_NOMES[l.a] ?? '', c: l.c, minha: true });
  const cat = app.hist.catalogo();
  for (const s of minhas.values()) if (!s.nome) s.nome = cat.find(x => x.a === s.a)?.nome ?? '';
  return [
    ...minhas.values(),
    ...Object.entries(CRIPTO_NOMES).map(([a, nome]) => ({ a, nome, c: 'cripto' as const })),
    ...cat,
  ];
}
let sugAtuais: Sugestao[] = [];
function mostrarSugestoes() {
  const inp = $<HTMLInputElement>('#fAtivo'), box = $('#sugAtivo');
  sugAtuais = buscarAtivos(inp.value, fontesBusca());
  box.hidden = !sugAtuais.length;
  inp.setAttribute('aria-expanded', String(!box.hidden));
  box.innerHTML = sugAtuais.map((s, i) => `<button type="button" role="option" data-sug="${i}">
    <b>${s.a}</b><span>${s.nome ? s.nome : ''}</span><em>${s.minha ? 'na carteira' : CLASSES[s.c]}</em></button>`).join('');
}
function escolherSugestao(i: number) {
  const s = sugAtuais[i];
  if (!s) return;
  $<HTMLInputElement>('#fAtivo').value = s.a;
  $<HTMLSelectElement>('#fClasse').value = s.c;
  $('#sugAtivo').hidden = true;
  $('#fAtivo').setAttribute('aria-expanded', 'false');
  $<HTMLInputElement>('#fQtd').focus();
  syncForm();
  sugerirPreco();
}
// Escolher na lista sem tirar o foco do campo (evita fechar a lista antes do toque valer).
document.addEventListener('pointerdown', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sug]');
  if (b) { e.preventDefault(); escolherSugestao(Number(b.dataset.sug)); }
});

/* ---------- eventos ---------- */
document.addEventListener('click', async e => {
  const target = e.target as HTMLElement;
  // Cards e linhas que abrem uma página de detalhe (exceto toques em gráficos e controles internos).
  const pg = target.closest<HTMLElement>('[data-page]');
  if (pg) {
    const ctl = target.closest('button, input, select, label, .ichart, a');
    if (!ctl || ctl === pg || !pg.contains(ctl)) {
      const p = parsePage(pg.dataset.page!);
      if (p) { openPage(p); aoEntrar(p); return; }
    }
  }
  const t = target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) setTab(ds.tab as Tab);
  else if (t.id === 'btnBack' || t.id === 'btnBack2') back();
  else if (t.id === 'btnSegAtivar') {
    const p1 = $<HTMLInputElement>('#segPin1').value, p2 = $<HTMLInputElement>('#segPin2').value;
    if (!/^\d{4,12}$/.test(p1)) return erroSeg('O PIN precisa ter de 4 a 12 números.');
    if (p1 !== p2) return erroSeg('Os dois PINs não são iguais.');
    await seg.definirPin(p1);
    toast('Bloqueio ativado');
    rerenderPagina();
    if (await seg.biometriaDisponivel()) setTimeout(() => toast('Agora, se quiser, toque em "Usar digital ou rosto".'), 1800);
  }
  else if (t.id === 'btnSegBio') {
    try { await seg.cadastrarBiometria(); toast('Digital/rosto cadastrado'); rerenderPagina(); }
    catch (err) { erroSeg((err as Error).name === 'NotAllowedError' ? 'Cadastro cancelado.' : (err as Error).message || 'Não foi possível cadastrar.'); }
  }
  else if (t.id === 'btnSegBioRem') { seg.removerBiometria(); toast('Digital removida; o PIN continua valendo'); rerenderPagina(); }
  else if (t.id === 'btnSegTrocar' || t.id === 'btnSegDesativar') {
    if (!(await seg.conferirPin($<HTMLInputElement>('#segPinAtual').value))) return erroSeg('PIN atual errado.');
    if (t.id === 'btnSegDesativar') { seg.desativar(); toast('Bloqueio desativado'); rerenderPagina(); return; }
    const novo = $<HTMLInputElement>('#segPinNovo').value;
    if (!/^\d{4,12}$/.test(novo)) return erroSeg('O novo PIN precisa ter de 4 a 12 números.');
    await seg.definirPin(novo); toast('PIN trocado'); rerenderPagina();
  }
  else if (t.id === 'btnOlho') {
    privacidade.oculto = !privacidade.oculto;
    try { localStorage.setItem('oculto', privacidade.oculto ? '1' : ''); } catch { /* ignora */ }
    atualizarOlho(); rerenderPagina();
  }
  else if (ds.delLanc) {
    if (ds.armed) { await app.removeLanc(ds.delLanc); toast('Lançamento excluído'); back(); }
    else { ds.armed = '1'; t.textContent = 'Toque de novo para confirmar'; setTimeout(() => { if (t.isConnected) { delete ds.armed; t.textContent = 'Excluir lançamento'; } }, 4000); }
  }
  else if (t.id === 'btnAdd') openForm();
  else if (t.id === 'btnCancel') $('#formPanel').hidden = true;
  else if (t.id === 'btnMenu') abrirMenu();
  else if (t.id === 'btnMenuFechar') fecharMenu();
  else if (t.id === 'btnRefresh') fecharMenu(() => { if (!navigator.onLine) toast('Sem internet agora.'); else app.refresh('botao'); });
  else if (ds.menuPage) { const p = parsePage(ds.menuPage); fecharMenu(() => { if (p && currentPage()?.k !== p.k) openPage(p); }); }
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

function syncEdit() {
  const t = $<HTMLSelectElement>('#eTipo').value;
  $('#ewQtd').hidden = t === 'P';
  $('#ewPreco').hidden = t === 'P' || t === 'S';
  $('#ewValor').hidden = !(t === 'P' || t === 'S');
  $('#ewValor label').textContent = t === 'S' ? 'Custo acrescentado (R$)' : 'Valor recebido (R$)';
  const q = parseNum($<HTMLInputElement>('#eQtd').value), p = parseNum($<HTMLInputElement>('#ePreco').value);
  $('#eTotal').textContent = (t === 'C' || t === 'V') && q > 0 && p > 0 ? `Total da operação: ${brl.format(q * p)}` : '';
}

async function salvarEdicao(e: Event) {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const v = (sel: string) => $<HTMLInputElement>(sel).value;
  const t = v('#eTipo') as TipoLanc, d = v('#eData'), a = cleanTicker(v('#eAtivo')), c = v('#eClasse') as Classe;
  const q = parseNum(v('#eQtd')), p = parseNum(v('#ePreco')), val = parseNum(v('#eValor'));
  const err = !d ? 'Informe a data.' : !a ? 'Informe o ativo.' : d > today() ? 'A data não pode ser no futuro.'
    : t === 'P' ? (val > 0 ? '' : 'Informe o valor recebido.')
    : t === 'S' ? (q !== 0 ? '' : 'Informe a quantidade.')
    : (q > 0 && p > 0 ? '' : 'Informe quantidade e preço maiores que zero.');
  if (err) { $('#eErr').textContent = err; $('#eErr').hidden = false; return; }
  const patch = t === 'P' ? { t, d, a, c, q: 0, p: 0, v: val }
    : t === 'S' ? { t, d, a, c, q, p: 0, v: val }
    : { t, d, a, c, q, p, v: q * p };
  await app.updateLanc(f.dataset.id!, patch);
  toast('Lançamento atualizado');
  back();
}

document.addEventListener('submit', async e => {
  const f = e.target as HTMLElement;
  if (f.id === 'form') submitForm(e);
  else if (f.id === 'formEdit') salvarEdicao(e);
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
  if (el.id === 'fTipo') { syncForm(); sugerirPreco(); }
  else if (el.id === 'fData') sugerirPreco();
  else if (el.id === 'fClasse' || el.id === 'fMoeda') { syncForm(); sugerirPreco(); }
  else if (el.id === 'eTipo') syncEdit();
  else if (el.id === 'segTempo') { seg.definirTempo(Number(el.value)); toast('Preferência salva'); }
  else if (el.id === 'ordemLanc') {
    state.ordemLanc = el.value as typeof state.ordemLanc;
    try { localStorage.setItem('ordemLanc', state.ordemLanc); } catch { /* ignora */ }
    renderLancs();
  }
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
  else if (el.dataset.backup !== undefined) {
    const f = el.files?.[0]; el.value = '';
    if (f) await puxarDeArquivo(f);
  }
});

document.addEventListener('input', e => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'filtro') { setFiltro(el.value); renderLancs(); }
  else if (el.id === 'fAtivo') mostrarSugestoes();
  else if (el.id === 'fPreco') { el.dataset.auto = ''; atualizarTotal(); }
  else if (el.id === 'fQtd') atualizarTotal();
  else if (el.id === 'eQtd' || el.id === 'ePreco') syncEdit();
});
document.addEventListener('focusout', e => {
  if ((e.target as HTMLElement).id !== 'fAtivo') return;
  setTimeout(() => {
    if (document.activeElement?.id === 'fAtivo') return; // voltou para o campo: mantém a lista
    $('#sugAtivo').hidden = true; $('#fAtivo').setAttribute('aria-expanded', 'false');
  }, 150);
  guessFormClass();
  syncForm();
  sugerirPreco();
});

async function exportBackup() {
  const b = buildBackup(state.lancs, state.precos, app.extrasBackup());
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

/** Entrar num ativo ou classe busca a cotação ao vivo dele (respeitando as regras de core/mercado.ts). */
function aoEntrar(p: Page) {
  if (!navigator.onLine || !state.ready) return;
  if (p.k === 'ativo') app.refresh('pagina', x => x.a === p.a);
  else if (p.k === 'classe') app.refresh('pagina', x => x.c === p.c);
}

// Ao sair do app, cobre a tela (a miniatura de apps recentes não mostra valores);
// ao voltar, pede o desbloqueio se passou do tempo escolhido e atualiza as cotações.
let saiuEm = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    saiuEm = Date.now();
    if (seg.bloqueioAtivo()) document.body.classList.add('coberto');
    return;
  }
  const fora = Date.now() - saiuEm;
  const atualizar = () => { if (fora >= 60_000 && state.ready && state.lancs.length && navigator.onLine) app.refresh('abrir'); };
  if (seg.bloqueioAtivo()) {
    const cfg = seg.lerConfig()!;
    if (!bloqueioAberto() && fora >= cfg.tempo * 1000) { mostrarBloqueio().then(atualizar); return; }
    document.body.classList.remove('coberto');
  }
  atualizar();
});

window.addEventListener('online', () => { render(); if (state.lancs.length) app.refresh('abrir'); });
window.addEventListener('offline', render);
// Só redesenha se a largura mudar (no celular, a barra de endereço muda a altura ao rolar).
let rz = 0, largura = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = window.setTimeout(() => { if (window.innerWidth !== largura) { largura = window.innerWidth; render(); } }, 150);
});

document.getElementById('menuFundo')!.addEventListener('click', () => fecharMenu());

/* ---------- início ---------- */
async function start() {
  app.setOnChange(render);
  setRenderView(render);
  try { const o = localStorage.getItem('ordemLanc'); if (o) state.ordemLanc = o as typeof state.ordemLanc; } catch { /* ignora */ }
  try { privacidade.oculto = localStorage.getItem('oculto') === '1'; } catch { /* ignora */ }
  atualizarOlho();
  initNav(location.hash.slice(1));
  renderLancs(); syncForm();
  render();
  if (seg.bloqueioAtivo()) await mostrarBloqueio(); // nada da carteira é carregado antes de desbloquear
  await app.init();
  applyTheme();
  render();
  if (state.lancs.length) {
    if (navigator.onLine) await app.refresh('abrir');
    else await app.loadHist();
  }
}
start();

registerSW({ immediate: true });
