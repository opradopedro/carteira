// Preço do dia no site do Tesouro Direto (lista pública de títulos; o pedido não leva nada da carteira).
// O CSV oficial do Tesouro Transparente só traz o dia útil anterior, então esta é a fonte do preço de hoje.

export interface TituloTD {
  treasuryBondName: string;
  maturityDate: string;            // "2031-03-01T00:00"
  unitaryRedemptionValue?: number; // preço de venda (o que você recebe ao vender)
  unitaryInvestmentValue?: number; // preço de compra
  lastMarketPricingDate?: string;
}

/** Mesma chave usada nos arquivos públicos: "TESOURO IPCA+ 2035", "TESOURO RENDA+ APOSENTADORIA EXTRA 2049"... */
export const chaveTesouro = (nome: string) =>
  nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Renda+ e Educa+ levam no nome o ano de início dos pagamentos, não o do vencimento. */
export function anoNoNome(tipo: string, anoVenc: number) {
  const t = chaveTesouro(tipo);
  if (t.startsWith('TESOURO RENDA+')) return anoVenc - 19;
  if (t.startsWith('TESOURO EDUCA+')) return anoVenc - 4;
  return anoVenc;
}

/**
 * Junta as listas do Tesouro Direto (para investir e para resgatar) em preço por título.
 * Usa o preço de venda (o que a carteira valeria se vendesse); se não houver, o de compra.
 */
export function precosTD(listas: unknown[], conhecidos?: Set<string>): Record<string, { p: number; ref: string }> {
  const out: Record<string, { p: number; ref: string }> = {};
  for (const lista of listas) {
    if (!lista || typeof lista !== 'object') continue;
    for (const grupo of Object.values(lista as Record<string, unknown>)) {
      if (!Array.isArray(grupo)) continue;
      for (const t of grupo as TituloTD[]) {
        if (!t || typeof t.treasuryBondName !== 'string') continue;
        const p = (t.unitaryRedemptionValue ?? 0) > 0 ? t.unitaryRedemptionValue! : (t.unitaryInvestmentValue ?? 0);
        if (!(p > 0)) continue;
        let k = chaveTesouro(t.treasuryBondName);
        const venc = parseInt(String(t.maturityDate).slice(0, 4), 10);
        if (conhecidos && !conhecidos.has(k) && venc) {
          const tipo = t.treasuryBondName.replace(/\s+\d{4}\s*$/, '');
          const alt = chaveTesouro(`${tipo} ${anoNoNome(tipo, venc)}`);
          if (conhecidos.has(alt)) k = alt;
        }
        const ref = String(t.lastMarketPricingDate || '').slice(0, 10);
        const atual = out[k];
        // O resgate tem prioridade sobre o investimento para o mesmo título.
        if (!atual || ((t.unitaryRedemptionValue ?? 0) > 0 && ref >= atual.ref)) out[k] = { p, ref };
      }
    }
  }
  return out;
}
