import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLisRubRate, steamdtRubCookie } from './currency.mjs';

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
