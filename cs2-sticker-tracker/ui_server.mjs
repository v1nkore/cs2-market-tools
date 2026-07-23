// Панель ежедневной выгрузки продаж наклеек CS2 со SteamDT.
// Одна кнопка «Запустить / продолжить»: собирает показатель «продано сегодня» по
// командным Holo-наклейкам турниров, копит историю по дням, строит HTML-отчёты.
// При сбое сама продолжает с места остановки; недобранное добирает авто-возобновлением.
import http from 'http';
import { spawn, exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const MAX_RESUME = 15;
const BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || join(ROOT, 'pw-browsers');
const REPORT = join('reports', 'index.html');

const pad = (n) => String(n).padStart(2, '0');
const siteDate = (d = new Date()) => { const b = new Date(d.getTime() + 8 * 3600000); return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`; };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function totalStickers() {
  const cfg = readJson(join(ROOT, 'config.json'));
  return cfg && Array.isArray(cfg.tournaments) ? cfg.tournaments.reduce((s, t) => s + (t.teams?.length || 0), 0) : 0;
}
function collectedToday() {
  const h = readJson(join(ROOT, 'data', 'history.json'));
  const day = h?.days?.[siteDate()];
  return day ? Object.keys(day.data).length : 0;
}

const st = { running: false, proc: null, stop: false, fresh: false, attempts: 0, quickFails: 0, live: 0, total: totalStickers(), current: '', status: 'idle', lastErr: '', spawnAt: 0, startedAt: null, endedAt: null };

const crashHint = (e) =>
  /ERR_MODULE_NOT_FOUND|Cannot find package/i.test(e) ? 'не установлены зависимости — выполните npm ci (или перезапустите «Открыть панель.bat»)' :
  /Executable doesn't exist|playwright install/i.test(e) ? 'не установлен браузер — выполните npx playwright install chromium (или перезапустите «Открыть панель.bat»)' : null;

function spawnOnce(fresh) {
  const args = [join(ROOT, 'scrape.mjs')];
  if (fresh) args.push('--fresh');
  const proc = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH } });
  st.proc = proc; st.spawnAt = Date.now();
  const startedDone = Math.max(collectedToday(), st.live);
  const onData = (buf) => {
    const s = buf.toString();
    let m, re = /\[(\d+)\/(\d+)\]/g;
    while ((m = re.exec(s))) { st.live = +m[1]; st.total = +m[2]; }
    const lines = s.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
    if (lines.length) st.current = lines[lines.length - 1].slice(0, 90);
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', (buf) => { st.lastErr = ((st.lastErr || '') + buf.toString()).slice(-2000); onData(buf); });
  proc.on('exit', () => {
    st.proc = null;
    const saved = collectedToday();
    const done = Math.max(saved, st.live);
    if (st.stop) { st.status = 'остановлено'; st.running = false; st.endedAt = Date.now(); return; }
    if (saved >= st.total && st.total > 0) { st.status = 'готово'; st.live = st.total; st.running = false; st.endedAt = Date.now(); return; }
    const ranMs = Date.now() - st.spawnAt;
    st.quickFails = (ranMs < 8000 && done <= startedDone) ? (st.quickFails || 0) + 1 : 0;
    if (st.quickFails >= 3) { st.status = 'сбой: ' + (crashHint(st.lastErr || '') || ((st.lastErr || 'причина неизвестна, смотрите консоль').replace(/\s+/g, ' ').slice(0, 160))); st.running = false; st.endedAt = Date.now(); return; }
    if (st.attempts < MAX_RESUME) { st.attempts++; st.status = `возобновление (${st.attempts})…`; setTimeout(() => { if (!st.stop) spawnOnce(false); }, 2500); }
    else { st.status = 'остановлено (лимит попыток)'; st.running = false; st.endedAt = Date.now(); }
  });
}

function startJob(fresh) {
  if (st.running) return;
  if (totalStickers() === 0) { st.status = 'нет config.json'; return; }
  if (!existsSync(join(ROOT, 'node_modules', 'playwright'))) { st.status = 'нет зависимостей — npm ci (или перезапустите «Открыть панель.bat»)'; return; }
  if (!existsSync(BROWSERS_PATH)) { st.status = 'нет браузера — npx playwright install chromium'; return; }
  Object.assign(st, { running: true, stop: false, fresh: !!fresh, attempts: 0, quickFails: 0, lastErr: '', total: totalStickers(), startedAt: Date.now(), endedAt: null, current: '', live: fresh ? 0 : collectedToday() });
  spawnOnce(fresh);
  st.status = fresh ? 'перевыгрузка с нуля…' : 'идёт сбор…';
}
function stopJob() {
  st.stop = true;
  if (st.proc) { try { process.platform === 'win32' ? exec(`taskkill /pid ${st.proc.pid} /T /F`) : st.proc.kill('SIGKILL'); } catch {} }
  st.running = false; st.status = 'остановлено'; st.endedAt = Date.now();
}

function statusPayload() {
  const saved = collectedToday();
  const done = st.running ? (st.fresh ? st.live : Math.max(st.live, saved)) : saved;
  return { running: st.running, done, total: st.total || totalStickers(), current: st.current, status: st.status, date: siteDate() };
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
  if (url.pathname === '/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(statusPayload())); return; }
  if (url.pathname === '/start') { startJob(url.searchParams.get('fresh') === '1'); res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/stop') { stopJob(); res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/open') {
    const p = join(ROOT, REPORT);
    if (existsSync(p)) { const o = process.platform === 'win32' ? `start "" "${p}"` : process.platform === 'darwin' ? `open "${p}"` : `xdg-open "${p}"`; try { exec(o); } catch {} }
    res.writeHead(200); res.end('ok'); return;
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`Панель наклеек: http://localhost:${PORT}`));

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CS2 Sticker Tracker</title><style>
:root{--bg:#0e1014;--card:#161922;--card2:#1e222d;--bd:#2a2f3c;--tx:#eceef2;--mut:#8b93a3;--acc:#6aa5ff;--good:#3ddc97;--warn:#f5b74e;--bad:#f8746a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#182033 0,var(--bg) 60%);color:var(--tx);font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh}
.wrap{max-width:640px;margin:0 auto;padding:40px 24px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--mut);box-shadow:0 0 0 4px rgba(139,147,163,.15)}
.dot.run{background:var(--acc);box-shadow:0 0 0 4px rgba(106,165,255,.18);animation:pulse 1.4s infinite}
.dot.done{background:var(--good);box-shadow:0 0 0 4px rgba(61,220,151,.18)}
.dot.warn{background:var(--warn);box-shadow:0 0 0 4px rgba(245,183,78,.18)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
h1{font-size:23px;margin:0;font-weight:700}
.sub{color:var(--mut);font-size:13px;margin:4px 0 26px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:24px;box-shadow:0 10px 40px -20px rgba(0,0,0,.6)}
.statusrow{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}
.big{font-size:38px;font-weight:800;letter-spacing:-.5px}
.big .of{color:var(--mut);font-size:22px;font-weight:600}
.status{font-size:14px;color:var(--mut);text-align:right}
.status b{color:var(--tx)}
.barwrap{background:var(--card2);border-radius:999px;height:12px;overflow:hidden}
.bar{height:100%;width:0;background:linear-gradient(90deg,var(--acc),var(--good));transition:width .5s;border-radius:999px}
.pctline{display:flex;justify-content:space-between;color:var(--mut);font-size:12px;margin-top:8px}
.cur{color:var(--mut);font-size:12px;margin-top:14px;min-height:18px;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btns{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}
button{font:inherit;border:1px solid var(--bd);background:var(--card2);color:var(--tx);padding:11px 18px;border-radius:12px;cursor:pointer;transition:.15s}
button:hover:not(:disabled){border-color:var(--acc);transform:translateY(-1px)}
button.primary{background:var(--acc);color:#0a0d14;border-color:var(--acc);font-weight:700;flex:1;min-width:190px}
button.stop{background:transparent;border-color:#5a2b30;color:#ffb4ad}
button:disabled{opacity:.4;cursor:default;transform:none}
.linkrow{margin-top:14px;display:flex;justify-content:space-between;align-items:center}
a.link{color:var(--acc);text-decoration:none;font-size:13px}
.hint{color:var(--mut);font-size:12px}
.foot{color:var(--mut);font-size:12px;margin-top:22px;line-height:1.6}
</style></head><body><div class="wrap">
  <div class="top"><span class="dot" id="dot"></span><h1>CS2 Sticker Tracker</h1></div>
  <p class="sub">Продажи командных Holo-наклеек за день со SteamDT · дата сайта <b id="date">—</b></p>
  <div class="card">
    <div class="statusrow">
      <div class="big"><span id="done">0</span><span class="of"> / <span id="total">0</span></span></div>
      <div class="status" id="status">—</div>
    </div>
    <div class="barwrap"><div class="bar" id="bar"></div></div>
    <div class="pctline"><span id="label">наклеек собрано сегодня</span><span id="pct">0%</span></div>
    <div class="cur" id="cur"></div>
    <div class="btns">
      <button class="primary" id="b-start" onclick="act('start')">▶ Запустить / продолжить</button>
      <button id="b-fresh" onclick="fresh()">↻ Собрать заново</button>
      <button class="stop" id="b-stop" onclick="act('stop')" disabled>■ Остановить</button>
    </div>
    <div class="linkrow"><span class="hint">Собрано за сегодня сохраняется — можно закрыть и продолжить позже</span><a class="link" href="#" onclick="act('open');return false">Открыть отчёт ↗</a></div>
  </div>
  <p class="foot">Счётчик «продано сегодня» на SteamDT обнуляется в полночь по Пекину (UTC+8 ≈ 19:00 МСК) — запускайте после этого. Окно консоли не закрывайте, пока идёт сбор.</p>
</div><script>
function set(id,v){document.getElementById(id).textContent=v}
async function act(a){await fetch('/'+a,{method:'POST'});setTimeout(refresh,250)}
async function fresh(){if(!confirm('Перевыгрузить сегодняшний день с нуля? Текущие значения за сегодня будут перезаписаны.'))return;await fetch('/start?fresh=1',{method:'POST'});setTimeout(refresh,250)}
async function refresh(){
  let d; try{d=await (await fetch('/status')).json()}catch{return}
  const pct=d.total?Math.round(d.done/d.total*100):0;
  set('date',d.date); set('done',d.done); set('total',d.total); set('status',d.status); set('pct',pct+'%');
  document.getElementById('bar').style.width=pct+'%';
  set('cur',d.running?(d.current||''):'');
  let cls='';if(d.running)cls='run';else if(d.status.startsWith('готово'))cls='done';else if(/лимит|нет |сбой/.test(d.status))cls='warn';
  document.getElementById('dot').className='dot '+cls;
  document.getElementById('b-start').disabled=d.running;
  document.getElementById('b-fresh').disabled=d.running;
  document.getElementById('b-stop').disabled=!d.running;
}
refresh();setInterval(refresh,1200);
</script></body></html>`;
