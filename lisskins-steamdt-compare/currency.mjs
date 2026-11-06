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
