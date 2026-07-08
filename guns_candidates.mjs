// Build the candidate list of normal-quality gun skins in FN/MW from the
// authoritative CS2 dataset (ByMykel/CSGO-API). Writes data_guns/candidates.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data_guns');
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

const SRC = join(ROOT, '_dev', 'skins_ng.json');
if (!existsSync(SRC)) { console.error('Нет _dev/skins_ng.json — скачайте датасет CS2 (ByMykel).'); process.exit(1); }

const GUN_CATS = new Set(['Rifles', 'Pistols', 'SMGs', 'Heavy']); // пушки (без ножей/перчаток/агентов)
const WEARS = new Set(['Factory New', 'Minimal Wear']);

const d = JSON.parse(readFileSync(SRC, 'utf8'));
const seen = new Set();
const items = [];
for (const x of d) {
  if (!GUN_CATS.has(x.category?.name)) continue;
  if (!WEARS.has(x.wear?.name)) continue;
  if (x.stattrak || x.souvenir) continue;             // только обычные
  const mhn = x.market_hash_name;
  if (!mhn || seen.has(mhn)) continue;
  seen.add(mhn);
  items.push({
    marketHashName: mhn,
    category: x.category.name,
    weapon: x.weapon?.name || '',
    pattern: x.pattern?.name || '',
    wear: x.wear.name,
  });
}
items.sort((a, b) => a.category.localeCompare(b.category) || a.marketHashName.localeCompare(b.marketHashName));
writeFileSync(join(DATA, 'candidates.json'), JSON.stringify(items, null, 2));

const byCat = {};
for (const it of items) byCat[it.category] = (byCat[it.category] || 0) + 1;
console.log('Кандидатов (normal, пушки, FN/MW):', items.length);
console.log('По типу:', JSON.stringify(byCat));
console.log('-> data_guns/candidates.json');
