import { hist, listaPendencias, model, serie, state } from '../app';
import { comparar } from '../core/analise';
import { ipcaAcumulado } from '../core/perf';
import { CLASSES, type Classe } from '../core/types';
import { addMonths } from '../core/util';
import { $, arrow, brl, esc, fmtNum, fmtPct, fmtYm, sign } from './fmt';
import { graficoPatrimonio, graficoRent, legendaComparacao, pctOu } from './widgets';

/** Comparação dos últimos 12 meses (usada no card Resumo e na página de detalhe). */
export function comparacao12m() {
  if (!serie.length) return null;
  const cur = serie.at(-1)!.ym;
  const ini = addMonths(cur, -11) < serie[0].ym ? serie[0].ym : addMonths(cur, -11);
  return comparar(serie, ini, cur, state.indices, hist.priceAt);
}

export function chipsIndices(): string {
  const ix = state.indices;
  if (!ix) return '';
  const chips: string[] = [];
  if (ix.ipca?.length) {
    const ult = ix.ipca.at(-1)![0].slice(0, 7);
    const r = ipcaAcumulado(ix.ipca, addMonths(ult, -11), ult);
    chips.push(`IPCA 12 meses ${fmtNum(r.acc * 100)}% (até ${fmtYm(ult)})`);
  }
  if (ix.selic != null) chips.push('Selic ' + fmtNum(ix.selic) + '% a.a.');
  return chips.length ? '<div class="chips">' + chips.map(c => `<span class="chip">${esc(c)}</span>`).join('') + '</div>' : '';
}

export function porClasse() {
  const byC: Partial<Record<Classe, { v: number; cost: number }>> = {};
  for (const p of model.open) {
    const o = byC[p.c] || (byC[p.c] = { v: 0, cost: 0 });
    o.v += p.value; o.cost += p.cost;
  }
  return (Object.entries(byC) as [Classe, { v: number; cost: number }][]).sort((a, b) => b[1].v - a[1].v);
}

export function renderResumo() {
  const el = $('#tab-resumo');
  const { tot } = model;
  if (!state.ready) { el.innerHTML = '<div class="panel"><div class="empty">Abrindo seus dados…</div></div>'; return; }
  if (!state.lancs.length) {
    el.innerHTML = `<div class="panel"><h2>Sua carteira está vazia</h2>
      <div class="empty">Vá em <b>Lançamentos</b> para importar as planilhas da B3 ou lançar a primeira compra.</div>
      <div class="row"><button class="btn primary" type="button" data-tab="lancamentos">Ir para Lançamentos</button></div></div>`;
    return;
  }
  const pct = tot.cost ? tot.res / tot.cost : 0;
  const cls = porClasse();
  const c12 = comparacao12m();
  const nPend = listaPendencias().length;
  const mais = '<span class="mais">Ver detalhes ›</span>';

  el.innerHTML = `
  ${nPend ? `<button type="button" class="pend-card" data-page="pend"><span>${nPend === 1 ? '1 pendência precisa' : nPend + ' pendências precisam'} de você</span><span>Ver ›</span></button>` : ''}
  <div class="panel clickable" data-page="resumo" tabindex="0">
    <div class="row between"><span class="label">Resumo</span>${mais}</div>
    <div class="hero">
      <div class="big">${brl.format(tot.value)}</div>
      <div class="delta ${sign(tot.res)}">${arrow(tot.res)} ${brl.format(Math.abs(tot.res))} (${fmtPct(pct)}) sobre o investido</div>
    </div>
    ${c12 ? `<div class="destaque">
      <span class="label">Rendimento em 12 meses</span>
      <div class="row between"><b class="${sign(c12.r.ganho)}">${brl.format(c12.r.ganho)}</b><b class="${sign(c12.r.rent)}">${fmtPct(c12.r.rent)}</b></div>
      <div class="stats">
        <div><span class="label">CDI</span><b>${pctOu(c12.cdi)}</b></div>
        <div><span class="label">Ibovespa</span><b>${pctOu(c12.ibov)}</b></div>
        <div><span class="label">vs CDI</span><b class="${c12.cdi != null ? sign(c12.r.rent - c12.cdi) : ''}">${c12.cdi != null ? (c12.r.rent - c12.cdi >= 0 ? '+' : '') + fmtNum((c12.r.rent - c12.cdi) * 100) + ' p.p.' : '—'}</b></div>
      </div></div>` : `<div class="sub">${state.histPronto ? '' : 'Carregando histórico…'}</div>`}
    <div class="stats adapt">
      <div><span class="label">Investido</span><b>${brl.format(tot.cost)}</b></div>
      <div><span class="label">Proventos 12m</span><b>${brl.format(tot.prov12)}</b></div>
      <div><span class="label">Lucro em vendas</span><b class="${sign(tot.realized)}">${brl.format(tot.realized)}</b></div>
    </div>
    ${chipsIndices()}
  </div>
  <div class="panel clickable" data-page="rent" tabindex="0">
    <div class="row between"><h2>Rendimento em 12 meses</h2>${mais}</div>
    ${c12 ? `<div class="chart" id="chRent"></div>${legendaComparacao()}` : '<div class="empty">Sem dados suficientes.</div>'}
  </div>
  <div class="panel clickable" data-page="evo" tabindex="0">
    <div class="row between"><h2>Evolução do patrimônio</h2>${mais}</div>
    <div class="chart" id="chEvo"></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Patrimônio</span><span><i style="background:var(--muted)"></i>Valor investido</span></div>
  </div>
  <div class="panel">
    <h2>Distribuição</h2>
    <div class="alloc">${cls.map(([c, o]) => `<span style="background:var(--c-${c});flex:${Math.max(o.v, 0.0001)}"></span>`).join('')}</div>
    <div class="list">${cls.map(([c, o]) => `<button type="button" class="item" data-page="classe:${c}">
      <div class="name"><span class="dot" style="background:var(--c-${c})"></span>${CLASSES[c] || c}</div><div class="val">${brl.format(o.v)} ›</div>
      <div class="meta ${sign(o.v - o.cost)}">${o.cost ? fmtPct(o.v / o.cost - 1) + ' sobre o investido' : ''}</div><div class="meta r">${tot.value ? fmtNum(o.v / tot.value * 100) : '0'}%</div></button>`).join('')}</div>
  </div>`;
  if (c12) graficoRent($('#chRent'), c12, serie, 'Rendimento');
  graficoPatrimonio($('#chEvo'), serie, 'Patrimônio');
}
