// Formato de arquivo "finai-banco/1": o que a rotina do Claude (ou você, pelo chat) grava com as
// transações lidas do conector do banco. O FinAI lê esses arquivos e junta sem duplicar.
//
// {
//   "formato": "finai-banco/1",
//   "geradoEm": "2026-10-09T09:00:00-03:00",
//   "contas": [{ "id": "mp-conta", "banco": "Mercado Pago", "nome": "Conta", "tipo": "corrente", "saldo": 132.35 }],
//   "transacoes": [{ "conta": "mp-conta", "data": "2026-10-08", "descricao": "Dinheiro reservado", "valor": -300 }]
// }
// valor: negativo = saiu / gastou (inclusive compra no cartão); positivo = entrou (ou estorno/pagamento no cartão).
import type { ContaBanco, TxBanco } from './tipos';
import { norm } from './classificar';

export const FORMATO = 'finai-banco/1';
export const ORIGEM_ARQUIVO = 'arquivo';

export interface LidoArquivo { geradoEm: string; contas: ContaBanco[]; txs: TxBanco[]; avisos: string[] }

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[R$\s]/g, '');
  // "1.234,56" ou "1234.56"
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return n;
};
const data = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const slug = (s: string) => norm(s).trim().replace(/\s+/g, '-') || 'conta';

/** Lê e valida um arquivo do formato finai-banco/1. Lança erro com mensagem amigável se não servir. */
export function lerArquivoBanco(texto: string): LidoArquivo {
  let o: Record<string, unknown>;
  try { o = JSON.parse(texto); } catch { throw new Error('O arquivo não é um JSON válido.'); }
  if (!o || typeof o !== 'object' || !Array.isArray(o.transacoes)) throw new Error('Este arquivo não está no formato do FinAI (falta a lista "transacoes").');
  const geradoEm = typeof o.geradoEm === 'string' ? o.geradoEm : new Date().toISOString();
  const avisos: string[] = [];
  const contas = new Map<string, ContaBanco>();
  for (const c of Array.isArray(o.contas) ? o.contas as Record<string, unknown>[] : []) {
    if (!c || (typeof c.id !== 'string' && typeof c.nome !== 'string')) continue;
    const banco = String(c.banco || c.instituicao || 'Banco');
    const tipo = /cart|credit/i.test(String(c.tipo || '')) ? 'cartao' : 'corrente';
    const id = String(c.id || `${slug(banco)}-${tipo}`);
    const saldo = num(c.saldo);
    contas.set(id, { id: `arq:${id}`, item: ORIGEM_ARQUIVO, banco, nome: String(c.nome || (tipo === 'cartao' ? 'Cartão' : 'Conta')), tipo,
      saldo: Number.isFinite(saldo) ? saldo : 0, em: geradoEm });
  }
  const txs: TxBanco[] = [];
  const ordem = new Map<string, number>();
  let ruins = 0;
  for (const t of o.transacoes as Record<string, unknown>[]) {
    const d = data(t?.data ?? t?.date);
    const v = num(t?.valor ?? t?.amount);
    const desc = String(t?.descricao ?? t?.description ?? '').trim();
    const contaOrig = String(t?.conta ?? '');
    if (!d || !Number.isFinite(v) || !contaOrig) { ruins++; continue; }
    if (!contas.has(contaOrig)) contas.set(contaOrig, { id: `arq:${contaOrig}`, item: ORIGEM_ARQUIVO, banco: contaOrig, nome: contaOrig,
      tipo: /cart|credit/i.test(contaOrig) ? 'cartao' : 'corrente', saldo: 0, em: geradoEm });
    const conta = `arq:${contaOrig}`;
    const vv = Math.round(v * 100) / 100;
    // Sem id do banco, a chave vem dos dados; a ordem separa transações idênticas no mesmo dia.
    const base = `${conta}|${d}|${vv}|${norm(desc).trim()}`;
    const n = (ordem.get(base) || 0) + 1; ordem.set(base, n);
    txs.push({
      id: t.id ? String(t.id) : `${base}|${n}`,
      chave: t.id ? `id:${conta}:${t.id}` : `${base}|${n}`,
      conta, d, desc: desc || '(sem descrição)', v: vv,
      ...(typeof t.categoria === 'string' && t.categoria ? { catP: t.categoria } : {}),
      ...(t.pendente ? { pend: true } : {}),
    });
  }
  if (ruins) avisos.push(`${ruins} transação(ões) com data, valor ou conta faltando foram ignoradas.`);
  return { geradoEm, contas: [...contas.values()], txs, avisos };
}

/** Junta o que veio do arquivo com o que já existe: transação repetida (mesma chave) não entra de novo. */
export function juntarArquivo(contasAtuais: ContaBanco[], txsAtuais: TxBanco[], lido: LidoArquivo) {
  const contas = new Map(contasAtuais.map(c => [c.id, c]));
  for (const c of lido.contas) {
    const atual = contas.get(c.id);
    // O saldo vale o do arquivo mais recente.
    if (!atual || atual.em <= c.em) contas.set(c.id, c);
  }
  const chaves = new Set(txsAtuais.map(t => t.chave));
  const novas = lido.txs.filter(t => !chaves.has(t.chave));
  return { contas: [...contas.values()], txs: [...txsAtuais, ...novas].sort((a, b) => a.d.localeCompare(b.d)), novas: novas.length };
}
