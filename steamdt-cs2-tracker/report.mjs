// Generate HTML reports from data/history.json.
// Produces:
//   reports/index.html            — dashboard (links + summary)
//   reports/history.html          — growing matrix: stickers x dates -> Sold Today
//   reports/day_YYYY-MM-DD.html   — daily snapshot with all fields
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const yuan = (v) => v == null ? '—' : '¥' + Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortName = (mhn) => mhn.replace('Sticker | ', '').replace(/\s*\(Holo\)\s*\|.*$/, '');
const cardUrl = (mhn) => 'https://www.steamdt.com/en/cs2/' + encodeURIComponent(mhn);

const CSS = `
:root{--bg:#0f1116;--card:#171a21;--card2:#1f242e;--bd:#2a313d;--tx:#e6e8eb;--mut:#8a93a3;--acc:#4ea1ff;--good:#34d399;--zero:#3a4150;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1500px;margin:0 auto;padding:22px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 18px;font-size:13px}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0}
.bar input,.bar select{background:var(--card2);border:1px solid var(--bd);color:var(--tx);padding:7px 10px;border-radius:8px;font-size:13px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 18px}
.kpi{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 16px;min-width:140px}
.kpi .n{font-size:24px;font-weight:700}.kpi .l{color:var(--mut);font-size:12px}
table{border-collapse:collapse;width:100%;background:var(--card);border-radius:12px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--bd);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}
thead th{position:sticky;top:0;background:var(--card2);cursor:pointer;font-weight:600;z-index:2}
thead th:first-child{z-index:3}
tbody tr:hover td{background:var(--card2)}
.grp td{background:#222a36;color:var(--acc);font-weight:700;text-align:left}
.tag{display:inline-block;background:var(--card2);border:1px solid var(--bd);color:var(--mut);border-radius:6px;padding:1px 7px;font-size:11px}
.sold{font-weight:700}.s0{color:var(--zero)}.s1{color:var(--tx)}.s2{color:var(--good)}
.tablewrap{overflow:auto;max-height:78vh;border:1px solid var(--bd);border-radius:12px}
.foot{color:var(--mut);font-size:12px;margin-top:18px}
.pill{padding:2px 8px;border-radius:999px;background:var(--card2);border:1px solid var(--bd);font-size:12px}
`;

const SORT_JS = `
function filt(){var q=(document.getElementById('q')||{}).value||'';q=q.toLowerCase();
 var sel=(document.getElementById('tf')||{}).value||'';
 document.querySelectorAll('tbody tr').forEach(function(r){
   if(r.classList.contains('grp')){r.style.display='';return;}
   var t=r.getAttribute('data-t')||'',n=(r.getAttribute('data-n')||'').toLowerCase();
   r.style.display=((!q||n.indexOf(q)>=0)&&(!sel||t===sel))?'':'none';});}
function sortT(th){var tb=th.closest('table'),idx=[].indexOf.call(th.parentNode.children,th);
 var num=th.getAttribute('data-num')==='1';var dir=th.getAttribute('data-dir')==='asc'?-1:1;th.setAttribute('data-dir',dir===1?'desc':'asc');
 var rows=[].slice.call(tb.querySelectorAll('tbody tr')).filter(function(r){return !r.classList.contains('grp');});
 rows.sort(function(a,b){var x=a.children[idx].getAttribute('data-v')||a.children[idx].innerText;var y=b.children[idx].getAttribute('data-v')||b.children[idx].innerText;
  if(num){x=parseFloat(x)||0;y=parseFloat(y)||0;return (x-y)*dir;}return x.localeCompare(y)*dir;});
 var tbody=tb.querySelector('tbody');rows.forEach(function(r){tbody.appendChild(r);});}
`;

