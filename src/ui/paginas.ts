// Páginas de detalhe abertas a partir dos cards e listas.
import { hist, listaPendencias, model, serie, serieDe, state } from '../app';
import { comparar, janela, lerPonto, periodRange, proventosPorMes, IBOV_PROXY } from '../core/analise';
import { cdiAcumulado, periodResult } from '../core/perf';
import { CLASSES, type Classe, type Cotacao, type Posicao } from '../core/types';
import { addMonths, monthEnd, today } from '../core/util';
import { barChart } from './charts';
import { $, MES, arrow, brl, esc, fmtD, fmtNum, fmtPct, fmtQ, fmtQuando, fmtYm, sign } from './fmt';
import type { Page } from './nav';
import { renderAjustes } from './ajustes';
import { renderPendencias } from './pendencias';
import { itemLanc } from './lancamentos';
import { chipsIndices, comparacao12m, porClasse } from './resumo';
import {
  anosDisponiveis, graficoPatrimonio, graficoRent, legendaComparacao, pctOu, segPeriodo, statsComparacao,
} from './widgets';

export function tituloPagina(p: Page): string {
  switch (p.k) {
    case 'resumo': return 'Resumo';
    case 'rent': return 'Rendimento';
    case 'evo': return 'Evolução';
    case 'pend': return 'Pendências';
    case 'ajustes': return 'Ajustes';
    case 'classe': return CLASSES[p.c];
    case 'ativo': return p.a;
    case 'prov': return p.a ? `Proventos · ${p.a}` : p.c ? `Proventos · ${CLASSES[p.c]}` : 'Proventos';
    case 'lanc': return 'Editar lançamento';
  }
}

export function renderPagina(el: HTMLElement, p: Page) {
  if (!state.ready) { el.innerHTML = ''; return; }
  switch (p.k) {
    case 'resumo': return paginaResumo(el);
    case 'rent': return paginaRent(el);
    case 'evo': return paginaEvo(el);
    case 'classe': return paginaClasse(el, p.c);
    case 'ativo': return paginaAtivo(el, p.a);
    case 'prov': return paginaProv(el, p.a, p.c);
    case 'pend': return renderPendencias(el);
    case 'ajustes': return void renderAjustes(el);
    case 'lanc': return paginaLanc(el, p.id);
  }
}

const vazio = (el: HTMLElement) => {
  el.innerHTML = `<div class="panel"><div class="empty">${state.histPronto ? 'Sem dados suficientes.' : 'Carregando histórico…'}</div></div>`;
};

