// Daily scraper for the selected gun skins (config_guns.json).
// Thin wrapper over scrape_engine.mjs (strategy B: in-page fetch + navigation fallback).
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildGunReports } from './report_guns.mjs';
import { runDailyScrape } from './scrape_engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(ROOT, 'pw-browsers');
const CONFIG = join(ROOT, 'config_guns.json');
if (!existsSync(CONFIG)) { console.error('Нет config_guns.json — сначала запустите отбор (guns_select.mjs).'); process.exit(1); }
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));

const argv = process.argv.slice(2);
const getOpt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const LIMIT = getOpt('--limit') ? Number(getOpt('--limit')) : null;
const FRESH = argv.includes('--fresh');

const stripWear = (mhn) => mhn.replace(/\s*\((Factory New|Minimal Wear)\)\s*$/, '');
let items = cfg.items;
if (LIMIT) items = items.slice(0, LIMIT);

runDailyScrape({
  root: ROOT,
  dataDir: 'data_guns',
  items,
  label: 'Пушки CS2 (FN/MW)',
  fresh: FRESH,
  itemMeta: (it) => ({ name: it.marketHashName, category: it.category, label: stripWear(it.marketHashName), wear: it.wear, avgDaily: it.avgDaily }),
  buildReports: buildGunReports,
}).catch(e => { console.error(e); process.exit(1); });
