import type { Lancamento } from './types';
import { cleanTicker, guessClass, newId, norm, parseDate, parseNum } from './util';

export type Linha = Record<string, unknown>;

export interface ResultadoLeitura {
  lancs: Lancamento[];
  ignored: number;
  kind: '' | 'Negociação' | 'Movimentação';
}

const PROVENTO = /dividendo|juros sobre capital|rendimento|amortizacao|restituicao de capital|^juros$|^reembolso$/;
/** Renda fixa privada vem como "CDB - CDB222ABCDE - BANCO X": usa o código do título. */
const RENDA_FIXA = /^(CDB|LCI|LCA|LC|LF|CRI|CRA|DEB|DEBENTURE)$/;
const AJUSTE = /^(desdobro|grupamento|bonificacao em ativos|fracao em ativos)$/;

/**
 * Converte as linhas das planilhas da Área do Investidor da B3 em lançamentos.
 * - Negociação: compras e vendas na bolsa.
 * - Movimentação: proventos, Tesouro Direto (compra, venda, resgate) e eventos
 *   que mudam a quantidade (desdobro, grupamento, bonificação).
 * Ficam de fora: liquidações (repetem a Negociação), transferências entre custódias,
 * empréstimo de ações (as ações continuam suas), "Atualização" (só informativa) e
 * direitos de subscrição não exercidos/cedidos.
 */
export function rowsToLancs(rows: Linha[]): ResultadoLeitura {
  const out: Lancamento[] = [];
  let ignored = 0;
  let kind: ResultadoLeitura['kind'] = '';
  for (const raw of rows) {
    const r: Linha = {};
    for (const k in raw) r[norm(k)] = raw[k];

    if ('codigo de negociacao' in r && 'tipo de movimentacao' in r) {
      kind = 'Negociação';
      const d = parseDate(r['data do negocio']);
      const a = cleanTicker(r['codigo de negociacao']);
      const q = parseNum(r['quantidade']);
      const p = parseNum(r['preco']);
      let v = parseNum(r['valor']);
      const tp = norm(r['tipo de movimentacao']);
      const t = tp.startsWith('compra') ? 'C' : tp.startsWith('venda') ? 'V' : '';
      if (!d || !a || !q || !t) { ignored++; continue; }
      if (!v) v = q * p;
      out.push({ id: newId(), d, t, a, c: guessClass(a), q, p: p || v / q, v, o: 'b3' });
    } else if ('movimentacao' in r && 'produto' in r) {
      kind = 'Movimentação';
      const d = parseDate(r['data']);
      const mvRaw = String(r['movimentacao'] ?? '').trim();
      const mv = norm(mvRaw);
      const partes = String(r['produto'] ?? '').split(' - ').map(x => x.trim());
      const rf = RENDA_FIXA.test(cleanTicker(partes[0])) && partes[1];
      const a = cleanTicker(rf ? partes[1] : partes[0]);
      const q = Math.abs(parseNum(r['quantidade']));
      const p = parseNum(r['preco unitario']);
      let v = Math.abs(parseNum(r['valor da operacao']));
      const credito = norm(r['entrada/saida'] ?? 'credito') === 'credito';
      if (!d || !a) { ignored++; continue; }
      const c = rf ? 'outro' : guessClass(a);
      if (PROVENTO.test(mv)) {
        if (!credito || !v) { ignored++; continue; }
        out.push({ id: newId(), d, t: 'P', a, c, q: 0, p: 0, v, o: 'b3', n: mv === 'reembolso' ? 'Reembolso (ações emprestadas)' : mvRaw });
      } else if (mv === 'leilao de fracao') {
        if (!credito || !v) { ignored++; continue; }
        out.push({ id: newId(), d, t: 'P', a, c, q: 0, p: 0, v, o: 'b3', n: 'Leilão de fração' });
      } else if (mv === 'compra' || mv === 'venda' || mv === 'resgate' || mv === 'vencimento' || mv === 'compra / venda') {
        // Tesouro Direto e renda fixa: compra, venda, resgate antecipado e vencimento.
        if (!q) { ignored++; continue; }
        if (!v) v = q * p;
        const t = mv === 'compra' || (mv === 'compra / venda' && credito) ? 'C' : 'V';
        const n = mv === 'resgate' ? 'Resgate' : mv === 'vencimento' ? 'Vencimento' : undefined;
        // Vencimento sem valor (comum em CDB): v = 0 e a venda sai pelo custo, sem lucro nem prejuízo.
        out.push({ id: newId(), d, t, a, c, q, p: p || (q ? v / q : 0), v, o: 'b3', ...(n ? { n } : {}) });
      } else if (AJUSTE.test(mv)) {
        if (!q) { ignored++; continue; }
        const custo = mv === 'bonificacao em ativos' && credito ? (v || q * p) : 0;
        out.push({ id: newId(), d, t: 'S', a, c, q: credito ? q : -q, p: 0, v: custo, o: 'b3', n: mvRaw });
      } else {
        ignored++;
      }
    } else {
      ignored++;
    }
  }
  return { lancs: out, ignored, kind };
}

/** Chave que identifica um lançamento para evitar duplicação na reimportação. */
export const keyOf = (l: Lancamento): string =>
  [l.d, l.t, l.a, Math.round(l.q * 1e6), Math.round(l.v * 100)].join('|');

/**
 * Junta lançamentos importados aos existentes sem duplicar.
 * Conta ocorrências de cada chave (dois negócios iguais no mesmo dia são legítimos):
 * só entra o que exceder o que já existe.
 */
export function mergeImport(existing: Lancamento[], incoming: Lancamento[]) {
  const have = new Map<string, number>();
  for (const l of existing) have.set(keyOf(l), (have.get(keyOf(l)) || 0) + 1);
  const seenNow = new Map<string, number>();
  const added: Lancamento[] = [];
  let dup = 0;
  for (const l of incoming) {
    const k = keyOf(l);
    const n = (seenNow.get(k) || 0) + 1;
    seenNow.set(k, n);
    if (n <= (have.get(k) || 0)) dup++;
    else added.push(l);
  }
  return { next: [...existing, ...added], added, dup };
}

/** Provento já anunciado e ainda não pago (planilha "Eventos" / Proventos a Receber da B3). */
export interface AReceber { a: string; d: string; tipo: string; v: number }

/**
 * Lê a planilha de Eventos da B3 (aba "Proventos a Receber"). Não vira lançamento:
 * quando o provento for pago, ele chega pela planilha de Movimentação.
 * O número da conta, que vem na planilha, é descartado.
 */
export function rowsToAReceber(rows: Linha[]): AReceber[] | null {
  const out: AReceber[] = [];
  let reconhecida = false;
  for (const raw of rows) {
    const r: Linha = {};
    for (const k in raw) r[norm(k)] = raw[k];
    if (!('previsao de pagamento' in r && 'tipo de evento' in r)) continue;
    reconhecida = true;
    const a = cleanTicker(String(r['produto'] ?? '').split(' - ')[0]);
    const d = parseDate(r['previsao de pagamento']);
    const v = parseNum(r['valor liquido']);
    if (!a || !d || !(v > 0)) continue; // linha de total e linhas vazias
    const tipo = String(r['tipo de evento'] ?? '').trim()
      .replace(/^reembolso - (.*)$/i, (_, x: string) => `Reembolso de ${x.toLowerCase()}`);
    out.push({ a, d, tipo: tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase(), v });
  }
  return reconhecida ? out : null;
}
