// Cliente da API da Pluggy (Open Finance) usado direto do celular: o Meu Pluggy guarda o seu
// consentimento e a API devolve contas e transações. Client ID/Secret ficam só neste aparelho.
import type { ConfigPluggy, ContaBanco, TxBanco } from './tipos';
import { norm } from './classificar';

const API = 'https://api.pluggy.ai';

interface PluggyConta { id: string; itemId: string; type: 'BANK' | 'CREDIT'; subtype?: string; name?: string; marketingName?: string; balance?: number; taxNumber?: string; creditData?: { creditLimit?: number } }
interface Doc { value?: string }
interface Parte { documentNumber?: Doc }
export interface PluggyTx {
  id: string; providerId?: string | null; description?: string; descriptionRaw?: string; amount: number; amountInAccountCurrency?: number;
  date: string; category?: string | null; type?: 'DEBIT' | 'CREDIT'; status?: string;
  paymentData?: { payer?: Parte; receiver?: Parte } | null;
}

export class ErroPluggy extends Error { constructor(msg: string, public status = 0) { super(msg); } }

async function pedir<T>(caminho: string, init: RequestInit = {}, tentativas = 2): Promise<T> {
  let erro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(API + caminho, { ...init, signal: AbortSignal.timeout(30_000), cache: 'no-store' });
      if (r.ok) return await r.json() as T;
      if (r.status === 401 || r.status === 403) throw new ErroPluggy('A Pluggy recusou o acesso. Confira o Client ID e o Client Secret.', r.status);
      if (r.status === 404) throw new ErroPluggy('Conexão não encontrada na Pluggy. Confira o Item ID.', r.status);
      erro = new ErroPluggy(`A Pluggy respondeu com erro (${r.status}).`, r.status);
      if (r.status < 500 && r.status !== 429) throw erro;
    } catch (e) {
      if (e instanceof ErroPluggy && e.status && e.status < 500 && e.status !== 429) throw e;
      erro = e;
    }
    if (i < tentativas - 1) await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
  throw erro instanceof ErroPluggy ? erro : new ErroPluggy('A Pluggy não respondeu. Tente de novo em instantes.');
}

async function autenticar(cfg: ConfigPluggy): Promise<string> {
  const r = await pedir<{ apiKey: string }>('/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: cfg.clientId.trim(), clientSecret: cfg.clientSecret.trim() }),
  });
  return r.apiKey;
}

/** Data em horário de Brasília (a Pluggy manda em UTC). */
const dataBR = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
const digitos = (s?: string) => (s || '').replace(/\D/g, '');

/** Converte a transação da Pluggy para o formato do app (sinal do ponto de vista do seu dinheiro). */
export function converterTx(t: PluggyTx, conta: { id: string; cartao: boolean; doc: string }, ordem: number): TxBanco {
  const bruto = t.amountInAccountCurrency ?? t.amount;
  // Cartão: na Pluggy, positivo é compra (aumenta a fatura). Aqui, compra é negativo.
  const v = Math.round((conta.cartao ? -bruto : bruto) * 100) / 100;
  const d = dataBR(t.date);
  const desc = (t.description || t.descriptionRaw || '').trim() || '(sem descrição)';
  const outro = v >= 0 ? t.paymentData?.payer : t.paymentData?.receiver;
  const docOutro = digitos(outro?.documentNumber?.value);
  return {
    id: t.id,
    // O id da Pluggy muda quando a fatura do cartão fecha; a chave usa o id da instituição ou os dados da transação.
    chave: t.providerId ? `p:${t.providerId}` : `${conta.id}|${d}|${v}|${norm(desc).trim()}|${ordem}`,
    conta: conta.id, d, desc, v,
    ...(t.category ? { catP: t.category } : {}),
    ...(conta.doc && docOutro && docOutro === conta.doc ? { mesmaPessoa: true } : {}),
    ...(t.status === 'PENDING' ? { pend: true } : {}),
  };
}

export interface ResultadoSinc { contas: ContaBanco[]; txs: TxBanco[]; contasLidas: string[]; erros: string[] }

/** Lê contas e transações (a partir de `desde`) de todas as conexões configuradas. */
export async function sincronizar(cfg: ConfigPluggy, desde: string): Promise<ResultadoSinc> {
  const key = await autenticar(cfg);
  const h = { headers: { 'X-API-KEY': key } };
  const contas: ContaBanco[] = [], txs: TxBanco[] = [], contasLidas: string[] = [], erros: string[] = [];
  const agora = new Date().toISOString();
  for (const item of cfg.itens.map(s => s.trim()).filter(Boolean)) {
    try {
      const it = await pedir<{ connector?: { name?: string }; status?: string; executionStatus?: string }>(`/items/${encodeURIComponent(item)}`, h);
      const banco = it.connector?.name || 'Banco';
      if (it.status === 'LOGIN_ERROR' || it.status === 'OUTDATED')
        erros.push(`${banco}: a conexão precisa ser renovada no Meu Pluggy.`);
      const lista = await pedir<{ results: PluggyConta[] }>(`/accounts?itemId=${encodeURIComponent(item)}`, h);
      for (const a of lista.results || []) {
        const cartao = a.type === 'CREDIT';
        contas.push({
          id: a.id, item, banco, nome: a.marketingName || a.name || (cartao ? 'Cartão' : 'Conta'),
          tipo: cartao ? 'cartao' : 'corrente', saldo: Number(a.balance) || 0,
          ...(a.creditData?.creditLimit ? { limite: a.creditData.creditLimit } : {}), em: agora,
        });
        const ordem = new Map<string, number>();
        for (let pg = 1, total = 1; pg <= total && pg <= 40; pg++) {
          const r = await pedir<{ results: PluggyTx[]; totalPages: number }>(
            `/transactions?accountId=${encodeURIComponent(a.id)}&from=${desde}&pageSize=500&page=${pg}`, h);
          total = r.totalPages || 1;
          for (const t of r.results || []) {
            const base = `${t.date}|${t.amount}|${t.description}`;
            const n = (ordem.get(base) || 0) + 1; ordem.set(base, n);
            txs.push(converterTx(t, { id: a.id, cartao, doc: digitos(a.taxNumber) }, n));
          }
        }
        contasLidas.push(a.id);
      }
    } catch (e) {
      erros.push(e instanceof ErroPluggy ? e.message : `Não consegui ler a conexão ${item.slice(0, 8)}…`);
      if (e instanceof ErroPluggy && (e.status === 401 || e.status === 403)) break;
    }
  }
  return { contas, txs, contasLidas, erros };
}
