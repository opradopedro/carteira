import { model, state } from '../app';
import type { TipoLanc } from '../core/types';
import { $, brl, esc, fmtD, fmtQ } from './fmt';

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
    </div>
    <div class="sub">Na Área do Investidor da B3, em <b>Extratos</b>, baixe em Excel o arquivo de <b>Negociação</b> (compras e vendas na bolsa) o de <b>Movimentação</b> (proventos, Tesouro Direto, desdobros e bonificações) e, se quiser, o de <b>Eventos</b> (proventos anunciados a receber). Pode selecionar todos de uma vez e importar de novo depois: o que já existe não duplica.</div>
    <div class="sub" id="importMsg" hidden></div>
  </div>
  <div class="panel" id="formPanel" hidden>
    <h2>Novo lançamento</h2>
    <form id="form" autocomplete="off">
      <div class="field"><label for="fTipo">Tipo</label>
        <select id="fTipo"><option value="C">Compra</option><option value="V">Venda</option><option value="P">Provento recebido</option></select></div>
      <div class="field"><label for="fData">Data</label><input type="date" id="fData" required></div>
      <div class="field"><label for="fAtivo">Ativo</label><input id="fAtivo" placeholder="PETR4, BTC, Tesouro IPCA+ 2029" autocapitalize="characters" required></div>
      <div class="field"><label for="fClasse">Classe</label>
        <select id="fClasse"><option value="acao">Ações</option><option value="fii">FIIs</option><option value="cripto">Cripto</option><option value="tesouro">Tesouro Direto</option><option value="outro">Outros</option></select></div>
      <div class="field" id="wQtd"><label for="fQtd">Quantidade</label><input id="fQtd" inputmode="decimal" placeholder="100 ou 0,0125"></div>
      <div class="field" id="wPreco"><label for="fPreco">Preço unitário (R$)</label><input id="fPreco" inputmode="decimal" placeholder="38,20"></div>
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
    <input id="filtro" type="search" placeholder="Filtrar por ativo" aria-label="Filtrar por ativo">
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
  const rows = [...model.sorted].reverse().filter(l => !f || l.a.includes(f));
  const shown = rows.slice(0, 300);
  list.innerHTML = shown.length ? shown.map(l => `<div class="item">
    <div class="name">${esc(l.a)} <span class="tag" style="color:var(--${COR[l.t]})">${l.n && l.t !== 'C' ? esc(l.n) : TIPO[l.t]}</span></div>
    <div class="val">${l.t === 'S' ? (l.q > 0 ? '+' : '') + fmtQ(l.q) : brl.format(l.v)}</div>
    <div class="meta">${fmtD(l.d)}${l.t === 'C' || l.t === 'V' ? ' · ' + fmtQ(l.q) + ' × ' + brl.format(l.p) : ''}${l.o === 'b3' ? ' · B3' : ''}</div>
    <div class="meta r"><button type="button" class="btn small danger" data-del="${esc(l.id)}">Excluir</button></div></div>`).join('')
    + (rows.length > 300 ? `<div class="empty">Mostrando os 300 mais recentes de ${rows.length}. Use o filtro para achar os outros.</div>` : '')
    : `<div class="empty">${f ? 'Nada com esse filtro.' : 'Nenhum lançamento ainda.'}</div>`;
}
