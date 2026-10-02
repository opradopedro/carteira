import { hist, state } from '../app';
import { $, esc, fmtD, fmtQuando } from './fmt';

export async function renderAjustes() {
  const el = $('#tab-ajustes');
  const c = state.cfg;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const usado = est?.usage != null ? `${(est.usage / 1024 / 1024).toFixed(1).replace('.', ',')} MB usados neste aparelho.` : '';
  const m = hist.meta;
  el.innerHTML = `
  <div class="panel">
    <div class="row" style="justify-content:space-between"><h2>Ajustes</h2><button class="btn small" type="button" data-tab="resumo">Fechar</button></div>
    <div class="sub">Tudo o que você lança fica só neste aparelho. Para buscar cotações, o app envia apenas os códigos dos ativos (ex.: PETR4), nunca quantidades ou valores.</div>
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
      <div class="note full">Sem token da brapi, ações e FIIs usam o fechamento do último pregão (publicado pela B3 todas as noites). Tesouro Direto atualiza uma vez por dia. O token não entra no backup.</div>
    </form>
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
    ${m ? `<div class="note">Histórico público gerado em ${fmtQuando(m.geradoEm)}${m.b3?.ultimo ? ` · B3 até ${fmtD(m.b3.ultimo)}` : ''}${m.tesouroUltimo ? ` · Tesouro até ${fmtD(m.tesouroUltimo)}` : ''}.</div>` : ''}
    <div class="row"><button class="btn danger" type="button" id="btnWipe">Apagar todos os dados</button></div>
  </div>`;
}
