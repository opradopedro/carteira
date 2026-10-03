import { model, state } from '../app';
import { CLASSES, type Cotacao, type Posicao } from '../core/types';
import { $, arrow, brl, esc, fmtD, fmtPct, fmtQ, fmtQuando, sign } from './fmt';

const FONTE: Record<Cotacao['fonte'], string> = {
  brapi: 'brapi', coingecko: 'CoinGecko', b3: 'fechamento B3', tesouro: 'Tesouro Direto', manual: 'preço manual', mb: 'Mercado Bitcoin',
};

function fonteTxt(px: Cotacao | null): string {
  if (!px) return 'Sem cotação: avaliado pelo custo.';
  if (px.fonte === 'manual') return `Preço informado por você em ${fmtQuando(px.em)}.`;
  const ref = px.ref ? (px.ref.length === 10 ? fmtD(px.ref) : px.ref.length === 7 ? px.ref : fmtQuando(px.ref)) : fmtQuando(px.em);
  return `Cotação: ${FONTE[px.fonte]} · ${ref}`;
}

export function renderAtivos() {
  const el = $('#tab-ativos');
  if (!state.ready) { el.innerHTML = ''; return; }
  const { open, list } = model;
  const closed = list.filter(p => p.q <= 0);
  const row = (p: Posicao) => {
    const pct = p.cost ? p.res / p.cost : 0, isOpen = state.open === p.a;
    let h = `<button type="button" class="item" data-open="${esc(p.a)}" aria-expanded="${isOpen}">
      <div class="name"><span class="dot" style="background:var(--c-${p.c})"></span>${esc(p.a)}${p.q > 0 && !p.px ? '<span class="tag" style="color:var(--warn)">sem cotação</span>' : ''}${p.px?.fonte === 'manual' ? '<span class="tag" style="color:var(--muted)">manual</span>' : ''}</div>
      <div class="val">${brl.format(p.value)}</div>
      <div class="meta">${p.q > 0 ? fmtQ(p.q) + ' × ' + brl.format(p.px ? p.px.p : p.pm) : p.q < 0 ? `Vendido em ${fmtQ(-p.q)} (veja Pendências)` : 'Posição encerrada'}</div>
      <div class="meta r ${p.q > 0 ? sign(p.res) : sign(p.real)}">${p.q > 0 ? arrow(p.res) + ' ' + fmtPct(pct) : brl.format(p.real)}</div></button>`;
    if (isOpen) h += `<div class="detail">
      <div class="kv">
        <div><span>Preço médio</span>${brl.format(p.pm)}</div><div><span>Custo</span>${brl.format(p.cost)}</div>
        <div><span>Resultado</span><b class="${sign(p.res)}">${brl.format(p.res)}</b></div><div><span>Proventos recebidos</span>${brl.format(p.prov)}</div>
        <div><span>Lucro em vendas</span>${brl.format(p.real)}</div><div><span>Proventos 12 meses</span>${brl.format(p.prov12)}</div>
      </div>
      ${p.q > 0 ? `<div class="note">${esc(fonteTxt(p.px))}</div>` : ''}
      <div class="form">
        <div class="field"><label for="cls">Classe</label><select id="cls" data-cls="${esc(p.a)}">${Object.entries(CLASSES).map(([k, v]) => `<option value="${k}" ${k === p.c ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${p.q > 0 ? `<div class="field"><label for="px">Preço manual (R$)</label><input id="px" inputmode="decimal" placeholder="opcional" value="${p.px?.fonte === 'manual' ? String(p.px.p).replace('.', ',') : ''}"></div>` : ''}
      </div>
      ${p.q > 0 ? `<div class="row"><button type="button" class="btn small" data-savepx="${esc(p.a)}">Salvar preço manual</button>
        ${p.px?.fonte === 'manual' ? `<button type="button" class="btn small" data-autopx="${esc(p.a)}">Voltar à cotação automática</button>` : ''}</div>` : ''}
    </div>`;
    return h;
  };
  el.innerHTML = `<div class="panel"><h2>Ativos em carteira</h2><div class="list">${open.length ? open.map(row).join('') : '<div class="empty">Nenhuma posição aberta.</div>'}</div></div>` +
    (closed.length ? `<div class="panel"><h2>Posições encerradas</h2><div class="list">${closed.map(row).join('')}</div></div>` : '');
}
