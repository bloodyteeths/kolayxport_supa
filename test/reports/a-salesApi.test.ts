import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ mocks */

const queryRaw = vi.fn();
const p = {
  user: { findUnique: vi.fn() },
  etsyShop: { findMany: vi.fn() },
  order: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({
  default: new Proxy(
    {},
    {
      get: (_t, k) => (k === '$queryRawUnsafe' ? (...a: unknown[]) => queryRaw(...a) : (p as Record<string, unknown>)[k as string]),
    },
  ),
}));
const authUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/etsy/draftService', () => ({ recoverStaleSyncingDrafts: vi.fn() }));
vi.mock('@/lib/listings/refreshHealth', () => ({ healthColumnTables: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const rates = vi.fn();
vi.mock('@/lib/fx', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getExchangeRates: () => rates() };
});

import handler from '@/pages/api/analytics/index';
import { addDays } from '@/lib/reports/dayMath';
import {
  buildSalesReport,
  byStoreSql,
  delta,
  isDateKey,
  parseSalesQuery,
  planBuckets,
  previousWindow,
  productsSql,
  resolveGranularity,
  resolveStoreFilter,
  seriesSql,
  statusesSql,
  STORES_SQL,
  unitsSql,
  weekStart,
  windowBounds,
  type SalesParams,
  type SalesRawData,
} from '@/lib/reports/salesApi';
import { LISTED_ORDER_SQL } from '@/lib/orders/views';

/* --------------------------------------------------------------- helpers */

const RATES = { rates: { TRY: 1, TL: 1, USD: 40, EUR: 45 }, stale: false, asOf: Date.parse('2026-10-15T10:00:00Z') };
const NOW = new Date('2026-10-15T12:00:00Z');

function params(over: Partial<SalesParams> = {}): SalesParams {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    tz: 'Europe/Istanbul',
    currency: 'TRY',
    granularity: 'day',
    stores: null,
    previous: { from: '2026-08-01', to: '2026-08-31' },
    ...over,
  };
}

function raw(over: Partial<SalesRawData> = {}): SalesRawData {
  return { series: [], byStore: [], units: [], products: [], statuses: [], marketplaces: [], ...over };
}

const tag = (sql: unknown) => String(sql).match(/\/\* sales:(\w+) \*\//)?.[1] ?? 'unknown';
const maxParam = (sql: string) => Math.max(0, ...Array.from(sql.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])));
const paramSet = (sql: string) => new Set(Array.from(sql.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])));

function mockRes() {
  const res: { statusCode: number; body: unknown; headers: Record<string, string>; status: (c: number) => typeof res; json: (b: unknown) => typeof res; setHeader: (k: string, v: string) => void } = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
    setHeader(k, v) {
      res.headers[k] = v;
    },
  };
  return res;
}

/* ------------------------------------------------------------ date keys */

