// Peças reaproveitadas pelas telas: seletor de período, comparação com índices,
// gráficos de patrimônio e de rentabilidade, e o painel que abre ao tocar no gráfico.
import { hist, state, type Periodo } from '../app';
import { lerPonto, pontoMaisProximo, type Comparacao } from '../core/analise';
import { cdiAcumulado, type PontoMes } from '../core/perf';
import { addMonths, monthEnd } from '../core/util';
import { interactiveChart, type ISerie } from './ichart';
import { brl, esc, fmtD, fmtPct, fmtPctAxis, fmtYm, sign, tms } from './fmt';

export const pctOu = (x: number | null | undefined) => (x == null ? '—' : fmtPct(x));

type Preset = Periodo['tipo'];
const NOMES: Record<Preset, string> = {
  '12m': '12 meses', ano: 'No ano', anoPassado: 'Ano passado', tudo: 'Desde o início', y: '', custom: 'Personalizado',
};

/** Botões de período + campos "De/Até" quando personalizado. `chave` identifica a página. */
export function segPeriodo(chave: string, p: Periodo, presets: Preset[], first: string, cur: string, ini: string, fim: string, anos: number[] = []) {
  const btn = (label: string, attrs: string, on: boolean) =>
    `<button type="button" data-per-chave="${chave}" ${attrs} aria-pressed="${on}">${label}</button>`;
  const bs = presets.filter(x => x !== 'custom' && x !== 'y').map(x => btn(NOMES[x], `data-per="${x}"`, p.tipo === x));
  for (const y of anos) bs.push(btn(String(y), `data-per="y" data-ano="${y}"`, p.tipo === 'y' && p.ano === y));
  if (presets.includes('custom')) bs.push(btn('Personalizado', 'data-per="custom"', p.tipo === 'custom'));
  return `<div class="seg" role="group" aria-label="Período">${bs.join('')}</div>
    ${p.tipo === 'custom' ? `<div class="form">
      <div class="field"><label>De</label><input type="month" data-per-ini="${chave}" min="${first}" max="${cur}" value="${ini}"></div>
      <div class="field"><label>Até</label><input type="month" data-per-fim="${chave}" min="${first}" max="${cur}" value="${fim}"></div></div>` : ''}
    <div class="sub">${fmtYm(ini)} a ${fim === cur ? 'hoje' : fmtYm(fim)}</div>`;
}

export function anosDisponiveis(first: string, cur: string) {
  const out: number[] = [];
  for (let y = parseInt(cur.slice(0, 4), 10) - 1; y >= parseInt(first.slice(0, 4), 10); y--) out.push(y);
  return out;
}

/** Quatro números: carteira x CDI x Ibovespa x IPCA. */
export function statsComparacao(c: Comparacao | null, rotulo = 'Carteira') {
  if (!c) return '<div class="empty">Sem dados suficientes.</div>';
  return `<div class="stats four">
    <div><span class="label">${rotulo}</span><b class="lg ${sign(c.r.rent)}">${fmtPct(c.r.rent)}</b></div>
    <div><span class="label">CDI</span><b class="lg">${pctOu(c.cdi)}</b></div>
    <div><span class="label">Ibovespa</span><b class="lg">${pctOu(c.ibov)}</b></div>
    <div><span class="label">IPCA</span><b class="lg">${c.ipca ? fmtPct(c.ipca.acc) : '—'}</b></div>
  </div>`;
}

export const legendaComparacao = (rotulo = 'Carteira') => `<div class="legend">
  <span><i style="background:var(--accent)"></i>${rotulo}</span><span><i style="background:var(--b-cdi)"></i>CDI</span>
  <span><i style="background:var(--b-ibov)"></i>Ibovespa</span><span><i style="background:var(--b-ipca)"></i>IPCA</span></div>`;

/** HTML do painel ao tocar num ponto de uma série de patrimônio. */
export interface OpcoesPainel { extra?: (p: PontoMes) => string; /** mostrar só a partir deste mês (os cálculos usam a série inteira) */ desde?: string }

