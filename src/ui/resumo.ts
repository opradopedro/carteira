import { model, serie, state, type Periodo } from '../app';
import { benchCurves, cdiAcumulado, ipcaAcumulado, periodResult } from '../core/perf';
import { CLASSES, type Classe } from '../core/types';
import { addMonths, today } from '../core/util';
import { lineChart, type Serie } from './charts';
import { $, arrow, brl, esc, fmtNum, fmtPct, fmtPctAxis, fmtYm, sign, tms } from './fmt';

export function periodRange(p: Periodo, first: string, cur: string): [string, string] {
  let ini = first, fim = cur;
  if (p.tipo === '12m') ini = addMonths(cur, -11);
  else if (p.tipo === 'ano') ini = cur.slice(0, 4) + '-01';
  else if (p.tipo === 'y' && p.ano) { ini = `${p.ano}-01`; fim = `${p.ano}-12` < cur ? `${p.ano}-12` : cur; }
  else if (p.tipo === 'custom') { ini = p.ini || first; fim = p.fim || cur; }
  if (ini < first) ini = first;
  if (fim > cur) fim = cur;
  if (fim < ini) fim = ini;
  return [ini, fim];
}

function chipsIndices(): string {
  const ix = state.indices;
  if (!ix) return '';
  const hoje = today(), cur = hoje.slice(0, 7);
  const chips: string[] = [];
  if (ix.cdi?.length) {
    const de = new Date(Date.parse(hoje) - 365 * 864e5).toISOString().slice(0, 10);
    chips.push('CDI 12 meses ' + fmtNum(cdiAcumulado(ix.cdi, de, hoje) * 100) + '%');
  }
  if (ix.ipca?.length) {
    const ult = ix.ipca.at(-1)![0].slice(0, 7);
    const r = ipcaAcumulado(ix.ipca, addMonths(ult, -11), ult);
    chips.push(`IPCA 12 meses ${fmtNum(r.acc * 100)}%` + (ult < addMonths(cur, -1) ? ` (até ${fmtYm(ult)})` : ''));
  }
  if (ix.selic != null) chips.push('Selic ' + fmtNum(ix.selic) + '% a.a.');
  return chips.length ? '<div class="chips">' + chips.map(c => `<span class="chip">${esc(c)}</span>`).join('') + '</div>' : '';
}

export function renderResumo() {
  const el = $('#tab-resumo');
  const { tot, open } = model;
  if (!state.ready) { el.innerHTML = '<div class="panel"><div class="empty">Abrindo seus dados…</div></div>'; return; }
  if (!state.lancs.length) {
    el.innerHTML = `<div class="panel"><h2>Sua carteira está vazia</h2>
      <div class="empty">Vá em <b>Lançamentos</b> para importar as planilhas da B3 ou lançar a primeira compra.</div>
      <div class="row"><button class="btn primary" type="button" data-tab="lancamentos">Ir para Lançamentos</button></div></div>`;
    return;
  }
  const pct = tot.cost ? tot.res / tot.cost : 0;
  const byC: Partial<Record<Classe, number>> = {};
  for (const p of open) byC[p.c] = (byC[p.c] || 0) + p.value;
  const cls = (Object.entries(byC) as [Classe, number][]).sort((a, b) => b[1] - a[1]);

  el.innerHTML = `
  <div class="panel">
    <div class="hero">
      <span class="label">Patrimônio</span>
      <div class="big">${brl.format(tot.value)}</div>
      <div class="delta ${sign(tot.res)}">${arrow(tot.res)} ${brl.format(Math.abs(tot.res))} (${fmtPct(pct)}) sobre o investido</div>
    </div>
    <div class="stats adapt">
      <div><span class="label">Investido</span><b>${brl.format(tot.cost)}</b></div>
      <div><span class="label">Proventos 12m</span><b>${brl.format(tot.prov12)}</b></div>
      <div><span class="label">Lucro em vendas</span><b class="${sign(tot.realized)}">${brl.format(tot.realized)}</b></div>
    </div>
    ${chipsIndices()}
  </div>
  <div class="panel" id="rentPanel"></div>
  <div class="panel">
    <h2>Evolução do patrimônio</h2>
    <div class="chart" id="chEvo"></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Patrimônio (fim de cada mês)</span><span><i style="background:var(--muted)"></i>Valor investido</span></div>
  </div>
  <div class="panel">
    <h2>Distribuição</h2>
    <div class="alloc">${cls.map(([c, v]) => `<span style="background:var(--c-${c});flex:${Math.max(v, 0.0001)}"></span>`).join('')}</div>
    <div class="list">${cls.map(([c, v]) => `<div class="item"><div class="name"><span class="dot" style="background:var(--c-${c})"></span>${CLASSES[c] || c}</div><div class="val">${brl.format(v)}</div><div class="meta"></div><div class="meta r">${tot.value ? fmtNum(v / tot.value * 100) : '0'}%</div></div>`).join('')}</div>
  </div>`;
  renderRent();
  renderEvo();
}

function renderEvo() {
  const el = $('#chEvo');
  if (!serie.length) { el.innerHTML = `<div class="empty">${state.histPronto ? 'Sem histórico ainda.' : 'Carregando histórico…'}</div>`; return; }
  lineChart(el, [
    { pts: serie.map(p => ({ x: tms(p.d), y: p.custo })), color: 'var(--muted)', step: true, dash: true },
    { pts: serie.map(p => ({ x: tms(p.d), y: p.v })), color: 'var(--accent)', fill: true, dot: true },
  ], { label: 'Evolução do patrimônio' });
}

