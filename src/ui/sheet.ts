// Painel que sobe de baixo com os detalhes de um ponto do gráfico.
let onClose: (() => void) | null = null;

function el(): HTMLElement {
  let s = document.getElementById('sheet');
  if (!s) {
    s = document.createElement('div');
    s.id = 'sheet';
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-live', 'polite');
    s.innerHTML = '<div class="sheet-grip"></div><button type="button" class="sheet-x" aria-label="Fechar">×</button><div class="sheet-body"></div>';
    document.body.appendChild(s);
    s.querySelector('.sheet-x')!.addEventListener('click', hideSheet);
    // Toque fora de gráficos e do painel fecha.
    // (usa o caminho do evento: o gráfico redesenha o SVG e o alvo original sai do documento)
    document.addEventListener('pointerdown', e => {
      const dentro = e.composedPath().some(n => n instanceof HTMLElement && (n.id === 'sheet' || n.classList.contains('ichart')));
      if (s!.classList.contains('open') && !dentro) hideSheet();
    });
  }
  return s;
}

export function showSheet(html: string, close?: () => void) {
  const s = el();
  if (onClose && onClose !== close) onClose();
  onClose = close ?? null;
  s.querySelector('.sheet-body')!.innerHTML = html;
  s.classList.add('open');
}

export function hideSheet() {
  const s = document.getElementById('sheet');
  if (!s || !s.classList.contains('open')) return;
  s.classList.remove('open');
  const c = onClose; onClose = null;
  c?.();
}
