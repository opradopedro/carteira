import { MES, brl, compact } from './fmt';

export interface Serie {
  pts: { x: number; y: number }[];
  color: string;
  step?: boolean;
  dash?: boolean;
  fill?: boolean;
  dot?: boolean;
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Gráfico de linhas em SVG. `fmtY` formata o eixo vertical. */
export function lineChart(el: HTMLElement, series: Serie[], opts: { label: string; fmtY?: (v: number) => string; zero?: boolean } ) {
  const fmtY = opts.fmtY ?? ((v: number) => compact.format(v));
  const W = Math.max(280, el.clientWidth || 320), H = 200, L = 50, R = 12, T = 12, B = 24;
  const all = series.flatMap(s => s.pts);
  if (!all.length) { el.innerHTML = ''; return; }
  let x0 = Math.min(...all.map(p => p.x)), x1 = Math.max(...all.map(p => p.x));
  if (x1 - x0 < 864e5) { x0 -= 864e5; x1 += 864e5; }
  let ymax = Math.max(...all.map(p => p.y)), ymin = Math.min(...all.map(p => p.y));
  if (opts.zero) { ymax = Math.max(ymax, 0); ymin = Math.min(ymin, 0); }
  if (ymax === ymin) { ymax = ymax + Math.abs(ymax) * 0.1 + 1e-3; ymin = ymin - Math.abs(ymin) * 0.1; }
  const step = niceStep((ymax - ymin) / 3);
  const y0 = Math.floor(ymin / step) * step, y1 = Math.ceil(ymax / step) * step;
  const X = (x: number) => L + (x - x0) / (x1 - x0) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let g = '';
  for (let v = y0; v <= y1 + step / 2; v += step)
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmtY(Math.abs(v) < step / 1e6 ? 0 : v)}</text>`;
  const lab = (t: number) => { const d = new Date(t); return MES[d.getUTCMonth()] + '/' + String(d.getUTCFullYear()).slice(2); };
  g += `<text x="${L}" y="${H - 6}" font-size="11" fill="var(--muted)">${lab(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${lab(x1)}</text>`;
  for (const s of series) {
    if (!s.pts.length) continue;
    let d = '';
    s.pts.forEach((p, i) => {
      if (i === 0) d += `M${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`;
      else if (s.step) d += `H${X(p.x).toFixed(1)}V${Y(p.y).toFixed(1)}`;
      else d += `L${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`;
    });
    const last = s.pts[s.pts.length - 1];
    const yb = Y(Math.max(y0, Math.min(0, y1)));
    if (s.fill) g += `<path d="${d}L${X(last.x).toFixed(1)},${yb}L${X(s.pts[0].x).toFixed(1)},${yb}Z" fill="${s.color}" fill-opacity=".12" stroke="none"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    if (s.dot) g += `<circle cx="${X(last.x)}" cy="${Y(last.y)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label}" font-family="inherit">${g}</svg>`;
}

export function barChart(el: HTMLElement, bars: { label: string; v: number }[]) {
  const W = Math.max(280, el.clientWidth || 320), H = 170, L = 46, R = 8, T = 10, B = 24;
  const max = Math.max(1, ...bars.map(b => b.v)), step = niceStep(max / 3), y1 = Math.ceil(max / step) * step;
  const Y = (v: number) => T + (1 - v / y1) * (H - T - B), bw = (W - L - R) / bars.length;
  let g = '';
  for (let v = 0; v <= y1 + step / 2; v += step)
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${compact.format(v)}</text>`;
  bars.forEach((b, i) => {
    const x = L + i * bw + bw * 0.18, w = bw * 0.64;
    if (b.v > 0) g += `<rect x="${x.toFixed(1)}" y="${Y(b.v).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - Y(b.v)).toFixed(1)}" rx="3" fill="var(--accent)"><title>${b.label}: ${brl.format(b.v)}</title></rect>`;
    if (i % 2 === (bars.length - 1) % 2) g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${b.label}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Proventos por mês" font-family="inherit">${g}</svg>`;
}
