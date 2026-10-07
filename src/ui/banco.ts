// Área Banco: entradas e saídas de verdade (sem a caixinha e as transferências entre suas contas),
// gastos por categoria e as transações do mês, vindas do Open Finance pelo Meu Pluggy.
import { bancoClassificadas, bancoConfigurado, state } from '../app';
import { CATEGORIAS, CATS_RECEITA, resumoMes, serieMeses, termoDe, type Classificada } from '../banco/classificar';
import { NATUREZAS, type Natureza } from '../banco/tipos';
import { $, brl, compact, esc, fmtD, fmtNum, fmtQuando, fmtYm, MES } from './fmt';

const contaNome = (id: string) => {
  const c = state.banco.contas.find(x => x.id === id);
  return c ? (c.tipo === 'cartao' ? `Cartão ${c.banco}` : c.banco) : 'Conta';
};
const mesLongo = (ym: string) => `${MES[parseInt(ym.slice(5, 7), 10) - 1]}/${ym.slice(0, 4)}`;
const sinal = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + brl.format(Math.abs(v));
const contaNoTotal = (n: Natureza) => n === 'receita' || n === 'despesa';

export function itemTx(x: Classificada) {
  const conta = contaNoTotal(x.nat);
  const rotulo = conta ? x.cat : NATUREZAS[x.nat];
  return `<button type="button" class="item${conta ? '' : ' fora'}" data-page="btx:${esc(x.chave)}">
    <div class="name">${esc(x.desc)}</div>
    <div class="val ${x.v > 0 && conta ? 'up' : ''}">${sinal(x.v)} ›</div>
    <div class="meta">${fmtD(x.d).slice(0, 5)} · ${esc(contaNome(x.conta))}${x.pend ? ' · pendente' : ''}</div>
    <div class="meta r"><span class="tag" style="color:var(--${conta ? (x.v > 0 ? 'gain' : 'muted') : 'warn'})">${esc(rotulo)}</span>${x.auto ? '' : ' ✎'}</div></button>`;
}

function painelConectar() {
  return `<div class="panel">
    <h2>Conecte seus bancos</h2>
    <div class="sub">Veja entradas e saídas de verdade, para onde vai cada real e gastos por categoria. A conexão é pelo
      <b>Open Finance</b>, usando o <b>Meu Pluggy</b> (gratuito): você autoriza no app do banco e o FinAI lê as transações direto da Pluggy para este celular.</div>
    <div class="sub">O dinheiro que você só muda de lugar (caixinha, outra conta sua, investimento, pagamento da fatura) é separado e <b>não conta como entrada nem saída</b>.</div>
    <div class="row"><button type="button" class="btn primary" data-page="bconf">Conectar</button></div>
  </div>`;
}

