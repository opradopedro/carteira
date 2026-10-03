// Gráfico de linhas interativo em SVG:
//  - 1 dedo (tocar ou arrastar): mostra o ponto e abre o painel com os detalhes daquele dia;
//  - 2 dedos: zoom (pinça) e arrastar para os lados;
//  - toque duplo ou "Ver tudo": volta ao zoom original.
import { MES, compact } from './fmt';
import { hideSheet, showSheet } from './sheet';

export interface ISerie {
  pts: { x: number; y: number }[];
  color: string;
  step?: boolean;
  dash?: boolean;
  fill?: boolean;
}

export interface IOpts {
  label: string;
  fmtY?: (v: number) => string;
  zero?: boolean;
  height?: number;
  /** HTML do painel ao tocar no gráfico; recebe a data (ms) mais próxima do dedo. */
  inspect?: (x: number) => string;
  /** Pontos "tocáveis" (datas em ms). Por padrão, os da primeira série. */
  xs?: number[];
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

const lab = (t: number, longo: boolean) => {
  const d = new Date(t);
  return (longo ? '' : String(d.getUTCDate()).padStart(2, '0') + '/') + MES[d.getUTCMonth()] + '/' + String(d.getUTCFullYear()).slice(2);
};

export function interactiveChart(el: HTMLElement, series: ISerie[], opts: IOpts) {
  const fmtY = opts.fmtY ?? ((v: number) => compact.format(v));
  const all = series.flatMap(s => s.pts);
  if (!all.length) { el.innerHTML = ''; return; }
  const X0 = Math.min(...all.map(p => p.x)), X1 = Math.max(...all.map(p => p.x));
  const xs = (opts.xs ?? series[0].pts.map(p => p.x)).slice().sort((a, b) => a - b);
  let vx0 = X0, vx1 = X1 - X0 < 864e5 ? X0 + 864e5 : X1;
  let sel: number | null = null;
  const cid = 'clip' + (++contador);

  el.classList.add('ichart');
  el.innerHTML = `<div class="ichart-svg"></div><button type="button" class="btn small ichart-reset" hidden>Ver tudo</button>`;
  const box = el.firstElementChild as HTMLElement;
  const reset = el.querySelector('.ichart-reset') as HTMLButtonElement;
  const W = () => Math.max(280, box.clientWidth || el.clientWidth || 320);
  const H = opts.height ?? 200, L = 50, R = 12, T = 12, B = 24;

  function draw() {
    const w = W();
    const vis = (p: { x: number }) => p.x >= vx0 - 1 && p.x <= vx1 + 1;
    const ys = series.flatMap(s => s.pts.filter(vis).map(p => p.y));
    let ymax = ys.length ? Math.max(...ys) : 1, ymin = ys.length ? Math.min(...ys) : 0;
    if (opts.zero) { ymax = Math.max(ymax, 0); ymin = Math.min(ymin, 0); }
    if (ymax === ymin) { ymax = ymax + Math.abs(ymax) * 0.1 + 1e-3; ymin = ymin - Math.abs(ymin) * 0.1; }
    const step = niceStep((ymax - ymin) / 3);
    const y0 = Math.floor(ymin / step) * step, y1 = Math.ceil(ymax / step) * step;
    const X = (x: number) => L + (x - vx0) / (vx1 - vx0) * (w - L - R);
    const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let g = `<defs><clipPath id="${cid}"><rect x="${L}" y="0" width="${w - L - R}" height="${H}"/></clipPath></defs>`;
    for (let v = y0; v <= y1 + step / 2; v += step)
      g += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmtY(Math.abs(v) < step / 1e6 ? 0 : v)}</text>`;
    const longo = vx1 - vx0 > 120 * 864e5;
    g += `<text x="${L}" y="${H - 6}" font-size="11" fill="var(--muted)">${lab(vx0, longo)}</text><text x="${w - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${lab(vx1, longo)}</text>`;
    g += `<g clip-path="url(#${cid})">`;
    const yb = Y(Math.max(y0, Math.min(0, y1)));
    for (const s of series) {
      if (!s.pts.length) continue;
      let d = '';
      s.pts.forEach((p, i) => {
        if (i === 0) d += `M${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`;
        else if (s.step) d += `H${X(p.x).toFixed(1)}V${Y(p.y).toFixed(1)}`;
        else d += `L${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`;
      });
      const last = s.pts[s.pts.length - 1];
      if (s.fill) g += `<path d="${d}L${X(last.x).toFixed(1)},${yb}L${X(s.pts[0].x).toFixed(1)},${yb}Z" fill="${s.color}" fill-opacity=".12" stroke="none"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    }
    if (sel != null) {
      g += `<line x1="${X(sel)}" x2="${X(sel)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1"/>`;
      for (const s of series) {
        const p = s.pts.reduce<{ x: number; y: number } | null>((b, q) => (!b || Math.abs(q.x - sel!) < Math.abs(b.x - sel!) ? q : b), null);
        if (p && Math.abs(p.x - sel) < 20 * 864e5) g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      }
    }
    g += '</g>';
    box.innerHTML = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${opts.label}" font-family="inherit">${g}</svg>`;
    reset.hidden = vx0 <= X0 + 1 && vx1 >= X1 - 1;
  }

  const xOf = (clientX: number) => {
    const r = box.getBoundingClientRect(), w = W();
    const sx = (clientX - r.left) / r.width * w;
    return vx0 + (sx - L) / (w - L - R) * (vx1 - vx0);
  };
  const nearest = (x: number) => xs.reduce((b, q) => (Math.abs(q - x) < Math.abs(b - x) ? q : b), xs[0]);

  // Um único "fechar" por gráfico: assim, ao arrastar, o painel é atualizado sem apagar a linha.
  const aoFechar = () => { sel = null; draw(); };
  function inspect(clientX: number) {
    if (!opts.inspect) return;
    sel = nearest(xOf(clientX));
    draw();
    showSheet(opts.inspect(sel), aoFechar);
  }

  // Gestos
  // Com o dedo, o toque só vira "consulta" quando fica claro que não é rolagem:
  // arrastar para os lados, segurar parado um instante, ou tocar e soltar sem mexer.
  const ptrs = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cx: number; vx0: number; vx1: number } | null = null;
  let toque: { id: number; x: number; y: number; timer: number } | null = null;
  let consultando = false;
  let lastTap = 0;
  const minSpan = Math.max(60 * 864e5, (X1 - X0) / 40);
  const clamp = (a: number, b: number) => {
    let span = Math.max(minSpan, Math.min(X1 - X0 || minSpan, b - a));
    a = Math.max(X0, Math.min(a, X1 - span));
    return [a, a + span];
  };
  const cancelaToque = () => { if (toque) clearTimeout(toque.timer); toque = null; };
  const comecaConsulta = (x: number) => { cancelaToque(); consultando = true; inspect(x); };

