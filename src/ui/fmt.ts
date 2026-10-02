export const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const qtd = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });
const pct2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const fmtQ = (q: number) => qtd.format(q);
/** Fração → "+12,34%". */
export const fmtPct = (x: number) => (x >= 0 ? '+' : '') + pct2.format(x * 100) + '%';
export const fmtPctAxis = (x: number) => pct1.format(x * 100) + '%';
export const fmtNum = (x: number) => pct2.format(x);
export const sign = (x: number) => (x >= 0 ? 'up' : 'down');
export const arrow = (x: number) => (x >= 0 ? '▲' : '▼');
export const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const fmtD = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
export const fmtYm = (ym: string) => MES[parseInt(ym.slice(5, 7), 10) - 1] + '/' + ym.slice(0, 4);
export const tms = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const fmtQuando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let toastT = 0;
export function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = window.setTimeout(() => (t.hidden = true), 3500);
}
