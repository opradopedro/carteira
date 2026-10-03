// Menu lateral (Atualizar, Pendências, Ajustes). Abrir o menu cria uma entrada no histórico,
// então o botão voltar do celular fecha o menu em vez de sair da tela.
import { nav } from './nav';
import { hideSheet } from './sheet';

let aberto = false;
let depois: (() => void) | null = null;

const el = () => document.getElementById('menu')!;

function mostrar(sim: boolean) {
  el().classList.toggle('open', sim);
  el().setAttribute('aria-hidden', String(!sim));
  document.getElementById('menuFundo')!.classList.toggle('open', sim);
  document.getElementById('btnMenu')?.setAttribute('aria-expanded', String(sim));
  document.body.classList.toggle('menu-aberto', sim);
}

export const menuAberto = () => aberto;

export function abrirMenu() {
  if (aberto) return;
  hideSheet();
  aberto = true;
  history.pushState({ depth: nav.stack.length, menu: 1 }, '');
  mostrar(true);
  requestAnimationFrame(() => el().querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true }));
}

/** Fecha o menu e, depois que o histórico voltar, executa `acao` (ex.: abrir uma página). */
export function fecharMenu(acao?: () => void) {
  if (!aberto) { acao?.(); return; }
  depois = acao ?? null;
  history.back();
}

window.addEventListener('popstate', () => {
  if (!aberto) return;
  aberto = false;
  mostrar(false);
  const a = depois; depois = null;
  if (a) setTimeout(a, 0);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && aberto) fecharMenu(); });
