// Shared daily-scrape engine for stickers and guns.
//
// Strategy "B": instead of a full page navigation per item (heavy: loads the whole
// SPA every time), keep ONE warmed page and call steamdt's own JSON endpoints via
// in-page fetch():
//   POST /api/user/skin/v1/item            -> itemId + prices
//   GET  /api/item/trade/v1/overview/today -> sold today (+ turnover)
// These pass anti-bot when sent with the SPA's full header set (incl. x-device-id).
//
// Anti-bot reality: sustained/bursty programmatic fetch eventually trips
// "environment abnormal", while SPA-navigation requests keep working. So the engine
// is adaptive + self-protecting:
//   - single lane, adaptive gap (speeds up on success, backs off on abnormal);
//   - on repeated "abnormal" it switches to the proven NAVIGATION path (fallback)
//     and stops hammering, periodically probing whether fetch works again;
//   - every failed item also falls back to navigation, so data never regresses.
// Net: as fast as fetch allows on a fresh session, never slower-than-navigation.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
export const localStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// SteamDT "today" resets at Beijing midnight (UTC+8).
export const siteDate = (d = new Date()) => { const b = new Date(d.getTime() + 8 * 3600000); return `${b.getUTCFullYear()}-${pad(b.getUTCMonth()+1)}-${pad(b.getUTCDate())}`; };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---- tuning ----
const START_GAP = 220, MIN_GAP = 120, MAX_GAP = 2500; // ms between items in fetch mode
const NAV_GAP = 800;            // ms between items in navigation (fallback) mode
const ABN_LIMIT = 5;            // consecutive "abnormal" in fetch mode -> drop to nav
const NAV_PROBE_EVERY = 40;     // in nav mode, retry fetch every N items
const RESTART_EVERY = 400;      // reopen browser context periodically (memory hygiene)
const SAVE_EVERY = 50;
const ITEM_TIMEOUT = 45000;

// Разбор почасового ряда type-trend: [ts, ценаCN, лотыCN, ценаSteam, лотыSteam,
// цена сделки, сделок за час, 存世量]. Возвращает агрегаты по датам сайта (Пекин).
// Старая ручка /api/item/trade/v1/overview/today с ~17.07.2026 всегда отвечает
// «environment abnormal» и SPA её больше не вызывает — sold теперь только отсюда.
function trendByDay(rows) {
  const byDay = {};
  for (const r of rows || []) {
    const d = siteDate(new Date((+r[0]) * 1000));
    const day = (byDay[d] ??= { sold: 0, turnover: 0, priceCN: null, priceSteam: null });
    day.sold += (+r[6] || 0);
    day.turnover += (+r[5] || 0) * (+r[6] || 0);
    if (r[1] != null) day.priceCN = +r[1];      // последняя цена дня
    if (r[3] != null) day.priceSteam = +r[3];
  }
  return byDay;
}

// In-page fetch of both payloads for one item. Runs in the page's JS context, so it
// reuses the real browser session (cookies + TLS fingerprint) and passes anti-bot.
async function viaFetch(page, deviceId, mhn) {
  const r = await page.evaluate(async ({ mhn, dev }) => {
    const Hp = { 'content-type': 'application/json', 'access-token': 'undefined', 'language': 'en_US', 'x-app-version': '1.0.0', 'x-currency': 'CNY', 'x-device': '1', 'x-device-id': dev };
    const isAbn = (j) => (j && j.errorMsg || '').includes('abnormal');
    const pf = (list, p) => { const x = (list || []).find(i => i.platform === p); return x && x.price > 0 ? x.price : null; };
    try {
      const ij = await (await fetch('/api/user/skin/v1/item?timestamp=' + Date.now(), { method: 'POST', headers: Hp, body: JSON.stringify({ appId: 730, marketHashName: mhn }) })).json();
      if (!ij.success) return { err: isAbn(ij) ? 'ABN' : 'item' };
      const itemId = ij.data?.itemId || ij.data?.id;
      const list = ij.data?.sellingPriceList || [];
      const buff = pf(list, 'buff'), youpin = pf(list, 'youpin'), c5 = pf(list, 'c5'), steam = pf(list, 'steam');
      const market = [buff, youpin, c5].filter(x => x != null);
      const tj = await (await fetch('/api/user/steam/type-trend/v2/item/details?timestamp=' + Date.now(), {
        method: 'POST', headers: Hp,
        body: JSON.stringify({ platform: 'ALL', typeDay: 1, dateType: 4, specialStyle: '', timestamp: String(Date.now()), itemId }),
      })).json();
      if (!tj.success) return { err: isAbn(tj) ? 'ABN' : 'trend', itemId };
      return { itemId, trend: tj.data, prices: {
        price: market.length ? Math.min(...market) : null, priceSteam: steam, priceBuff: buff, priceYoupin: youpin,
      } };
    } catch (e) { return { err: 'exc' }; }
  }, { mhn, dev: deviceId });
  if (r.err) return r;
  const days = trendByDay(r.trend);
  const today = days[siteDate()] || { sold: 0, turnover: 0 };
  return { itemId: r.itemId, days, rec: {
    soldToday: today.sold, turnoverToday: Math.round(today.turnover * 100) / 100, ...r.prices,
  } };
}

