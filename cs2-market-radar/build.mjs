// Перегенерация дашборда index.html из data.json: подставляет строку `const DATA = ...`
// и шапку. Индексы аномалий считаются в самом дашборде (JS), чтобы фильтры/пороги
// пересчитывались на лету.  Вызывается из scrape.mjs или вручную: node build.mjs [data.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function build(dataPath = path.join(__dirname, 'data.json')) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const htmlPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');

  const line = 'const DATA = ' + JSON.stringify({ siteDate: data.siteDate, generatedAt: data.generatedAt, rows: data.rows }) + ';';
  if (!/^const DATA = .*;$/m.test(html)) throw new Error('index.html: не найдена строка const DATA');
  html = html.replace(/^const DATA = .*;$/m, line);

  const d = new Date(data.generatedAt);
  const stamp = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  html = html.replace(/(id="meta-line">)[^<]*(<\/div>)/, `$1${data.rows.length} позиций активного рынка · день ${data.siteDate} · обновлено ${stamp}$2`);

  fs.writeFileSync(htmlPath, html, 'utf-8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  build(process.argv[2]).then(() => console.log('build: ok')).catch((e) => { console.error(e); process.exit(1); });
}
