import { model, state } from '../app';
import { CLASSES, type Classe } from '../core/types';
import { today, ymd } from '../core/util';
import { barChart } from './charts';
import { $, MES, brl, esc, fmtD, fmtNum, fmtQuando } from './fmt';

export function renderProventos() {
  const el = $('#tab-proventos');
  if (!state.ready) { el.innerHTML = ''; return; }
  const { tot, list, sorted } = model;
  const now = new Date(), bars: { k: string; label: string; v: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    bars.push({ k: ymd(d).slice(0, 7), label: MES[d.getMonth()], v: 0 });
  }
  for (const l of sorted) if (l.t === 'P') { const b = bars.find(b => b.k === l.d.slice(0, 7)); if (b) b.v += l.v; }
  const payers = list.filter(p => p.prov > 0).sort((a, b) => b.prov12 - a.prov12 || b.prov - a.prov);
  const porClasse = new Map<Classe, { v12: number; v: number }>();
  for (const p of payers) {
    const o = porClasse.get(p.c) || { v12: 0, v: 0 };
    o.v12 += p.prov12; o.v += p.prov; porClasse.set(p.c, o);
  }
  el.innerHTML = `
  <div class="panel clickable" data-page="prov" tabindex="0">
    <div class="row between"><span class="label">Recebido nos últimos 12 meses</span><span class="mais">Ver detalhes ›</span></div>
    <div class="big">${brl.format(tot.prov12)}</div>
    <div class="sub">${brl.format(tot.prov)} desde o início · média de ${brl.format(tot.prov12 / 12)} por mês</div>
    <div class="chart" id="chProv"></div>
  </div>
  ${aReceber()}
  ${porClasse.size ? `<div class="panel"><h2>Por categoria</h2><div class="list">${[...porClasse.entries()].sort((a, b) => b[1].v12 - a[1].v12).map(([c, o]) => `<button type="button" class="item" data-page="prov:c:${c}">
    <div class="name"><span class="dot" style="background:var(--c-${c})"></span>${CLASSES[c]}</div><div class="val">${brl.format(o.v12)} ›</div>
    <div class="meta">em 12 meses</div><div class="meta r">${brl.format(o.v)} no total</div></button>`).join('')}</div></div>` : ''}
  <div class="panel"><h2>Por ativo</h2><div class="list">${payers.length ? payers.map(p => `<button type="button" class="item" data-page="prov:a:${esc(p.a)}">
    <div class="name"><span class="dot" style="background:var(--c-${p.c})"></span>${esc(p.a)}</div><div class="val">${brl.format(p.prov)} ›</div>
    <div class="meta">${brl.format(p.prov12)} em 12 meses</div><div class="meta r">${p.cost && p.prov12 ? 'rende ' + fmtNum(p.prov12 / p.cost * 100) + '% do custo' : ''}</div></button>`).join('') : '<div class="empty">Nenhum provento lançado ainda.</div>'}</div></div>`;
  barChart($('#chProv'), bars);
}

function aReceber(): string {
  const ar = state.aReceber;
  const hoje = today();
  const itens = (ar?.itens || []).filter(e => e.d >= hoje).sort((a, b) => a.d.localeCompare(b.d));
  if (!itens.length) {
    return `<div class="panel"><h2>A receber</h2><div class="empty">${ar ? 'Nada anunciado para os próximos dias.' : 'Importe a planilha de <b>Eventos</b> da B3 em Lançamentos para ver os proventos já anunciados.'}</div></div>`;
  }
  const total = itens.reduce((s, e) => s + e.v, 0);
  return `<div class="panel">
    <div class="hero"><span class="label">A receber (já anunciados)</span><div class="big" style="font-size:clamp(24px,7vw,32px)">${brl.format(total)}</div>
    <div class="sub">Segundo a planilha de Eventos importada em ${fmtQuando(ar!.em)}.</div></div>
    <div class="list">${itens.map(e => `<div class="item">
      <div class="name">${esc(e.a)}</div><div class="val">${brl.format(e.v)}</div>
      <div class="meta">${esc(e.tipo)}</div><div class="meta r">${fmtD(e.d)}</div></div>`).join('')}</div></div>`;
}
