import { describe, it, expect, vi, beforeEach } from 'vitest';

// No DB, no network: Prisma and the Etsy HTTP layer are mocked.
const { etsyFetch, prismaMock, authUser } = vi.hoisted(() => ({
  etsyFetch: vi.fn(),
  authUser: vi.fn(),
  prismaMock: {
    etsyPublicListingSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/etsy/http', () => ({
  etsyFetch: (...a: unknown[]) => etsyFetch(...a),
  etsyPublicHeaders: () => ({ 'x-api-key': 'KEY:SECRET' }),
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/finance/fx', () => ({
  convertCurrency: async (amount: number, from: string) => (from === 'EUR' ? amount * 1.1 : null),
}));

import { summarizeEtsySearch, moneyToNumber, queryWantsDigital } from '@/lib/etsy/searchSummary';
import {
  revenueFor, shownMonthlySales, pickRevenuePrice, getBatchListingStats, getShopStats, getListingStats,
} from '@/lib/etsy/listingStats';
import researchHandler from '@/pages/api/ext/research';

const money = (amount: number, currency = 'USD', divisor = 100) => ({ amount, divisor, currency_code: currency });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

/** Route mocked Etsy GETs by path. */
function routeEtsy(routes: Record<string, unknown>) {
  etsyFetch.mockImplementation(async (url: string) => {
    const path = url.replace('https://openapi.etsy.com/v3/application', '');
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' };
    return ok(routes[key]);
  });
}

beforeEach(() => {
  etsyFetch.mockReset();
  authUser.mockReset();
});

describe('moneyToNumber (Etsy v3 Money objects)', () => {
  it('divides amount by divisor; never treats amount as dollars', () => {
    expect(moneyToNumber(money(2999))).toBe(29.99);
    expect(moneyToNumber({ amount: 1427, divisor: 100 })).toBe(14.27);
    expect(moneyToNumber({ amount: 500, divisor: 1 })).toBe(500); // JPY-style divisor
    expect(moneyToNumber({ amount: 2999 })).toBe(29.99); // missing divisor -> 100
    expect(moneyToNumber({ amount: 0, divisor: 100 })).toBeNull();
    expect(moneyToNumber(null)).toBeNull();
  });
});

describe('summarizeEtsySearch (search_enrich)', () => {
  const physical = (cents: number, favs: number, shop: number, extra: Record<string, unknown> = {}) => ({
    listing_type: 'physical', price: money(cents), num_favorers: favs, shop_id: shop, ...extra,
  });
  const results = [
    physical(2999, 43, 1), physical(2854, 1000, 2), physical(17998, 2100, 3), physical(3996, 5100, 3),
    physical(2400, 12, 4), physical(3500, 30, 5), physical(4500, 8, 6), physical(1999, 0, 7),
    // Digital SVG templates that keyword search mixes into a physical query.
    { listing_type: 'download', price: money(200), num_favorers: 5, shop_id: 8 },
    { listing_type: 'download', price: money(350), num_favorers: 2, shop_id: 9 },
    // EUR listing converted with the FX table (30 EUR -> 33 USD).
    physical(3000, 50, 10, { price: money(3000, 'EUR') }),
  ];

  it('excludes digital downloads, converts currency, reports median + P25-P75 + median favourites', () => {
    const s = summarizeEtsySearch({ count: 71100, results }, { query: 'personalized jewelry box', fx: { EUR: 1.1 } });
    expect(s.totalResults).toBe(71100);
    expect(s.sampled).toBe(11);
    expect(s.used).toBe(9);
    expect(s.excludedDigital).toBe(2);
    expect(s.priceBasis).toBe('list_price');
    expect(s.currency).toBe('USD');
    // USD: 19.99 24 28.54 29.99 33(EUR) 35 39.96 45 179.98. Tukey upper fence = 39.96 + 3*11.42
    // = 74.22, so 179.98 is trimmed; median/P25/P75 of the 8 kept values.
    expect(s.priceStats.trimmed).toBe(1);
    expect(s.medianPrice).toBeCloseTo(31.5, 1);
    expect(s.avgPrice).toBe(s.medianPrice); // legacy field carries the median
    expect(s.p25Price).toBeCloseTo(27.41, 1);
    expect(s.p75Price).toBeCloseTo(36.24, 1);
    expect(s.minPrice).toBe(19.99); // the $2 SVG no longer sets the minimum
    expect(s.maxPrice).toBe(45); // trimmed max
    expect(s.rawMinPrice).toBe(19.99);
    expect(s.rawMaxPrice).toBe(179.98); // raw extreme kept separately, labelled raw
    expect(s.medianFavorites).toBe(43);
    expect(s.uniqueShops).toBe(8);
    expect(s.competition).toBe('low');
  });

  it('keeps digital items when the query asks for them', () => {
    expect(queryWantsDigital('jewelry box svg')).toBe(true);
    expect(queryWantsDigital('personalized jewelry box')).toBe(false);
    const s = summarizeEtsySearch({ count: 5, results }, { query: 'jewelry box svg laser cut file', fx: { EUR: 1.1 } });
    expect(s.excludedDigital).toBe(0);
    expect(s.used).toBe(11);
  });

  it('handles an empty response', () => {
    const s = summarizeEtsySearch({ count: 0, results: [] }, { query: 'x' });
    expect(s.medianPrice).toBeNull();
    expect(s.avgPrice).toBe(0);
    expect(s.medianFavorites).toBeNull();
  });
});

describe('search_enrich handler', () => {
  it('uses findAllListingsActive count + summary, with the KEY:SECRET header', async () => {
    authUser.mockResolvedValue({ id: 'u1' });
    routeEtsy({ '/listings/active': { count: 71100, results: [{ listing_type: 'physical', price: money(2999), num_favorers: 43, shop_id: 1 }] } });
    const res: any = { statusCode: 200, headers: {} };
    res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    res.end = () => res;
    await researchHandler({ method: 'POST', headers: {}, body: { action: 'search_enrich', query: 'jewelry box' }, socket: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.summary).toMatchObject({ totalResults: 71100, medianPrice: 29.99, priceBasis: 'list_price' });
    const [url, init] = etsyFetch.mock.calls[0];
    expect(url).toContain('/listings/active?keywords=jewelry%20box&limit=100&sort_on=score');
    expect(init.headers['x-api-key']).toBe('KEY:SECRET');
  });
});

describe('revenue helpers', () => {
  it('revenue = displayed sales x unit price', () => {
    expect(shownMonthlySales(18.1)).toBe(18);
    expect(shownMonthlySales(4.84)).toBe(4.8);
    expect(revenueFor(18.1, 14.27)).toBe(257);
    expect(revenueFor(26.7, 89.99)).toBe(2430);
    expect(revenueFor(null, 10)).toBeNull();
    expect(revenueFor(5, null)).toBeNull();
    expect(revenueFor(5, 0)).toBeNull();
  });

  it('page price (sale price) beats the API list price; needs a currency', () => {
    expect(pickRevenuePrice({ pagePrice: 29.99, pageCurrency: 'USD' }, 59.98, 'USD')).toEqual({ price: 29.99, currency: 'USD', source: 'page' });
    expect(pickRevenuePrice({ pagePrice: 29.99, pageCurrency: null }, 59.98, 'USD')).toEqual({ price: 59.98, currency: 'USD', source: 'list_price' });
    expect(pickRevenuePrice({}, null, 'USD')).toEqual({ price: null, currency: 'USD', source: 'none' });
  });
});

describe('getBatchListingStats (search cards)', () => {
  it('reads Money objects and multiplies the rounded sales by the list price', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Shop: 37,700 sold / 7,113 reviews = 5.3 sales per review. 100 reviews over ~33 days.
    const reviews = Array.from({ length: 100 }, (_, i) => ({
      listing_id: i < 20 ? 11111 : 99999, created_timestamp: now - Math.round((i / 99) * 33 * 86400),
    }));
    routeEtsy({
      '/listings/batch': { results: [{ listing_id: 11111, shop_id: 7, price: money(2854), num_favorers: 1000, quantity: 3951, original_creation_timestamp: now - 400 * 86400 }] },
      '/shops/7/reviews': { count: 7113, results: reviews },
      '/shops/7': { shop_id: 7, transaction_sold_count: 37700, review_count: 7113 },
    });
    const { listings } = await getBatchListingStats(['11111']);
    const c = listings['11111'];
    expect(c.price).toBe(28.54);
    expect(c.currency).toBe('USD');
    expect(c.favorites).toBe(1000);
    expect(c.sales.kind).toBe('estimated');
    expect(c.sales.confidence).toBe('medium');
    const shown = shownMonthlySales(c.sales.monthlySales as number);
    expect(c.sales.monthlyRevenue).toBe(Math.round(shown * 28.54));
  });
});

describe('getShopStats', () => {
  it('uses the median list price in the shop currency (no mean, no mixed currency)', async () => {
    routeEtsy({
      '/shops/8/listings/active': { results: [
        { listing_id: 1, price: money(2000) }, { listing_id: 2, price: money(2200) }, { listing_id: 3, price: money(2400) },
        { listing_id: 4, price: money(50000) }, // one $500 custom piece
        { listing_id: 5, price: money(9900, 'EUR') }, // other currency: excluded
      ] },
      '/shops/8/reviews': { count: 0, results: [] },
      '/shops/8': { shop_id: 8, shop_name: 'S', currency_code: 'USD', transaction_sold_count: 100, review_count: 20 },
    });
    const s = await getShopStats('8');
    expect(s?.avgPrice).toBe(23); // median of 20, 22, 24, 500 (mean would be 141.50)
  });
});

describe('getListingStats (listing page)', () => {
  it('revenue uses the page (sale) price; quantity and item review count pass through', async () => {
    const now = Math.floor(Date.now() / 1000);
    routeEtsy({
      '/listings/222/reviews': { count: 0, results: [] },
      '/listings/222/images': { results: [] },
      '/listings/222': { listing_id: 222, shop_id: 9, price: money(5998), num_favorers: 43, views: 1700, quantity: 3951, tags: [], original_creation_timestamp: now - 39 * 86400 },
      '/shops/9/reviews': { count: 7113, results: [] },
      '/shops/9': { shop_id: 9, transaction_sold_count: 37700, review_count: 7113, review_average: 4.8 },
    });
    const r = await getListingStats('222', { pagePrice: 29.99, pageCurrency: 'USD' });
    expect(r.listing.price).toBe(59.98); // API list price
    expect(r.listing.reviewCount).toBe(0); // this listing's own reviews
    expect(r.listing.quantity).toBe(3951);
    expect(r.sales.kind).toBe('estimated');
    expect(r.sales.confidence).toBe('low');
    expect(r.sales.monthlySales).toBeNull();
    expect(r.sales.monthlySalesUpperBound).toBe(4.1); // 30 x 5.3 / 39 days
    expect(r.sales.priceSource).toBe('page');
    expect(r.sales.priceUsed).toBe(29.99);
  });
});
