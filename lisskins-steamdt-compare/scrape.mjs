// Сбор данных: список избранного с lis-skins + цены Steam/BUFF/YouPin со SteamDT.
// Оба сайта блокируют прямые HTTP-запросы антиботом, поэтому всё делается внутри
// настоящего Chromium (Playwright): lis-skins читается из клиентского vue-query кэша
// страницы, SteamDT — перехватом ответа его собственного API при загрузке страницы поиска.
//
// Использование:
//   node scrape.mjs [--url <lis-skins list url>] [--limit N] [--out data.json] [--no-build]

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_URL = 'https://lis-skins.com/ru/market/cs2/?user_list_id=01kvbgbzhn0acjzykwfagmc96y';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LIST_URL = arg('--url', DEFAULT_URL);
const LIMIT = Number(arg('--limit', 0)) || 0;
const OUT = arg('--out', path.join(__dirname, 'data.json'));
const NO_BUILD = process.argv.includes('--no-build');

function progress(obj) {
  console.log('PROGRESS ' + JSON.stringify(obj));
}

async function newBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

async function scrapeLisSkins(page) {
  progress({ stage: 'lis-skins', msg: 'загрузка списка' });
  const rows = [];
  let usdRate = null;
  let pageNum = 1;
  let lastPage = 1;
  while (pageNum <= lastPage) {
    const url = LIST_URL + (LIST_URL.includes('?') ? '&' : '?') + 'page=' + pageNum;
    await page.goto(pageNum === 1 ? LIST_URL : url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      const v = window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state['$svue-query'];
      return v && v.queries && v.queries.some(q => q.queryKey && q.queryKey[0] === 'skins' && q.state && q.state.data && q.state.data.data && q.state.data.data.length);
    }, { timeout: 45000 });
    const chunk = await page.evaluate(() => {
      const v = window.__NUXT__.state['$svue-query'];
      const q = v.queries.find(q => q.queryKey[0] === 'skins');
      const cur = v.queries.find(q => q.queryKey[0] === 'currencies');
      const rub = cur && cur.state.data.data.find(c => c.name === 'rub');
      return {
        meta: q.state.data.meta,
        usdRate: rub ? Number(rub.rate) : null,
        items: q.state.data.data.map(it => ({
          id: it.skin.id,
          name: it.skin.name,
          url: 'https://lis-skins.com/ru/market/csgo/' + it.skin.url + '/',
          qty: it.similar_count || 0,
          lis_usd: it.final_withdrawal_price,
        })),
      };
    });
    usdRate = chunk.usdRate || usdRate;
    lastPage = (chunk.meta && chunk.meta.last_page) || 1;
    rows.push(...chunk.items);
    progress({ stage: 'lis-skins', msg: `страница ${pageNum}/${lastPage}`, done: rows.length });
    pageNum++;
  }
  // дедуп по имени (одно имя = одна строка сравнения)
  const seen = new Set();
  const deduped = rows.filter(r => (seen.has(r.name) ? false : (seen.add(r.name), true)));
  return { rows: deduped, usdRate };
}

async function scrapeSteamdt(page, names) {
  const prices = {};
  let cnyRate = null;
  let done = 0;
  for (const name of names) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const respPromise = page.waitForResponse(
          r => r.url().includes('/api/skin/market/v3/page') && r.status() === 200 &&
               (r.request().postData() || '').includes(JSON.stringify(name).slice(1, -1)),
          { timeout: 45000 }
        );
        await page.goto('https://www.steamdt.com/en/mkt?search=' + encodeURIComponent(name), {
          waitUntil: 'domcontentloaded', timeout: 60000,
        });
        const resp = await respPromise;
        const json = await resp.json();
        const list = json && json.success && json.data && json.data.list;
        if (!list || !list.length) throw new Error((json && json.errorMsg) || 'empty list');
        const item = list.find(it => it.name === name) || list[0];
        const get = p => { const o = item.sellingPriceList.find(x => x.platform === p); return o ? o.price : null; };
        prices[name] = { steam: get('steam'), buff: get('buff'), youpin: get('youpin') };
        if (!cnyRate) {
          cnyRate = await page.evaluate(() => {
            try {
              const d = JSON.parse(localStorage.getItem('commonDictionary'));
              const r = d.rates.find(x => x.currency === 'RUB');
              return r ? Number(r.rate) : null;
            } catch { return null; }
          });
        }
        ok = true;
      } catch (e) {
        const msg = String(e.message || e);
        if (attempt === 3) {
          prices[name] = { steam: null, buff: null, youpin: null, error: msg };
        } else if (/too fast|try again/i.test(msg)) {
          progress({ stage: 'steamdt', done, total: names.length, msg: 'рейт-лимит, пауза 65с...' });
          await page.waitForTimeout(65000);
        } else {
          await page.waitForTimeout(2000 * attempt);
        }
      }
    }
    done++;
    progress({ stage: 'steamdt', done, total: names.length, msg: name });
    await page.waitForTimeout(1200);
  }
  return { prices, cnyRate };
}

async function main() {
  const browser = await newBrowser();
  try {
    const ctx = await browser.newContext({
      locale: 'ru-RU',
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    let { rows, usdRate } = await scrapeLisSkins(page);
    if (!usdRate) throw new Error('не удалось получить курс USD→RUB с lis-skins');
    if (LIMIT) rows = rows.slice(0, LIMIT);
    progress({ stage: 'lis-skins', msg: `собрано позиций: ${rows.length}, курс $ ${usdRate}` });

    const { prices, cnyRate } = await scrapeSteamdt(page, rows.map(r => r.name));
    if (!cnyRate) throw new Error('не удалось получить курс CNY→RUB со SteamDT');

    const failed = [];
    const out = {
      generatedAt: new Date().toISOString(),
      listUrl: LIST_URL,
      usd_rate: usdRate,
      cny_rate: cnyRate,
      rows: rows.map(r => {
        const p = prices[r.name] || {};
        if (p.error) failed.push({ name: r.name, error: p.error });
        const rub = v => (v == null ? null : Math.round(v * cnyRate * 100) / 100);
        return {
          ...r,
          lis_rub: Math.round(r.lis_usd * usdRate * 100) / 100,
          steam_cny: p.steam ?? null, buff_cny: p.buff ?? null, youpin_cny: p.youpin ?? null,
          steam_rub: rub(p.steam), buff_rub: rub(p.buff), youpin_rub: rub(p.youpin),
        };
      }),
      failed,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf-8');
    progress({ stage: 'save', msg: `data.json записан (${out.rows.length} строк, ошибок: ${failed.length})` });

    if (!NO_BUILD) {
      await build(OUT);
      progress({ stage: 'build', msg: 'index.html и comparison.xlsx перезаписаны' });
    }
    console.log('DONE');
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