/* ---------- Resumo detalhado ---------- */
function paginaResumo(el: HTMLElement) {
  const { tot } = model;
  const pct = tot.cost ? tot.res / tot.cost : 0;
  const cur = serie.at(-1)?.ym;
  const linha = (nome: string, ini: string | null) => {
    if (!cur || !ini) return '';
    const c = comparar(serie, ini < serie[0].ym ? serie[0].ym : ini, cur, state.indices, hist.priceAt);
    if (!c) return '';
    return `<tr><th>${nome}</th><td class="${sign(c.r.rent)}">${fmtPct(c.r.rent)}</td><td>${pctOu(c.cdi)}</td><td>${pctOu(c.ibov)}</td><td>${c.ipca ? fmtPct(c.ipca.acc) : '—'}</td></tr>`;
  };
  const c12 = comparacao12m();
  const cls = porClasse();
  el.innerHTML = `
  <div class="panel">
    <span class="label">Patrimônio</span>
    <div class="big">${brl.format(tot.value)}</div>
    <div class="delta ${sign(tot.res)}">${arrow(tot.res)} ${brl.format(Math.abs(tot.res))} (${fmtPct(pct)}) sobre o investido</div>
    <div class="stats adapt">
      <div><span class="label">Investido</span><b>${brl.format(tot.cost)}</b></div>
      <div><span class="label">Ganho em 12 meses</span><b class="${c12 ? sign(c12.r.ganho) : ''}">${c12 ? brl.format(c12.r.ganho) : '—'}</b></div>
      <div><span class="label">Rendimento 12m</span><b class="${c12 ? sign(c12.r.rent) : ''}">${c12 ? fmtPct(c12.r.rent) : '—'}</b></div>
      <div><span class="label">Lucro em vendas</span><b class="${sign(tot.realized)}">${brl.format(tot.realized)}</b></div>
      <div><span class="label">Proventos 12m</span><b>${brl.format(tot.prov12)}</b></div>
      <div><span class="label">Proventos (total)</span><b>${brl.format(tot.prov)}</b></div>
    </div>
    ${chipsIndices()}
  </div>
  <div class="panel">
    <h2>Comparação</h2>
    <div class="tabela"><table>
      <thead><tr><th></th><th>Carteira</th><th>CDI</th><th>Ibov.</th><th>IPCA</th></tr></thead>
      <tbody>
        ${cur ? linha('No mês', cur) : ''}
        ${cur ? linha('No ano', cur.slice(0, 4) + '-01') : ''}
        ${cur ? linha('12 meses', addMonths(cur, -11)) : ''}
        ${cur ? linha('24 meses', addMonths(cur, -23)) : ''}
        ${cur ? linha('Desde o início', serie[0].ym) : ''}
      </tbody></table></div>
    <div class="note">Rendimento = ganho no período (com proventos) ÷ total investido no período (valor no início + compras − vendas). Ibovespa medido pelo ETF ${IBOV_PROXY}.</div>
  </div>
  <div class="panel">
    <h2>Por classe</h2>
    <div class="list">${cls.map(([c, o]) => `<button type="button" class="item" data-page="classe:${c}">
      <div class="name"><span class="dot" style="background:var(--c-${c})"></span>${CLASSES[c]}</div><div class="val">${brl.format(o.v)} ›</div>
      <div class="meta">Investido ${brl.format(o.cost)}</div><div class="meta r ${sign(o.v - o.cost)}">${o.cost ? fmtPct(o.v / o.cost - 1) : ''}</div></button>`).join('')}</div>
  </div>`;
}

/* ---------- Rentabilidade ---------- */
function paginaRent(el: HTMLElement) {
  if (!serie.length) return vazio(el);
  const first = serie[0].ym, cur = serie.at(-1)!.ym;
  const per = state.per.rent;
  const [ini, fim] = periodRange(per, first, cur);
  const c = comparar(serie, ini, fim, state.indices, hist.priceAt);
  const meses = serie.filter(p => p.ym >= ini && p.ym <= fim).slice().reverse();
  const ix = state.indices;
  const sem = new Set(meses.flatMap(s => s.semPreco));
  el.innerHTML = `
  <div class="panel">
    ${segPeriodo('rent', per, ['12m', 'ano', 'tudo', 'y', 'custom'], first, cur, ini, fim, anosDisponiveis(first, cur))}
    ${statsComparacao(c)}
    ${c ? `<div class="stats adapt">
      <div><span class="label">Ganho no período</span><b class="${sign(c.r.ganho)}">${brl.format(c.r.ganho)}</b></div>
      <div><span class="label">Aportes líquidos</span><b>${brl.format(c.r.aportes)}</b></div>
      <div><span class="label">Proventos</span><b>${brl.format(c.r.prov)}</b></div>
    </div>
    <div class="chart" id="chRentP"></div>${legendaComparacao()}
    <div class="note">Patrimônio de ${brl.format(c.r.vIni)} (fim de ${fmtYm(addMonths(c.r.ini, -1))}) para ${brl.format(c.r.vFim)} (${c.r.fim === cur ? 'hoje' : 'fim de ' + fmtYm(c.r.fim)}).
    ${c.ipca && c.ipca.ultimo < c.r.fim ? ` IPCA disponível até ${fmtYm(c.ipca.ultimo)}.` : ''}
    ${sem.size ? ` Sem cotação histórica, avaliados pelo custo: ${esc([...sem].slice(0, 8).join(', '))}.` : ''}</div>` : ''}
  </div>
  <div class="panel">
    <h2>Mês a mês</h2>
    <div class="tabela"><table>
      <thead><tr><th>Mês</th><th>Carteira</th><th>CDI</th><th>Ibov.</th><th>Patrimônio</th></tr></thead>
      <tbody>${meses.map(p => {
        const dAnt = monthEnd(addMonths(p.ym, -1));
        const cdi = ix?.cdi?.length && ix.cdi[0][0] <= dAnt ? cdiAcumulado(ix.cdi, dAnt, p.d) : null;
        const b0 = hist.priceAt(IBOV_PROXY, 'outro', addMonths(p.ym, -1)), b1 = hist.priceAt(IBOV_PROXY, 'outro', p.ym);
        return `<tr><th>${MES[parseInt(p.ym.slice(5, 7), 10) - 1]}/${p.ym.slice(2, 4)}</th><td class="${sign(p.r)}">${fmtPct(p.r)}</td><td>${pctOu(cdi)}</td><td>${b0 && b1 ? fmtPct(b1 / b0 - 1) : '—'}</td><td>${brl.format(p.v)}</td></tr>`;
      }).join('')}</tbody></table></div>
  </div>`;
  if (c) graficoRent($('#chRentP'), c, serie, 'Rendimento');
}

