import { model, state } from '../app';
import { CLASSES, type Classe } from '../core/types';
import { $, brl } from './fmt';
import { itemAtivo } from './paginas';

export function renderAtivos() {
  const el = $('#tab-ativos');
  if (!state.ready) { el.innerHTML = ''; return; }
  const { open, list } = model;
  const closed = list.filter(p => p.q <= 0);
  const grupos = (Object.keys(CLASSES) as Classe[])
    .map(c => ({ c, itens: open.filter(p => p.c === c) }))
    .filter(g => g.itens.length);
  el.innerHTML = (grupos.length ? grupos.map(g => `<div class="panel">
      <button type="button" class="row between linkish" data-page="classe:${g.c}">
        <h2><span class="dot" style="background:var(--c-${g.c})"></span> ${CLASSES[g.c]}</h2>
        <span class="mais">${brl.format(g.itens.reduce((s, p) => s + p.value, 0))} ›</span></button>
      <div class="list">${g.itens.map(itemAtivo).join('')}</div></div>`).join('')
    : '<div class="panel"><div class="empty">Nenhuma posição aberta.</div></div>') +
    (closed.length ? `<div class="panel"><h2>Posições encerradas</h2><div class="list">${closed.map(itemAtivo).join('')}</div></div>` : '');
}
