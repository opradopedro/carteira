import type { Classe } from './types';

export const norm = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = (): string => ymd(new Date());

/** Converte número em formato brasileiro ("1.234,56", "R$ 10,00") ou número puro. */
export function parseNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/R\$/g, '').replace(/\s/g, '');
  if (!s || s === '-') return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Aceita Date, "dd/mm/aaaa" ou "aaaa-mm-dd"; devolve "aaaa-mm-dd" ou "". */
export function parseDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return ymd(new Date(v.getTime() + 12 * 3600 * 1000));
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export const CRIPTOS = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE'];

/** Palpite de classe pelo código; a B3 pode corrigir isso (ver hist.ts). */
export function guessClass(a: string): Classe {
  if (/^TESOURO/.test(a)) return 'tesouro';
  if (CRIPTOS.includes(a) || a === 'BITCOIN') return 'cripto';
  if (/^[A-Z]{4}11$/.test(a)) return 'fii';
  if (/^[A-Z]{4}\d{1,2}$/.test(a)) return 'acao';
  return 'outro';
}

/** Padroniza o código: maiúsculas, sem o "F" do mercado fracionário, BITCOIN → BTC. */
export function cleanTicker(t: unknown): string {
  let s = String(t ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^[A-Z]{4}\d{1,2}F$/.test(s)) s = s.slice(0, -1);
  if (s === 'BITCOIN') s = 'BTC';
  return s;
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const isB3Ticker = (a: string): boolean => /^[A-Z0-9]{4}\d{1,2}[A-Z]?$/.test(a) && !CRIPTOS.includes(a);

export const addMonths = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Último dia (AAAA-MM-DD) do mês "AAAA-MM". */
export const monthEnd = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return ymd(new Date(y, m, 0));
};
