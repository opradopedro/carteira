import { brl, compact } from './fmt';

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
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
    const passo = Math.max(1, Math.ceil(bars.length / 8));
    if ((bars.length - 1 - i) % passo === 0) g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${b.label}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Proventos por mês" font-family="inherit">${g}</svg>`;
}
