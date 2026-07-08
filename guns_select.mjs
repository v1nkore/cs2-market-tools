// One-time (resumable) selection crawl: measure ~30-day average daily sales for
// each candidate gun skin and keep those averaging > THRESHOLD sales/day.
// Progress is saved after every item, so it can be stopped and resumed safely.
//   node guns_select.mjs            # crawl / resume
//   node guns_select.mjs --finalize # just rebuild config_guns.json from progress
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(ROOT, 'pw-browsers');
const DATA = join(ROOT, 'data_guns');
const CAND = join(DATA, 'candidates.json');
const PROG = join(DATA, 'selection_progress.json');
const CONFIG = join(ROOT, 'config_guns.json');
const THRESHOLD = 20; // среднее > 20 продаж/день

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getArg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const finalizeOnly = process.argv.includes('--finalize');

function loadProgress() { return existsSync(PROG) ? JSON.parse(readFileSync(PROG, 'utf8')) : {}; }
function priceFrom(list, platform) { const p = (list || []).find(x => x.platform === platform); return p && p.price > 0 ? p.price : null; }

function finalize(progress, candidates) {
  const byMhn = Object.fromEntries(candidates.map(c => [c.marketHashName, c]));
  const kept = Object.entries(progress)
    .filter(([, v]) => v.ok && v.avgDaily != null && v.avgDaily > THRESHOLD)
    .map(([mhn, v]) => {
      const c = byMhn[mhn] || {};
      return { marketHashName: mhn, category: c.category, weapon: c.weapon, wear: c.wear, avgDaily: Math.round(v.avgDaily * 100) / 100 };
    })
    .sort((a, b) => b.avgDaily - a.avgDaily);
  writeFileSync(CONFIG, JSON.stringify({ title: 'Пушки CS2 (FN/MW, >5 продаж/день)', threshold: THRESHOLD, builtFrom: candidates.length, items: kept }, null, 2));
  const byCat = {}; for (const k of kept) byCat[k.category] = (byCat[k.category] || 0) + 1;
  console.log(`\nОтобрано (avg/день > ${THRESHOLD}): ${kept.length} из ${candidates.length}`);
  console.log('По типу:', JSON.stringify(byCat));
  console.log('-> config_guns.json');
}

const candidates = JSON.parse(readFileSync(CAND, 'utf8'));
let progress = loadProgress();

if (finalizeOnly) { finalize(progress, candidates); process.exit(0); }

async function measure(page, mhn) {
  let series = null, today = null, detail = null;
  const onResp = async (resp) => {
    const u = resp.url();
    try {
      if (u.includes('type-trend/v2/item/details')) { const j = await resp.json(); if (j.success) series = j.data; }
      else if (u.includes('overview/today')) { const j = await resp.json(); if (j.success) today = j.data; }
      else if (u.includes('/api/user/skin/v1/item?')) { const j = await resp.json(); if (j.success) detail = j.data; }
    } catch {}
  };
  page.on('response', onResp);
  try {
    await page.goto('https://www.steamdt.com/en/cs2/' + encodeURIComponent(mhn), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline && !(series && today)) await sleep(250);
  } catch {} finally { page.off('response', onResp); }

  if (!series && !today) return { ok: false };
  let avgDaily = null;
  if (series && series.length > 1) {
    const days = (Number(series[series.length - 1][0]) - Number(series[0][0])) / 86400;
    let sum = 0; for (const r of series) if (r[6] != null) sum += Number(r[6]);
    if (days > 0) avgDaily = sum / days;
  }
  const list = detail?.sellingPriceList || [];
  const buff = priceFrom(list, 'buff'), youpin = priceFrom(list, 'youpin'), c5 = priceFrom(list, 'c5'), steam = priceFrom(list, 'steam');
  const market = [buff, youpin, c5].filter(x => x != null);
  const soldToday = (today?.overview?.transactionCount ?? 0) + (today?.steamOverview?.transactionCount ?? 0);
  return { ok: true, avgDaily, soldToday, price: market.length ? Math.min(...market) : null, priceSteam: steam, priceBuff: buff, priceYoupin: youpin };
}

async function main() {
  const todo = candidates.filter(c => !(c.marketHashName in progress));
  console.log(`Кандидатов: ${candidates.length} · уже измерено: ${candidates.length - todo.length} · осталось: ${todo.length}`);
  if (!todo.length) { finalize(progress, candidates); return; }

  const CONCURRENCY = Number(getArg('--concurrency')) || 4;
  const ctx = await chromium.launchPersistentContext(join(DATA, 'browser-profile'), {
    headless: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', viewport: { width: 1366, height: 768 },
  });
  // warm up + create a pool of pages
  const warm = ctx.pages()[0] || await ctx.newPage();
  await warm.goto('https://www.steamdt.com/en/mkt', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(()=>{});
  await sleep(2500);
  const pages = [warm];
  for (let i = 1; i < CONCURRENCY; i++) pages.push(await ctx.newPage());

  let cursor = 0, done = 0, kept = 0, fails = 0, saveCounter = 0;
  const baseDone = candidates.length - todo.length;
  async function worker(page) {
    while (cursor < todo.length) {
      const c = todo[cursor++];
      let res = await measure(page, c.marketHashName);
      if (!res.ok) { await sleep(1500); res = await measure(page, c.marketHashName); }
      progress[c.marketHashName] = res.ok
        ? { ok: true, avgDaily: res.avgDaily, soldToday: res.soldToday, price: res.price, priceSteam: res.priceSteam, priceBuff: res.priceBuff, priceYoupin: res.priceYoupin }
        : { ok: false };
      done++;
      if (!res.ok) fails++;
      else if (res.avgDaily != null && res.avgDaily > THRESHOLD) kept++;
      if (++saveCounter >= 8) { writeFileSync(PROG, JSON.stringify(progress)); saveCounter = 0; }
      process.stdout.write(`\r[${baseDone + done}/${candidates.length}] оставлено:${kept} ошибок:${fails}  ${c.marketHashName.slice(0,38).padEnd(38)}   `);
      await sleep(700);
    }
  }
  await Promise.all(pages.map(p => worker(p)));
  writeFileSync(PROG, JSON.stringify(progress));
  await ctx.close();
  console.log('');
  finalize(progress, candidates);
}
main().catch(e => { writeFileSync(PROG, JSON.stringify(progress)); console.error('\n', e); process.exit(1); });
