import { describe, expect, it } from 'vitest';
import { deveBuscar, feriadosB3, mercadoAberto, RESERVA_BRAPI } from '../src/core/mercado';
import type { Cotacao } from '../src/core/types';

// Horários em Brasília (UTC-3).
const sp = (s: string) => new Date(s + '-03:00');
const live = (em: Date, fonte: Cotacao['fonte'] = 'brapi'): Cotacao => ({ p: 10, em: em.toISOString(), fonte });

describe('pregão da B3', () => {
  it('abre das 10h às 18h em dias úteis', () => {
    expect(mercadoAberto(sp('2026-10-02T09:59'))).toBe(false); // sexta
    expect(mercadoAberto(sp('2026-10-02T10:00'))).toBe(true);
    expect(mercadoAberto(sp('2026-10-02T17:59'))).toBe(true);
    expect(mercadoAberto(sp('2026-10-02T18:00'))).toBe(false);
    expect(mercadoAberto(sp('2026-10-03T12:00'))).toBe(false); // sábado
    expect(mercadoAberto(sp('2026-10-04T12:00'))).toBe(false); // domingo
  });
  it('não abre em feriados, Carnaval e Sexta-feira Santa', () => {
    expect(feriadosB3(2026)).toContain('2026-02-16'); // Carnaval (segunda)
    expect(feriadosB3(2026)).toContain('2026-02-17');
    expect(feriadosB3(2026)).toContain('2026-04-03'); // Sexta-feira Santa
    expect(feriadosB3(2026)).toContain('2026-06-04'); // Corpus Christi
    expect(mercadoAberto(sp('2026-10-12T12:00'))).toBe(false);
    expect(mercadoAberto(sp('2026-11-20T12:00'))).toBe(false);
  });
});

describe('quando buscar cotação ao vivo', () => {
  const aberto = sp('2026-10-02T11:00'), madrugada = sp('2026-10-02T03:00');
  it('ações: só com o pregão aberto e no máximo a cada 15 min', () => {
    expect(deveBuscar('b3', undefined, 'abrir', madrugada)).toBe(false);
    expect(deveBuscar('b3', undefined, 'abrir', aberto)).toBe(true);
    expect(deveBuscar('b3', live(sp('2026-10-02T10:50')), 'abrir', aberto)).toBe(false);
    expect(deveBuscar('b3', live(sp('2026-10-02T10:40')), 'pagina', aberto)).toBe(true);
    expect(deveBuscar('b3', live(sp('2026-10-01T17:00'), 'b3'), 'abrir', aberto)).toBe(true);
  });
  it('ações: perto do fim do plano grátis, só pelo botão', () => {
    expect(deveBuscar('b3', undefined, 'abrir', aberto, RESERVA_BRAPI)).toBe(false);
    expect(deveBuscar('b3', undefined, 'botao', madrugada, RESERVA_BRAPI)).toBe(true);
  });
  it('cripto: a qualquer hora, no máximo 1x por minuto', () => {
    expect(deveBuscar('cripto', live(sp('2026-10-02T02:58'), 'coingecko'), 'abrir', madrugada)).toBe(true);
    expect(deveBuscar('cripto', live(sp('2026-10-02T02:59:30'), 'coingecko'), 'abrir', madrugada)).toBe(false);
  });
  it('preço manual nunca é trocado; "novos" só busca quem não tem cotação de hoje', () => {
    expect(deveBuscar('b3', live(aberto, 'manual'), 'botao', aberto)).toBe(false);
    expect(deveBuscar('b3', live(sp('2026-10-02T08:00')), 'novos', madrugada)).toBe(false);
    expect(deveBuscar('b3', live(sp('2026-10-01T15:00')), 'novos', madrugada)).toBe(true);
  });
});
