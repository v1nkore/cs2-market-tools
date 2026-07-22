// Локальная панель управления выгрузками (наклейки и пушки).
// Кнопки «Запустить / продолжить» и «Остановить», прогресс-бар, авто-возобновление
// при сбое (выгрузки возобновляются в рамках дня). Открывается в браузере.
import http from 'http';
import { spawn, exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 4317;
const MAX_RESUME = 15; // максимум авто-перезапусков при сбоях за один «Запуск»
// путь к браузерам Playwright: уважаем внешний env (например, /ms-playwright в Docker-образе),
// иначе локальная папка проекта
const BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || join(ROOT, 'pw-browsers');

const pad = (n) => String(n).padStart(2, '0');
const siteDate = (d = new Date()) => { const b = new Date(d.getTime() + 8 * 3600000); return `${b.getUTCFullYear()}-${pad(b.getUTCMonth()+1)}-${pad(b.getUTCDate())}`; };

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

const JOBS = {
  stickers: { title: 'Наклейки команд', script: 'scrape.mjs', config: 'config.json', dataDir: 'data', report: join('reports', 'index.html') },
  guns:     { title: 'Пушки (FN/MW)',    script: 'scrape_guns.mjs', config: 'config_guns.json', dataDir: 'data_guns', report: join('reports_guns', 'index.html') },
};

function totalFor(job) {
  const cfgPath = join(ROOT, JOBS[job].config);
  const cfg = readJson(cfgPath);
  if (!cfg) return 0;
  if (Array.isArray(cfg.items)) return cfg.items.length;                       // guns
  if (Array.isArray(cfg.tournaments)) return cfg.tournaments.reduce((s, t) => s + (t.teams?.length || 0), 0); // stickers
  return 0;
}
function collectedToday(job) {
  const h = readJson(join(ROOT, JOBS[job].dataDir, 'history.json'));
  const day = h?.days?.[siteDate()];
  return day ? Object.keys(day.data).length : 0;
}

// рантайм-состояние
const state = {};
for (const k of Object.keys(JOBS)) state[k] = { running: false, proc: null, stop: false, fresh: false, attempts: 0, live: 0, total: totalFor(k), current: '', status: 'idle', startedAt: null, endedAt: null };

function crashHint(errText) {
  if (/ERR_MODULE_NOT_FOUND|Cannot find package/i.test(errText)) return 'не установлены зависимости — выполните: npm ci (или перезапустите «Открыть панель.bat»)';
  if (/Executable doesn't exist|playwright install/i.test(errText)) return 'не установлен браузер — выполните: npx playwright install chromium (или перезапустите «Открыть панель.bat»)';
  return null;
}

function spawnOnce(job, fresh) {
  const j = JOBS[job], st = state[job];
  const args = [join(ROOT, j.script)];
  if (fresh) args.push('--fresh');
  const proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
  });
  st.proc = proc;
  st.spawnAt = Date.now();
  const startedDone = Math.max(collectedToday(job), st.live);
  const onData = (buf) => {
    const s = buf.toString();
    let m, re = /\[(\d+)\/(\d+)\]/g;
    while ((m = re.exec(s))) { st.live = +m[1]; st.total = +m[2]; }
    const lines = s.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
    if (lines.length) st.current = lines[lines.length - 1].slice(0, 80);
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', (buf) => { st.lastErr = ((st.lastErr || '') + buf.toString()).slice(-2000); onData(buf); });
  proc.on('exit', (code) => {
    st.proc = null;
    // завершение считаем по РЕАЛЬНО сохранённым позициям, а не по счётчику прогресса
    // (счётчик доходит до total, даже если часть позиций упала в таймаут — тогда нужно
    // возобновиться и добрать недостающие, а не рапортовать «готово»)
    const saved = collectedToday(job);
    const done = Math.max(saved, st.live);
    if (st.stop) { st.status = 'остановлено'; st.running = false; st.endedAt = Date.now(); return; }
    if (saved >= st.total && st.total > 0) { st.status = 'готово'; st.live = st.total; st.running = false; st.endedAt = Date.now(); return; }
    // быстрый краш без прогресса — не жжём попытки, а сразу показываем причину
    const ranMs = Date.now() - st.spawnAt;
    st.quickFails = (ranMs < 8000 && done <= startedDone) ? (st.quickFails || 0) + 1 : 0;
    if (st.quickFails >= 3) {
      const hint = crashHint(st.lastErr || '');
      st.status = 'сбой: ' + (hint || ((st.lastErr || 'причина неизвестна, смотрите консоль').replace(/\s+/g, ' ').slice(0, 160)));
      st.running = false; st.endedAt = Date.now();
      return;
    }
    if (st.attempts < MAX_RESUME) { st.attempts++; st.status = `возобновление (${st.attempts})…`; setTimeout(() => { if (!st.stop) spawnOnce(job); }, 2500); }
    else { st.status = 'остановлено (лимит попыток)'; st.running = false; st.endedAt = Date.now(); }
  });
}

function startJob(job, fresh) {
  const st = state[job];
  if (st.running) return;
  if (totalFor(job) === 0) { st.status = job === 'guns' ? 'нет config_guns.json (сначала отбор)' : 'нет config.json'; return; }
  if (!existsSync(join(ROOT, 'node_modules', 'playwright'))) { st.status = 'нет зависимостей — выполните npm ci (или перезапустите «Открыть панель.bat»)'; return; }
  if (!existsSync(BROWSERS_PATH)) { st.status = 'нет браузера — npx playwright install chromium (или перезапустите «Открыть панель.bat»)'; return; }
  st.running = true; st.stop = false; st.fresh = !!fresh; st.attempts = 0; st.quickFails = 0; st.lastErr = ''; st.total = totalFor(job); st.status = 'запуск…'; st.startedAt = Date.now(); st.endedAt = null; st.current = '';
  st.live = fresh ? 0 : collectedToday(job);
  spawnOnce(job, fresh);
  st.status = fresh ? 'перевыгрузка с нуля…' : 'идёт сбор…';
}
function stopJob(job) {
  const st = state[job];
  st.stop = true;
  if (st.proc) {
    try {
      if (process.platform === 'win32') exec(`taskkill /pid ${st.proc.pid} /T /F`);
      else st.proc.kill('SIGKILL');
    } catch {}
  }
  st.running = false; st.status = 'остановлено'; st.endedAt = Date.now();
}

function statusPayload() {
  const out = {};
  for (const k of Object.keys(JOBS)) {
    const st = state[k];
    const saved = collectedToday(k);
    // при перевыгрузке с нуля показываем прогресс по живому счётчику (старые значения ещё в истории)
    const done = st.running ? (st.fresh ? st.live : Math.max(st.live, saved)) : saved;
    out[k] = { title: JOBS[k].title, running: st.running, done, total: st.total || totalFor(k), current: st.current, status: st.status, date: siteDate() };
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
  if (url.pathname === '/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(statusPayload())); return; }
  if (url.pathname === '/start') { startJob(url.searchParams.get('job'), url.searchParams.get('fresh') === '1'); res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/stop') { stopJob(url.searchParams.get('job')); res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/open') {
    const job = url.searchParams.get('job');
    if (JOBS[job]) {
      const p = join(ROOT, JOBS[job].report);
      if (existsSync(p)) {
        const opener = process.platform === 'win32' ? `start "" "${p}"` : process.platform === 'darwin' ? `open "${p}"` : `xdg-open "${p}"`;
        try { exec(opener); } catch {}
      }
    }
    res.writeHead(200); res.end('ok'); return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, () => console.log(`Панель управления: http://localhost:${PORT}`));

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SteamDT — панель выгрузок</title><style>
:root{--bg:#0f1116;--card:#171a21;--card2:#1f242e;--bd:#2a313d;--tx:#e6e8eb;--mut:#8a93a3;--acc:#4ea1ff;--good:#34d399;--warn:#f59e0b;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:26px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px 20px;margin-bottom:18px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.name{font-size:17px;font-weight:700}
.badge{font-size:12px;padding:3px 10px;border-radius:999px;background:var(--card2);border:1px solid var(--bd);color:var(--mut)}
.badge.run{color:#0b0e13;background:var(--acc);border-color:var(--acc)}
.badge.done{color:#0b0e13;background:var(--good);border-color:var(--good)}
.badge.warn{color:#0b0e13;background:var(--warn);border-color:var(--warn)}
.barwrap{background:var(--card2);border-radius:10px;height:22px;overflow:hidden;border:1px solid var(--bd)}
.bar{height:100%;width:0;background:linear-gradient(90deg,#3b82f6,#34d399);transition:width .4s}
.meta{display:flex;justify-content:space-between;color:var(--mut);font-size:13px;margin-top:7px}
.cur{color:var(--mut);font-size:12px;margin-top:6px;height:16px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.btns{margin-top:14px;display:flex;gap:10px;flex-wrap:wrap}
button{font:inherit;border:1px solid var(--bd);background:var(--card2);color:var(--tx);padding:9px 16px;border-radius:10px;cursor:pointer}
button:hover{border-color:var(--acc)}
button.primary{background:var(--acc);color:#0b0e13;border-color:var(--acc);font-weight:600}
button.stop{background:#3a1d22;border-color:#5b2a31;color:#ffb4b4}
button:disabled{opacity:.45;cursor:default}
a.link{color:var(--acc);text-decoration:none;font-size:13px;align-self:center}
.foot{color:var(--mut);font-size:12px;margin-top:8px}
</style></head><body><div class="wrap">
<h1>SteamDT — панель выгрузок</h1>
<p class="sub">Заходи утром и жми «Запустить». При сбое продолжит с места остановки само. Дата сайта: <b id="date">—</b></p>
<div id="cards"></div>
<p class="foot">Окно с этой панелью должно оставаться открытым, пока идёт сбор. Закрытие окна консоли остановит сервер.</p>
</div><script>
const JOBS=['stickers','guns'];
function card(k,d){
 const pct=d.total?Math.round(d.done/d.total*100):0;
 let bc='';if(d.running)bc='run';else if(d.status.startsWith('готово'))bc='done';else if(d.status.includes('лимит')||d.status.includes('нет ')||d.status.includes('сбой'))bc='warn';
 return \`<div class="card">
  <div class="row"><span class="name">\${d.title}</span><span class="badge \${bc}">\${d.status}</span></div>
  <div class="barwrap"><div class="bar" style="width:\${pct}%"></div></div>
  <div class="meta"><span>\${d.done} / \${d.total}</span><span>\${pct}%</span></div>
  <div class="cur">\${d.running?(d.current||''):''}</div>
  <div class="btns">
   <button class="primary" \${d.running?'disabled':''} onclick="act('start','\${k}')">▶ Запустить / продолжить</button>
   <button \${d.running?'disabled':''} onclick="fresh('\${k}')">↻ Собрать заново</button>
   <button class="stop" \${d.running?'':'disabled'} onclick="act('stop','\${k}')">■ Остановить</button>
   <a class="link" href="#" onclick="act('open','\${k}');return false">Открыть отчёт ↗</a>
  </div></div>\`;
}
async function act(a,k){await fetch('/'+a+'?job='+k,{method:'POST'});setTimeout(refresh,300);}
async function fresh(k){if(!confirm('Перевыгрузить сегодняшний день с нуля? Текущие значения за сегодня будут перезаписаны новыми.'))return;await fetch('/start?job='+k+'&fresh=1',{method:'POST'});setTimeout(refresh,300);}
async function refresh(){
 try{const r=await fetch('/status');const s=await r.json();
  document.getElementById('date').textContent=s.stickers.date;
  document.getElementById('cards').innerHTML=JOBS.map(k=>card(k,s[k])).join('');
 }catch(e){}
}
refresh();setInterval(refresh,1500);
</script></body></html>`;