function page(title, body, extraJs = '') {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div><script>${SORT_JS}${extraJs}</script></body></html>`;
}

function soldClass(v){ return v > 0 ? (v >= 5 ? 's2' : 's1') : 's0'; }

export function buildReports(root) {
  const histPath = join(root, 'data', 'history.json');
  if (!existsSync(histPath)) { console.log('no history yet'); return; }
  const h = JSON.parse(readFileSync(histPath, 'utf8'));
  const outDir = join(root, 'reports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const dates = Object.keys(h.days).sort();
  const items = Object.values(h.items);
  // order items by tournament (config order) then team
  const tOrder = {}; let oi = 0;
  for (const it of items) if (!(it.tournamentKey in tOrder)) tOrder[it.tournamentKey] = oi++;
  items.sort((a,b)=> (tOrder[a.tournamentKey]-tOrder[b.tournamentKey]) || a.team.localeCompare(b.team));

  // ---------- daily snapshots ----------
  const tournaments = [...new Set(items.map(i=>i.tournament))];
  for (const date of dates) {
    const day = h.days[date];
    const rows = items.filter(it => day.data[it.name]).map(it => {
      const d = day.data[it.name];
      return `<tr data-t="${esc(it.tournament)}" data-n="${esc(it.team)}">
<td><a href="${cardUrl(it.name)}" target="_blank" rel="noopener">${esc(it.team)}</a> <span class="tag">${esc(it.tournament)}</span></td>
<td data-num="1" data-v="${d.soldToday}" class="sold ${soldClass(d.soldToday)}">${d.soldToday}</td>
<td data-v="${d.price??0}">${yuan(d.price)}</td>
<td data-v="${d.priceSteam??0}">${yuan(d.priceSteam)}</td>
<td data-v="${d.priceBuff??0}">${yuan(d.priceBuff)}</td>
<td data-v="${d.priceYoupin??0}">${yuan(d.priceYoupin)}</td>
<td data-v="${d.turnoverToday??0}">${yuan(d.turnoverToday)}</td>
<td>${esc(d.soldDate)}</td><td>${esc(d.scrapedAt)}</td></tr>`;
    }).join('\n');
    const totalSold = items.reduce((s,it)=> s + (day.data[it.name]?.soldToday||0), 0);
    const body = `
<h1>Продажи за день — ${esc(date)}</h1>
<p class="sub">Снято: ${esc(day.scrapedAt)} · позиций: ${items.filter(it=>day.data[it.name]).length} · <a href="index.html">← дашборд</a> · <a href="history.html">сводная история →</a></p>
<div class="cards">
 <div class="kpi"><div class="n">${totalSold}</div><div class="l">Sold Today всего</div></div>
 <div class="kpi"><div class="n">${items.filter(it=>day.data[it.name]).length}</div><div class="l">наклеек</div></div>
 <div class="kpi"><div class="n">${tournaments.length}</div><div class="l">турниров</div></div>
</div>
<div class="bar">
 <input id="q" placeholder="поиск по команде…" oninput="filt()">
 <select id="tf" onchange="filt()"><option value="">все турниры</option>${tournaments.map(t=>`<option>${esc(t)}</option>`).join('')}</select>
</div>
<div class="tablewrap"><table><thead><tr>
<th onclick="sortT(this)">Наклейка / Коллекция</th>
<th data-num="1" onclick="sortT(this)">Sold&nbsp;Today</th>
<th data-num="1" onclick="sortT(this)">Цена</th>
<th data-num="1" onclick="sortT(this)">Steam</th>
<th data-num="1" onclick="sortT(this)">Buff</th>
<th data-num="1" onclick="sortT(this)">YouPin</th>
<th data-num="1" onclick="sortT(this)">Оборот/день</th>
<th onclick="sortT(this)">Дата Sold</th>
<th onclick="sortT(this)">Выгрузка</th>
</tr></thead><tbody>${rows}</tbody></table></div>
<p class="foot">Цена — минимальная рыночная цена среди BUFF/YouPin/C5 (¥). Sold Today = сделки на китайских площадках + Steam за текущий день (сброс в полночь UTC+8).</p>`;
    writeFileSync(join(outDir, `day_${date}.html`), page(`Продажи ${date}`, body));
  }

  // ---------- growing matrix ----------
  let mrows = '';
  let lastT = null;
  for (const it of items) {
    if (it.tournament !== lastT) { mrows += `<tr class="grp"><td colspan="${dates.length+2}">${esc(it.tournament)}</td></tr>`; lastT = it.tournament; }
    const cells = dates.map(date => {
      const d = h.days[date].data[it.name];
      const v = d ? d.soldToday : null;
      return v == null ? `<td data-v="-1">·</td>` : `<td data-v="${v}" class="sold ${soldClass(v)}">${v}</td>`;
    }).join('');
    const latest = [...dates].reverse().map(dt=>h.days[dt].data[it.name]).find(Boolean);
    mrows += `<tr data-t="${esc(it.tournament)}" data-n="${esc(it.team)}"><td><a href="${cardUrl(it.name)}" target="_blank" rel="noopener">${esc(it.team)}</a></td>${cells}<td data-v="${latest?.price??0}">${yuan(latest?.price)}</td></tr>`;
  }
  const matrixBody = `
<h1>Сводная история продаж (Sold Today)</h1>
<p class="sub">Строки — наклейки команд, столбцы — даты. <a href="index.html">← дашборд</a></p>
<div class="bar">
 <input id="q" placeholder="поиск по команде…" oninput="filt()">
 <select id="tf" onchange="filt()"><option value="">все турниры</option>${tournaments.map(t=>`<option>${esc(t)}</option>`).join('')}</select>
 <span class="pill">${items.length} наклеек · ${dates.length} дней</span>
</div>
<div class="tablewrap"><table><thead><tr><th onclick="sortT(this)">Команда</th>${dates.map(d=>`<th data-num="1" onclick="sortT(this)">${d.slice(5)}</th>`).join('')}<th data-num="1" onclick="sortT(this)">Цена</th></tr></thead>
<tbody>${mrows}</tbody></table></div>
<p class="foot">Зелёным — дни с активными продажами (≥5). «·» — данных за день нет.</p>`;
  writeFileSync(join(outDir, 'history.html'), page('История продаж', matrixBody));

  // ---------- dashboard ----------
  const dayLinks = [...dates].reverse().map(d => {
    const sold = items.reduce((s,it)=> s + (h.days[d].data[it.name]?.soldToday||0), 0);
    const cnt = items.filter(it=>h.days[d].data[it.name]).length;
    return `<tr><td><a href="day_${d}.html">${d}</a></td><td data-num="1">${sold}</td><td data-num="1">${cnt}</td><td>${esc(h.days[d].scrapedAt)}</td></tr>`;
  }).join('');
  const byT = tournaments.map(t => {
    const c = items.filter(i=>i.tournament===t).length;
    return `<tr><td>${esc(t)}</td><td data-num="1">${c}</td></tr>`;
  }).join('');
  const dash = `
<h1>SteamDT — мониторинг продаж наклеек CS2</h1>
<p class="sub">Команды (Holo) · ${items.length} наклеек · ${dates.length} дней наблюдений · обновлено ${esc(dates.length?h.days[dates[dates.length-1]].scrapedAt:'—')}</p>
<div class="cards">
 <div class="kpi"><div class="n">${items.length}</div><div class="l">наклеек отслеживается</div></div>
 <div class="kpi"><div class="n">${tournaments.length}</div><div class="l">турниров</div></div>
 <div class="kpi"><div class="n">${dates.length}</div><div class="l">дней истории</div></div>
 <div class="kpi"><div class="n"><a href="history.html">матрица →</a></div><div class="l">сводная история</div></div>
</div>
<h3>Выгрузки по дням</h3>
<div class="tablewrap" style="max-height:40vh"><table><thead><tr><th onclick="sortT(this)">Дата</th><th data-num="1" onclick="sortT(this)">Sold всего</th><th data-num="1" onclick="sortT(this)">Позиций</th><th onclick="sortT(this)">Снято</th></tr></thead><tbody>${dayLinks||'<tr><td colspan=4>пока нет данных</td></tr>'}</tbody></table></div>
<h3 style="margin-top:22px">Турниры</h3>
<div class="tablewrap" style="max-height:40vh"><table><thead><tr><th>Коллекция</th><th data-num="1">Наклеек</th></tr></thead><tbody>${byT}</tbody></table></div>
<p class="foot">Главный показатель — Sold Today (продажи за текущий день). Данные: steamdt.com. Сырые данные — data/history.json.</p>`;
  writeFileSync(join(outDir, 'index.html'), page('SteamDT мониторинг', dash));

  console.log(`reports: ${dates.length} день(дней), ${items.length} наклеек -> reports/index.html`);
}

// allow standalone: node report.mjs
if (process.argv[1] && process.argv[1].endsWith('report.mjs')) {
  buildReports(dirname(fileURLToPath(import.meta.url)));
}
