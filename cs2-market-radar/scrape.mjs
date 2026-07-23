// CS2 Market Radar — сбор агрегированного рейтинга активного рынка со SteamDT.
//
// SteamDT отдаёт по каждому предмету СРАЗУ все метрики за все периоды через одну ручку
// POST /api/user/ranking/v1/page (курсорная пагинация по nextId). Прямой fetch к ней
// не проходит (подпись/анти-бот, ошибка 108), поэтому листаем внутри самой SPA скроллом
// окна — её собственные запросы подписаны и проходят. За ~68 подписанных запросов
// собирается весь активный рынок (~1000 позиций), что на порядки легче лимита, чем
// открывать 1500 отдельных карточек.
//
//   node scrape.mjs [--limit N] [--out data.json] [--no-build]

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('--limit', 0)) || 0;
const OUT = arg('--out', path.join(__dirname, 'data.json'));
const NO_BUILD = process.argv.includes('--no-build');

const pad = (n) => String(n).padStart(2, '0');
// день сайта: SteamDT «сегодня» сбрасывается в полночь по Пекину (UTC+8)
const siteDate = (d = new Date()) => { const b = new Date(d.getTime() + 8 * 3600000); return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`; };
const progress = (o) => console.log('PROGRESS ' + JSON.stringify(o));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CAT = (itemType = '') => {
  const m = {
    Rifle: 'Rifle', Pistol: 'Pistol', SMG: 'SMG', Shotgun: 'Shotgun', Machinegun: 'Machinegun',
    Knife: 'Knife', Hands: 'Gloves', Gloves: 'Gloves', Sticker: 'Sticker', Patch: 'Patch',
    CustomPlayer: 'Agent', Agent: 'Agent', Graffiti: 'Graffiti', MusicKit: 'Music Kit',
    WeaponCase: 'Container', Container: 'Container', Case: 'Container', Collectible: 'Collectible',
    Charm: 'Charm', Key: 'Key', Pin: 'Pin', Tool: 'Tool',
  };
  for (const [k, v] of Object.entries(m)) if (itemType.includes(k)) return v;
  return itemType.replace(/^(CSGO_)?(Type|Tool|Item)_/, '') || 'Other';
};
// для стикеров/патчей «износа» нет — финиш зашит в названии (Holo/Foil/Gold/Glitter/Lenticular)
const FINISH = (name = '') => {
  const m = name.match(/\((Holo|Foil|Gold|Glitter|Lenticular)\)/i);
  return m ? m[1] : 'Paper';
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
    const page = await ctx.newPage();

    const rowsById = new Map();
    let total = 0;
    page.on('response', async (r) => {
      if (!r.url().includes('/api/user/ranking/v1/page') || r.status() !== 200) return;
      try {
        const j = await r.json();
        if (!j.success || !j.data) return;
        total = Number(j.data.total) || total;
        for (const it of (j.data.list || [])) {
          const iv = it.itemInfoVO || {};
          if (!iv.itemId || rowsById.has(iv.itemId)) continue;
          const sp = it.sellPriceInfoVO || {}, sn = it.sellNumsInfoVO || {}, tc = it.transactionCountInfoVO || {}, ta = it.transactionAmountInfoVO || {}, hot = it.hotVO || {};
          const plat = {};
          for (const p of (it.platformInfoList || [])) if (p.price > 0) plat[p.platformEnum.toLowerCase()] = p.price;
          rowsById.set(iv.itemId, {
            id: iv.itemId, name: iv.marketHashName || iv.name,
            category: CAT(iv.itemType), rarity: iv.rarity || '', exterior: iv.exterior || '',
            finish: /Sticker|Patch/.test(iv.itemType) ? FINISH(iv.name) : '',
            quality: iv.quality || '', image: iv.imageUrl || '',
            supply: Number(it.surviveNum) || 0,
            price: sp.price ?? null,
            priceDiff1: sp.diff1Days ?? null, priceDiff3: sp.diff3Days ?? null, priceDiff7: sp.diff7Days ?? null, priceDiff30: sp.diff1Months ?? null,
            sellNums: sn.sellNums ?? null,
            sellRate1: sn.sellNums1DaysRate ?? null, sellRate3: sn.sellNums3DaysRate ?? null, sellRate7: sn.sellNums7DaysRate ?? null, sellRate30: sn.sellNums1MonthsRate ?? null,
            trades1: Number(tc.transactionCount1Days) || 0, trades3: Number(tc.transactionCount3Days) || 0, trades7: Number(tc.transactionCount7Days) || 0, trades30: Number(tc.transactionCount1Months) || 0,
            tradesRate48: tc.transactionCountRate48Hours ?? null,
            turnover1: ta.transactionAmount1Days ?? null, turnover7: ta.transactionAmount7Days ?? null, turnover30: ta.transactionAmount1Months ?? null,
            hotCount: hot.hotCount ?? null, hotRank: hot.hotRank ?? null, hotRankChange: hot.hotRankChange ?? null,
            buff: plat.buff ?? null, youpin: plat.youpin ?? null, c5: plat.c5 ?? null, steam: plat.steam ?? null,
          });
        }
      } catch {}
    });

    progress({ stage: 'load', msg: 'открываю рейтинг' });
    await page.goto('https://www.steamdt.com/en/ladders', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // ждём первую страницу рейтинга
    const t0 = Date.now();
    while (Date.now() - t0 < 45000 && rowsById.size === 0) await page.waitForTimeout(500);
    if (rowsById.size === 0) throw new Error('SteamDT не отдал рейтинг (антибот/лимит?). Попробуйте позже.');

    // Листаем ПОШАГОВЫМ скроллом окна (не прыжком в низ — список виртуализируется, и
    // scrollHeight после ~200 позиций перестаёт достигать триггера подгрузки). Мелкие
    // шаги держат sentinel в игре, курсорная пагинация идёт до конца.
    let stagnant = 0;
    while ((LIMIT ? rowsById.size < LIMIT : (total === 0 || rowsById.size < total)) && stagnant < 12) {
      const before = rowsById.size;
      await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
      await page.waitForTimeout(1400);
      progress({ stage: 'collect', done: rowsById.size, total, msg: `собрано ${rowsById.size}${total ? '/' + total : ''}` });
      stagnant = rowsById.size > before ? 0 : stagnant + 1;
    }

    let rows = [...rowsById.values()];
    if (LIMIT) rows = rows.slice(0, LIMIT);

    const out = { generatedAt: new Date().toISOString(), siteDate: siteDate(), total: rows.length, rows };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf-8');
    progress({ stage: 'save', msg: `сохранено позиций: ${rows.length}` });

    // добавляем дневной снимок в историю (для собственных трендов/индексов со временем)
    try {
      const histPath = path.join(__dirname, 'data', 'history.json');
      fs.mkdirSync(path.dirname(histPath), { recursive: true });
      const hist = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf-8')) : { days: {} };
      hist.days[siteDate()] = { generatedAt: out.generatedAt, trades: Object.fromEntries(rows.map(r => [r.id, r.trades1])) };
      // держим максимум 60 последних дней, чтобы файл не рос бесконечно
      const keep = Object.keys(hist.days).sort().slice(-60);
      hist.days = Object.fromEntries(keep.map(k => [k, hist.days[k]]));
      fs.writeFileSync(histPath, JSON.stringify(hist), 'utf-8');
    } catch (e) { progress({ stage: 'hist', msg: 'история не записана: ' + e.message }); }

    if (!NO_BUILD) { await build(OUT); progress({ stage: 'build', msg: 'index.html перестроен' }); }
    console.log('DONE');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
