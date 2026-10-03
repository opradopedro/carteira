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
export interface OpcoesPainel { extra?: (p: PontoMes) => string; inicio?: string }

export function painelPonto(serie: PontoMes[], x: number, titulo: string, o: OpcoesPainel = {}) {
  const i = pontoMaisProximo(serie, x);
  const L = lerPonto(serie, i);
  const hoje = i === serie.length - 1 && serie[i].d.slice(0, 7) === new Date().toISOString().slice(0, 7);
  const ix = state.indices;
  let cdi = '';
  if (ix?.cdi?.length) {
    const d0 = monthEnd(addMonths(serie[0].ym, -1));
    const d12 = monthEnd(addMonths(L.ym, -L.meses12));
    const dm = monthEnd(addMonths(L.ym, -1));
    if (ix.cdi[0][0] <= d0) {
      cdi = `<div class="sheet-cdi">CDI no mesmo período: ${fmtPct(cdiAcumulado(ix.cdi, d0, L.d))} · ${fmtPct(cdiAcumulado(ix.cdi, d12, L.d))} · ${fmtPct(cdiAcumulado(ix.cdi, dm, L.d))}</div>`;
    }
  }
  return `<div class="sheet-title">${esc(titulo)} · ${fmtD(L.d)}${hoje ? ' (hoje)' : ' (fechamento do mês)'}</div>
    <div class="sheet-big">${brl.format(L.v)}</div>
    <div class="sub">Investido: ${brl.format(L.custo)}${L.custo ? ` · resultado ${brl.format(L.v - L.custo)}` : ''}</div>
    ${o.extra ? o.extra(serie[i]) : ''}
    <div class="stats">
      <div><span class="label">${o.inicio ?? 'Desde a compra'}</span><b class="${sign(L.desdeInicio)}">${fmtPct(L.desdeInicio)}</b></div>
      <div><span class="label">${L.meses12 >= 12 ? '12 meses' : `${L.meses12} ${L.meses12 === 1 ? 'mês' : 'meses'}`}</span><b class="${sign(L.r12)}">${fmtPct(L.r12)}</b></div>
      <div><span class="label">No mês</span><b class="${sign(L.rMes)}">${fmtPct(L.rMes)}</b></div>
    </div>${cdi}`;
}

/** Gráfico de patrimônio x investido com painel ao tocar. */
export function graficoPatrimonio(el: HTMLElement, serie: PontoMes[], titulo: string, o: OpcoesPainel = {}) {
  if (!serie.length) { el.innerHTML = `<div class="empty">${state.histPronto ? 'Sem histórico ainda.' : 'Carregando histórico…'}</div>`; return; }
  const series: ISerie[] = [
    { pts: serie.map(p => ({ x: tms(p.d), y: p.custo })), color: 'var(--muted)', step: true, dash: true },
    { pts: serie.map(p => ({ x: tms(p.d), y: p.v })), color: 'var(--accent)', fill: true },
  ];
  interactiveChart(el, series, {
    label: titulo, xs: serie.map(p => tms(p.d)),
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
