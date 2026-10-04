// Janela para puxar os dados de um backup: mostra o que tem no arquivo e deixa escolher
// entre juntar com a carteira atual (sem duplicar) ou substituir tudo.
import * as app from '../app';
import { state } from '../app';
import { parseBackup, resumoBackup, type Backup } from '../data/backup';
import { esc, fmtD, fmtQuando, toast } from './fmt';

export async function puxarDeArquivo(f: File) {
  let b: Backup;
  try { b = parseBackup(await f.text()); }
  catch (err) { abrir(`<h2>Não deu para ler</h2><div class="sub">${esc((err as Error).message || 'Arquivo inválido.')}</div>
    <div class="row"><button type="button" class="btn primary" data-dlg="fechar">Ok</button></div>`); return; }

  const r = resumoBackup(b, state.lancs);
  const x = b.extras ?? {};
  const tambem = [
    x.filtros?.length ? `${x.filtros.length} filtro(s) salvo(s)` : '',
    x.aReceber?.itens.length ? 'proventos a receber' : '',
    Object.keys(b.precosManuais).length ? `${Object.keys(b.precosManuais).length} preço(s) manual(is)` : '',
    x.tema ? 'tema' : '',
  ].filter(Boolean);
  const temAtual = state.lancs.length > 0;
  const dlg = abrir(`
    <h2>Puxar dados de um backup</h2>
    <div class="sub">${b.exportadoEm ? 'Backup feito em ' + fmtQuando(b.exportadoEm) : 'Backup sem data'}</div>
    <div class="stats adapt">
      <div><span class="label">Lançamentos</span><b>${r.lancs}</b></div>
      <div><span class="label">Ativos</span><b>${r.ativos}</b></div>
      <div><span class="label">Período</span><b>${r.de ? fmtD(r.de).slice(3) + ' a ' + fmtD(r.ate).slice(3) : '—'}</b></div>
    </div>
    ${tambem.length ? `<div class="note">Também vem: ${tambem.join(', ')}. Tokens das cotações não vão no backup.</div>` : '<div class="note">Tokens das cotações não vão no backup.</div>'}
    ${temAtual ? `<div class="note">Na carteira atual há ${state.lancs.length} lançamentos. ${r.novos ? `<b>${r.novos}</b> do backup ainda não ${r.novos === 1 ? 'está' : 'estão'} aqui.` : 'Tudo o que está no backup já está aqui.'}</div>` : ''}
    <div class="dlg-acoes">
      ${temAtual
        ? `<button type="button" class="btn primary" data-dlg="juntar"${r.novos ? '' : ' disabled'}>Juntar com a carteira atual${r.novos ? ` (+${r.novos})` : ''}</button>
           <button type="button" class="btn" data-dlg="substituir">Substituir tudo pelo backup</button>`
        : `<button type="button" class="btn primary" data-dlg="substituir">Restaurar</button>`}
      <button type="button" class="btn" data-dlg="fechar">Cancelar</button>
    </div>
    ${temAtual ? '<div class="note">Juntar acrescenta só o que falta, sem duplicar. Substituir apaga a carteira atual deste aparelho e deixa igual à do backup.</div>' : ''}`);

  dlg.addEventListener('click', async e => {
    const bt = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-dlg]');
    if (!bt || bt.dataset.dlg === 'fechar') return;
    const modo = bt.dataset.dlg as 'juntar' | 'substituir';
    if (modo === 'substituir' && temAtual && !bt.dataset.armed) {
      bt.dataset.armed = '1'; bt.classList.add('danger');
      bt.textContent = `Toque de novo: apagar os ${state.lancs.length} lançamentos atuais`;
      return;
    }
    dlg.querySelectorAll('button').forEach(b => (b.disabled = true));
    try {
      const res = await app.puxarBackup(b, modo);
      dlg.close();
      toast(modo === 'juntar'
        ? `${res.added} ${res.added === 1 ? 'lançamento trazido' : 'lançamentos trazidos'}${res.dup ? `; ${res.dup} já ${res.dup === 1 ? 'estava' : 'estavam'} aqui` : ''}`
        : `Backup restaurado: ${res.added} lançamentos`);
      if (navigator.onLine) app.refresh('novos');
    } catch {
      dlg.close();
      toast('Não consegui puxar os dados. Tente de novo.');
    }
  });
}

function abrir(html: string): HTMLDialogElement {
  document.getElementById('dlgBackup')?.remove();
  const d = document.createElement('dialog');
  d.id = 'dlgBackup'; d.className = 'dlg';
  d.innerHTML = html;
  d.addEventListener('click', e => {
    if (e.target === d || (e.target as HTMLElement).closest('[data-dlg="fechar"]')) d.close();
  });
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  d.showModal();
  return d;
}
