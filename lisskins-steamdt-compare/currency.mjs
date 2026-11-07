export function parseLisRubRate(payloadText) {
  const match = String(payloadText || '').match(
    /"rub","RUB","Ruble","([0-9]+(?:\.[0-9]+)?)","₽"/i,
  );
  const rate = match ? Number(match[1]) : null;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function steamdtRubCookie() {
  return {
    name: 'SDT_MonetaryUnit',
    value: JSON.stringify({ currency: 'RUB' }),
    domain: '.steamdt.com',
    path: '/',
  };
}

export function chooseLisRubRate(explicitRate, previousData) {
  const explicit = Number(explicitRate);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { rate: explicit, source: 'provided', updatedAt: new Date().toISOString() };
  }

  const cached = Number(previousData && previousData.usd_rate);
  if (Number.isFinite(cached) && cached > 0) {
    return {
      rate: cached,
      source: 'cached:data.json',
      updatedAt: previousData.usd_rate_updated_at || previousData.generatedAt || null,
    };
  }

  throw new Error('не задан курс LIS-SKINS USD→RUB и нет предыдущего значения в data.json');
}
