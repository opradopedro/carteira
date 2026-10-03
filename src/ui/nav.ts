// Navegação: abas de baixo + pilha de páginas de detalhe.
// Cada página aberta vira uma entrada no histórico do navegador, então o botão "voltar"
// do celular e a seta do topo voltam exatamente para onde você estava (inclusive a rolagem).
import type { Classe } from '../core/types';
import { hideSheet } from './sheet';

export type Tab = 'resumo' | 'ativos' | 'proventos' | 'lancamentos';
export type Page =
  | { k: 'resumo' } | { k: 'rent' } | { k: 'evo' } | { k: 'pend' } | { k: 'ajustes' }
  | { k: 'classe'; c: Classe } | { k: 'ativo'; a: string } | { k: 'prov'; a?: string; c?: Classe } | { k: 'lanc'; id: string };

export const TABS: Tab[] = ['resumo', 'ativos', 'proventos', 'lancamentos'];

export const nav = {
  tab: 'resumo' as Tab,
  stack: [] as Page[],
  scrolls: [] as number[],          // rolagem da tela de baixo de cada página aberta
  tabScroll: {} as Partial<Record<Tab, number>>,
};

let renderView: () => void = () => {};
let pendingTab: Tab | null = null;
export const setRenderView = (fn: () => void) => { renderView = fn; };

export const currentPage = (): Page | null => nav.stack.at(-1) ?? null;

/** "classe:acao", "ativo:PETR4", "prov:a:PETR4", "prov:c:fii", "rent"… */
export function parsePage(s: string): Page | null {
  const [k, a, b] = s.split(':');
  switch (k) {
    case 'resumo': case 'rent': case 'evo': case 'pend': case 'ajustes': return { k };
    case 'classe': return { k, c: a as Classe };
    case 'ativo': return { k, a: s.slice(6) };
    case 'lanc': return { k, id: s.slice(5) };
    case 'prov': return a === 'a' ? { k, a: s.slice(7) } : a === 'c' ? { k, c: b as Classe } : { k };
  }
  return null;
}

function animate(kind: 'in' | 'back' | 'fade') {
  const el = nav.stack.length ? document.getElementById('page') : document.getElementById('tab-' + nav.tab);
  if (!el) return;
  el.classList.remove('anim-in', 'anim-back', 'anim-fade');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('anim-' + kind);
}

function restoreScroll(y: number) {
  // Espera o conteúdo ser desenhado para conseguir rolar até a posição antiga.
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
}

export function openPage(p: Page) {
  hideSheet();
  nav.scrolls.push(window.scrollY);
  nav.stack.push(p);
  history.pushState({ depth: nav.stack.length }, '');
  renderView();
  window.scrollTo(0, 0);
  animate('in');
}

export function back() {
  if (nav.stack.length) history.back();
}

export function setTab(t: Tab) {
  hideSheet();
  if (nav.stack.length) { pendingTab = t; history.go(-nav.stack.length); return; }
  if (t === nav.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  nav.tabScroll[nav.tab] = window.scrollY;
  nav.tab = t;
  try { history.replaceState({ depth: 0 }, '', '#' + t); } catch { /* ignora */ }
  renderView();
  restoreScroll(nav.tabScroll[t] ?? 0);
  animate('fade');
}

window.addEventListener('popstate', e => {
  hideSheet();
  const depth = (e.state as { depth?: number } | null)?.depth ?? 0;
  let y: number | undefined;
  let popped = false;
  while (nav.stack.length > depth) { nav.stack.pop(); y = nav.scrolls.pop(); popped = true; }
  if (!popped) return;
  if (pendingTab && !nav.stack.length) {
    const t = pendingTab; pendingTab = null;
    if (t !== nav.tab) { nav.tabScroll[nav.tab] = y ?? 0; nav.tab = t; y = nav.tabScroll[t] ?? 0; }
    try { history.replaceState({ depth: 0 }, '', '#' + t); } catch { /* ignora */ }
    renderView(); restoreScroll(y ?? 0); animate('fade');
    return;
  }
  renderView();
  restoreScroll(y ?? 0);
  animate('back');
});

export function initNav(hashTab: string) {
  if ((TABS as string[]).includes(hashTab)) nav.tab = hashTab as Tab;
  try { history.replaceState({ depth: 0 }, '', '#' + nav.tab); } catch { /* ignora */ }
}
