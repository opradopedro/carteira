// Funções puras usadas pelo gerador de dados públicos (scripts/build-data.mjs).
// Nenhuma delas lida com dados pessoais: só cotações públicas de mercado.

/** Normaliza o nome de um título do Tesouro para casar com o que vem da B3. */
export function tesouroKey(nome) {
  return String(nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

const CLASSE_BDI = { '02': 'a', '12': 'f', '34': 'o', '35': 'o', '36': 'o', '39': 'o' };

/**
 * Acumula linhas do arquivo COTAHIST da B3 (layout oficial, posições fixas).
 * Guarda, para cada ativo do mercado à vista, o último fechamento de cada mês.
 */
export function createCotahistAccumulator(year) {
  const p = {};      // ticker -> array(12) de fechamentos
  const lastDay = {}; // ticker -> array(12) com o dia do fechamento guardado
  const k = {};      // ticker -> classe ('a' ação, 'f' FII/Fiagro, 'o' outros)
  const n = {};      // ticker -> nome curto do pregão (ex.: "PETROBRAS"), para a busca do app
  let ultimo = '';
  return {
    add(line) {
      if (line.length < 121 || line[0] !== '0' || line[1] !== '1') return;
      if (line.slice(24, 27) !== '010') return; // só mercado à vista (lote padrão)
      const data = line.slice(2, 10);
      if (data.slice(0, 4) !== String(year)) return;
      const bdi = line.slice(10, 12);
      const ticker = line.slice(12, 24).trim();
      const nome = line.slice(27, 39).trim();
      const close = parseInt(line.slice(108, 121), 10) / 100;
      if (!ticker || !(close > 0)) return;
      const m = parseInt(data.slice(4, 6), 10) - 1;
      const dia = parseInt(data.slice(6, 8), 10);
      const arr = p[ticker] || (p[ticker] = new Array(12).fill(null));
      const dd = lastDay[ticker] || (lastDay[ticker] = new Array(12).fill(0));
      if (dia >= dd[m]) { arr[m] = close; dd[m] = dia; }
      let c = CLASSE_BDI[bdi];
      if (bdi === '14') c = /^FIAGRO/.test(nome) ? 'f' : 'o';
      if (c) k[ticker] = c;
      if (nome) n[ticker] = nome.replace(/\s+/g, ' ');
      const iso = `${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}`;
      if (iso > ultimo) ultimo = iso;
    },
    result() {
      const tickers = Object.keys(p).sort();
      /** @type {{ y: number, ultimo: string, p: Record<string, (number|null)[]>, k: Record<string, string>, n: Record<string, string> }} */
      const out = { y: year, ultimo, p: {}, k: {}, n: {} };
      for (const t of tickers) { out.p[t] = p[t]; if (k[t]) out.k[t] = k[t]; if (n[t]) out.n[t] = n[t]; }
      return out;
    },
  };
}

const ymKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/** Lista de meses "AAAA-MM" de start até end (inclusive). */
export function monthRange(start, end) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(ymKey(y, m));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Ano que aparece no nome do título (e na planilha da B3). Para Renda+ e Educa+ o
 * nome usa o ano em que começam os pagamentos, não o vencimento final do CSV:
 * Renda+ 2065 vence em 2084 (20 anos de pagamentos); Educa+ 2026 vence em 2030 (5 anos).
 */
export function anoNoNome(tipo, anoVenc) {
  const t = tesouroKey(tipo);
  if (t.startsWith('TESOURO RENDA+')) return anoVenc - 19;
  if (t.startsWith('TESOURO EDUCA+')) return anoVenc - 4;
  return anoVenc;
}

const brNum = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
const brDate = s => { const [d, m, y] = String(s).trim().split('/'); return `${y}-${m}-${d}`; };

/**
 * Lê o CSV "PrecoTaxaTesouroDireto" do Tesouro Transparente e devolve o último
 * preço (PU Base) de cada título em cada mês, mais o preço mais recente.
 */
export function parseTesouroCsv(text, startMonth) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(';').map(h => h.trim());
  const iTipo = header.indexOf('Tipo Titulo');
  const iVenc = header.indexOf('Data Vencimento');
  const iData = header.indexOf('Data Base');
  const iPu = header.indexOf('PU Base Manha');
  if ([iTipo, iVenc, iData, iPu].some(i => i < 0)) throw new Error('Cabeçalho do CSV do Tesouro mudou: ' + lines[0]);
  const byKey = {}; // key -> { 'AAAA-MM': [data, pu] }
  /** @type {Record<string, [number, string]>} */
  const ult = {};   // key -> [pu, data]
  let ultimo = '';
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length <= iPu) continue;
    const data = brDate(c[iData]);
    const pu = brNum(c[iPu]);
    if (!(pu > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    const key = tesouroKey(`${c[iTipo]} ${anoNoNome(c[iTipo], parseInt(c[iVenc].trim().slice(-4), 10))}`);
    const ym = data.slice(0, 7);
    if (data > ultimo) ultimo = data;
    if (!ult[key] || data > ult[key][1]) ult[key] = [pu, data];
    if (ym < startMonth) continue;
    const mm = byKey[key] || (byKey[key] = {});
    if (!mm[ym] || data > mm[ym][0]) mm[ym] = [data, pu];
  }
  const m = monthRange(startMonth, ultimo.slice(0, 7));
  /** @type {Record<string, (number|null)[]>} */
  const p = {};
  for (const key of Object.keys(byKey).sort()) {
    p[key] = m.map(ym => (byKey[key][ym] ? byKey[key][ym][1] : null));
  }
  return { ultimo, m, p, u: ult };
}

/** Converte velas mensais do Mercado Bitcoin em fechamentos por mês. */
export function parseMbCandles(json, startMonth, endMonth) {
  const m = monthRange(startMonth, endMonth);
  const idx = new Map(m.map((k, i) => [k, i]));
  const out = new Array(m.length).fill(null);
  (json.t || []).forEach((t, i) => {
    const d = new Date(t * 1000);
    const k = ymKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
    const c = parseFloat(json.c[i]);
    if (idx.has(k) && c > 0) out[idx.get(k)] = c;
  });
  return { m, p: out };
}