// Proven fallback: navigate to the card; the SPA itself fires the (anti-bot-passing)
// requests and we read the responses. SPA грузит type-trend на каждой карточке.
async function viaNav(page, mhn) {
  let trend = null, detail = null;
  const onResp = async (resp) => {
    const u = resp.url();
    try {
      if (u.includes('/api/user/steam/type-trend/v2/item/details')) { const j = await resp.json(); if (j.success) trend = j.data; }
      else if (u.includes('/api/user/skin/v1/item?')) { const j = await resp.json(); if (j.success) detail = j.data; }
    } catch {}
  };
  page.on('response', onResp);
  try {
    await page.goto('https://www.steamdt.com/en/cs2/' + encodeURIComponent(mhn), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline && !trend) await sleep(280); // resolve as soon as trend arrives; prices are best-effort
    if (trend && !detail) { const d2 = Date.now() + 3000; while (Date.now() < d2 && !detail) await sleep(200); }
  } catch {} finally { page.off('response', onResp); }
  if (!trend) return null;
  const pf = (list, p) => { const x = (list || []).find(i => i.platform === p); return x && x.price > 0 ? x.price : null; };
  const list = detail?.sellingPriceList || [];
  const buff = pf(list, 'buff'), youpin = pf(list, 'youpin'), c5 = pf(list, 'c5'), steam = pf(list, 'steam');
  const market = [buff, youpin, c5].filter(x => x != null);
  const days = trendByDay(trend);
  const today = days[siteDate()] || { sold: 0, turnover: 0 };
  return { days, rec: {
    soldToday: today.sold, turnoverToday: Math.round(today.turnover * 100) / 100,
    price: market.length ? Math.min(...market) : null, priceSteam: steam, priceBuff: buff, priceYoupin: youpin,
  } };
}