describe('date keys and windows', () => {
  it('validates real calendar days only', () => {
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-9-01')).toBe(false);
    expect(isDateKey(20260901)).toBe(false);
  });

  it('weekStart is Monday (Postgres date_trunc week)', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12'); // Thu → Mon
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sun → previous Mon
  });

  it('previous window: whole month vs whole previous month', () => {
    expect(previousWindow('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousWindow('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('previous window: a partial month starting on the 1st uses equal length (This month comes as compareFrom/To)', () => {
    // The server cannot tell This month from Last 7 days on the 7th; the client sends This month explicitly.
    expect(previousWindow('2026-10-01', '2026-10-15')).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(previousWindow('2026-10-01', '2026-10-07')).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(previousWindow('2026-03-01', '2026-03-30')).toEqual({ from: '2026-01-30', to: '2026-02-28' });
  });

  it('previous window: otherwise the equal-length period right before', () => {
    expect(previousWindow('2026-09-16', '2026-10-15')).toEqual({ from: '2026-08-17', to: '2026-09-15' });
    // Single day → previous day, also on the 1st and the 2nd of a month (§4.2).
    expect(previousWindow('2026-10-15', '2026-10-15')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(previousWindow('2026-10-01', '2026-10-01')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(previousWindow('2026-10-02', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });

  it('granularity overrides: the same set the client control offers (lib/reports/dayMath)', () => {
    expect(resolveGranularity(undefined, 1)).toBe('hour');
    expect(resolveGranularity('day', 1)).toBe('hour'); // a single day is hourly only
    expect(resolveGranularity('week', 7)).toBe('day'); // week from 8 days
    expect(resolveGranularity('month', 31)).toBe('day'); // month from 32 days
    expect(resolveGranularity('week', 30)).toBe('week');
    expect(resolveGranularity('hour', 30)).toBe('day'); // hour only for a single day
    expect(resolveGranularity('bogus', 200)).toBe('month');
  });

  it('Istanbul window bounds: local midnights (B2/B13)', () => {
    // 1 Oct 00:30 Istanbul = 30 Sep 21:30Z sits inside the 1 Oct window, not 30 Sep.
    const [start, end] = windowBounds('2026-10-01', '2026-10-01', 'Europe/Istanbul');
    expect(start).toBe('2026-09-30T21:00:00.000Z');
    expect(end).toBe('2026-10-01T21:00:00.000Z');
    const orderAt = Date.parse('2026-09-30T21:30:00Z');
    expect(orderAt >= Date.parse(start) && orderAt < Date.parse(end)).toBe(true);
  });

  it('window bounds follow DST in other zones', () => {
    const [start, end] = windowBounds('2026-03-08', '2026-03-08', 'America/New_York');
    expect(start).toBe('2026-03-08T05:00:00.000Z');
    expect(end).toBe('2026-03-09T04:00:00.000Z'); // 23-hour day
  });
});

/* --------------------------------------------------------------- buckets */

describe('planBuckets', () => {
  it('day: one bucket per day, previous aligned by offset and clipped to the previous window', () => {
    const plan = planBuckets('2026-09-01', '2026-09-30', { from: '2026-08-01', to: '2026-08-31' }, 'day');
    expect(plan.current).toHaveLength(30);
    expect(plan.previous).toHaveLength(30);
    expect(plan.current[0]).toEqual(['2026-09-01']);
    expect(plan.previous[29]).toEqual(['2026-08-30']);
  });

  it('week: Monday buckets clipped to the range', () => {
    // 1 Sep 2026 is a Tuesday.
    const plan = planBuckets('2026-09-01', '2026-09-30', previousWindow('2026-09-01', '2026-09-30'), 'week');
    expect(plan.current[0]).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(plan.current[1][0]).toBe('2026-09-07');
    expect(plan.current.at(-1)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(plan.current.flat()).toHaveLength(30);
    expect(plan.previous[0][0]).toBe('2026-08-01');
  });

  it('month buckets', () => {
    const plan = planBuckets('2026-01-15', '2026-10-15', previousWindow('2026-01-15', '2026-10-15'), 'month');
    expect(plan.current).toHaveLength(10);
    expect(plan.current[0][0]).toBe('2026-01-15');
    expect(plan.current[9].at(-1)).toBe('2026-10-15');
  });

  it('hour: 24 local hours, previous day by index', () => {
    const plan = planBuckets('2026-10-15', '2026-10-15', { from: '2026-10-14', to: '2026-10-14' }, 'hour');
    expect(plan.current).toHaveLength(24);
    expect(plan.current[0]).toEqual(['2026-10-15T00']);
    expect(plan.current[23]).toEqual(['2026-10-15T23']);
    expect(plan.previous[5]).toEqual(['2026-10-14T05']);
  });
});

/* ----------------------------------------------------------------- parse */

describe('parseSalesQuery', () => {
  it('defaults: tz Istanbul, TRY, auto granularity, all stores, previous window', () => {
    const r = parseSalesQuery({ from: '2026-09-16', to: '2026-10-15' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params).toEqual({
      from: '2026-09-16',
      to: '2026-10-15',
      tz: 'Europe/Istanbul',
      currency: 'TRY',
      granularity: 'day',
      stores: null,
      previous: { from: '2026-08-17', to: '2026-09-15' },
    });
  });

  it('reads tz, currency, granularity and stores', () => {
    const r = parseSalesQuery({ from: '2026-09-01', to: '2026-09-30', tz: 'America/New_York', currency: 'usd', granularity: 'week', stores: 'etsy:bellecouturegifts, Trendyol,,' });
    expect(r.ok && r.params).toMatchObject({ tz: 'America/New_York', currency: 'USD', granularity: 'week', stores: ['etsy:bellecouturegifts', 'trendyol'] });
  });

  it('falls back on a bad tz / currency', () => {
    const r = parseSalesQuery({ from: '2026-09-01', to: '2026-09-30', tz: 'Mars/Base', currency: 'GBP' });
    expect(r.ok && r.params).toMatchObject({ tz: 'Europe/Istanbul', currency: 'TRY' });
  });

  it('rejects bad ranges', () => {
    expect(parseSalesQuery({ from: '2026-09-30', to: '2026-09-01' })).toEqual({ ok: false, error: 'invalid_range' });
    expect(parseSalesQuery({ from: '2026-09-01' })).toEqual({ ok: false, error: 'invalid_range' });
    expect(parseSalesQuery({ from: '2026-02-30', to: '2026-03-01' })).toEqual({ ok: false, error: 'invalid_range' });
    expect(parseSalesQuery({ from: '2020-01-01', to: '2026-10-15' })).toEqual({ ok: false, error: 'range_too_long' });
  });

  it('compare override must be complete and end before `from`', () => {
    const ok = parseSalesQuery({ from: '2026-10-01', to: '2026-10-15', compareFrom: '2025-10-01', compareTo: '2025-10-15' });
    expect(ok.ok && ok.params.previous).toEqual({ from: '2025-10-01', to: '2025-10-15' });
    expect(parseSalesQuery({ from: '2026-10-01', to: '2026-10-15', compareFrom: '2026-09-01' })).toEqual({ ok: false, error: 'invalid_compare' });
    expect(parseSalesQuery({ from: '2026-10-01', to: '2026-10-15', compareFrom: '2026-09-20', compareTo: '2026-10-01' })).toEqual({ ok: false, error: 'invalid_compare' });
  });
});

/* -------------------------------------------------------------------- SQL */

describe('SQL', () => {
  const all = [
    ['stores', STORES_SQL, 5],
    ['series', seriesSql('day', false), 6],
    ['series', seriesSql('hour', true), 7],
    ['byStore', byStoreSql(false), 3],
    ['byStore', byStoreSql(true), 4],
    ['units', unitsSql(false), 5],
    ['units', unitsSql(true), 6],
    ['products', productsSql(false), 3],
    ['products', productsSql(true), 4],
    ['statuses', statusesSql(true), 4],
  ] as const;

  it.each(all)('%s references every parameter it is given (Postgres rejects unused ones)', (_name, sql, n) => {
    expect(maxParam(sql)).toBe(n);
    expect(paramSet(sql).size).toBe(n);
  });

  it('uses the Orders page rule and the order date for every window (B3)', () => {
    for (const [, sql] of all) {
      expect(sql).toContain(LISTED_ORDER_SQL);
      expect(sql).toContain('COALESCE(o."uiOrderDate", o."createdAt")');
    }
  });

  it('series: tz-aware keys, no LIMIT (B1/B2)', () => {
    const day = seriesSql('day', false);
    expect(day).toContain(`AT TIME ZONE 'UTC') AT TIME ZONE $6`);
    expect(day).not.toMatch(/LIMIT/i);
    expect(seriesSql('hour', false)).toContain('YYYY-MM-DD"T"HH24');
  });

  it('products group by sku ‖ name and sum quantity (B5)', () => {
    const sql = productsSql(false);
    expect(sql).toContain(`COALESCE(NULLIF(BTRIM(i."sku"), ''), LOWER(NULLIF(BTRIM(i."productName"), '')))`);
    expect(sql).toContain('SUM(i."quantity")');
  });
});

/* ------------------------------------------------------------------ build */

describe('buildSalesReport', () => {
  it('previous buckets past a shorter previous window are null gaps, not repeated last-day zeros', () => {
    const r = buildSalesReport({
      params: params({ from: '2026-03-01', to: '2026-03-31', previous: { from: '2026-02-01', to: '2026-02-28' } }),
      rates: RATES,
      etsyShopNames: [],
      raw: raw({ series: [{ kind: 'prev', key: '2026-02-28', currency: 'TRY', orders: 3, amount: 30 }] }),
      now: NOW,
    });
    expect(r.previousSeries).toHaveLength(31);
    expect(r.previousSeries[27]).toMatchObject({ bucketStart: '2026-02-28', bucketEnd: '2026-02-28', orders: 3 });
    expect(r.previousSeries.slice(28)).toEqual([null, null, null]);
    expect(r.previousTotals.orders).toBe(3);
  });

  it('series is ascending and zero-filled (B1)', () => {
    const r = buildSalesReport({
      params: params(),
      rates: RATES,
      etsyShopNames: [],
      raw: raw({
        series: [
          { kind: 'cur', key: '2026-09-30', currency: 'TRY', orders: 2n, amount: 200 },
          { kind: 'cur', key: '2026-09-03', currency: 'USD', orders: 1, amount: 10 },
          { kind: 'cur', key: '2026-09-03', currency: 'TRY', orders: 1, amount: 100 },
          { kind: 'prev', key: '2026-08-03', currency: 'TRY', orders: 4, amount: 40 },
        ],
      }),
      now: NOW,
    });
    expect(r.series).toHaveLength(30);
    expect(r.series.map((b) => b.bucketStart)).toEqual([...r.series.map((b) => b.bucketStart)].sort());
    expect(r.series[0]).toEqual({ bucketStart: '2026-09-01', bucketEnd: '2026-09-01', orders: 0, revenue: 0 });
    expect(r.series[2]).toMatchObject({ bucketStart: '2026-09-03', orders: 2, revenue: 500 });
    expect(r.series[29]).toMatchObject({ orders: 2, revenue: 200 });
    expect(r.previousSeries).toHaveLength(30);
    expect(r.previousSeries[2]).toMatchObject({ bucketStart: '2026-08-03', orders: 4, revenue: 40 });
    expect(r.previousSeries.every((b) => b !== null)).toBe(true); // 30 days vs 31 days: every bucket has a day
    expect(r.totals).toMatchObject({ orders: 4, revenue: 700, convertedOrders: 4, aov: 175 });
    expect(r.previousTotals).toMatchObject({ orders: 4, revenue: 40, aov: 10 });
    expect(r.totals.ordersDelta).toBe(0);
    expect(r.totals.revenueDelta).toBe(16.5);
    expect(r.range).toEqual({ from: '2026-09-01', to: '2026-09-30', tz: 'Europe/Istanbul', granularity: 'day', days: 30 });
    expect(r.previousRange).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(r.generatedAt).toBe(NOW.toISOString());
  });

  it('deltas are null when the previous period is empty (B4)', () => {
    const r = buildSalesReport({
      params: params(),
      rates: RATES,
      etsyShopNames: [],
      raw: raw({ series: [{ kind: 'cur', key: '2026-09-02', currency: 'TRY', orders: 1, amount: 50 }], units: [{ kind: 'cur', marketplace: 'Trendyol', units: 3 }] }),
    });
    expect(r.totals).toMatchObject({ revenueDelta: null, ordersDelta: null, aovDelta: null, unitsDelta: null, units: 3 });
    expect(delta(5, 0)).toBeNull();
    expect(delta(6, 4)).toBe(0.5);
  });

  it('converts to the display currency and lists excluded currencies', () => {
    const r = buildSalesReport({
      params: params({ currency: 'USD' }),
      rates: RATES,
      etsyShopNames: [],
      raw: raw({
        series: [
          { kind: 'cur', key: '2026-09-02', currency: 'TRY', orders: 1, amount: 400 },
          { kind: 'cur', key: '2026-09-02', currency: 'usd', orders: 1, amount: 10 },
          { kind: 'cur', key: '2026-09-02', currency: 'CAD', orders: 12, amount: 999 },
        ],
      }),
    });
    expect(r.currency).toBe('USD');
    expect(r.totals).toMatchObject({ revenue: 20, orders: 14, convertedOrders: 2, aov: 10 });
    expect(r.fx).toEqual({
      source: 'exchangerate-api.com',
      asOf: '2026-10-15T10:00:00.000Z',
      stale: false,
      rates: { USD: 40, EUR: 45 },
      excluded: [{ currency: 'CAD', orders: 12 }],
    });
  });

  it('with no rates at all, only display-currency orders count', () => {
    const r = buildSalesReport({
      params: params(),
      rates: { rates: {}, stale: true, asOf: null },
      etsyShopNames: [],
      raw: raw({
        series: [
          { kind: 'cur', key: '2026-09-02', currency: null, orders: 1, amount: 100 },
          { kind: 'cur', key: '2026-09-02', currency: 'USD', orders: 2, amount: 10 },
        ],
      }),
    });
    expect(r.totals.revenue).toBe(100);
    expect(r.fx).toMatchObject({ stale: true, asOf: null, rates: { USD: null, EUR: null }, excluded: [{ currency: 'USD', orders: 2 }] });
  });

  it('stores: canonical keys, original currencies, revenue share, units (B8)', () => {
    const r = buildSalesReport({
      params: params(),
      rates: RATES,
      etsyShopNames: ['BelleCoutureGifts'],
      raw: raw({
        byStore: [
          { marketplace: 'BelleCoutureGifts', currency: 'USD', orders: 3, amount: 30 },
          { marketplace: 'bellecouturegifts', currency: 'USD', orders: 1, amount: 10 },
          { marketplace: 'Trendyol', currency: 'TRY', orders: 2, amount: 400 },
          { marketplace: 'eBay US', currency: 'EUR', orders: 1, amount: 10 },
          { marketplace: 'eBay US', currency: 'GBP', orders: 1, amount: 10 },
        ],
        series: [
          { kind: 'cur', key: '2026-09-02', currency: 'USD', orders: 4, amount: 40 },
          { kind: 'cur', key: '2026-09-02', currency: 'TRY', orders: 2, amount: 400 },
          { kind: 'cur', key: '2026-09-02', currency: 'EUR', orders: 1, amount: 10 },
          { kind: 'cur', key: '2026-09-02', currency: 'GBP', orders: 1, amount: 10 },
        ],
        units: [
          { kind: 'cur', marketplace: 'BelleCoutureGifts', units: 5 },
          { kind: 'cur', marketplace: 'Trendyol', units: 2 },
          { kind: 'prev', marketplace: 'Trendyol', units: 9 },
        ],
        marketplaces: ['BelleCoutureGifts', 'Trendyol', 'eBay US', 'Veeqo'],
      }),
    });
    // 1600 (Etsy) + 400 (Trendyol) + 450 (eBay, EUR only) = 2450
    expect(r.totals.revenue).toBe(2450);
    expect(r.stores.map((s) => s.key)).toEqual(['etsy:bellecouturegifts', 'ebay', 'trendyol']);
    const etsy = r.stores[0];
    expect(etsy).toEqual({
      key: 'etsy:bellecouturegifts',
      marketplace: 'etsy',
      shopName: 'BelleCoutureGifts',
      orders: 4,
      units: 5,
      revenue: 1600,
      byCurrency: { USD: 40 },
      aov: 400,
      share: 0.6531,
      excludedOrders: 0,
    });
    expect(r.stores[1]).toMatchObject({ byCurrency: { EUR: 10, GBP: 10 }, excludedOrders: 1, orders: 2, aov: 450 });
    expect(r.storesIncluded).toEqual(['etsy:bellecouturegifts', 'ebay', 'trendyol']);
    expect(r.availableStores.map((s) => s.key)).toEqual(['ebay', 'etsy:bellecouturegifts', 'other:veeqo', 'trendyol']);
    expect(r.totals.units).toBe(7);
    expect(r.previousTotals.units).toBe(9);
  });

  it('top products: by units, merged across currencies, top 10 with image (B5)', () => {
    const products = Array.from({ length: 12 }, (_, i) => ({
      key: `sku-${i}`,
      name: `Product ${i}`,
      sku: `SKU-${i}`,
      image: i === 0 ? 'https://img/0.jpg' : null,
      currency: 'TRY',
      units: i,
      orders: 1,
      amount: 10,
    }));
    products.push({ key: 'sku-0', name: 'Product 0', sku: 'SKU-0', image: null, currency: 'USD', units: 20, orders: 2, amount: 1 });
    const r = buildSalesReport({ params: params(), rates: RATES, etsyShopNames: [], raw: raw({ products }) });
    expect(r.products).toHaveLength(10);
    expect(r.products[0]).toEqual({ key: 'sku-0', name: 'Product 0', sku: 'SKU-0', image: 'https://img/0.jpg', units: 20, orders: 3, revenue: 50 });
    expect(r.products[1].key).toBe('sku-11');
  });

  it('statuses are merged per raw status and canonical marketplace', () => {
    const r = buildSalesReport({
      params: params(),
      rates: RATES,
      etsyShopNames: ['ShopA'],
      raw: raw({
        statuses: [
          { raw: 'shipped', marketplace: 'ShopA', count: 2 },
          { raw: 'shipped', marketplace: 'Etsy', count: 3 },
          { raw: 'Created', marketplace: 'Trendyol', count: 1 },
        ],
      }),
    });
    expect(r.statuses).toEqual([
      { raw: 'shipped', marketplace: 'etsy', count: 5 },
      { raw: 'Created', marketplace: 'trendyol', count: 1 },
    ]);
  });

  it('hourly series for a single day', () => {
    const r = buildSalesReport({
      params: params({ from: '2026-10-15', to: '2026-10-15', granularity: 'hour', previous: { from: '2026-10-14', to: '2026-10-14' } }),
      rates: RATES,
      etsyShopNames: [],
      raw: raw({
        series: [
          { kind: 'cur', key: '2026-10-15T01', currency: 'TRY', orders: 1, amount: 10 },
          { kind: 'prev', key: '2026-10-14T01', currency: 'TRY', orders: 2, amount: 20 },
        ],
      }),
    });
    expect(r.series).toHaveLength(24);
    expect(r.series[1]).toEqual({ bucketStart: '2026-10-15T01', bucketEnd: '2026-10-15T01', orders: 1, revenue: 10 });
    expect(r.previousSeries[1]).toMatchObject({ bucketStart: '2026-10-14T01', orders: 2 });
  });
});

describe('resolveStoreFilter', () => {
  it('maps canonical keys back to the raw marketplace values', () => {
    const rawValues = ['BelleCoutureGifts', 'bellecouturegifts', 'Trendyol', 'Amazon Channel', 'Veeqo', null];
    expect(resolveStoreFilter(['etsy:bellecouturegifts'], rawValues, ['BelleCoutureGifts']).sort()).toEqual(['BelleCoutureGifts', 'bellecouturegifts']);
    expect(resolveStoreFilter(['amazon', 'other:veeqo'], rawValues, [])).toEqual(['Amazon Channel', 'Veeqo']);
    expect(resolveStoreFilter(['shopify'], rawValues, [])).toEqual([]);
  });
});

/* ---------------------------------------------------------------- handler */

describe('GET /api/analytics (Reports shape)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.mockResolvedValue({ email: 'seller@example.com' });
    p.user.findUnique.mockResolvedValue({ id: 'u1' });
    p.etsyShop.findMany.mockResolvedValue([{ shopName: 'BelleCoutureGifts' }]);
    rates.mockResolvedValue(RATES);
  });

  it('400 on an invalid range, before any order query', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: { from: 'x', to: '2026-09-30' }, headers: {} } as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_range' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('runs every query with matching parameters and the store filter', async () => {
    queryRaw.mockImplementation(async (sql: string) => {
      switch (tag(sql)) {
        case 'stores':
          return [{ marketplace: 'BelleCoutureGifts' }, { marketplace: 'Trendyol' }];
        case 'series':
          return [{ kind: 'cur', key: '2026-09-05', currency: 'USD', orders: 1n, amount: 25 }];
        case 'byStore':
          return [{ marketplace: 'BelleCoutureGifts', currency: 'USD', orders: 1n, amount: 25 }];
        case 'units':
          return [{ kind: 'cur', marketplace: 'BelleCoutureGifts', units: 2n }];
        default:
          return [];
      }
    });
    const res = mockRes();
    await handler(
      { method: 'GET', query: { from: '2026-09-01', to: '2026-09-30', stores: 'etsy:bellecouturegifts', tz: 'Europe/Istanbul' }, headers: {} } as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown> & { totals: { revenue: number; units: number }; stores: unknown[] };
    expect(body.version).toBe(2);
    expect(body.totals).toMatchObject({ revenue: 1000, units: 2 });
    expect(res.headers['Cache-Control']).toBe('private, no-store');

    // Every SQL got exactly as many args as it references; the filter is the raw Etsy value.
    for (const call of queryRaw.mock.calls) {
      const [sql, ...args] = call as [string, ...unknown[]];
      expect(args).toHaveLength(maxParam(sql));
      expect(args[0]).toBe('u1');
      if (tag(sql) !== 'stores') expect(args.at(-1)).toEqual(['BelleCoutureGifts']);
    }
    const series = queryRaw.mock.calls.find((c) => tag(c[0]) === 'series')!;
    expect(series.slice(1, 7)).toEqual([
      'u1',
      '2026-08-31T21:00:00.000Z',
      '2026-09-30T21:00:00.000Z',
      '2026-07-31T21:00:00.000Z',
      '2026-08-31T21:00:00.000Z',
      'Europe/Istanbul',
    ]);
    expect(p.order.findMany).not.toHaveBeenCalled(); // legacy path untouched
  });

  it('no store filter → no filter parameter', async () => {
    queryRaw.mockResolvedValue([]);
    const res = mockRes();
    await handler({ method: 'GET', query: { from: '2026-09-01', to: '2026-09-30' }, headers: {} } as never, res as never);
    expect(res.statusCode).toBe(200);
    for (const call of queryRaw.mock.calls) {
      const [sql, ...args] = call as [string, ...unknown[]];
      expect(sql).not.toContain('ANY(');
      expect(args).toHaveLength(maxParam(sql));
    }
    const body = res.body as { series: unknown[]; totals: { revenueDelta: unknown } };
    expect(body.series).toHaveLength(30);
    expect(body.totals.revenueDelta).toBeNull();
  });

  it('401 without a session', async () => {
    authUser.mockResolvedValue(null);
    const res = mockRes();
    await handler({ method: 'GET', query: { from: '2026-09-01', to: '2026-09-30' }, headers: {} } as never, res as never);
    expect(res.statusCode).toBe(401);
  });

  it('500 when a query fails', async () => {
    queryRaw.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await handler({ method: 'GET', query: { from: '2026-09-01', to: '2026-09-30' }, headers: {} } as never, res as never);
    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });

  it('addDays crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
