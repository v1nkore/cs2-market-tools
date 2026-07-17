// Локальная панель: отдаёт index.html и по кнопке запускает пересборку данных
// (scrape.mjs в дочернем процессе). После успешной пересборки файлы index.html,
// comparison.xlsx и data.json уже перезаписаны на диске; опционально коммитит и пушит.
//
//   node server.mjs            → http://localhost:8317
//   GIT_AUTOPUSH=0             → не коммитить/пушить (по умолчанию включено, если есть .git)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8317);
const REPO_ROOT = path.resolve(__dirname, '..');
const AUTOPUSH = process.env.GIT_AUTOPUSH !== '0' && fs.existsSync(path.join(REPO_ROOT, '.git'));

const state = { running: false, stage: null, done: 0, total: 0, msg: '', error: null, finishedAt: null, gitResult: null };

function runGitPush(cb) {
  const files = ['lisskins-steamdt-compare/index.html', 'lisskins-steamdt-compare/comparison.xlsx', 'lisskins-steamdt-compare/data.json'];
  execFile('git', ['-C', REPO_ROOT, 'add', ...files], err => {
    if (err) return cb('git add: ' + err.message);
    execFile('git', ['-C', REPO_ROOT, 'commit', '-m', 'lisskins-steamdt-compare: auto-rebuild data'], err2 => {
      if (err2) return cb('git commit: ' + err2.message);
      execFile('git', ['-C', REPO_ROOT, 'push'], err3 => cb(err3 ? 'git push: ' + err3.message : 'ok'));
    });
  });
}

function startRebuild(listUrl) {
  state.running = true;
  Object.assign(state, { stage: 'start', done: 0, total: 0, msg: '', error: null, finishedAt: null, gitResult: null });
  const args = [path.join(__dirname, 'scrape.mjs')];
  if (listUrl) args.push('--url', listUrl);
  const child = spawn(process.execPath, args, { cwd: __dirname, env: process.env });
  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('PROGRESS ')) {
        try { Object.assign(state, JSON.parse(line.slice(9))); } catch {}
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', c => { stderr += c.toString(); });
  child.on('close', code => {
    if (code === 0) {
      state.stage = 'done';
      state.msg = 'файлы перезаписаны';
      state.finishedAt = new Date().toISOString();
      if (AUTOPUSH) {
        state.stage = 'git';
        runGitPush(res => { state.gitResult = res; state.stage = 'done'; state.running = false; });
        return;
      }
    } else {
      state.error = 'scrape завершился с кодом ' + code + (stderr ? ': ' + stderr.slice(-500) : '');
      state.stage = 'error';
    }
    state.running = false;
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify(state));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/rebuild') {
    if (state.running) { res.writeHead(409, { 'content-type': MIME['.json'] }); res.end(JSON.stringify({ error: 'already running' })); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let listUrl = null;
      try { listUrl = JSON.parse(body || '{}').url || null; } catch {}
      startRebuild(listUrl);
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify({ started: true }));
    });
    return;
  }
  if (req.method === 'GET' && ['/comparison.xlsx', '/data.json'].includes(url.pathname)) {
    const f = path.join(__dirname, url.pathname.slice(1));
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
      return;
    }
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  console.log(`lisskins-steamdt-compare: http://localhost:${PORT} (autopush: ${AUTOPUSH ? 'on' : 'off'})`);
});
