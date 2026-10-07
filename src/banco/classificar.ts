// Classificação das transações do banco: o que é receita/despesa de verdade, o que é dinheiro
// seu só mudando de lugar (caixinha, outra conta sua, investimento, pagamento da fatura) e em
// que categoria cada gasto cai. Funções puras, testadas em tests/banco.test.ts.
import type { AjusteTx, Natureza, RegraBanco, TxBanco, ContaBanco } from './tipos';

export const CATEGORIAS = [
  'Mercado', 'Alimentação', 'Transporte', 'Moradia', 'Contas da casa', 'Saúde', 'Educação', 'Lazer',
  'Compras', 'Assinaturas', 'Viagem', 'Serviços', 'Taxas e juros', 'Impostos', 'Seguros', 'Doações',
  'Apostas', 'Transferências', 'Outros',
  'Salário', 'Rendimentos', 'Outras receitas',
] as const;
export const CATS_RECEITA = new Set(['Salário', 'Rendimentos', 'Outras receitas']);

/** Texto sem acento, minúsculo e com espaços simples (para comparar descrições). */
export const norm = (s: string) =>
  ` ${s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()} `;

/** Parte "fixa" da descrição, usada nas regras ("aplicar às parecidas"): sem números, datas e códigos. */
export function termoDe(desc: string): string {
  return norm(desc).replace(/\b[a-z]*\d\w*\b/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
}

// Categoria da Pluggy (árvore em inglês) -> categoria do app.
const MAPA_PLUGGY: [RegExp, string][] = [
  [/proceeds|dividend/i, 'Rendimentos'],
  [/^groceries/i, 'Mercado'],
  [/food|eating|restaurant|delivery/i, 'Alimentação'],
  [/taxi|ride|public transport|car rental|bicycle|automotive|gas station|parking|toll|vehicle|traffic|transportation/i, 'Transporte'],
  [/rent|houseware|urban land|housing/i, 'Moradia'],
  [/utilit|water|electricity|^gas$|telecom|internet|mobile|^tv$/i, 'Contas da casa'],
  [/health|dentist|pharmacy|optometry|hospital|gym|fitness|wellness|sports practice/i, 'Saúde'],
  [/education|course|university|school|kindergarten/i, 'Educação'],
  [/streaming|gaming|digital services/i, 'Assinaturas'],
  [/leisure|ticket|stadium|landmark|cinema|theater/i, 'Lazer'],
  [/shopping|electronics|pet|clothing|kids|bookstore|sports goods|office|cashback/i, 'Compras'],
  [/travel|airport|airline|accommodation|mileage|bus ticket/i, 'Viagem'],
  [/fee|interest|late payment|overdraft|loan|financing/i, 'Taxas e juros'],
  [/tax/i, 'Impostos'],
  [/insurance/i, 'Seguros'],
  [/donation/i, 'Doações'],
  [/gambling|lottery|bet/i, 'Apostas'],
  [/salary|retirement|pro-labore/i, 'Salário'],
  [/income|government aid|entrepreneurial/i, 'Outras receitas'],
  [/transfer|pix|ted|doc|boleto|bank slip/i, 'Transferências'],
  [/services/i, 'Serviços'],
];

// Palavras na descrição -> categoria (quando a Pluggy não categoriza). A ordem importa.
const PALAVRAS: [RegExp, string][] = [
  [/ (ifood|rappi|ze delivery|aiqfome|restaurante|lanchonete|padaria|panificadora|burger|pizza|mcdonald|bobs|subway|starbucks|cafeteria|churrascaria|sorvete|acai|bar e|boteco|sushi|food) /, 'Alimentação'],
  [/ (mercado livre|mercadolivre|meli|shopee|amazon(?! prime)|aliexpress|magalu|magazine luiza|americanas|shein|renner|riachuelo|c&a|zara|centauro|netshoes|kabum|casas bahia|ponto frio|leroy|tok stok|decathlon) /, 'Compras'],
  [/ (supermercado|supermerc|mercado|mercearia|atacadao|atacadista|assai|carrefour|pao de acucar|hortifruti|sacolao|dia supermercado|makro|tenda|savegnago|condor|zaffari) /, 'Mercado'],
  [/ (uber|99 ?app|99 pop|99pop|cabify|indriver|posto|combustiv|shell|ipiranga|petrobras br|ale combust|estacionamento|estapar|sem parar|veloe|conectcar|metro|cptm|onibus|bilhete unico|top transporte|recarga bu) /, 'Transporte'],
  [/ (farmacia|drogaria|droga raia|drogasil|pague menos|panvel|hospital|clinica|laboratorio|exame|unimed|amil|hapvida|odonto|dentista|smart fit|smartfit|academia|bluefit|gympass|wellhub|totalpass) /, 'Saúde'],
  [/ (netflix|spotify|disney|prime video|amazon prime|youtube|google one|icloud|apple com|hbo|max com|deezer|globoplay|paramount|crunchyroll|chatgpt|openai|claude|anthropic|microsoft|adobe|canva) /, 'Assinaturas'],
  [/ (aluguel|condominio|iptu|quinto andar|quintoandar) /, 'Moradia'],
  [/ (enel|light|cemig|copel|celesc|coelba|energia|eletropaulo|sabesp|copasa|cedae|saneamento|agua|comgas|gas natural|claro|vivo|oi fibra|net servicos|internet|telefonica) /, 'Contas da casa'],
  [/ (escola|colegio|faculdade|universidade|curso|udemy|alura|coursera|livraria) /, 'Educação'],
  [/ (cinema|cinemark|ingresso|sympla|eventim|teatro|steam|playstation|xbox|nintendo) /, 'Lazer'],
  [/ (airbnb|booking|hotel|pousada|latam|gol linhas|azul linhas|decolar|123milhas|smiles|rodoviaria|buser) /, 'Viagem'],
  [/ (salario|folha de pagamento|pagamento de salario|proventos salario|adiantamento salarial) /, 'Salário'],
  [/ (rendimento|rendimentos|juros sobre capital|dividendo|remuneracao) /, 'Rendimentos'],
  [/ (iof|tarifa|anuidade|juros|multa|encargos?) /, 'Taxas e juros'],
  [/ (darf|ipva|imposto|receita federal|detran|licenciamento) /, 'Impostos'],
  [/ (seguro|seguradora|porto seguro|azul seguros) /, 'Seguros'],
  [/ (bet|aposta|loteria|lotofacil|mega sena|blaze|betano|bet365|sportingbet|pixbet|esportes da sorte) /, 'Apostas'],
  [/ (pix|ted|doc|transferencia|transf|boleto) /, 'Transferências'],
];

const CAIXINHA = / (caixinhas?|cofrinhos?|cofre|dinheiro reservado|dinheiro retirado|reservado|retirada da reserva|guardado|porquinho) /;
const FATURA = / (pagamento (da |de )?fatura|pagto fatura|pgto fatura|pagamento cartao|pagamento de cartao|fatura cartao|pagamento recebido|pagamento efetuado|credit card payment) /;
const INVEST = / (aplicacao|aplic|resgate|cdb|lci|lca|tesouro direto|investimento|corretora|fundo de investimento|previdencia) /;

export function categoriaPluggy(catP?: string): string | null {
  if (!catP) return null;
  for (const [re, c] of MAPA_PLUGGY) if (re.test(catP)) return c;
  return null;
}

export function categoriaPorPalavras(desc: string): string | null {
  const t = norm(desc);
  for (const [re, c] of PALAVRAS) if (re.test(t)) return c;
  return null;
}

/** Natureza automática de uma transação, olhando só para ela. */
export function naturezaAuto(tx: TxBanco, cartao: boolean): Natureza {
  const t = norm(tx.desc), cp = tx.catP || '';
  if (cartao) {
    // No cartão: entrada é pagamento da fatura (já contado na conta) ou estorno (desconta do gasto).
    if (tx.v > 0 && (FATURA.test(t) || /credit card payment/i.test(cp))) return 'fatura';
    return 'despesa';
  }
  if (tx.mesmaPessoa || /^same person/i.test(cp) || CAIXINHA.test(t)) return 'interna';
  if (/credit card payment/i.test(cp) || FATURA.test(t)) return 'fatura';
  if (/proceeds|dividend/i.test(cp) || / rendimento/.test(t)) return 'receita';
  if (/^(investments|automatic investment|fixed income|mutual funds|variable income|margin|pension)/i.test(cp) || INVEST.test(t)) return 'investimento';
  return tx.v >= 0 ? 'receita' : 'despesa';
}

export interface Classificada extends TxBanco { nat: Natureza; cat: string; auto: boolean }

export interface Contexto {
  contas: ContaBanco[];
  ajustes: Record<string, AjusteTx>;
  regras: RegraBanco[];
}

/**
 * Classifica todas as transações. Além das regras por transação, junta pares: o mesmo valor saindo
 * de uma conta sua e entrando em outra conta sua em até 3 dias é transferência interna; o pagamento
 * da fatura na conta casa com o crédito no cartão.
 */
export function classificar(txs: TxBanco[], ctx: Contexto): Classificada[] {
  const tipo = new Map(ctx.contas.map(c => [c.id, c.tipo]));
  const regras = ctx.regras.map(r => ({ ...r, t: ` ${r.termo} ` }));
  const out: Classificada[] = txs.map(tx => {
    const cartao = tipo.get(tx.conta) === 'cartao';
    let nat = naturezaAuto(tx, cartao);
    let cat: string | null = null;
    let auto = true;
    const t = norm(tx.desc);
    for (const r of regras) if (t.includes(r.t)) { if (r.nat) nat = r.nat; if (r.cat) cat = r.cat; auto = false; }
    const a = ctx.ajustes[tx.chave];
    if (a?.nat) { nat = a.nat; auto = false; }
    if (a?.cat) { cat = a.cat; auto = false; }
    cat ||= categoriaPluggy(tx.catP) || categoriaPorPalavras(tx.desc) || (tx.v > 0 ? 'Outras receitas' : 'Outros');
    // Receita com categoria de gasto (ex.: estorno de compra na conta) vira desconto no gasto.
    return { ...tx, nat, cat, auto };
  });

  // Pares entre contas diferentes (ex.: Pix da sua conta do banco A para a do banco B).
  const livres = out.filter(x => x.auto && (x.nat === 'receita' || x.nat === 'despesa') && tipo.get(x.conta) !== 'cartao');
  const usados = new Set<Classificada>();
  const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  for (const e of livres) {
    if (e.v <= 0 || usados.has(e)) continue;
    const s = livres.find(x => !usados.has(x) && x.v < 0 && x.conta !== e.conta && Math.abs(x.v + e.v) < 0.005 && dias(x.d, e.d) <= 3);
    if (s) { e.nat = 'interna'; s.nat = 'interna'; usados.add(e); usados.add(s); }
  }
  // Pagamento da fatura: débito na conta com o mesmo valor do crédito no cartão, em até 5 dias.
  const creditosCartao = out.filter(x => tipo.get(x.conta) === 'cartao' && x.v > 0 && x.nat !== 'fatura' && x.auto);
  for (const c of creditosCartao) {
    const p = out.find(x => x.auto && tipo.get(x.conta) !== 'cartao' && x.v < 0 && Math.abs(x.v + c.v) < 0.005 && dias(x.d, c.d) <= 5 && !usados.has(x));
    if (p) { p.nat = 'fatura'; c.nat = 'fatura'; usados.add(p); usados.add(c); }
  }
  return out;
}

export interface ResumoMes {
  receitas: number;
  despesas: number;      // já descontados os estornos
  sobra: number;
  investido: number;     // líquido aplicado (negativo = resgatou mais do que aplicou)
  internasEntrada: number; // "entradas" que eram só dinheiro seu (caixinha, outra conta, resgate, fatura)
  porCategoria: { cat: string; v: number; n: number }[];
  receitasPorCategoria: { cat: string; v: number; n: number }[];
}

export function resumoMes(cls: Classificada[], mes: string): ResumoMes {
  let receitas = 0, despesas = 0, investido = 0, internasEntrada = 0;
  const gastos = new Map<string, { v: number; n: number }>(), ganhos = new Map<string, { v: number; n: number }>();
  for (const x of cls) {
    if (x.d.slice(0, 7) !== mes) continue;
    if (x.nat === 'receita') {
      receitas += x.v;
      const g = ganhos.get(x.cat) || { v: 0, n: 0 }; g.v += x.v; g.n++; ganhos.set(x.cat, g);
    } else if (x.nat === 'despesa') {
      despesas -= x.v;
      const g = gastos.get(x.cat) || { v: 0, n: 0 }; g.v -= x.v; g.n++; gastos.set(x.cat, g);
    } else {
      if (x.nat === 'investimento') investido -= x.v;
      if (x.v > 0 && x.nat !== 'fatura') internasEntrada += x.v;
    }
  }
  const lista = (m: Map<string, { v: number; n: number }>) =>
    [...m].map(([cat, g]) => ({ cat, v: g.v, n: g.n })).filter(g => g.v > 0.005).sort((a, b) => b.v - a.v);
  return { receitas, despesas, sobra: receitas - despesas, investido, internasEntrada, porCategoria: lista(gastos), receitasPorCategoria: lista(ganhos) };
}

/** Receitas e despesas dos últimos `n` meses até `mes` (inclusive). */
export function serieMeses(cls: Classificada[], mes: string, n = 12): { mes: string; receitas: number; despesas: number }[] {
  const meses: string[] = [];
  let [y, m] = mes.split('-').map(Number);
  for (let i = 0; i < n; i++) { meses.unshift(`${y}-${String(m).padStart(2, '0')}`); if (--m === 0) { m = 12; y--; } }
  const idx = new Map(meses.map((k, i) => [k, i]));
  const out = meses.map(k => ({ mes: k, receitas: 0, despesas: 0 }));
  for (const x of cls) {
    const i = idx.get(x.d.slice(0, 7));
    if (i == null) continue;
    if (x.nat === 'receita') out[i].receitas += x.v;
    else if (x.nat === 'despesa') out[i].despesas -= x.v;
  }
  return out;
}
