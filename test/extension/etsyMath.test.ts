import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

// The content script is a plain browser file with a CommonJS export fallback.
const require = createRequire(import.meta.url);
const M = require(path.resolve(__dirname, '../../chrome-extension/src/lib/etsyMath.js'));

describe('displayed price parsing', () => {
  it('parses symbols, codes and separators', () => {
    expect(M.parseDisplayedPrice('$14.27')).toEqual({ amount: 14.27, currency: 'USD' });
    expect(M.parseDisplayedPrice('$14.27+')).toEqual({ amount: 14.27, currency: 'USD' });
    expect(M.parseDisplayedPrice('US$ 1,234.50')).toEqual({ amount: 1234.5, currency: 'USD' });
    expect(M.parseDisplayedPrice('CA$20.00')).toEqual({ amount: 20, currency: 'CAD' });
    expect(M.parseDisplayedPrice('€12,50')).toEqual({ amount: 12.5, currency: 'EUR' });
    expect(M.parseDisplayedPrice('1.234,56 TL')).toEqual({ amount: 1234.56, currency: 'TRY' });
    expect(M.parseDisplayedPrice('£9.99')).toEqual({ amount: 9.99, currency: 'GBP' });
    expect(M.parseDisplayedPrice('29.99')).toEqual({ amount: 29.99, currency: null });
    expect(M.parseDisplayedPrice('free')).toBeNull();
  });

  it('prefers the sale price over the original price in card text', () => {
    const sale = 'Personalized Jewelry Box\n4.9 (2.1k)\nSale Price $14.27\n$14.27\nOriginal Price $28.54\n$28.54\n(50% off)';
    expect(M.pickCardPriceFromText(sale)).toEqual({ amount: 14.27, currency: 'USD' });
    // Unlabelled sale text: skip the price introduced as "Original Price".
    expect(M.pickCardPriceFromText('Ad by Etsy seller\nOriginal Price $59.98 $29.99')).toEqual({ amount: 29.99, currency: 'USD' });
    // Ratings and counts are not prices.
    expect(M.pickCardPriceFromText('4.8 (1,024)\n$89.99')).toEqual({ amount: 89.99, currency: 'USD' });
    expect(M.pickCardPriceFromText('no price here 4.8 (12)')).toBeNull();
  });
});

describe('revenue = shown sales x displayed price', () => {
  // Live report (personalized jewelry box): the Etsy API price was the pre-discount list
  // price, exactly 2x the price shown on each card, so revenue came out doubled.
  const cards = [
    { shown: 14.27, list: 28.54, sales: 18.1, before: 518, after: 257 },
    { shown: 89.99, list: 179.98, sales: 26.7, before: 4807, after: 2430 },
    { shown: 19.98, list: 39.96, sales: 576.8, before: 23050, after: 11528 },
  ];
  it.each(cards)('$%s card', (c) => {
    const stats = { price: c.list, currency: 'USD', sales: { kind: 'estimated', monthlySales: c.sales } };
    // Old behaviour reproduced: unrounded sales x API list price.
    expect(Math.abs(Math.round(c.sales * c.list) - c.before)).toBeLessThanOrEqual(10);
    const rev = M.cardRevenue(stats, { amount: c.shown, currency: 'USD' });
    expect(rev).toMatchObject({ amount: c.after, currency: 'USD', unitPrice: c.shown, source: 'page' });
    expect(rev.amount).toBe(Math.round(M.shownSales(c.sales) * c.shown));
  });

  it('falls back to the API list price, labelled as such', () => {
    const rev = M.cardRevenue({ price: 28.54, currency: 'USD', sales: { monthlySales: 18.1 } }, null);
    expect(rev).toMatchObject({ source: 'list_price', unitPrice: 28.54, amount: Math.round(18 * 28.54) });
  });

  it('never prices an upper bound or a missing sales figure', () => {
    expect(M.cardRevenue({ price: 29.99, sales: { monthlySales: null, monthlySalesUpperBound: 4.8 } }, { amount: 29.99, currency: 'USD' })).toBeNull();
    expect(M.cardRevenue({ price: null, sales: { monthlySales: 3 } }, null)).toBeNull();
  });

  it('shownSales matches the display rounding', () => {
    expect(M.shownSales(18.1)).toBe(18);
    expect(M.shownSales(4.84)).toBe(4.8);
    expect(M.shownSales(9.96)).toBe(10);
    expect(M.shownSales(null)).toBeNull();
  });
});