/** Barras de entradas x saídas por mês. */
function graficoMeses(el: HTMLElement, s: { mes: string; receitas: number; despesas: number }[], atual: string) {
  const W = Math.max(280, el.clientWidth || 320), H = 180, L = 44, R = 6, T = 10, B = 24;
  const max = Math.max(1, ...s.flatMap(x => [x.receitas, x.despesas]));
  const p10 = Math.pow(10, Math.floor(Math.log10(max / 3))), f = max / 3 / p10;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p10, y1 = Math.ceil(max / step) * step;
  const Y = (v: number) => T + (1 - v / y1) * (H - T - B), bw = (W - L - R) / s.length;
  let g = '';
  for (let v = 0; v <= y1 + step / 2; v += step)
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${compact.format(v)}</text>`;
  s.forEach((x, i) => {
    const x0 = L + i * bw + bw * 0.14, w = bw * 0.34, op = x.mes === atual ? 1 : 0.55;
    if (x.receitas > 0) g += `<rect x="${x0.toFixed(1)}" y="${Y(x.receitas).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - Y(x.receitas)).toFixed(1)}" rx="2" fill="var(--gain)" opacity="${op}"/>`;
    if (x.despesas > 0) g += `<rect x="${(x0 + w + bw * 0.04).toFixed(1)}" y="${Y(x.despesas).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - Y(x.despesas)).toFixed(1)}" rx="2" fill="var(--loss)" opacity="${op}"/>`;
    if ((s.length - 1 - i) % 2 === 0) g += `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${MES[parseInt(x.mes.slice(5), 10) - 1]}</text>`;
    g += `<rect x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" fill="transparent" data-bmes-ir="${x.mes}"><title>${fmtYm(x.mes)}: entradas ${brl.format(x.receitas)}, saídas ${brl.format(x.despesas)}</title></rect>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas por mês" font-family="inherit">${g}</svg>`;
}

export function renderBanco() {
  const el = $('#tab-banco');
  if (!state.ready) { el.innerHTML = ''; return; }
  if (!bancoConfigurado()) { el.innerHTML = painelConectar(); return; }
  const b = state.banco;
  const cls = bancoClassificadas();
  const mes = b.mes;
  const r = resumoMes(cls, mes);
  const doMes = cls.filter(x => x.d.slice(0, 7) === mes).reverse();
  const hoje = new Date().toISOString().slice(0, 7);
  const pctPoup = r.receitas > 0 ? r.sobra / r.receitas : 0;
  const maiorGasto = r.porCategoria[0]?.v || 1;

  el.innerHTML = `
  <div class="panel">
    <div class="row between nowrap">
      <button type="button" class="btn icon" data-bmes="-1" aria-label="Mês anterior">‹</button>
      <h2 class="mes-banco">${mesLongo(mes)}</h2>
      <button type="button" class="btn icon" data-bmes="1" aria-label="Próximo mês"${mes >= hoje ? ' disabled' : ''}>›</button>
    </div>
    <div class="stats four">
      <div><span class="label">Entradas</span><b class="lg up">${brl.format(r.receitas)}</b></div>
      <div><span class="label">Saídas</span><b class="lg down">${brl.format(r.despesas)}</b></div>
      <div><span class="label">Sobrou</span><b class="lg ${r.sobra >= 0 ? 'up' : 'down'}">${brl.format(r.sobra)}</b></div>
      <div><span class="label">Poupou</span><b class="lg">${r.receitas > 0 ? fmtNum(pctPoup * 100) + '%' : '—'}</b></div>
    </div>
    ${r.internasEntrada > 0.005 ? `<button type="button" class="nota-interna" data-page="bnat:interna">
      ${brl.format(r.internasEntrada)} que entraram eram dinheiro seu mudando de lugar (caixinha, outras contas, resgates) e não contam como entrada. Ver ›</button>` : ''}
    ${Math.abs(r.investido) > 0.005 ? `<div class="sub">${r.investido > 0 ? 'Aplicado em investimentos' : 'Resgatado de investimentos'}: <b>${brl.format(Math.abs(r.investido))}</b></div>` : ''}
  </div>

  <div class="panel">
    <div class="row between"><h2>Gastos por categoria</h2><span class="sub">${brl.format(r.despesas)}</span></div>
    <div class="list">${r.porCategoria.length ? r.porCategoria.map(c => `<button type="button" class="item cat-linha" data-page="bcat:${esc(c.cat)}">
      <div class="name">${esc(c.cat)}</div><div class="val">${brl.format(c.v)} ›</div>
      <div class="barra"><i style="width:${Math.max(2, c.v / maiorGasto * 100).toFixed(1)}%"></i></div>
      <div class="meta">${c.n} ${c.n === 1 ? 'transação' : 'transações'}</div><div class="meta r">${r.despesas > 0 ? fmtNum(c.v / r.despesas * 100) + '%' : ''}</div></button>`).join('')
      : '<div class="empty">Nenhum gasto neste mês.</div>'}</div>
  </div>

  ${r.receitasPorCategoria.length ? `<div class="panel"><h2>De onde veio</h2><div class="list">${r.receitasPorCategoria.map(c => `<button type="button" class="item" data-page="bcat:${esc(c.cat)}">
      <div class="name">${esc(c.cat)}</div><div class="val up">${brl.format(c.v)} ›</div><div class="meta">${c.n} ${c.n === 1 ? 'entrada' : 'entradas'}</div><div class="meta r"></div></button>`).join('')}</div></div>` : ''}

  <div class="panel">
    <h2>Entradas e saídas</h2>
    <div class="legenda"><span><i style="background:var(--gain)"></i>Entradas</span><span><i style="background:var(--loss)"></i>Saídas</span></div>
    <div id="chBanco" class="chart"></div>
  </div>

  <div class="panel">
    <div class="row between"><h2>Contas</h2><button type="button" class="btn small" id="btnSincBanco"${b.sincronizando ? ' disabled' : ''}>${b.sincronizando ? 'Sincronizando…' : 'Sincronizar'}</button></div>
    ${b.erros.length ? `<div class="err">${b.erros.map(esc).join('<br>')}</div>` : ''}
    <div class="list">${b.contas.map(c => `<div class="item"><div class="name">${esc(c.banco)} <span class="tag" style="color:var(--muted)">${c.tipo === 'cartao' ? 'cartão' : 'conta'}</span></div>
      <div class="val">${brl.format(c.saldo)}</div><div class="meta">${esc(c.nome)}</div>
      <div class="meta r">${c.tipo === 'cartao' ? 'fatura atual' + (c.limite ? ' · limite ' + brl.format(c.limite) : '') : 'saldo'}</div></div>`).join('') || '<div class="empty">Nenhuma conta lida ainda. Toque em Sincronizar.</div>'}</div>
    <div class="note">${b.sinc ? 'Última sincronização: ' + fmtQuando(b.sinc) + '. ' : ''}A Pluggy atualiza as conexões uma vez por dia.</div>
  </div>

  <div class="panel">
    <h2>Transações de ${mesLongo(mes)}</h2>
    <div class="note">Toque numa transação para mudar a categoria ou dizer o que ela é (ex.: caixinha). Dá para aplicar às parecidas.</div>
    <div class="list">${doMes.slice(0, 150).map(itemTx).join('') || '<div class="empty">Nada neste mês.</div>'}</div>
  </div>
  <div class="row"><button type="button" class="btn" data-page="bconf">Conexão e regras ›</button></div>`;
  graficoMeses($('#chBanco'), serieMeses(cls, mes, 12), mes);
}

/* ---------- páginas ---------- */

export function paginaCategoria(el: HTMLElement, cat: string) {
  const cls = bancoClassificadas().filter(x => x.cat === cat && contaNoTotal(x.nat));
  const mes = state.banco.mes;
  const doMes = cls.filter(x => x.d.slice(0, 7) === mes).reverse();
  const receita = CATS_RECEITA.has(cat);
  const total = doMes.reduce((s, x) => s + (receita ? x.v : -x.v), 0);
  const meses = serieMeses(cls, mes, 12);
  const media = meses.slice(0, -1).reduce((s, m) => s + (receita ? m.receitas : m.despesas), 0) / 11;
  el.innerHTML = `<div class="panel">
    <span class="label">${esc(cat)} · ${mesLongo(mes)}</span>
    <div class="big">${brl.format(total)}</div>
    <div class="sub">Média dos 11 meses anteriores: ${brl.format(media)}</div>
    <div id="chCat" class="chart"></div>
  </div>
  <div class="panel"><h2>Transações</h2><div class="list">${doMes.map(itemTx).join('') || '<div class="empty">Nada neste mês.</div>'}</div></div>`;
  graficoMeses($('#chCat'), meses.map(m => receita ? { ...m, despesas: 0 } : { ...m, receitas: 0 }), mes);
}

export function paginaNatureza(el: HTMLElement, nat: Natureza) {
  const mes = state.banco.mes;
  const doMes = bancoClassificadas().filter(x => x.nat === nat && x.d.slice(0, 7) === mes).reverse();
  el.innerHTML = `<div class="panel">
    <span class="label">${NATUREZAS[nat]} · ${mesLongo(mes)}</span>
    <div class="sub">${nat === 'interna' ? 'Dinheiro seu mudando de lugar: caixinha, transferência entre contas suas, Pix para você mesmo. Não conta como entrada nem como saída.' : nat === 'fatura' ? 'Pagamentos da fatura do cartão. As compras já contam como saída na data em que foram feitas, então o pagamento não conta de novo.' : nat === 'investimento' ? 'Aplicações e resgates. Ficam fora das entradas e saídas.' : ''}</div>
    <div class="note">Se algo aqui for entrada ou gasto de verdade, toque e mude o tipo.</div>
  </div>
  <div class="panel"><div class="list">${doMes.map(itemTx).join('') || '<div class="empty">Nada neste mês.</div>'}</div></div>`;
}

export function paginaTx(el: HTMLElement, chave: string) {
  const x = bancoClassificadas().find(t => t.chave === chave);
  if (!x) { el.innerHTML = '<div class="panel"><div class="empty">Transação não encontrada.</div></div>'; return; }
  const termo = termoDe(x.desc);
  const temAjuste = !!state.banco.ajustes[x.chave];
  el.innerHTML = `<div class="panel">
    <span class="label">${fmtD(x.d)} · ${esc(contaNome(x.conta))}</span>
    <div class="big ${x.v > 0 ? 'up' : ''}">${sinal(x.v)}</div>
    <div class="sub">${esc(x.desc)}</div>
    ${x.catP ? `<div class="note">Categoria sugerida pela Pluggy: ${esc(x.catP)}</div>` : ''}
  </div>
  <div class="panel">
    <h2>O que é esta transação</h2>
    <form id="formBtx" data-chave="${esc(x.chave)}">
      <div class="field full"><label for="bNat">Tipo</label><select id="bNat">
        ${(Object.keys(NATUREZAS) as Natureza[]).map(n => `<option value="${n}"${n === x.nat ? ' selected' : ''}>${NATUREZAS[n]}</option>`).join('')}</select></div>
      <div class="field full"><label for="bCat">Categoria</label><select id="bCat">
        ${CATEGORIAS.map(c => `<option${c === x.cat ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
      ${termo ? `<label class="check full"><input type="checkbox" id="bParecidas"> Aplicar a todas que contêm “${esc(termo)}” (inclusive as próximas)</label>` : ''}
      <div class="row full"><button class="btn primary" type="submit">Salvar</button>
        ${temAjuste ? '<button type="button" class="btn" id="btnBtxAuto">Voltar ao automático</button>' : ''}</div>
    </form>
    <div class="note">Movimentação interna, investimento e pagamento de fatura não entram nas entradas e saídas.</div>
  </div>`;
}

export function paginaConexao(el: HTMLElement) {
  const p = state.cfg.pluggy;
  el.innerHTML = `<div class="panel">
    <h2>Como conectar (uma vez só)</h2>
    <ol class="passos">
      <li>Crie sua conta grátis no <a href="https://meu.pluggy.ai" target="_blank" rel="noopener">Meu Pluggy</a> e conecte o Mercado Pago (e outros bancos). A autorização é feita no app do próprio banco, pelo Open Finance.</li>
      <li>Crie uma conta no <a href="https://dashboard.pluggy.ai" target="_blank" rel="noopener">Dashboard da Pluggy</a>. Isso abre um teste de 15 dias: faça os passos 3 e 4 dentro dele.</li>
      <li>No Dashboard, abra a aplicação de demonstração (“Ir para Demo”) e conecte nela as contas do Meu Pluggy.</li>
      <li>Copie o <b>Client ID</b> e o <b>Client Secret</b> da aplicação e o <b>Item ID</b> de cada banco (menu ⋮ → “Copiar Item ID”). Cole abaixo.</li>
    </ol>
    <div class="note">Client ID e Secret ficam só neste celular e não vão no backup. As transações vão da Pluggy direto para cá. A categorização da Pluggy só vem no período de teste; depois, o FinAI categoriza pelas palavras da descrição e pelas suas correções.</div>
  </div>
  <div class="panel">
    <h2>Credenciais</h2>
    <form id="formPluggy" autocomplete="off">
      <div class="field full"><label for="pId">Client ID</label><input id="pId" value="${esc(p?.clientId || '')}" spellcheck="false" autocapitalize="off" required></div>
      <div class="field full"><label for="pSecret">Client Secret</label><input id="pSecret" type="password" value="${esc(p?.clientSecret || '')}" spellcheck="false" autocapitalize="off" required></div>
      <div class="field full"><label for="pItens">Item IDs (um por linha, um por banco)</label><textarea id="pItens" rows="3" spellcheck="false" autocapitalize="off" required>${esc((p?.itens || []).join('\n'))}</textarea></div>
      <div class="row full"><button class="btn primary" type="submit">Salvar e sincronizar</button></div>
      <div class="err full" id="pErr" hidden></div>
    </form>
  </div>
  <div class="panel">
    <h2>Suas regras</h2>
    <div class="sub">Criadas quando você corrige uma transação e marca “aplicar a todas”.</div>
    <div class="list">${state.banco.regras.map(r => `<div class="item"><div class="name">“${esc(r.termo)}”</div>
      <div class="val"><button type="button" class="btn small" data-del-regra="${esc(r.id)}">Excluir</button></div>
      <div class="meta">${[r.nat ? NATUREZAS[r.nat] : '', r.cat || ''].filter(Boolean).join(' · ')}</div><div class="meta r"></div></div>`).join('') || '<div class="empty">Nenhuma regra ainda.</div>'}</div>
  </div>
  ${p ? `<div class="row"><button type="button" class="btn" id="btnDesconectarBanco">Desconectar e apagar transações deste aparelho</button></div>` : ''}`;
}
