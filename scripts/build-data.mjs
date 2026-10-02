// Gera os arquivos públicos de cotações históricas em public/data/.
// Roda no GitHub Actions (diariamente) e localmente com `npm run data`.
// Só baixa dados públicos de mercado: nada da carteira de ninguém passa por aqui.
//
// Saídas:
//   public/data/b3/AAAA.json   fechamento mensal de todos os ativos da B3 (COTAHIST)
//   public/data/tesouro.json   preço mensal + mais recente de cada título do Tesouro Direto
//   public/data/cripto.json    fechamento mensal de BTC e ETH em reais (Mercado Bitcoin)
//   public/data/bcb.json       CDI, IPCA e Selic (melhor esforço; o app tenta o BCB direto antes)
//   public/data/meta.json      índice do que foi gerado

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCotahistAccumulator, parseMbCandles, parseTesouroCsv } from './lib.mjs';

const START_YEAR = 2016;
const START_MONTH = `${START_YEAR}-01`;
const OUT = join(import.meta.dirname, '..', 'public', 'data');
const repo = process.env.GITHUB_REPOSITORY || '';
const SITE_URL = process.env.SITE_URL ||
  (repo ? `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/` : '');
const TESOURO_CSV = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';

mkdirSync(join(OUT, 'b3'), { recursive: true });
const now = new Date();
const curYear = now.getUTCFullYear();
const curMonth = `${curYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const only = process.argv.slice(2); // ex.: `node scripts/build-data.mjs b3 tesouro`
const want = k => !only.length || only.includes(k);
const problemas = [];

async function fetchRetry(url, opts = {}, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 600_000) });
      if (r.ok) return r;
      err = new Error(`HTTP ${r.status} em ${url}`);
      if (r.status === 404) break;
    } catch (e) { err = e; }
    await new Promise(res => setTimeout(res, 2000 * 2 ** i));
  }
  throw err;
}

const writeJson = (rel, obj) => writeFileSync(join(OUT, rel), JSON.stringify(obj));

/** Se a fonte falhar, mantém a versão publicada antes no site, para o app não ficar sem dados. */
async function keepPublished(rel) {
  if (existsSync(join(OUT, rel))) return true;
  if (!SITE_URL) return false;
  try {
    const r = await fetchRetry(new URL('data/' + rel, SITE_URL), {}, 2);
    writeFileSync(join(OUT, rel), Buffer.from(await r.arrayBuffer()));
    console.log(`  usando a versão já publicada de ${rel}`);
    return true;
  } catch { return false; }
}

async function b3Year(year) {
  const url = `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A${year}.ZIP`;
  const zip = join(tmpdir(), `COTAHIST_A${year}.ZIP`);
  console.log(`B3 ${year}: baixando…`);
  // O arquivo tem ~90 MB; se a conexão cair no meio, tenta de novo do começo.
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetchRetry(url);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(zip));
      break;
    } catch (e) {
      if (tentativa >= 3) throw e;
      console.log(`B3 ${year}: download interrompido (${e.message}), tentando de novo…`);
    }
  }
  const acc = createCotahistAccumulator(year);
  const unzip = spawn('unzip', ['-p', zip], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  for await (const line of rl) acc.add(line);
  rmSync(zip, { force: true });
  const res = acc.result();
  writeJson(`b3/${year}.json`, res);
  console.log(`B3 ${year}: ${Object.keys(res.p).length} ativos, último pregão ${res.ultimo}`);
  return res.ultimo;
}

async function b3() {
  const anos = [];
  let ultimo = '';
  for (let y = START_YEAR; y <= curYear; y++) {
    const file = join(OUT, 'b3', `${y}.json`);
    const refazer = !existsSync(file) || y === curYear || (y === curYear - 1 && now.getUTCMonth() === 0);
    try {
      if (refazer) ultimo = (await b3Year(y)) || ultimo;
      else ultimo = JSON.parse(readFileSync(file, 'utf8')).ultimo || ultimo;
      anos.push(y);
    } catch (e) {
      problemas.push(`B3 ${y}: ${e.message}`);
      if (await keepPublished(`b3/${y}.json`)) {
        anos.push(y);
        try { ultimo = JSON.parse(readFileSync(file, 'utf8')).ultimo || ultimo; } catch { /* ignora */ }
      }
    }
  }
  return { anos, ultimo };
}

async function tesouro() {
  try {
    console.log('Tesouro: baixando CSV…');
    const text = await (await fetchRetry(TESOURO_CSV)).text();
    const res = parseTesouroCsv(text, START_MONTH);
    writeJson('tesouro.json', res);
    console.log(`Tesouro: ${Object.keys(res.p).length} títulos, último dia ${res.ultimo}`);
    return res.ultimo;
  } catch (e) {
    problemas.push(`Tesouro: ${e.message}`);
    await keepPublished('tesouro.json');
    return '';
  }
}

async function cripto() {
  try {
    const from = Math.floor(Date.UTC(START_YEAR, 0, 1) / 1000);
    const to = Math.floor(Date.now() / 1000);
    const out = { m: [], p: {} };
    for (const sym of ['BTC', 'ETH']) {
      const url = `https://api.mercadobitcoin.net/api/v4/candles?symbol=${sym}-BRL&resolution=1M&from=${from}&to=${to}`;
      const res = parseMbCandles(await (await fetchRetry(url, { timeout: 60_000 })).json(), START_MONTH, curMonth);
      out.m = res.m; out.p[sym] = res.p;
    }
    writeJson('cripto.json', out);
    console.log('Cripto: ok');
  } catch (e) {
    problemas.push(`Cripto: ${e.message}`);
    await keepPublished('cripto.json');
  }
}

async function bcb() {
  // O BCB costuma recusar conexões de fora do Brasil (como os servidores do GitHub).
  // Por isso o app consulta o BCB direto do celular e só usa este arquivo como reserva.
  const sgs = async (code, ini, fim) => {
    const fmt = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${fmt(ini)}&dataFinal=${fmt(fim)}`;
    const arr = await (await fetchRetry(url, { timeout: 60_000 }, 2)).json();
    return arr.map(o => [o.data.split('/').reverse().join('-'), parseFloat(o.valor)]);
  };
  try {
    const meio = new Date(Date.UTC(START_YEAR + 9, 11, 31));
    const cdi = [
      ...await sgs(12, new Date(Date.UTC(START_YEAR, 0, 1)), meio),
      ...await sgs(12, new Date(meio.getTime() + 864e5), now),
    ];
    const ipca = await sgs(433, new Date(Date.UTC(START_YEAR, 0, 1)), now);
    const selic = await sgs(432, new Date(now.getTime() - 40 * 864e5), now);
    writeJson('bcb.json', { cdi, ipca, selic: selic.at(-1)?.[1] ?? null, em: now.toISOString() });
    console.log('BCB: ok');
  } catch (e) {
    console.log(`BCB indisponível daqui (${e.message}); o app consulta direto.`);
    await keepPublished('bcb.json');
  }
}

const meta = { geradoEm: now.toISOString(), inicio: START_MONTH };
if (want('b3')) Object.assign(meta, { b3: await b3() });
if (want('tesouro')) meta.tesouroUltimo = await tesouro();
if (want('cripto')) await cripto();
if (want('bcb')) await bcb();
if (!only.length) {
  if (!meta.b3?.anos?.length) problemas.push('Nenhum ano da B3 disponível');
  writeJson('meta.json', meta);
}

if (problemas.length) {
  console.log('\nAvisos:\n- ' + problemas.join('\n- '));
  if (process.env.GITHUB_ACTIONS) for (const p of problemas) console.log(`::warning::${p}`);
}
