// Перегенерация index.html (строка const DATA, шапка, ссылка списка) и comparison.xlsx
// из data.json. Вызывается из scrape.mjs или вручную: node build.mjs [data.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function build(dataPath = path.join(__dirname, 'data.json')) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const htmlPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');

  const compactRows = data.rows
    .filter(r => r.steam_rub != null || r.buff_rub != null || r.youpin_rub != null)
    .map(r => [String(r.id), r.name, r.url, r.qty, r.lis_rub, r.steam_rub ?? 0, r.buff_rub ?? 0, r.youpin_rub ?? 0, r.category || '', r.rarity || '']);

  const dataLine = 'const DATA = ' + JSON.stringify({
    usd_rate: data.usd_rate, cny_rate: data.cny_rate, rows: compactRows,
  }) + ';';
  if (!/^const DATA = .*;$/m.test(html)) throw new Error('index.html: не найдена строка const DATA');
  html = html.replace(/^const DATA = .*;$/m, dataLine);

  const d = new Date(data.generatedAt);
  const stamp = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear() +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const metaText = `${compactRows.length} позиций избранного · курс $ ${data.usd_rate} ₽ · курс ¥ ${data.cny_rate} ₽ · обновлено ${stamp}`;
  html = html.replace(/(id="meta-line">)[^<]*(<\/div>)/, `$1${metaText}$2`);
  html = html.replace(/(id="list-url" type="text" value=")[^"]*(")/, `$1${data.listUrl}$2`);

  fs.writeFileSync(htmlPath, html, 'utf-8');

  // Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Сравнение цен');
  ws.addRow([`Сравнение цен LIS-SKINS vs SteamDT (Steam/BUFF/YouPin), обновлено ${stamp}`]);
  ws.addRow([`Список: ${data.listUrl}`]);
  ws.addRow(['Курс USD→RUB', data.usd_rate, '', 'Курс CNY→RUB', data.cny_rate]);
  ws.addRow([]);
  const header = ws.addRow(['Скин', 'Кол-во', 'LIS-SKINS $', 'LIS-SKINS ₽', 'Steam ₽', 'BUFF ₽', 'YouPin ₽', 'Лучшая SteamDT ₽', 'Разница ₽', 'Разница %', 'Категория', 'Редкость']);
  header.font = { bold: true };
  const first = 6;
  data.rows.forEach((r, i) => {
    const n = first + i;
    ws.addRow([
      r.name, r.qty, r.lis_usd,
      { formula: `C${n}*$B$3` },
      r.steam_rub, r.buff_rub, r.youpin_rub,
      { formula: `MIN(E${n}:G${n})` },
      { formula: `H${n}-D${n}` },
      { formula: `IF(D${n}=0,"",(H${n}-D${n})/D${n})` },
      r.category || '', r.rarity || '',
    ]);
  });
  ws.getColumn(1).width = 50;
  for (const c of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) ws.getColumn(c).width = 14;
  for (let i = 0; i < data.rows.length; i++) ws.getCell(first + i, 10).numFmt = '0.0%';
  await wb.xlsx.writeFile(path.join(__dirname, 'comparison.xlsx'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  build(process.argv[2]).then(() => console.log('build: ok')).catch(e => { console.error(e); process.exit(1); });
}
