import { model, serieDe, state } from '../app';
import { lerPonto } from '../core/analise';
import { CLASSES, type Classe, type Posicao } from '../core/types';
import { $, arrow, brl, fmtPct, sign } from './fmt';
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
        <span class="cls-val"><span class="mais">${brl.format(g.itens.reduce((s, p) => s + p.value, 0))} ›</span>${rend12(g.c, g.itens)}</span></button>
      <div class="list">${g.itens.map(itemAtivo).join('')}</div></div>`).join('')
    : '<div class="panel"><div class="empty">Nenhuma posição aberta.</div></div>') +
    (closed.length ? `<div class="panel"><h2>Posições encerradas</h2><div class="list">${closed.map(itemAtivo).join('')}</div></div>` : '');
}

/** Rendimento da classe nos últimos 12 meses, sobre o dinheiro aplicado (o mesmo do gráfico da classe). */
function rend12(c: Classe, itens: Posicao[]) {
  const s = serieDe('classe:' + c, l => l.c === c, itens.reduce((x, p) => x + p.value, 0));
  if (!s.length) return '';
  const d = lerPonto(s, s.length - 1).doze;
  const quando = d.meses >= 12 ? '12m' : `${d.meses} ${d.meses === 1 ? 'mês' : 'meses'}`;
  return `<span class="cls-rend ${sign(d.pct)}">${arrow(d.pct)} ${fmtPct(d.pct)} <small>${quando}</small></span>`;
}