export function painelPonto(serie: PontoMes[], x: number, titulo: string, o: OpcoesPainel = {}) {
  const i = pontoMaisProximo(serie, x);
  const L = lerPonto(serie, i);
  const hoje = i === serie.length - 1 && serie[i].d.slice(0, 7) === new Date().toISOString().slice(0, 7);
  const ix = state.indices;
  const cdiDe = (meses: number) => {
    const d0 = monthEnd(addMonths(L.ym, -meses));
    return ix?.cdi?.length && ix.cdi[0][0] <= d0 ? cdiAcumulado(ix.cdi, d0, L.d) : null;
  };
  const rotulo12 = L.doze.meses >= 12 ? '12 meses' : `${L.doze.meses} ${L.doze.meses === 1 ? 'mês' : 'meses'}`;
  const bloco = (rot: string, g: number, pct: number, cdi: number | null) => `<div>
      <span class="label">${rot}</span><b class="${sign(g)}">${fmtPct(pct)}</b>
      <span class="mini ${sign(g)}">${brl.format(g)}</span>${cdi != null ? `<span class="mini">CDI ${fmtPct(cdi)}</span>` : ''}</div>`;
  return `<div class="sheet-title">${esc(titulo)} · ${fmtD(L.d)}${hoje ? ' (hoje)' : ' (fechamento do mês)'}</div>
    <div class="sheet-big">${brl.format(L.v)}</div>
    ${o.extra ? o.extra(serie[i]) : ''}
    <div class="sheet-linhas">
      <div><span>Total comprado</span><b>${brl.format(L.comprado)}</b></div>
      ${L.vendido ? `<div><span>Recebido em vendas</span><b>${brl.format(L.vendido)}</b></div>` : ''}
      ${L.proventos ? `<div><span>Proventos recebidos</span><b>${brl.format(L.proventos)}</b></div>` : ''}
      <div><span>Resultado total</span><b class="${sign(L.resultado)}">${brl.format(L.resultado)} (${fmtPct(L.pctTotal)})</b></div>
    </div>
    <div class="stats">
      ${bloco(rotulo12, L.doze.ganho, L.doze.pct, cdiDe(L.doze.meses))}
      ${bloco('No mês', L.mes.ganho, L.mes.pct, cdiDe(1))}
    </div>
    <details class="como"><summary>Como é calculado</summary>
      <p><b>Resultado total</b> = valor em ${fmtD(L.d)} + o que recebeu em vendas + proventos − tudo o que comprou. A % é esse resultado dividido pelo total comprado.</p>
      <p><b>${rotulo12} e no mês</b>: ganho = valor no fim − valor no início − compras + vendas + proventos do período, dividido pelo que estava aplicado (valor no início + compras do período).</p>
      <p>A linha tracejada do gráfico é o custo do que você ainda tem (preço médio × quantidade).</p>
    </details>`;
}

/** Gráfico de patrimônio x investido com painel ao tocar. */
export function graficoPatrimonio(el: HTMLElement, serie: PontoMes[], titulo: string, o: OpcoesPainel = {}) {
  if (!serie.length) { el.innerHTML = `<div class="empty">${state.histPronto ? 'Sem histórico ainda.' : 'Carregando histórico…'}</div>`; return; }
  const vis = o.desde ? serie.filter(p => p.ym >= o.desde!) : serie;
  const series: ISerie[] = [
    { pts: vis.map(p => ({ x: tms(p.d), y: p.custo })), color: 'var(--muted)', step: true, dash: true },
    { pts: vis.map(p => ({ x: tms(p.d), y: p.v })), color: 'var(--accent)', fill: true },
  ];
  interactiveChart(el, series, {
    label: titulo, xs: vis.map(p => tms(p.d)),
    inspect: x => painelPonto(serie, x, titulo, o),
  });
}

/** Rentabilidade acumulada no período comparada aos índices. */
export function graficoRent(el: HTMLElement, c: Comparacao, serie: PontoMes[], titulo: string) {
  const s: ISerie[] = [];
  if (c.curvas.ipca) s.push({ pts: c.curvas.ipca.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--b-ipca)', dash: true });
  if (c.curvas.cdi) s.push({ pts: c.curvas.cdi.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--b-cdi)', dash: true });
  if (c.curvas.ibov) s.push({ pts: c.curvas.ibov.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--b-ibov)', dash: true });
  s.push({ pts: c.r.indice.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--accent)' });
  const xs = c.r.indice.map(p => tms(p.d));
  interactiveChart(el, s, {
    label: titulo, fmtY: fmtPctAxis, zero: true, xs,
    inspect: x => {
      const i = xs.reduce((b, q, k) => (Math.abs(q - x) < Math.abs(xs[b] - x) ? k : b), 0);
      const pt = c.r.indice[i];
      const em = (arr: { d: string; acc: number }[] | null) => arr?.find(q => q.d === pt.d)?.acc;
      const sp = serie.find(q => q.ym === pt.ym);
      return `<div class="sheet-title">${esc(titulo)} · ${fmtD(pt.d)}</div>
        <div class="sub">Acumulado desde ${fmtD(c.r.indice[0].d)}</div>
        <div class="stats four">
          <div><span class="label">Carteira</span><b class="${sign(pt.acc)}">${fmtPct(pt.acc)}</b></div>
          <div><span class="label">CDI</span><b>${pctOu(em(c.curvas.cdi))}</b></div>
          <div><span class="label">Ibovespa</span><b>${pctOu(em(c.curvas.ibov))}</b></div>
          <div><span class="label">IPCA</span><b>${pctOu(em(c.curvas.ipca))}</b></div>
        </div>
        ${sp ? `<div class="sub">Patrimônio: ${brl.format(sp.v)} · no mês ${fmtPct(sp.r)}</div>` : ''}`;
    },
  });
}

export const priceAt = (a: string, c: Parameters<typeof hist.priceAt>[1], ym: string) => hist.priceAt(a, c, ym);
