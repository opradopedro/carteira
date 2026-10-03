export type Classe = 'acao' | 'fii' | 'cripto' | 'tesouro' | 'outro';

/**
 * Tipos de lançamento:
 *  C compra, V venda, P provento recebido em dinheiro,
 *  S ajuste de quantidade (desdobro, grupamento, bonificação): q pode ser negativo
 *    e v é o custo acrescentado (zero em desdobro/grupamento).
 */
export type TipoLanc = 'C' | 'V' | 'P' | 'S';

export interface Lancamento {
  id: string;
  d: string;        // AAAA-MM-DD
  t: TipoLanc;
  a: string;        // código do ativo (PETR4, BTC, TESOURO IPCA+ 2029…)
  c: Classe;
  q: number;        // quantidade (0 em proventos)
  p: number;        // preço unitário
  v: number;        // valor total da operação
  o: 'b3' | 'manual';
  n?: string;       // descrição (ex.: "Dividendo", "Desdobro")
  k0?: string;      // chave original da importação, mantida quando o lançamento é corrigido à mão
}

export interface Cotacao {
  p: number;        // preço
  em: string;       // ISO de quando foi obtida
  fonte: 'brapi' | 'coingecko' | 'b3' | 'tesouro' | 'manual' | 'mb';
  ref?: string;     // data de referência do preço (AAAA-MM-DD), quando não é tempo real
}

export type Precos = Record<string, Cotacao>;

export interface Posicao {
  a: string;
  c: Classe;
  q: number;
  cost: number;
  prov: number;
  prov12: number;
  real: number;
  pm: number;
  px: Cotacao | null;
  value: number;
  res: number;
}

export interface Totais {
  value: number;
  cost: number;
  prov: number;
  prov12: number;
  realized: number;
  res: number;
  semCot: number;
}

export interface Modelo {
  list: Posicao[];
  open: Posicao[];
  tot: Totais;
  timeline: { d: string; v: number }[];
  sorted: Lancamento[];
}

export const CLASSES: Record<Classe, string> = {
  acao: 'Ações', fii: 'FIIs', cripto: 'Cripto', tesouro: 'Tesouro Direto', outro: 'Outros',
};