/* ---------- Evolução ---------- */
function paginaEvo(el: HTMLElement) {
  if (!serie.length) return vazio(el);
  const first = serie[0].ym, cur = serie.at(-1)!.ym;
  const per = state.per.evo;
  const [ini, fim] = periodRange(per, first, cur);
  const recorte = serie.filter(p => p.ym >= addMonths(ini, -1) && p.ym <= fim);
  const r = periodResult(serie, ini, fim);
  const jan = r ? janela(serie, serie.findIndex(p => p.ym >= r.ini), serie.findIndex(p => p.ym === r.fim)) : null;
  el.innerHTML = `
  <div class="panel">
    ${segPeriodo('evo', per, ['12m', 'ano', 'tudo', 'y', 'custom'], first, cur, ini, fim, anosDisponiveis(first, cur))}
    <div class="chart" id="chEvoP"></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Patrimônio</span><span><i style="background:var(--muted)"></i>Valor investido</span></div>
    <div class="note">Toque ou arraste no gráfico para ver cada mês; use dois dedos para dar zoom.</div>
  </div>
  ${r ? `<div class="panel"><div class="stats adapt">
    <div><span class="label">Início</span><b>${brl.format(r.vIni)}</b></div>
    <div><span class="label">Fim</span><b>${brl.format(r.vFim)}</b></div>
    <div><span class="label">Aportes líquidos</span><b>${brl.format(r.aportes)}</b></div>
    <div><span class="label">Proventos</span><b>${brl.format(r.prov)}</b></div>
    <div><span class="label">Ganho</span><b class="${sign(r.ganho)}">${brl.format(r.ganho)}</b></div>
    <div><span class="label">Rendimento</span><b class="${sign(jan!.pct)}">${fmtPct(jan!.pct)}</b></div>
  </div></div>` : ''}`;
  graficoPatrimonio($('#chEvoP'), serie, 'Patrimônio', { desde: recorte.length ? recorte[0].ym : undefined });
}

