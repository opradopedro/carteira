import { model, state } from '../app';
import type { Lancamento, TipoLanc } from '../core/types';
import { $, brl, esc, fmtD, fmtQ } from './fmt';
import { MOEDAS, NOME_MOEDA } from '../core/moeda';

const TIPO: Record<TipoLanc, string> = { C: 'Compra', V: 'Venda', P: 'Provento', S: 'Ajuste' };
const COR: Record<TipoLanc, string> = { C: 'accent', V: 'loss', P: 'gain', S: 'muted' };

let montado = false;
export let filtro = '';
export const setFiltro = (f: string) => { filtro = f; };

/** Estrutura fixa da aba (formulário não é recriado a cada render, para não perder o que foi digitado). */
function montar(el: HTMLElement) {
  el.innerHTML = `
  <div class="panel">
    <h2>Trazer lançamentos</h2>
    <div class="row">
      <label class="btn primary" for="fileB3">Importar planilhas da B3<input type="file" id="fileB3" accept=".xlsx,.xls,.csv" multiple></label>
      <button class="btn" id="btnAdd" type="button">+ Lançar na mão</button>
      <label class="btn" for="fileBackupLanc">Puxar de um backup<input type="file" id="fileBackupLanc" data-backup accept=".json,application/json"></label>
    </div>
    <div class="sub">Na Área do Investidor da B3, em <b>Extratos</b>, baixe em Excel o arquivo de <b>Negociação</b> (compras e vendas na bolsa) o de <b>Movimentação</b> (proventos, Tesouro Direto, desdobros e bonificações) e, se quiser, o de <b>Eventos</b> (proventos anunciados a receber). Pode selecionar todos de uma vez e importar de novo depois: o que já existe não duplica. Um backup do app (arquivo .json) também pode ser puxado aqui, juntando com o que já existe.</div>
    <div class="sub" id="importMsg" hidden></div>
  </div>
  <div class="panel" id="formPanel" hidden>
    <h2>Novo lançamento</h2>
    <form id="form" autocomplete="off">
      <div class="field"><label for="fTipo">Tipo</label>
        <select id="fTipo"><option value="C">Compra</option><option value="V">Venda</option><option value="P">Provento recebido</option></select></div>
      <div class="field"><label for="fData">Data</label><input type="date" id="fData" required></div>
      <div class="field busca"><label for="fAtivo">Ativo</label><input id="fAtivo" placeholder="PETR4, Bitcoin, Tesouro IPCA+" autocapitalize="characters" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="sugAtivo" aria-expanded="false" required>
        <div class="sug" id="sugAtivo" role="listbox" hidden></div></div>
      <div class="field"><label for="fClasse">Classe</label>
        <select id="fClasse"><option value="acao">Ações</option><option value="fii">FIIs</option><option value="cripto">Cripto</option><option value="tesouro">Tesouro Direto</option><option value="outro">Outros</option></select></div>
      <div class="field full" id="wMoeda" hidden><label for="fMoeda">Pago em</label>
        <select id="fMoeda">${MOEDAS.map(m => `<option value="${m}">${NOME_MOEDA[m]}</option>`).join('')}</select></div>
      <div class="field" id="wQtd"><label for="fQtd">Quantidade</label><input id="fQtd" inputmode="decimal" placeholder="100 ou 0,0125"></div>
      <div class="field" id="wPreco"><label for="fPreco" id="fPrecoLabel">Preço unitário (R$)</label><input id="fPreco" inputmode="decimal" placeholder="38,20"></div>
      <div class="note full" id="fPrecoNota" hidden></div>
      <div class="field full" id="wValor" hidden><label for="fValor">Valor recebido (R$)</label><input id="fValor" inputmode="decimal" placeholder="125,40"></div>
      <div class="row full">
        <button class="btn primary" type="submit">Salvar lançamento</button>
        <button class="btn" type="button" id="btnCancel">Cancelar</button>
      </div>
      <div class="err full" id="formErr" hidden></div>
    </form>
  </div>
  <div class="panel">
    <h2>Lançamentos</h2>
    <div class="form">
      <div class="field"><label for="filtro">Filtrar</label><input id="filtro" type="search" placeholder="Ativo" aria-label="Filtrar por ativo"></div>
      <div class="field"><label for="ordemLanc">Ordenar por</label><select id="ordemLanc">
        <option value="recentes">Mais recentes</option><option value="antigos">Mais antigos</option>
        <option value="ativo">Ativo (A–Z)</option><option value="valor">Maior valor</option></select></div>
    </div>
    <div class="note">Toque num lançamento para corrigir ou excluir.</div>
    <div class="list" id="lancList"></div>
  </div>`;
  montado = true;
}

export function renderLancs() {
  const el = $('#tab-lancamentos');
  if (!montado) montar(el);
  const list = $('#lancList');
  if (!state.ready) { list.innerHTML = ''; return; }
  const f = filtro.trim().toUpperCase();
  const base = [...model.sorted];
  const ordem = state.ordemLanc;
  if (ordem === 'recentes') base.reverse();
  else if (ordem === 'ativo') base.sort((x, y) => x.a.localeCompare(y.a) || y.d.localeCompare(x.d));
  else if (ordem === 'valor') base.sort((x, y) => y.v - x.v);
  $<HTMLSelectElement>('#ordemLanc').value = ordem;
  const rows = base.filter(l => !f || l.a.includes(f));
  const shown = rows.slice(0, 300);
  list.innerHTML = shown.length ? shown.map(l => itemLanc(l)).join('')
    + (rows.length > 300 ? `<div class="empty">Mostrando ${300} de ${rows.length}. Use o filtro para achar os outros.</div>` : '')
    : `<div class="empty">${f ? 'Nada com esse filtro.' : 'Nenhum lançamento ainda.'}</div>`;
}

/** Linha de lançamento que abre a tela de edição. */
export function itemLanc(l: Lancamento, mostrarAtivo = true) {
  return `<button type="button" class="item" data-page="lanc:${esc(l.id)}">
    <div class="name">${mostrarAtivo ? esc(l.a) + ' ' : ''}<span class="tag" style="color:var(--${COR[l.t]})">${l.n && (l.t !== 'C' || l.moeda) ? esc(l.n) : TIPO[l.t]}</span></div>
    <div class="val">${l.t === 'S' ? (l.q > 0 ? '+' : '') + fmtQ(l.q) : brl.format(l.v)} ›</div>
    <div class="meta">${fmtD(l.d)}${l.t === 'C' || l.t === 'V' ? ' · ' + fmtQ(l.q) + ' × ' + brl.format(l.p) : ''}${l.o === 'b3' ? ' · B3' : ''}</div><div class="meta r"></div></button>`;
}
