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
  const CHALLENGE_RE = /Один момент|Just a moment|провер\w* безопасности|Checking your browser|cf-chl|challenge/i;
  // ВАЖНО: у waitForFunction options — третьим аргументом (второй — это arg для функции)
  const waitForSkinsPage = (n, timeout) => page.waitForFunction((n) => {
    const v = window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state['$svue-query'];
    if (!v || !v.queries) return false;
    // при SPA-навигации каждая страница — отдельная запись кэша ['skins', {...}]
    return v.queries.some(q => q.queryKey && q.queryKey[0] === 'skins' &&
      q.state && q.state.data && q.state.data.data && q.state.data.data.length &&
      q.state.data.meta && q.state.data.meta.current_page === n);
  }, n, { timeout });
  const pageInfo = () => page.evaluate(() => ({
    title: document.title,
    text: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 200),
  })).catch(() => null);

  // Полную загрузку документа антибот может встретить заглушкой (в headless она не
  // проходит), поэтому документ грузим ОДИН раз, а по страницам пагинации ходим
  // кликами внутри SPA — это внутренние API-запросы сайта, заглушка на них не срабатывает.
  let loaded = false;
  for (let attempt = 1; attempt <= 4 && !loaded; attempt++) {
    try {
      await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForSkinsPage(1, 45000);
      loaded = true;
    } catch (e) {
      const info = await pageInfo();
      const isChallenge = info && CHALLENGE_RE.test(info.title + ' ' + info.text);
      if (attempt === 4) {
        throw new Error(
          `lis-skins не отдал данные (4 попытки${isChallenge ? ', упирается в антибот-проверку' : ''}). ` +
          `Подождите пару минут и нажмите кнопку ещё раз. Содержимое страницы: ${JSON.stringify(info)}`
        );
      }
      progress({ stage: 'lis-skins', msg: isChallenge ? `антибот-проверка, повтор ${attempt + 1}/4 через ${8 * attempt}с...` : `страница не загрузилась, повтор ${attempt + 1}/4...` });
      await page.waitForTimeout(8000 * attempt);
    }
  }

  const mapItems = (arr) => arr.map(it => ({
    id: it.skin.id,
    name: it.skin.name,
    url: 'https://lis-skins.com/ru/market/csgo/' + it.skin.url + '/',
    qty: it.similar_count || 0,
    lis_usd: it.final_withdrawal_price,
  }));

  // Постоянный сборщик API-ответов пагинации: не теряет ответ, даже если он пришёл
  // раньше/позже, чем мы начали его ждать.
  const apiPages = new Map();
  page.on('response', (r) => {
    if (r.url().includes('/api/v2/obtained-skins') && r.status() === 200) {
      r.json().then(j => { if (j && j.meta && j.data) apiPages.set(j.meta.current_page, j); }).catch(() => {});
    }
  });

  // Дождаться гидрации Vue: до неё клик по пагинации не перехватывается роутером
  // и превращается в полную навигацию (которую ловит антибот-заглушка).
  await page.waitForFunction(() => {
    const el = document.querySelector('#__nuxt');
    return el && el.__vue_app__ !== undefined;
  }, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Данные страницы N после клика: либо API-ответ SPA, либо (если всё же случилась
  // полная навигация) свежий SSR-стейт нового документа.
  const grabPage = async (n) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (apiPages.has(n)) {
        const j = apiPages.get(n);
        return { meta: j.meta, usdRate: null, items: mapItems(j.data) };
      }
      const ssr = await page.evaluate((n) => {
        const v = window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state['$svue-query'];
        if (!v || !v.queries) return null;
        const q = v.queries.find(q => q.queryKey && q.queryKey[0] === 'skins' &&
          q.state && q.state.data && q.state.data.data && q.state.data.data.length &&
          q.state.data.meta && q.state.data.meta.current_page === n);
        return q ? { meta: q.state.data.meta, raw: q.state.data.data } : null;
      }, n).catch(() => null);
      if (ssr) return { meta: ssr.meta, usdRate: null, items: mapItems(ssr.raw) };
      await page.waitForTimeout(700);
    }
    return null;
  };

  while (pageNum <= lastPage) {
    let chunk;
    if (pageNum > 1) {
      // Страница 1 приходит с SSR; дальше НЕ делаем goto (антибот-заглушка ловит полные
      // загрузки документа и в headless не проходит), а кликаем «следующая страница» в SPA
      // и перехватываем её собственный API-ответ /api/v2/obtained-skins.
      chunk = null;
      for (let attempt = 1; attempt <= 3 && !chunk; attempt++) {
        const clicked = await page.evaluate((n) => {
          const next = document.querySelector('a[rel="next"]');
          if (next) { next.click(); return 'next'; }
          const byNum = [...document.querySelectorAll('a')].find(a => (a.getAttribute('href') || '').includes('page=' + n));
          if (byNum) { byNum.click(); return 'num'; }
          return null;
        }, pageNum).catch(() => null);
        if (!clicked) throw new Error(`не нашёл кнопку следующей страницы (страница ${pageNum} из ${lastPage})`);
        chunk = await grabPage(pageNum);
        if (!chunk && attempt < 3) {
          const info = await pageInfo();
          const isChallenge = info && CHALLENGE_RE.test(info.title + ' ' + info.text);
          progress({ stage: 'lis-skins', msg: `страница ${pageNum}: нет данных (${isChallenge ? 'антибот' : 'таймаут'}), повтор ${attempt + 1}/3...` });
          if (isChallenge) {
            // заглушка — вернёмся на список полной загрузкой и продолжим кликами
            await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
            await waitForSkinsPage(1, 45000).catch(() => {});
            await page.waitForTimeout(3000);
          } else {
            await page.waitForTimeout(5000);
          }
        }
      }
      if (!chunk) {
        const info = await pageInfo();
        throw new Error(`не удалось получить страницу ${pageNum} из ${lastPage} (3 попытки). Содержимое страницы: ${JSON.stringify(info)}`);
      }
    } else {
      chunk = await page.evaluate(() => {
        const v = window.__NUXT__.state['$svue-query'];
        const q = v.queries.find(q => q.queryKey[0] === 'skins');
        const cur = v.queries.find(q => q.queryKey[0] === 'currencies');
        const rub = cur && cur.state.data.data.find(c => c.name === 'rub');
        return {
          meta: q.state.data.meta,
          usdRate: rub ? Number(rub.rate) : null,
          raw: q.state.data.data,
        };
      });
      chunk.items = mapItems(chunk.raw);
    }
    usdRate = chunk.usdRate || usdRate;
    lastPage = (chunk.meta && chunk.meta.last_page) || 1;
    if (lastPage > 25) {
      throw new Error(
        `Сайт вернул ${chunk.meta && chunk.meta.total} позиций (${lastPage} страниц) — похоже, это весь каталог, а не список избранного. ` +
        `Проверьте ссылку: она должна содержать корректный user_list_id.`
      );
    }
    rows.push(...chunk.items);
    progress({ stage: 'lis-skins', msg: `страница ${pageNum}/${lastPage}`, done: rows.length });
    pageNum++;
    if (pageNum <= lastPage) await page.waitForTimeout(2500);
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
        respPromise.catch(() => {}); // страховка от unhandled rejection, если goto упадёт раньше
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