/* ---------- Classe ---------- */
function paginaClasse(el: HTMLElement, c: Classe) {
  const ativos = model.open.filter(p => p.c === c);
  const encerrados = model.list.filter(p => p.c === c && p.q <= 0);
  const v = ativos.reduce((s, p) => s + p.value, 0), cost = ativos.reduce((s, p) => s + p.cost, 0);
  const s = serieDe('classe:' + c, l => l.c === c, v);
  const cur = s.at(-1)?.ym;
  const per = state.per.classe;
  const [ini, fim] = cur ? periodRange(per, s[0].ym, cur) : ['', ''];
  const comp = cur ? comparar(s, ini, fim, state.indices, hist.priceAt) : null;
  const prov12 = model.list.filter(p => p.c === c).reduce((x, p) => x + p.prov12, 0);
  el.innerHTML = `
  <div class="panel">
    <span class="label"><span class="dot" style="background:var(--c-${c})"></span> ${CLASSES[c]}</span>
    <div class="big">${brl.format(v)}</div>
    <div class="delta ${sign(v - cost)}">${arrow(v - cost)} ${brl.format(Math.abs(v - cost))} (${cost ? fmtPct(v / cost - 1) : '—'}) sobre o investido</div>
    <div class="stats adapt">
      <div><span class="label">% da carteira</span><b>${model.tot.value ? fmtNum(v / model.tot.value * 100) : '0'}%</b></div>
      <div><span class="label">Investido</span><b>${brl.format(cost)}</b></div>
      <div><span class="label">Proventos 12m</span><b>${brl.format(prov12)}</b></div>
    </div>
  </div>
  ${cur ? `<div class="panel">
    <h2>Rendimento</h2>
    ${segPeriodo('classe', per, ['12m', 'ano', 'tudo', 'y', 'custom'], s[0].ym, cur, ini, fim, anosDisponiveis(s[0].ym, cur))}
    ${statsComparacao(comp, CLASSES[c])}
    <div class="chart" id="chClsR"></div>${legendaComparacao(CLASSES[c])}
  </div>
  <div class="panel"><h2>Evolução</h2><div class="chart" id="chClsE"></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Valor</span><span><i style="background:var(--muted)"></i>Investido</span></div></div>` : ''}
  <div class="panel"><h2>Ativos</h2><div class="list">${ativos.map(itemAtivo).join('') || '<div class="empty">Nenhuma posição aberta.</div>'}</div></div>
  ${encerrados.length ? `<div class="panel"><h2>Encerrados</h2><div class="list">${encerrados.map(itemAtivo).join('')}</div></div>` : ''}
  <div class="row"><button type="button" class="btn" data-page="prov:c:${c}">Ver proventos de ${CLASSES[c]} ›</button></div>`;
  if (comp) graficoRent($('#chClsR'), comp, s, CLASSES[c]);
  if (cur) graficoPatrimonio($('#chClsE'), s, CLASSES[c]);
}

export function itemAtivo(p: Posicao) {
  const pct = p.cost ? p.res / p.cost : 0;
  return `<button type="button" class="item" data-page="ativo:${esc(p.a)}">
    <div class="name"><span class="dot" style="background:var(--c-${p.c})"></span>${esc(p.a)}${p.q > 0 && !p.px ? '<span class="tag" style="color:var(--warn)">sem cotação</span>' : ''}${p.px?.fonte === 'manual' ? '<span class="tag" style="color:var(--muted)">manual</span>' : ''}</div>
    <div class="val">${brl.format(p.value)} ›</div>
    <div class="meta">${p.q > 0 ? fmtQ(p.q) + ' × ' + brl.format(p.px ? p.px.p : p.pm) : p.q < 0 ? `Vendido em ${fmtQ(-p.q)} (veja Pendências)` : 'Posição encerrada'}</div>
    <div class="meta r ${p.q > 0 ? sign(p.res) : sign(p.real)}">${p.q > 0 ? arrow(p.res) + ' ' + fmtPct(pct) : 'Lucro ' + brl.format(p.real)}</div></button>`;
}

/* ---------- Ativo ---------- */
const FONTE: Record<Cotacao['fonte'], string> = {
  brapi: 'brapi', coingecko: 'CoinGecko', b3: 'fechamento B3', tesouro: 'Tesouro Direto', manual: 'preço manual', mb: 'Mercado Bitcoin',
};
function fonteTxt(px: Cotacao | null): string {
  if (!px) return 'Sem cotação: avaliado pelo custo.';
  if (px.fonte === 'manual') return `Preço informado por você em ${fmtQuando(px.em)}.`;
  const ref = px.ref ? (px.ref.length === 10 ? fmtD(px.ref) : px.ref.length === 7 ? px.ref : fmtQuando(px.ref)) : fmtQuando(px.em);
  return `Cotação: ${FONTE[px.fonte]} · ${ref}`;
}

