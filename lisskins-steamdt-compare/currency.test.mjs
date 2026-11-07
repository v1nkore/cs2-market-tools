import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseLisRubRate, parseLisRubRate, steamdtRubCookie } from './currency.mjs';

test('reads the LIS-SKINS RUB rate from the Nuxt payload', () => {
  const payload = '["rub","RUB","Ruble","86.57","₽"]';
  const rate = parseLisRubRate(payload);

  assert.equal(rate, 86.57);
  assert.equal(Math.round(2.2 * rate * 100) / 100, 190.45);
});

test('selects RUB in SteamDT before parsing', () => {
  assert.deepEqual(steamdtRubCookie(), {
    name: 'SDT_MonetaryUnit',
    value: JSON.stringify({ currency: 'RUB' }),
    domain: '.steamdt.com',
    path: '/',
  });
});

test('prefers an explicitly provided LIS-SKINS RUB rate', () => {
  const result = chooseLisRubRate('87.12', { usd_rate: 86.57, generatedAt: '2026-11-01T10:00:00.000Z' });
  assert.equal(result.rate, 87.12);
  assert.equal(result.source, 'provided');
});

test('falls back to the last successful LIS-SKINS RUB rate', () => {
  assert.deepEqual(
    chooseLisRubRate(null, { usd_rate: 86.57, generatedAt: '2026-11-01T10:00:00.000Z' }),
    { rate: 86.57, source: 'cached:data.json', updatedAt: '2026-11-01T10:00:00.000Z' },
  );
});

test('fails clearly when no LIS-SKINS RUB rate is available', () => {
  assert.throws(() => chooseLisRubRate(null, null), /не задан курс/);
});