  // Enquanto consulta, impede a página de rolar junto com o dedo.
  box.addEventListener('touchmove', e => { if (consultando || pinch) e.preventDefault(); }, { passive: false });

  box.addEventListener('pointerdown', e => {
    try { box.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      cancelaToque(); consultando = false;
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.abs(a.x - b.x) || 1, cx: xOf((a.x + b.x) / 2), vx0, vx1 };
      hideSheet();
    } else if (ptrs.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { cancelaToque(); vx0 = X0; vx1 = X1; draw(); lastTap = 0; return; }
      lastTap = now;
      if (e.pointerType === 'mouse') { comecaConsulta(e.clientX); return; }
      const x = e.clientX;
      toque = { id: e.pointerId, x, y: e.clientY, timer: window.setTimeout(() => comecaConsulta(x), 250) };
    }
  });
  box.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.abs(a.x - b.x) || 1;
      const span = (pinch.vx1 - pinch.vx0) * pinch.d / d;
      const r = box.getBoundingClientRect(), w = W();
      const frac = (((a.x + b.x) / 2 - r.left) / r.width * w - L) / (w - L - R);
      [vx0, vx1] = clamp(pinch.cx - frac * span, pinch.cx - frac * span + span);
      draw();
    } else if (toque && e.pointerId === toque.id) {
      const dx = Math.abs(e.clientX - toque.x), dy = Math.abs(e.clientY - toque.y);
      if (dy > 8 && dy > dx) cancelaToque();          // rolando a página: não abre nada
      else if (dx > 8) comecaConsulta(e.clientX);      // arrastando para o lado: consulta
    } else if (consultando && ptrs.size === 1) {
      inspect(e.clientX);
    }
  });
  const up = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (toque && e.pointerId === toque.id) {
      // tocou e soltou sem mexer: mostra o ponto
      if (e.type === 'pointerup') comecaConsulta(toque.x); else cancelaToque();
    }
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) consultando = false; // o painel e a linha continuam até fechar
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  reset.addEventListener('click', () => { vx0 = X0; vx1 = X1; draw(); });

  draw();
}

let contador = 0;