function paginaAtivo(el: HTMLElement, a: string) {
  const p = model.list.find(x => x.a === a);
  if (!p) { el.innerHTML = '<div class="panel"><div class="empty">Ativo não encontrado.</div></div>'; return; }
  const s = serieDe('ativo:' + a, l => l.a === a, p.q > 0 ? p.value : 0);
  const lancs = model.sorted.filter(l => l.a === a).slice().reverse();
  const tudo = s.length ? lerPonto(s, s.length - 1) : null;
  const cur = s.at(-1)?.ym;
  const per = state.per.ativo;
  const [ini, fim] = cur ? periodRange(per, s[0].ym, cur) : ['', ''];
  const iIni = s.findIndex(q => q.ym >= ini), iFim = s.findLastIndex(q => q.ym <= fim);
  const jan = cur && iIni >= 0 && iFim >= iIni ? janela(s, iIni, iFim) : null;
  const ix = state.indices;
  const dIni = monthEnd(addMonths(ini, -1)), dFim = iFim >= 0 ? s[iFim].d : '';
  const cdiPer = jan && ix?.cdi?.length && ix.cdi[0][0] <= dIni ? cdiAcumulado(ix.cdi, dIni, dFim) : null;
  const pct = p.cost ? p.res / p.cost : 0;
  const ed = state.editando === a;
  const dis = ed ? '' : 'disabled';
  el.innerHTML = `
  <div class="panel">
    <span class="label"><span class="dot" style="background:var(--c-${p.c})"></span> ${CLASSES[p.c]}</span>
    <div class="big">${brl.format(p.value)}</div>
    ${p.q > 0 ? `<div class="delta ${sign(p.res)}">${arrow(p.res)} ${brl.format(Math.abs(p.res))} (${fmtPct(pct)}) sobre o custo atual</div>` : `<div class="sub">${p.q < 0 ? 'Posição vendida (veja Pendências)' : 'Posição encerrada'}</div>`}
    ${tudo ? `<div class="destaque">
      <span class="label">Rendimento total${tudo.inicio !== s[0].ym ? ` (posição desde ${fmtYm(tudo.inicio)})` : ''}</span>
      <div class="row between"><b class="${sign(tudo.resultado)}">${brl.format(tudo.resultado)}</b><b class="${sign(tudo.resultado)}">${fmtPct(tudo.pctTotal)}</b></div>
      <div class="sub">Total investido ${brl.format(tudo.investido)}${tudo.proventos ? ` · proventos ${brl.format(tudo.proventos)}` : ''}</div>
    </div>` : ''}
    <div class="stats adapt">
      <div><span class="label">Quantidade</span><b>${fmtQ(p.q)}</b></div>
      <div><span class="label">Preço atual</span><b>${p.px ? brl.format(p.px.p) : '—'}</b></div>
      <div><span class="label">Preço médio</span><b>${brl.format(p.pm)}</b></div>
      <div><span class="label">Custo atual</span><b>${brl.format(p.cost)}</b></div>
      <div><span class="label">Lucro em vendas</span><b class="${sign(p.real)}">${brl.format(p.real)}</b></div>
      <div><span class="label">Proventos</span><b>${brl.format(p.prov)}</b></div>
    </div>
    ${p.q > 0 ? `<div class="note">${esc(fonteTxt(p.px))}</div>` : ''}
  </div>
  ${cur ? `<div class="panel">
    <h2>Desempenho</h2>
    ${segPeriodo('ativo', per, ['12m', 'ano', 'tudo', 'y', 'custom'], s[0].ym, cur, ini, fim, anosDisponiveis(s[0].ym, cur))}
    ${jan ? `<div class="stats">
      <div><span class="label">Ganho no período</span><b class="${sign(jan.ganho)}">${brl.format(jan.ganho)}</b></div>
      <div><span class="label">Rendimento</span><b class="lg ${sign(jan.ganho)}">${fmtPct(jan.pct)}</b></div>
      <div><span class="label">CDI</span><b class="lg">${pctOu(cdiPer)}</b></div>
    </div>` : ''}
    <div class="chart" id="chAtivo"></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Valor da posição</span><span><i style="background:var(--muted)"></i>Investido (custo do que você tem)</span></div>
    <details class="como"><summary>Como é calculado</summary>
      <p><b>Total investido</b> = compras − vendas da posição atual. Se você vendeu tudo e comprou de novo, conta só a partir da nova compra.</p><p><b>Rendimento total</b> = valor de hoje + proventos − total investido. A % é sobre o total investido.</p>
      <p><b>Ganho no período</b> = valor no fim − valor no início − compras + vendas + proventos do período. A % é sobre o que estava aplicado: valor no início + compras do período.</p>
      <p>Toque ou arraste no gráfico para ver esses números em cada mês. Ao rolar a página por cima do gráfico, nada abre.</p>
    </details>
  </div>` : ''}
  <div class="panel">
    <div class="row between"><h2>Ajustes do ativo</h2>
      ${ed ? '' : `<button type="button" class="btn small" data-editar="${esc(a)}">Editar</button>`}</div>
    <div class="form ${ed ? '' : 'travado'}">
      <div class="field"><label for="cls">Classe</label><select id="cls" data-cls="${esc(a)}" ${dis}>${Object.entries(CLASSES).map(([k, v]) => `<option value="${k}" ${k === p.c ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      ${p.q > 0 ? `<div class="field"><label for="px">Preço manual (R$)</label><input id="px" inputmode="decimal" placeholder="opcional" ${dis} value="${p.px?.fonte === 'manual' ? String(p.px.p).replace('.', ',') : ''}"></div>` : ''}
    </div>
    ${ed ? `<div class="row">
      ${p.q > 0 ? `<button type="button" class="btn primary small" data-savepx="${esc(a)}">Salvar preço manual</button>` : ''}
      ${p.px?.fonte === 'manual' ? `<button type="button" class="btn small" data-autopx="${esc(a)}">Voltar à cotação automática</button>` : ''}
      <button type="button" class="btn small" data-editar="">Concluir</button></div>` : '<div class="note">Toque em Editar para mudar a classe ou informar um preço.</div>'}
  </div>
  ${p.prov > 0 ? `<div class="row"><button type="button" class="btn" data-page="prov:a:${esc(a)}">Ver proventos de ${esc(a)} ›</button></div>` : ''}
  <div class="panel"><h2>Lançamentos</h2><div class="note">Toque num lançamento para corrigir ou excluir.</div><div class="list">${lancs.slice(0, 60).map(l => itemLanc(l, false)).join('')}
    ${lancs.length > 60 ? `<div class="empty">Mostrando os 60 mais recentes de ${lancs.length}.</div>` : ''}</div></div>`;
  if (cur) graficoPatrimonio($('#chAtivo'), s, a, {
    desde: per.tipo === 'tudo' ? undefined : addMonths(ini, -1),
    extra: q => {
      const px = hist.priceAt(a, p.c, q.ym);
      return px ? `<div class="sub">Preço no fim do mês: ${brl.format(px)}</div>` : '';
    },
  });
}

/* ---------- Proventos (geral, por ativo ou por classe) ---------- */
function paginaProv(el: HTMLElement, a?: string, c?: Classe) {
  const lancs = state.lancs.filter(l => l.t === 'P' && (a ? l.a === a : c ? l.c === c : true));
  const cur = today().slice(0, 7);
  const first = lancs.reduce((m, l) => (l.d.slice(0, 7) < m ? l.d.slice(0, 7) : m), cur);
  const per = state.per.prov;
  const [ini, fim] = periodRange(per, first < addMonths(cur, -11) ? first : addMonths(cur, -11), cur);
  const r = proventosPorMes(lancs, ini, fim);
  const porAtivo = new Map<string, number>();
  for (const l of r.itens) porAtivo.set(l.a, (porAtivo.get(l.a) || 0) + l.v);
  const custo = a ? model.list.find(p => p.a === a)?.cost ?? 0 : c ? model.open.filter(p => p.c === c).reduce((s, p) => s + p.cost, 0) : model.tot.cost;
  el.innerHTML = `
  <div class="panel">
    ${segPeriodo('prov', per, ['12m', 'ano', 'anoPassado', 'tudo', 'custom'], first, cur, ini, fim)}
    <div class="big">${brl.format(r.total)}</div>
    <div class="sub">Média de ${brl.format(r.media)} por mês · ${r.itens.length} pagamento${r.itens.length === 1 ? '' : 's'}${custo && per.tipo === '12m' ? ` · rende ${fmtNum(r.total / custo * 100)}% do investido` : ''}</div>
    <div class="chart" id="chProvP"></div>
  </div>
  ${!a && porAtivo.size ? `<div class="panel"><h2>Por ativo no período</h2><div class="list">${[...porAtivo.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `<button type="button" class="item" data-page="prov:a:${esc(k)}">
    <div class="name">${esc(k)}</div><div class="val">${brl.format(v)} ›</div><div class="meta">${r.total ? fmtNum(v / r.total * 100) : '0'}% do total</div><div class="meta r"></div></button>`).join('')}</div></div>` : ''}
  <div class="panel"><h2>Pagamentos</h2><div class="list">${r.itens.slice(0, 120).map(l => `<div class="item">
    <div class="name">${esc(l.a)}</div><div class="val">${brl.format(l.v)}</div>
    <div class="meta">${esc(l.n || 'Provento')}</div><div class="meta r">${fmtD(l.d)}</div></div>`).join('') || '<div class="empty">Nenhum provento no período.</div>'}</div></div>`;
  barChart($('#chProvP'), r.meses.map(m => ({ label: MES[parseInt(m.ym.slice(5, 7), 10) - 1] + (r.meses.length > 12 ? '/' + m.ym.slice(2, 4) : ''), v: m.v })));
}

export { listaPendencias, fmtYm };

/* ---------- Editar lançamento ---------- */
function paginaLanc(el: HTMLElement, id: string) {
  const l = state.lancs.find(x => x.id === id);
  if (!l) { el.innerHTML = '<div class="panel"><div class="empty">Lançamento não encontrado (talvez já tenha sido excluído).</div></div>'; return; }
  const num = (x: number) => (x ? String(x).replace('.', ',') : '');
  const ehP = l.t === 'P', ehS = l.t === 'S';
  el.innerHTML = `
  <div class="panel">
    <div class="sub">${l.o === 'b3' ? 'Lançamento importado da B3. Se você corrigir aqui e importar a planilha de novo, a correção é mantida e nada duplica.' : 'Lançamento feito à mão.'}</div>
    <form id="formEdit" data-id="${esc(l.id)}" autocomplete="off">
      <div class="field"><label for="eTipo">Tipo</label>
        <select id="eTipo">${ehS ? '<option value="S" selected>Ajuste (desdobro, bonificação…)</option>' : ''}
          <option value="C" ${l.t === 'C' ? 'selected' : ''}>Compra</option><option value="V" ${l.t === 'V' ? 'selected' : ''}>Venda</option><option value="P" ${ehP ? 'selected' : ''}>Provento recebido</option></select></div>
      <div class="field"><label for="eData">Data</label><input type="date" id="eData" value="${l.d}" max="${today()}" required></div>
      <div class="field"><label for="eAtivo">Ativo</label><input id="eAtivo" value="${esc(l.a)}" autocapitalize="characters" spellcheck="false" required></div>
      <div class="field"><label for="eClasse">Classe</label>
        <select id="eClasse">${Object.entries(CLASSES).map(([k, v]) => `<option value="${k}" ${k === l.c ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" id="ewQtd" ${ehP ? 'hidden' : ''}><label for="eQtd">Quantidade</label><input id="eQtd" inputmode="decimal" value="${num(l.q)}"></div>
      <div class="field" id="ewPreco" ${ehP || ehS ? 'hidden' : ''}><label for="ePreco">Preço unitário (R$)</label><input id="ePreco" inputmode="decimal" value="${num(l.p)}"></div>
      <div class="field full" id="ewValor" ${ehP || ehS ? '' : 'hidden'}><label for="eValor">${ehS ? 'Custo acrescentado (R$)' : 'Valor recebido (R$)'}</label><input id="eValor" inputmode="decimal" value="${num(l.v)}"></div>
      <div class="note full" id="eTotal"></div>
      <div class="row full">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn" type="button" id="btnBack2">Cancelar</button>
      </div>
      <div class="err full" id="eErr" hidden></div>
    </form>
  </div>
  <div class="panel">
    <h2>Excluir</h2>
    <div class="sub">Remove este lançamento da carteira. Se ele veio da B3 e você importar a planilha de novo, ele volta.</div>
    <div class="row"><button type="button" class="btn danger" data-del-lanc="${esc(l.id)}">Excluir lançamento</button></div>
  </div>`;
}
