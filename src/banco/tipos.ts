// Área Banco: contas e transações vindas do Open Finance (via Meu Pluggy). Tudo fica no aparelho.

export type TipoConta = 'corrente' | 'cartao';

export interface ContaBanco {
  id: string;
  item: string;       // conexão (Item) da Pluggy
  banco: string;      // nome da instituição
  nome: string;
  tipo: TipoConta;
  saldo: number;      // conta: saldo; cartão: fatura em aberto
  limite?: number;
  em: string;         // quando foi lido
}

/**
 * Transação normalizada. `v` segue o ponto de vista do seu dinheiro:
 * negativo = saiu/gastou (inclusive compra no cartão), positivo = entrou (ou estorno/pagamento no cartão).
 */
export interface TxBanco {
  id: string;
  chave: string;      // identificador estável (sobrevive à troca de id da Pluggy no fechamento da fatura)
  conta: string;
  d: string;          // AAAA-MM-DD (horário de Brasília)
  desc: string;
  v: number;
  catP?: string;      // categoria da Pluggy (em inglês), quando houver
  mesmaPessoa?: boolean; // contraparte com o mesmo CPF/CNPJ do titular
  pend?: boolean;     // ainda pendente (fatura aberta / parcela futura)
}

/** O que a transação é de verdade: só receita e despesa entram nos totais de entradas e saídas. */
export type Natureza = 'receita' | 'despesa' | 'interna' | 'investimento' | 'fatura';

export const NATUREZAS: Record<Natureza, string> = {
  receita: 'Receita',
  despesa: 'Despesa',
  interna: 'Movimentação interna',
  investimento: 'Investimento',
  fatura: 'Pagamento de fatura',
};

/** Correção feita por você numa transação (pela chave). */
export interface AjusteTx { cat?: string; nat?: Natureza }

/** Regra "tudo que contém X na descrição vira Y". */
export interface RegraBanco { id: string; termo: string; cat?: string; nat?: Natureza }

export interface ConfigPluggy { clientId: string; clientSecret: string; itens: string[] }
