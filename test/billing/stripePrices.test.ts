import { describe, it, expect, afterEach, vi } from 'vitest';

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

async function load() {
  vi.resetModules();
  return import('@/lib/stripePrices');
}

describe('priceIdFor', () => {
  it('prefers the per-currency price, falls back to the base price', async () => {
    process.env.PRICE_PRO_MONTH = 'price_base';
    process.env.PRICE_PRO_MONTH_TRY = 'price_try';
    const { priceIdFor } = await load();
    expect(priceIdFor('pro', 'month', 'try')).toBe('price_try');
    expect(priceIdFor('pro', 'month', 'usd')).toBe('price_base');
    expect(priceIdFor('pro', 'month', null)).toBe('price_base');
  });

  it('ignores unknown currencies and returns undefined when nothing is configured', async () => {
    delete process.env.PRICE_GROWTH_YEAR;
    process.env.PRICE_GROWTH_YEAR_EUR = 'price_eur';
    const { priceIdFor } = await load();
    expect(priceIdFor('growth', 'year', 'eur')).toBeUndefined();
  });
});
