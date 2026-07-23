// SteamDT CS2 team-sticker daily sales scraper.
// Thin wrapper over scrape_engine.mjs (strategy B: in-page fetch + navigation fallback).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildReports } from './report.mjs';
import { runDailyScrape } from './scrape_engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = join(ROOT, 'pw-browsers');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const argv = process.argv.slice(2);
const getOpt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const LIMIT = getOpt('--limit') ? Number(getOpt('--limit')) : null;
const ONLY = getOpt('--tournament');
const FRESH = argv.includes('--fresh');

// Build the flat work list of team Holo stickers.
function workList() {
  const items = [];
  for (const t of cfg.tournaments) {
    if (ONLY && t.key !== ONLY) continue;
    for (const team of t.teams) {
      items.push({ tournamentKey: t.key, tournament: t.name, team, marketHashName: `Sticker | ${team} (Holo) | ${t.name}` });
    }
  }
  return LIMIT ? items.slice(0, LIMIT) : items;
}

runDailyScrape({
  root: ROOT,
  dataDir: 'data',
  items: workList(),
  label: 'SteamDT наклейки',
  fresh: FRESH,
  itemMeta: (it) => ({ name: it.marketHashName, tournament: it.tournament, tournamentKey: it.tournamentKey, team: it.team }),
  buildReports,
}).catch(e => { console.error(e); process.exit(1); });
