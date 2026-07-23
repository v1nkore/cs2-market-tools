// Локальная панель: отдаёт дашборд и по кнопке «Собрать заново» запускает scrape.mjs.
// После сбора index.html / data.json перезаписаны на диске; если папка — git-репозиторий
// и GIT_AUTOPUSH!=0, изменения коммитятся и пушатся.
//   node server.mjs   → http://localhost:8319

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8319);
const REPO_ROOT = path.resolve(__dirname, '..');
const AUTOPUSH = process.env.GIT_AUTOPUSH !== '0' && fs.existsSync(path.join(REPO_ROOT, '.git'));
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const state = { running: false, stage: null, done: 0, total: 0, msg: '', error: null, gitResult: null };

function gitPush(cb) {
  const files = ['cs2-market-radar/index.html', 'cs2-market-radar/data.json'];
  execFile('git', ['-C', REPO_ROOT, 'add', ...files], (e) => {
    if (e) return cb('git add: ' + e.message);
    execFile('git', ['-C', REPO_ROOT, 'commit', '-m', 'cs2-market-radar: auto-rebuild snapshot'], (e2) => {
      if (e2) return cb('git commit: ' + e2.message);
      execFile('git', ['-C', REPO_ROOT, 'push'], (e3) => cb(e3 ? 'git push: ' + e3.message : 'ok'));
    });
  });
}

function startRebuild() {
  if (!fs.existsSync(path.join(__dirname, 'node_modules', 'playwright'))) {
    Object.assign(state, { running: false, stage: 'error', error: 'Нет зависимостей — выполните npm install (Chromium поставится сам), затем перезапустите сервер.' });
    return;
  }
  Object.assign(state, { running: true, stage: 'start', done: 0, total: 0, msg: '', error: null, gitResult: null });
  const child = spawn(process.execPath, [path.join(__dirname, 'scrape.mjs')], { cwd: __dirname, env: process.env });
  let buf = '', stderr = '';
  child.stdout.on('data', (c) => {
    buf += c.toString();
    let i; while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('PROGRESS ')) { try { Object.assign(state, JSON.parse(line.slice(9))); } catch {} }
    }
  });
  child.stderr.on('data', (c) => { stderr += c.toString(); });
  child.on('close', (code) => {
    if (code === 0) {
      state.stage = 'done'; state.msg = 'готово';
      if (AUTOPUSH) { state.stage = 'git'; gitPush((res) => { state.gitResult = res; state.stage = 'done'; state.running = false; }); return; }
    } else {
      const hint = /ERR_MODULE_NOT_FOUND|Cannot find package/i.test(stderr) ? ' — выполните npm install' : /Executable doesn't exist|playwright install/i.test(stderr) ? ' — выполните npx playwright install chromium' : '';
      state.error = 'сбор завершился с кодом ' + code + hint + (stderr ? ' | ' + stderr.slice(0, 300) : '');
      state.stage = 'error';
    }
    state.running = false;
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); return;
  }
  if (req.method === 'GET' && url.pathname === '/api/status') { res.writeHead(200, { 'content-type': MIME['.json'] }); res.end(JSON.stringify(state)); return; }
  if (req.method === 'POST' && url.pathname === '/api/rebuild') {
    if (state.running) { res.writeHead(409, { 'content-type': MIME['.json'] }); res.end(JSON.stringify({ error: 'already running' })); return; }
    startRebuild(); res.writeHead(200, { 'content-type': MIME['.json'] }); res.end(JSON.stringify({ started: true })); return;
  }
  if (req.method === 'GET' && url.pathname === '/data.json') {
    const f = path.join(__dirname, 'data.json');
    if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME['.json'] }); res.end(fs.readFileSync(f)); return; }
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`cs2-market-radar: http://localhost:${PORT} (autopush: ${AUTOPUSH ? 'on' : 'off'})`));
