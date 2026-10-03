import { hist, state } from '../app';
import { esc, fmtD, fmtQuando } from './fmt';
import { biometriaDisponivel, lerConfig } from '../seguranca/bloqueio';

export async function renderAjustes(el: HTMLElement) {
  const c = state.cfg;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const usado = est?.usage != null ? `${(est.usage / 1024 / 1024).toFixed(1).replace('.', ',')} MB usados neste aparelho.` : '';
  const m = hist.meta;
  const blq = lerConfig();
  const bioOk = await biometriaDisponivel();
  const tempos: [number, string][] = [[0, 'Sempre que sair do app'], [60, 'Depois de 1 minuto fora'], [300, 'Depois de 5 minutos fora'], [1800, 'Depois de 30 minutos fora']];
  el.innerHTML = `
  <div class="panel">
    <div class="sub">Tudo o que você lança fica só neste aparelho. Para buscar cotações, o app envia apenas os códigos dos ativos (ex.: PETR4), nunca quantidades ou valores.</div>
  </div>

  <div class="panel">
    <h2>Segurança</h2>
    ${blq?.ativo ? `
      <div class="ok">Bloqueio ativo: o app pede ${blq.cred ? 'sua digital/rosto ou o PIN' : 'o PIN'} para abrir.</div>
      <div class="field"><label for="segTempo">Pedir de novo</label><select id="segTempo">${tempos.map(([v, n]) => `<option value="${v}" ${blq.tempo === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${blq.cred ? '<div class="row"><span class="sub">Digital/rosto cadastrado.</span><button type="button" class="btn small" id="btnSegBioRem">Remover digital</button></div>'
        : bioOk ? '<div class="row"><button type="button" class="btn primary small" id="btnSegBio">Usar digital ou rosto</button></div>'
        : '<div class="note">Este aparelho/navegador não oferece desbloqueio por digital para o app. O PIN continua valendo.</div>'}
      <details class="como"><summary>Trocar ou desativar o PIN</summary>
        <div class="form" style="margin-top:8px">
          <div class="field"><label for="segPinAtual">PIN atual</label><input id="segPinAtual" type="password" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label for="segPinNovo">Novo PIN</label><input id="segPinNovo" type="password" inputmode="numeric" autocomplete="off"></div>
          <div class="row full"><button type="button" class="btn small" id="btnSegTrocar">Trocar PIN</button><button type="button" class="btn small danger" id="btnSegDesativar">Desativar bloqueio</button></div>
        </div></details>`
    : `
      <div class="sub">Peça um PIN (e, se quiser, sua digital ou rosto) para abrir o app.</div>
      <div class="form">
        <div class="field"><label for="segPin1">Crie um PIN (4 a 12 números)</label><input id="segPin1" type="password" inputmode="numeric" autocomplete="off"></div>
        <div class="field"><label for="segPin2">Repita o PIN</label><input id="segPin2" type="password" inputmode="numeric" autocomplete="off"></div>
        <div class="row full"><button type="button" class="btn primary small" id="btnSegAtivar">Ativar bloqueio</button></div>
      </div>`}
    <div class="note">O bloqueio impede que outra pessoa abra o app no seu celular. Os dados continuam guardados só no aparelho, como antes; se esquecer o PIN, a saída é apagar os dados e restaurar um backup.</div>
    <div class="err" id="segErr" hidden></div>
  </div>

  <div class="panel">
    <h2>Fontes de cotação</h2>
    <form id="cfgForm" autocomplete="off">
      <div class="field full"><label for="cBrapi">Token da brapi.dev (ações, FIIs, ETFs)</label>
        <input id="cBrapi" type="password" value="${esc(c.brapiToken || '')}" placeholder="cole aqui o token" autocomplete="off" spellcheck="false"></div>
      <div class="field full"><label for="cCg">Chave Demo da CoinGecko (cripto)</label>
        <input id="cCg" type="password" value="${esc(c.cgKey || '')}" placeholder="opcional" autocomplete="off" spellcheck="false"></div>
      <div class="row full">
        <button class="btn primary" type="submit">Salvar</button>
        <button class="btn" type="button" id="btnShowKeys">Mostrar</button>
      </div>
      <div class="note full">Sem token da brapi, ações e FIIs usam o fechamento do último pregão (publicado pela B3 todas as noites). Cripto atualiza sempre que você abre o app ou entra numa cripto. Ações e FIIs atualizam do mesmo jeito, mas só com o pregão aberto (10h às 18h, dias úteis) e no máximo a cada 15 minutos por ativo; perto do fim das 15.000 consultas grátis do mês, só pelo botão Atualizar. Tesouro Direto atualiza uma vez por dia. O token não entra no backup.</div>
    </form>
  </div>

  <div class="panel">
    <h2>Filtros de período salvos</h2>
    <div class="sub">Aparecem como opção rápida em todas as telas com filtro de período (Rendimento, Evolução, classes, ativos e proventos).</div>
    ${state.filtros.map(f => linhaFiltro(f.id, f.nome, f.ini, f.fim)).join('')}
    <h3 class="sub-h">Novo filtro</h3>
    ${linhaFiltro('novo', '', '', '')}
  </div>

  <div class="panel">
    <h2>Aparência</h2>
    <div class="field"><label for="cTema">Tema</label>
      <select id="cTema">
        <option value="auto" ${!c.tema || c.tema === 'auto' ? 'selected' : ''}>Igual ao celular</option>
        <option value="claro" ${c.tema === 'claro' ? 'selected' : ''}>Claro</option>
        <option value="escuro" ${c.tema === 'escuro' ? 'selected' : ''}>Escuro</option>
      </select></div>
  </div>

  <div class="panel">
    <h2>Backup</h2>
    <div class="sub">Seus dados existem só aqui. Exporte um backup de vez em quando e guarde no Google Drive, por exemplo.</div>
    <div class="row">
      <button class="btn primary" type="button" id="btnExport">Exportar backup</button>
      <label class="btn" for="fileBackup">Restaurar backup<input type="file" id="fileBackup" accept=".json,application/json"></label>
    </div>
    <div class="sub" id="backupMsg" hidden></div>
  </div>

  <div class="panel">
    <h2>Armazenamento</h2>
    <div class="sub">${state.persist ? 'Armazenamento persistente ativo: o navegador não apaga seus dados para liberar espaço.' : 'O navegador ainda não garantiu armazenamento persistente. Instalar o app na tela inicial costuma resolver; mesmo assim, mantenha backups.'} ${usado}</div>
    ${m ? `<div class="note">Versão ${__VERSAO__} · histórico público gerado em ${fmtQuando(m.geradoEm)}${m.b3?.ultimo ? ` · B3 até ${fmtD(m.b3.ultimo)}` : ''}${m.tesouroUltimo ? ` · Tesouro até ${fmtD(m.tesouroUltimo)}` : ''}.</div>` : ''}
    <div class="row"><button class="btn danger" type="button" id="btnWipe">Apagar todos os dados</button></div>
  </div>`;
}

function linhaFiltro(id: string, nome: string, ini: string, fim: string) {
  const a = (campo: string) => `data-filtro-campo="${campo}" data-filtro-id="${esc(id)}"`;
  return `<div class="form filtro-linha">
    <div class="field full"><label>Nome</label><input ${a('nome')} value="${esc(nome)}" placeholder="ex.: Desde que mudei de corretora"></div>
    <div class="field"><label>De</label><input type="month" ${a('ini')} value="${esc(ini)}"></div>
    <div class="field"><label>Até</label><input type="month" ${a('fim')} value="${esc(fim)}"></div>
    <div class="row full">
      <button type="button" class="btn small primary" data-filtro-salvar="${esc(id)}">${id === 'novo' ? 'Criar filtro' : 'Salvar'}</button>
      ${id === 'novo' ? '' : `<button type="button" class="btn small danger" data-filtro-excluir="${esc(id)}">Excluir</button>`}
    </div></div>`;
}