export async function runDailyScrape({ root, dataDir, items, label, itemMeta, buildReports, fresh = false }) {
  const DATA_DIR = join(root, dataDir);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const histPath = join(DATA_DIR, 'history.json');
  const history = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : { items: {}, days: {} };

  const today = siteDate();
  const scrapedAt = localStamp();
  console.log(`${label} — ${items.length} позиций — дата сайта ${today} — старт ${scrapedAt}`);

  const dayData = history.days[today]?.data || {};
  const todo = fresh ? items.slice() : items.filter(it => !(it.marketHashName in dayData));
  const alreadyDone = items.length - todo.length;
  if (fresh) console.log(`Принудительная перевыгрузка дня (${items.length}).`);
  else if (alreadyDone) console.log(`Уже собрано сегодня: ${alreadyDone}. Осталось: ${todo.length}.`);

  const save = () => { history.days[today] = { scrapedAt, data: dayData }; writeFileSync(histPath, JSON.stringify(history, null, 2)); };

  // Бэкфилл прошлых дат из 7-дневного ряда type-trend: заполняем только дыры
  // (дни, где по этой позиции данных нет) — живую историю никогда не перетираем.
  let backfilled = 0;
  const backfill = (mhn, days) => {
    for (const [d, agg] of Object.entries(days)) {
      if (d >= today) continue;
      const day = (history.days[d] ??= { scrapedAt: `backfill ${scrapedAt}`, data: {} });
      day.data ??= {};
      if (mhn in day.data) continue;
      day.data[mhn] = {
        soldToday: agg.sold, turnoverToday: Math.round(agg.turnover * 100) / 100,
        price: agg.priceCN, priceSteam: agg.priceSteam, priceBuff: null, priceYoupin: null,
        soldDate: d, scrapedAt, backfilled: true,
      };
      backfilled++;
    }
  };
  if (todo.length === 0) { console.log(`День ${today} уже собран полностью (${alreadyDone}/${items.length}).`); buildReports(root); return; }

  const profileDir = join(DATA_DIR, 'browser-profile');
  let ctx, page, deviceId;
  async function openCtx() {
    ctx = await chromium.launchPersistentContext(profileDir, { headless: true, userAgent: UA, viewport: { width: 1366, height: 768 } });
    page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://www.steamdt.com/en/mkt', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(2500);
    deviceId = (await ctx.cookies('https://www.steamdt.com')).find(c => c.name === 'SDT_DeviceId')?.value || '';
  }
  const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('hard-timeout')), ms))]);

  await openCtx();
  const failed = [];
  let mode = deviceId ? 'fetch' : 'nav';   // need a device-id to attempt fetch
  if (!deviceId) console.log('deviceId не найден — работаю только через навигацию');
  let gap = START_GAP, consecAbn = 0, navProbeIn = NAV_PROBE_EVERY;
  let done = 0, fastCount = 0, navCount = 0;
  const errStats = {};   // причины отказов fetch-пути — для диагностики

  for (const it of todo) {
    const mhn = it.marketHashName;
    let rec = null, gotByFetch = false;

    if (mode === 'fetch') {
      let r; try { r = await withTimeout(viaFetch(page, deviceId, mhn), ITEM_TIMEOUT); } catch { r = { err: 'exc' }; }
      if (r.rec) { rec = r.rec; backfill(mhn, r.days); gotByFetch = true; fastCount++; consecAbn = 0; gap = Math.max(MIN_GAP, gap - 10); if (r.itemId) it._itemId = r.itemId; }
      else { errStats[r.err || '?'] = (errStats[r.err || '?'] || 0) + 1; if (r.err === 'ABN') { consecAbn++; gap = Math.min(MAX_GAP, Math.round(gap * 1.8)); } }
      // item/trend/exc errors: leave rec null -> nav fallback handles this item
    }

    if (!rec) {
      let n; try { n = await withTimeout(viaNav(page, mhn), ITEM_TIMEOUT); } catch { n = null; }
      if (n) { rec = n.rec; backfill(mhn, n.days); navCount++; }
    }

    done++;
    if (rec) {
      history.items[mhn] = itemMeta(it);
      dayData[mhn] = { ...rec, soldDate: today, scrapedAt };
      process.stdout.write(`\r[${alreadyDone + done}/${items.length}] ${gotByFetch ? 'f' : 'n'} ${mhn.slice(0, 38).padEnd(38)} sold=${rec.soldToday}     `);
    } else { failed.push(mhn); process.stdout.write(`\r[${alreadyDone + done}/${items.length}] FAIL ${mhn.slice(0, 38)}     `); }

    // circuit breaker: too many abnormals -> stop hammering, switch to navigation
    if (mode === 'fetch' && consecAbn >= ABN_LIMIT) { mode = 'nav'; consecAbn = 0; navProbeIn = NAV_PROBE_EVERY; }
    // recovery: while on navigation, periodically test whether fetch works again
    if (mode === 'nav' && deviceId && --navProbeIn <= 0) {
      let t; try { t = await viaFetch(page, deviceId, mhn); } catch { t = { err: 'exc' }; }
      if (t.rec) { mode = 'fetch'; gap = START_GAP; } else navProbeIn = NAV_PROBE_EVERY;
    }

    if (done % SAVE_EVERY === 0) save();
    if (done % RESTART_EVERY === 0 && done < todo.length) { try { await ctx.close(); } catch {} await openCtx(); if (!deviceId) mode = 'nav'; }
    await sleep(mode === 'fetch' ? gap : NAV_GAP);
  }
  console.log('');
  save();
  try { await ctx.close(); } catch {}
  if (failed.length) { console.log(`не собрано: ${failed.length}`); writeFileSync(join(DATA_DIR, `failed_${today}.json`), JSON.stringify(failed, null, 2)); }
  console.log(`через fetch: ${fastCount} · через навигацию: ${navCount}` + (backfilled ? ` · бэкфилл прошлых дней: ${backfilled} записей` : ''));
  if (Object.keys(errStats).length) console.log('отказы fetch-пути:', JSON.stringify(errStats));
  buildReports(root);
  console.log(`Готово. Собрано ${items.length - failed.length}/${items.length}.`);
}
