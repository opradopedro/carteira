import { listaPendencias, state } from '../app';
import type { Pendencia } from '../core/pendencias';
import { $, brl, esc, fmtD, fmtQ } from './fmt';

function card(p: Pendencia): string {
  const ignorar = `<button type="button" class="btn small" data-ignorar="${esc(p.id)}">Ignorar</button>`;
  switch (p.tipo) {
    case 'vencimento': {
      const l = p.lanc!;
      return `<div class="panel">
        <h2>${esc(p.a)}: quanto você recebeu?</h2>
        <div class="sub">Venceu em ${fmtD(l.d)} (${fmtQ(l.q)} unidades, aplicado ${brl.format(p.custo || 0)}). A B3 não informa o valor do resgate de CDB/LCI/LCA, então o rendimento aparece como zero. Veja no extrato da corretora quanto caiu na conta nesse dia.</div>
        <div class="form">
          <div class="field full"><label for="venc-${esc(l.id)}">Valor recebido no vencimento (R$)</label>
            <input id="venc-${esc(l.id)}" inputmode="decimal" placeholder="${brl.format(p.custo || 0).replace('R$', '').trim()}"></div>
        </div>
        <div class="row"><button type="button" class="btn primary small" data-venc="${esc(l.id)}">Salvar</button>${ignorar}</div>
      </div>`;
    }
    case 'vendida':
      return `<div class="panel">
        <h2>${esc(p.a)}: posição vendida</h2>
        <div class="sub">Pelos lançamentos, você vendeu ${fmtQ(-(p.q || 0))} a mais do que tinha (venda a descoberto, que vira aluguel). Se já recomprou, importe a planilha de Negociação mais recente; se o lançamento está errado, corrija em Lançamentos.</div>
        <div class="row"><button type="button" class="btn small" data-filtrar="${esc(p.a)}">Ver lançamentos</button>${ignorar}</div>
      </div>`;
    case 'semCotacao':
      return `<div class="panel">
        <h2>${esc(p.a)}: sem cotação</h2>
        <div class="sub">Nenhuma fonte tem preço para esse ativo, então ele aparece pelo valor investido. Informe um preço manual em Ativos.</div>
        <div class="row"><button type="button" class="btn small" data-page="ativo:${esc(p.a)}" data-x="${esc(p.a)}">Informar preço</button>${ignorar}</div>
      </div>`;
    case 'token':
      return `<div class="panel">
        <h2>Cotações de ações e FIIs atrasadas</h2>
        <div class="sub">Sem o token da brapi, ações e FIIs usam o fechamento do pregão anterior.</div>
        <div class="row"><button type="button" class="btn small" data-page="ajustes">Abrir Ajustes</button>${ignorar}</div>
      </div>`;
    case 'backup':
      return `<div class="panel">
        <h2>Faça um backup</h2>
        <div class="sub">${state.ultimoBackup ? 'O último backup tem mais de 30 dias.' : 'Você ainda não exportou nenhum backup.'} Seus dados existem só neste aparelho.</div>
        <div class="row"><button type="button" class="btn primary small" id="btnExport">Exportar backup</button></div>
      </div>`;
  }
}

export function renderPendencias(el: HTMLElement) {
  const ps = listaPendencias();
  el.innerHTML = `<div class="panel">
      <div class="sub">${ps.length ? 'Coisas que o app não consegue resolver sozinho.' : 'Tudo em dia.'}</div>
    </div>` + ps.map(card).join('') +
    (state.pendIgnoradas.length ? `<div class="row"><button type="button" class="btn small" id="btnReverIgnoradas">Mostrar ${state.pendIgnoradas.length} ignorada(s) de novo</button></div>` : '');
}

/** Contador no botão do topo e aviso no Resumo. */
export function renderBadge() {
  const n = listaPendencias().length;
  const b = $('#pendCount');
  b.textContent = String(n);
  b.hidden = n === 0;
  $('#btnPend').setAttribute('aria-label', n ? `Pendências: ${n}` : 'Pendências');
  $('#pendSub').textContent = n ? `${n} ${n === 1 ? 'item precisa' : 'itens precisam'} de você` : 'Tudo em dia';
  const m = $('#menuCount');
  m.textContent = String(n);
  m.hidden = n === 0;
  $('#btnMenu').setAttribute('aria-label', n ? `Menu (${n} pendências)` : 'Menu');
}