describe('price vs page median', () => {
  it('compares displayed price with the page median, same currency only', () => {
    // $29.99 vs a $17.28 median is +74% (the old "+247% avg." used the 2x list price).
    expect(M.priceVsMedian(29.99, 17.28, 'USD', 'USD')).toEqual({ pct: 74, text: '+74%' });
    expect(M.priceVsMedian(14.27, 17.28, 'USD', 'USD')).toEqual({ pct: -17, text: '−17%' });
    expect(M.priceVsMedian(17.28, 17.28, 'USD', 'USD')).toEqual({ pct: 0, text: '±0%' });
    expect(M.priceVsMedian(29.99, 17.28, 'EUR', 'USD')).toBeNull();
    expect(M.priceVsMedian(29.99, null, 'USD', 'USD')).toBeNull();
  });
});

describe('summaries', () => {
  it('median, P25-P75, Tukey-trimmed and raw min/max', () => {
    const s = M.summarize([2, 14.27, 17, 18, 19.98, 22, 25, 29.99, 35, 40, 45, 89.99, 900]);
    expect(s.n).toBe(13);
    expect(s.median).toBe(25);
    expect(s.p25).toBe(18);
    expect(s.p75).toBe(40);
    expect(s.rawMin).toBe(2);
    expect(s.rawMax).toBe(900);
    expect(s.max).toBe(89.99); // 900 trimmed (Q3 + 3*IQR = 106)
    expect(s.trimmed).toBe(1);
  });

  it('page market: excludes ads, uses the dominant currency, median favourites, distinct shops', () => {
    const cards = [
      { price: 29.99, currency: 'USD', favorites: 43, shopId: 'a' },
      { price: 14.27, currency: 'USD', favorites: 1000, shopId: 'b' },
      { price: 89.99, currency: 'USD', favorites: 2100, shopId: 'c' },
      { price: 19.98, currency: 'USD', favorites: 5100, shopId: 'c' },
      { price: 24.0, currency: 'USD', favorites: 300, shopId: 'd' },
      { price: 2.0, currency: 'USD', favorites: 1, shopId: 'e', isAd: true },
      { price: 30, currency: 'EUR', favorites: 10, shopId: 'f' },
    ];
    const m = M.pageMarketSummary(cards);
    expect(m.ads).toBe(1);
    expect(m.cards).toBe(6);
    expect(m.currency).toBe('USD');
    expect(m.price.n).toBe(5);
    expect(m.price.median).toBe(24);
    expect(m.price.rawMin).toBe(14.27);
    expect(m.favoritesMedian).toBe(650);
    expect(m.shops).toBe(5);
  });

  it('empty input is safe', () => {
    expect(M.summarize([]).median).toBeNull();
    expect(M.pageMarketSummary([]).price.n).toBe(0);
  });
});

describe('quantity', () => {
  it('only tiny quantities are a stock signal', () => {
    expect(M.quantitySignal(3951)).toBe('seller_set');
    expect(M.quantitySignal(2)).toBe('low');
    expect(M.quantitySignal(0)).toBeNull();
    expect(M.quantitySignal(null)).toBeNull();
  });
});

describe('parseCount (result / sales counts printed on the page)', () => {
  it('treats every separator as a thousands separator', () => {
    expect(M.parseCount('1,234')).toBe(1234);
    expect(M.parseCount('1.234')).toBe(1234);
    expect(M.parseCount('12 345')).toBe(12345);
    expect(M.parseCount('1,000+')).toBe(1000);
    expect(M.parseCount('')).toBeNull();
    expect(M.parseCount(null)).toBeNull();
  });
});
