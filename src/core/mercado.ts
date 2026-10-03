// Quando vale a pena buscar cotação ao vivo, para poupar os limites gratuitos das APIs.
import type { Cotacao } from './types';

/** Pregão regular da B3 (horário de Brasília). Cobre o horário de inverno e o de verão americano. */
export const PREGAO = { abre: 10 * 60, fecha: 18 * 60 };
/** Intervalo mínimo entre buscas automáticas do mesmo ativo. */
export const INTERVALO_B3 = 15 * 60_000;   // a brapi gratuita já entrega o preço com atraso
export const INTERVALO_CRIPTO = 60_000;    // o CoinGecko atualiza mais ou menos a cada minuto
/** Plano gratuito da brapi: 15.000 requisições por mês. Acima disto, só pelo botão Atualizar. */
export const LIMITE_BRAPI = 15_000;
export const RESERVA_BRAPI = 13_000;

/** Data e minuto do dia em Brasília. */
export function agoraSP(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), semana: p.weekday as string };
}

function pascoa(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia));
}
const desloca = (d: Date, dias: number) => new Date(d.getTime() + dias * 864e5).toISOString().slice(0, 10);

/** Dias sem pregão na B3 (feriados nacionais, Carnaval, Corpus Christi, 24 e 31/12). */
export function feriadosB3(y: number): Set<string> {
  const p = pascoa(y);
  return new Set([
    ...['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-24', '12-25', '12-31'].map(md => `${y}-${md}`),
    desloca(p, -48), desloca(p, -47), desloca(p, -2), desloca(p, 60),
  ]);
}

export function mercadoAberto(now: Date): boolean {
  const { data, min, semana } = agoraSP(now);
  if (semana === 'Sat' || semana === 'Sun') return false;
  if (feriadosB3(Number(data.slice(0, 4))).has(data)) return false;
  return min >= PREGAO.abre && min < PREGAO.fecha;
}

export type Motivo = 'abrir' | 'pagina' | 'botao' | 'novos';

/**
 * Decide se um ativo vai à internet agora.
 * - botão Atualizar: sempre;
 * - 'novos' (depois de importar/lançar): só quem ainda não tem cotação ao vivo de hoje;
 * - ao abrir o app ou entrar no ativo/classe: cripto sempre (no máximo 1x por minuto);
 *   ações e FIIs só com o pregão aberto (no máximo 1x a cada 15 min por ativo).
 */
export function deveBuscar(tipo: 'b3' | 'cripto', px: Cotacao | undefined, motivo: Motivo, now: Date, usoBrapi = 0): boolean {
  if (px?.fonte === 'manual') return false;
  if (motivo === 'botao') return true;
  const aoVivo = px && (px.fonte === 'brapi' || px.fonte === 'coingecko');
  const idade = aoVivo ? now.getTime() - Date.parse(px.em) : Infinity;
  if (motivo === 'novos') return !aoVivo || agoraSP(new Date(px.em)).data !== agoraSP(now).data;
  if (tipo === 'cripto') return idade >= INTERVALO_CRIPTO;
  return mercadoAberto(now) && idade >= INTERVALO_B3 && usoBrapi < RESERVA_BRAPI;
}
