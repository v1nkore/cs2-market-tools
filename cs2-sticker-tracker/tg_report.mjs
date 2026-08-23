// Daily Telegram digest: top-N CS2 team stickers by "sold today".
// Reads data/history.json (produced by scrape.mjs) and posts a single HTML
// message to the same bot as the dota gem-monitor, tagged with #cs2stickers so
// the two reports are easy to tell apart in the chat.
//
// Env:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — bot + destination (same as dota monitor)
//   TOP_N        (default 20)  — how many stickers to list
//   DRY_RUN=1                  — print the message instead of sending
//   RUN_URL                    — link to the Actions run (shown only in error digest)
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TOP_N = Number(process.env.TOP_N || 20);
const DRY_RUN = process.env.DRY_RUN === '1';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const RUN_URL = process.env.RUN_URL || '';
const TAG = '#cs2stickers';

const pad = (n) => String(n).padStart(2, '0');
// SteamDT "today" resets at Beijing midnight (UTC+8) — same convention as the scraper.
const siteDate = (d = new Date()) => { const b = new Date(d.getTime() + 8 * 3600000); return `${b.getUTCFullYear()}-${pad(b.getUTCMonth()+1)}-${pad(b.getUTCDate())}`; };
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const yuan = (v) => v == null ? '—' : '¥' + Number(v).toFixed(2);
const cardUrl = (mhn) => 'https://www.steamdt.com/en/cs2/' + encodeURIComponent(mhn);

async function sendTelegram(text) {
  if (DRY_RUN || !TG_TOKEN || !TG_CHAT) {
    console.log(DRY_RUN ? '[DRY_RUN] message:\n' : '[no TELEGRAM_* env — printing only]\n');
    console.log(text.replace(/<[^>]+>/g, ''));
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram error: ' + JSON.stringify(j));
  console.log('sent to Telegram.');
}

function main() {
  const histPath = join(ROOT, 'data', 'history.json');
  if (!existsSync(histPath)) {
    return sendTelegram(`${TAG}\n⚠️ Нет data/history.json — сбор не дал данных.` + (RUN_URL ? `\nЛоги: ${RUN_URL}` : ''));
  }
  const h = JSON.parse(readFileSync(histPath, 'utf8'));
  const dates = Object.keys(h.days || {}).sort();
  if (!dates.length) {
    return sendTelegram(`${TAG}\n⚠️ История пуста — сбор не дал данных.` + (RUN_URL ? `\nЛоги: ${RUN_URL}` : ''));
  }

  // Reference day = last COMPLETE day (yesterday by Beijing time). At 08:00 MSK the
  // current Beijing day is only ~13h in, so ranking by it would undercount; the
  // previous day gives a full 24h of "sold today". Fall back to the freshest day.
  const todayB = siteDate();
  const complete = dates.filter(d => d < todayB);
  const refDate = complete.length ? complete[complete.length - 1] : dates[dates.length - 1];
  const partial = refDate === todayB;

  const day = h.days[refDate];
  const rows = Object.entries(day.data || {})
    .map(([mhn, d]) => {
      const meta = h.items[mhn] || {};
      return { mhn, team: meta.team || mhn, tournament: meta.tournament || '', sold: d.soldToday || 0, price: d.price ?? d.priceSteam ?? null };
    })
    .sort((a, b) => b.sold - a.sold);

  const withSales = rows.filter(r => r.sold > 0);
  const totalSold = rows.reduce((s, r) => s + r.sold, 0);
  const top = (withSales.length ? withSales : rows).slice(0, TOP_N);

  const lines = top.map((r, i) =>
    `${String(i + 1).padStart(2, ' ')}. <a href="${cardUrl(r.mhn)}">${esc(r.team)}</a> — <b>${r.sold}</b> шт · ${yuan(r.price)} · <i>${esc(r.tournament)}</i>`
  );

  const head = `${TAG} 📊 <b>Топ-${top.length} наклеек CS2 по продажам</b>\n` +
    `за ${esc(refDate)}${partial ? ' (день ещё идёт)' : ''} · всего ${totalSold} продаж по ${rows.length} наклейкам\n`;
  const foot = `\nЦена — мин. рыночная (BUFF/YouPin/C5, ¥). Клик по названию — карточка на SteamDT.`;

  return sendTelegram(head + '\n' + lines.join('\n') + '\n' + foot);
}

Promise.resolve().then(main).catch(e => { console.error(e); process.exit(1); });
