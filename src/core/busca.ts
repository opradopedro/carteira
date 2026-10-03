// Sugestões para o campo "Ativo" do lançamento manual.
import type { Classe } from './types';
import { norm } from './util';

export interface Sugestao { a: string; nome: string; c: Classe; minha?: boolean }

export const CRIPTO_NOMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', USDT: 'Tether (dólar)', USDC: 'USD Coin (dólar)',
  BNB: 'BNB', XRP: 'XRP', ADA: 'Cardano', DOGE: 'Dogecoin',
};

/**
 * Ordena por relevância: seus ativos primeiro; depois código que começa com o texto,
 * nome que começa com o texto e, por fim, código ou nome que contém o texto.
 */
export function buscarAtivos(q: string, fontes: Sugestao[], limite = 8): Sugestao[] {
  const t = norm(q).replace(/\s+/g, ' ');
  if (!t) return [];
  const vistos = new Set<string>();
  const pontos: { s: Sugestao; p: number }[] = [];
  for (const s of fontes) {
    if (vistos.has(s.a)) continue;
    const a = norm(s.a), n = norm(s.nome);
    let p: number = -1;
    if (a === t) p = 0;
    else if (a.startsWith(t)) p = 1;
    else if (n.startsWith(t)) p = 2;
    else if (n.split(/[\s/.-]+/).some(w => w.startsWith(t))) p = 3;
    else if (a.includes(t) || n.includes(t)) p = 4;
    if (p < 0) continue;
    if (s.c === 'cripto' && p <= 2) p = 0.5; // "bit" → Bitcoin antes dos fundos com "BIT" no código
    vistos.add(s.a);
    pontos.push({ s, p: p - (s.minha ? 10 : 0) });
  }
  return pontos.sort((x, y) => x.p - y.p || x.s.a.length - y.s.a.length || x.s.a.localeCompare(y.s.a))
    .slice(0, limite).map(x => x.s);
}