function renderRent() {
  const el = $('#rentPanel');
  if (!serie.length) {
    el.innerHTML = `<h2>Rentabilidade</h2><div class="empty">${state.histPronto ? 'Sem dados suficientes.' : 'Carregando histórico de cotações…'}</div>`;
    return;
  }
  const first = serie[0].ym, cur = serie.at(-1)!.ym;
  const [ini, fim] = periodRange(state.periodo, first, cur);
  const anos: number[] = [];
  for (let y = parseInt(cur.slice(0, 4), 10) - 1; y >= parseInt(first.slice(0, 4), 10); y--) anos.push(y);
  const p = state.periodo;
  const btn = (label: string, attrs: string, on: boolean) => `<button type="button" ${attrs} aria-pressed="${on}">${label}</button>`;
  const seg = [
    btn('12 meses', 'data-per="12m"', p.tipo === '12m'),
    btn('No ano', 'data-per="ano"', p.tipo === 'ano'),
    btn('Desde o início', 'data-per="tudo"', p.tipo === 'tudo'),
    ...anos.map(y => btn(String(y), `data-per="y" data-ano="${y}"`, p.tipo === 'y' && p.ano === y)),
    btn('Personalizado', 'data-per="custom"', p.tipo === 'custom'),
  ].join('');

  const r = periodResult(serie, ini, fim);
  const ix = state.indices;
  let bench = '', chart = '', notas: string[] = [];
  let cdiAcc: number | null = null, ipca: { acc: number; ultimo: string } | null = null;
  if (r && ix?.cdi?.length) {
    const d0 = r.indice[0].d, d1 = r.indice.at(-1)!.d;
    if (ix.cdi[0][0] <= addDaysIso(d0, 7)) cdiAcc = cdiAcumulado(ix.cdi, d0, d1);
    ipca = ipcaAcumulado(ix.ipca, r.ini, r.fim);
    if (ipca.ultimo && ipca.ultimo < r.fim) notas.push(`IPCA disponível até ${fmtYm(ipca.ultimo)}.`);
    if (!ipca.ultimo) ipca = null;
  } else if (r) notas.push('CDI e IPCA aparecem depois da primeira atualização com internet.');
  if (r) {
    const sem = new Set(serie.filter(s => s.ym >= r.ini && s.ym <= r.fim).flatMap(s => s.semPreco));
    if (sem.size) notas.push(`Sem cotação histórica, avaliados pelo custo: ${[...sem].slice(0, 8).join(', ')}${sem.size > 8 ? '…' : ''}.`);
    bench = `
      <div class="stats">
        <div><span class="label">Carteira</span><b class="lg ${sign(r.rent)}">${fmtPct(r.rent)}</b></div>
        <div><span class="label">CDI</span><b class="lg">${cdiAcc != null ? fmtPct(cdiAcc) : '—'}</b></div>
        <div><span class="label">IPCA</span><b class="lg">${ipca ? fmtPct(ipca.acc) : '—'}</b></div>
      </div>
      <div class="stats adapt">
        <div><span class="label">Ganho no período</span><b class="${sign(r.ganho)}">${brl.format(r.ganho)}</b></div>
        <div><span class="label">Aportes líquidos</span><b>${brl.format(r.aportes)}</b></div>
        <div><span class="label">Proventos</span><b>${brl.format(r.prov)}</b></div>
      </div>
      <div class="note">Patrimônio de ${brl.format(r.vIni)} (fim de ${fmtYm(addMonths(r.ini, -1))}) para ${brl.format(r.vFim)} (${r.fim === cur ? 'hoje' : 'fim de ' + fmtYm(r.fim)}). A rentabilidade desconta aportes e inclui proventos.</div>`;
    chart = `<div class="chart" id="chRent"></div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Carteira</span><span><i style="background:var(--b-cdi)"></i>CDI</span><span><i style="background:var(--b-ipca)"></i>IPCA</span></div>`;
  }
  el.innerHTML = `<h2>Rentabilidade</h2>
    <div class="seg" role="group" aria-label="Período">${seg}</div>
    ${p.tipo === 'custom' ? `<div class="form">
      <div class="field"><label for="perIni">De</label><input type="month" id="perIni" min="${first}" max="${cur}" value="${ini}"></div>
      <div class="field"><label for="perFim">Até</label><input type="month" id="perFim" min="${first}" max="${cur}" value="${fim}"></div></div>` : ''}
    <div class="sub">${fmtYm(ini)} a ${fim === cur ? 'hoje' : fmtYm(fim)}</div>
    ${bench}${chart}
    ${notas.length ? `<div class="note">${notas.map(esc).join(' ')}</div>` : ''}`;

  if (r) {
    const series: Serie[] = [{ pts: r.indice.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--accent)', dot: true }];
    if (ix?.cdi?.length) {
      const b = benchCurves(r.indice, ix.cdi, ix.ipca);
      if (cdiAcc != null) series.push({ pts: b.cdi.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--b-cdi)', dash: true });
      if (b.ipca.length > 1) series.push({ pts: b.ipca.map(p => ({ x: tms(p.d), y: p.acc })), color: 'var(--b-ipca)', dash: true });
    }
    lineChart($('#chRent'), series, { label: 'Rentabilidade acumulada', fmtY: fmtPctAxis, zero: true });
  }
}

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

export { renderRent };
