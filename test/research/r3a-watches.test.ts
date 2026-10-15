// R3-A Shop tracker server: lib/research/watchAdapter.ts (pure + read model + cron) and
// /api/research/watches, /api/research/watches/[id], /api/cron/research-snapshots (research.md §8, §10; RR §6.3).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { authUser, cache, p, store, alertTypes, notifySpy, cronGuard } = vi.hoisted(() => ({
  authUser: vi.fn(),
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  alertTypes: { on: false },
  notifySpy: vi.fn(),
  cronGuard: vi.fn(),
  store: {
    enabled: true,
    watches: [] as any[],
    snaps: [] as any[],
  },
  p: {
    user: { findUnique: vi.fn() },
    shopifyShop: { count: vi.fn() },
    ebayTrackedSeller: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    ebayTrackedProduct: { findMany: vi.fn() },
    amazonTrackedProduct: { findMany: vi.fn(), updateMany: vi.fn() },
    etsyShop: { findMany: vi.fn() },
    etsyListing: { findMany: vi.fn() },
  },
}));

function matches(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const f = v as any;
      if ('in' in f && !f.in.includes(row[k])) return false;
      if ('gte' in f && !(row[k] >= f.gte)) return false;
      if ('lt' in f && !(row[k] < f.lt)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
let seq = 0;
const watchDelegate = {
  findMany: async ({ where }: any) => store.watches.filter((w) => matches(w, where)),
  findFirst: async ({ where }: any) => store.watches.find((w) => matches(w, where)) ?? null,
  count: async ({ where }: any) => store.watches.filter((w) => matches(w, where)).length,
  create: async ({ data }: any) => { const row = { id: `watch${String(++seq).padStart(4, '0')}`, createdAt: new Date('2026-10-01T00:00:00Z'), ...data }; store.watches.push(row); return row; },
  update: async ({ where, data }: any) => { const row = store.watches.find((w) => w.id === where.id); Object.assign(row, data); return row; },
};
const snapDelegate = {
  findMany: async ({ where }: any) => store.snaps.filter((s) => matches(s, where)).sort((a, b) => a.takenAt - b.takenAt),
  findFirst: async ({ where }: any) => store.snaps.find((s) => matches(s, where)) ?? null,
  create: async ({ data }: any) => { const row = { id: `snap${++seq}`, ...data }; store.snaps.push(row); return row; },
  deleteMany: async ({ where }: any) => { const before = store.snaps.length; store.snaps = store.snaps.filter((s) => !matches(s, where)); return { count: before - store.snaps.length }; },
};

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, {
    get(_t, key: string) {
      if (key === 'researchCache') {
        return {
          findUnique: async ({ where }: any) => cache.get(where.userId_cacheKey.cacheKey) ?? null,
          upsert: async ({ where, create }: any) => { cache.set(where.userId_cacheKey.cacheKey, { data: create.data, expiresAt: create.expiresAt }); return {}; },
        };
      }
      if (key === 'researchWatch') return store.enabled ? watchDelegate : undefined;
      if (key === 'researchSnapshot') return store.enabled ? snapDelegate : undefined;
      return (p as Record<string, unknown>)[key];
    },
  }),
}));
vi.mock('@/lib/notifications', () => ({ notify: (...a: unknown[]) => notifySpy(...a) }));
vi.mock('@/lib/notificationCenter/registry', () => ({ isKnownType: (t: string) => alertTypes.on && t.startsWith('research') }));
vi.mock('@/lib/cron/idempotency', () => ({ runCronGuard: (...a: unknown[]) => cronGuard(...a) }));
vi.mock('@/lib/admin/events', () => ({ logCronEvent: vi.fn() }));
// Bypass the shared token bucket (it waits on real time); budget accounting is tested in lib/etsy.
vi.mock('@/lib/etsy/http', async (orig) => {
  const real = await orig<typeof import('@/lib/etsy/http')>();
  return { ...real, etsyFetch: (url: string, init?: RequestInit) => fetch(url, init) };
});

import listHandler from '@/pages/api/research/watches';
import itemHandler from '@/pages/api/research/watches/[id]';
import cronHandler from '@/pages/api/cron/research-snapshots';
import { searchCacheKey } from '@/lib/research/etsySearch';
import {
  DAY_MS, buildShopSnapshot, detectWatchTarget, ebaySellerMetrics, evaluateShopAlerts, fastestGaining, parseAlertRules, priceChange,
  ratePairs, salesMetrics, salesSeries, tagGap, watchLimitFor, type SnapListing,
} from '@/lib/research/watchAdapter';

function run(handler: (req: any, res: any) => unknown, query: Record<string, unknown> = {}, method = 'GET', body?: unknown) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query, body } as any, res)).then(() => res);
}

const NOW = Date.parse('2026-10-15T06:00:00Z');
const day = (n: number) => new Date(NOW - n * DAY_MS);
const listing = (id: number, over: Record<string, unknown> = {}) => ({
  listing_id: id, title: `Box ${id} &amp; lid`, price: { amount: 4500, divisor: 100, currency_code: 'USD' }, num_favorers: 10,
  tags: ['walnut box', 'ring box'], shop_id: 77, url: `https://etsy.com/listing/${id}`, original_creation_timestamp: Math.floor((NOW - 30 * DAY_MS) / 1000),
  ...over,
});
const snapMetrics = (sold: number, over: Record<string, unknown> = {}) => ({
  v: 1, kind: 'etsyShop', shopId: '77', name: 'WoodAndWords', url: null, iconUrl: null, createdAt: 1600000000,
  transactionSoldCount: sold, reviewCount: 8100, reviewAverage: 4.9, activeCount: 412, currency: 'USD', listingsN: 412,
  listingsComplete: true, new7d: 9, oldestFetchedCreatedAt: 1500000000,
  price: { median: 45, p25: 38, p75: 60, n: 400, currency: 'USD', quality: 'ok' }, ...over,
});

const etsyCalls: string[] = [];
const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  seq = 0;
  cache.clear();
  etsyCalls.length = 0;
  store.enabled = true;
  store.watches = [];
  store.snaps = [];
  alertTypes.on = false;
  authUser.mockResolvedValue({ id: 'user-1' });
  cronGuard.mockResolvedValue({ ok: true, bucket: '2026-10-15' });
  p.user.findUnique.mockResolvedValue({ subscriptionPlan: 'starter', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null });
  p.shopifyShop.count.mockResolvedValue(0);
  p.ebayTrackedSeller.findMany.mockResolvedValue([]);
  p.ebayTrackedProduct.findMany.mockResolvedValue([]);
  p.amazonTrackedProduct.findMany.mockResolvedValue([]);
  p.etsyShop.findMany.mockResolvedValue([{ shopId: '555' }]);
  p.etsyListing.findMany.mockResolvedValue([{ tags: ['walnut box'] }]);
  fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes('openapi.etsy.com')) throw new Error(`unexpected fetch ${u}`);
    etsyCalls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('/shops?shop_name=')) return new Response(JSON.stringify({ results: [{ shop_id: 77, shop_name: 'WoodAndWords', transaction_sold_count: 1000, listing_active_count: 3, currency_code: 'USD' }] }), { status: 200 });
    if (/\/shops\/77\/listings\/active/.test(u)) {
      return new Response(JSON.stringify({ count: 3, results: [listing(1, { original_creation_timestamp: Math.floor((NOW - DAY_MS / 2) / 1000) }), listing(2), listing(3)] }), { status: 200 });
    }
    if (/\/shops\/77$/.test(u)) return new Response(JSON.stringify({ shop_id: 77, shop_name: 'WoodAndWords', transaction_sold_count: 1000, listing_active_count: 3, currency_code: 'USD', review_count: 10 }), { status: 200 });
    if (u.includes('/listings/batch')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('pure: input detection + rules', () => {
  it('detects shops, sellers, listings, ASINs and queries', () => {
    expect(detectWatchTarget('https://www.etsy.com/shop/WoodAndWords?ref=x')).toEqual({ type: 'etsyShop', shopName: 'WoodAndWords' });
    expect(detectWatchTarget('WoodAndWords')).toEqual({ type: 'etsyShop', shopName: 'WoodAndWords' });
    expect(detectWatchTarget('12345678')).toEqual({ type: 'etsyShop', shopId: '12345678' });
    expect(detectWatchTarget('etsy.com/listing/1234567/walnut-box')).toEqual({ type: 'etsyShop', fromListingId: '1234567' });
    expect(detectWatchTarget('https://www.ebay.com/usr/engrave_us')).toEqual({ type: 'ebaySeller', seller: 'engrave_us' });
    expect(detectWatchTarget('engrave_us', { marketplace: 'ebay' })).toEqual({ type: 'ebaySeller', seller: 'engrave_us' });
    expect(detectWatchTarget('wooden jewelry box', { type: 'query' })).toEqual({ type: 'query', text: 'wooden jewelry box', marketplace: 'etsy' });
    expect(detectWatchTarget('wooden jewelry box')).toBeNull();
    expect(detectWatchTarget('https://www.ebay.com/usr/x', { type: 'etsyShop' })).toBeNull();
  });
  it('alert rules: defaults, partial merge, bounds', () => {
    expect(parseAlertRules(undefined)).toEqual({ newListing: true, priceDropPct: 10, salesSpikeX: null });
    expect(parseAlertRules({ newListings: false })).toMatchObject({ newListing: false });
    expect(parseAlertRules({ salesSpikeX: 2 })).toMatchObject({ salesSpikeX: 2, priceDropPct: 10 });
    expect(parseAlertRules({ priceDropPct: null })).toMatchObject({ priceDropPct: null });
    expect(parseAlertRules({ priceDropPct: 2 })).toBeNull();
    expect(parseAlertRules({ newListing: 'yes' })).toBeNull();
    expect(parseAlertRules([])).toBeNull();
  });
  it('watch limits follow D-R1; expired adds nothing', () => {
    expect(watchLimitFor('trial', 'trial')).toBe(3);
    expect(watchLimitFor('growth', 'active')).toBe(25);
    expect(watchLimitFor('shopify_free', 'shopify_free')).toBe(10);
    expect(watchLimitFor('enterprise', 'enterprise')).toBeNull();
    expect(watchLimitFor('pro', 'expired')).toBe(0);
  });
});

describe('pure: measured sales (guard 7)', () => {
  it('one reading → firstReading; two → measured rate', () => {
    expect(salesMetrics([{ takenAt: day(0), sold: 1000 }]).salesPerDay7d).toMatchObject({ value: null, guard: { ok: false, reasonKey: 'research.shops.firstReading' } });
    const m = salesMetrics([{ takenAt: day(1), sold: 1000 }, { takenAt: day(0), sold: 1014 }]);
    expect(m.salesPerDay7d).toMatchObject({ value: 14, kind: 'measured', guard: { ok: true } });
    expect(m.salesChange.guard).toMatchObject({ ok: false, reasonKey: 'research.shops.needTwoWeeks' });
  });
  it('drops negative and > 50× median deltas and flags them; 7d vs prev 7d', () => {
    const rs = [];
    let sold = 1000;
    for (let d = 14; d >= 0; d--) {
      if (d < 14) sold += d >= 7 ? 10 : 12;
      rs.push({ takenAt: day(d), sold });
    }
    rs[10] = { ...rs[10], sold: rs[10].sold + 5000 }; // spike then a negative delta next day
    const pairs = ratePairs(rs);
    expect(pairs.filter((x) => x.flagged)).toHaveLength(2);
    const m = salesMetrics(rs);
    expect(m.salesPerDay7d.value).toBe(12);
    expect(m.salesChange.value).toBeCloseTo(0.2, 2);
    const series = salesSeries(m.pairs, m.latestMs);
    expect(series).toHaveLength(30);
    expect(series.filter((pt) => pt.dropped)).toHaveLength(2);
    expect(series.find((pt) => pt.dropped)?.value).toBeNull();
  });
  it('readings < 12 h apart are not a rate', () => {
    const m = salesMetrics([{ takenAt: NOW - 3_600_000, sold: 100 }, { takenAt: NOW, sold: 130 }]);
    expect(m.salesPerDay7d.guard.reasonKey).toBe('research.shops.firstReading');
  });
  it('price change needs a reading ~7 days older in the same currency and a usable sample', () => {
    const pr = (median: number, currency = 'USD', quality: any = 'ok') => ({ median, p25: median, p75: median, n: 40, currency, quality });
    expect(priceChange([{ takenAt: day(7), price: pr(50) }, { takenAt: day(0), price: pr(47) }]).value).toBeCloseTo(-0.06, 3);
    expect(priceChange([{ takenAt: day(2), price: pr(50) }, { takenAt: day(0), price: pr(47) }]).guard.reasonKey).toBe('research.shops.needWeek');
    expect(priceChange([{ takenAt: day(7), price: pr(50, 'EUR') }, { takenAt: day(0), price: pr(47) }]).guard.reasonKey).toBe('research.shops.currencyChanged');
    expect(priceChange([{ takenAt: day(7), price: pr(50, 'USD', 'insufficient') }, { takenAt: day(0), price: pr(47) }]).guard.reasonKey).toBe('research.shops.priceSample');
  });
  it('shop snapshot: robust median (no mean), new7d from original creation', () => {
    const ls: SnapListing[] = [10, 12, 14, 9999].map((pv, i) => ({ id: String(i), t: 't', p: pv, c: 'USD', f: 1, cr: Math.floor((NOW - (i === 0 ? 2 : 40) * DAY_MS) / 1000), tags: [], url: null }));
    const s = buildShopSnapshot({ shopId: '77', name: 'W', url: null, iconUrl: null, createdAt: null, soldCount: 5, reviewCount: null, reviewAverage: null, activeCount: 4, currency: 'USD' }, ls, true, NOW);
    expect(s.new7d).toBe(1);
    expect(s.price?.median).toBeLessThan(100);
    expect(s.price?.quality).toBe('insufficient');
  });
  it('fastest gaining = favorites Δ share (Estimate); tag gap ignores own tags', () => {
    const mk = (id: string, f: number, tags: string[] = []): SnapListing => ({ id, t: id, p: 1, c: 'USD', f, cr: null, tags, url: null });
    const g = fastestGaining([mk('a', 150), mk('b', 20), mk('c', 5)], [mk('a', 50), mk('b', 0), mk('c', 9)], 7);
    expect(g.map((x) => x.listing.id)).toEqual(['a', 'b']);
    expect(g[0].share).toMatchObject({ value: 0.833, kind: 'estimate' });
    const gap = tagGap([mk('a', 1, ['Recipe Box', 'walnut box']), mk('b', 1, ['recipe box'])], ['Walnut Box']);
    expect(gap).toEqual([{ tag: 'recipe box', count: 2, share: 1 }]);
  });
  it('alerts: new listings, price drop, sales spike', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({ end: NOW - (9 - i) * DAY_MS, days: 1, delta: i === 9 ? 30 : 10, rate: i === 9 ? 30 : 10, flagged: false }));
    const fires = evaluateShopAlerts({ newListing: true, priceDropPct: 10, salesSpikeX: 2 }, {
      newSincePrev: 3, priceChange: { value: -0.12, kind: 'measured', guard: { ok: true } }, pairs,
    });
    expect(fires.map((f) => f.type)).toEqual(['researchShopNewListings', 'researchShopPriceDrop', 'researchShopSalesSpike']);
    expect(fires[1].params).toEqual({ pct: 12 });
    expect(evaluateShopAlerts({ newListing: true, priceDropPct: null, salesSpikeX: null }, { newSincePrev: null, priceChange: { value: -0.5, kind: 'measured', guard: { ok: true } }, pairs })).toEqual([]);
  });
});

describe('GET/POST /api/research/watches', () => {
  it('401 without a session; 405 on PUT', async () => {
    authUser.mockResolvedValueOnce(null);
    expect((await run(listHandler)).statusCode).toBe(401);
    expect((await run(listHandler, {}, 'PUT')).statusCode).toBe(405);
  });

  it('BR-1c missing: legacy eBay rows still listed, available false, POST etsy shop 503', async () => {
    store.enabled = false;
    p.ebayTrackedSeller.findMany.mockResolvedValue([{ id: 'seller1', sellerUsername: 'engrave_us', feedbackScore: 900, createdAt: day(20), lastCheckedAt: null }]);
    p.ebayTrackedProduct.findMany.mockResolvedValue([
      { id: 'p1', legacyItemId: '123456789012', title: 'Engraved box', seller: 'engrave_us', totalSold: 31, currentPrice: 20, currency: 'USD', createdAt: day(5), snapshots: [] },
    ]);
    const res = await run(listHandler);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.errors).toEqual([{ section: 'watches', key: 'research.shops.unavailable' }]);
    const row = res.body.data.rows[0];
    expect(row).toMatchObject({ id: 'ebaySeller.seller1', type: 'ebaySeller', capabilities: { alerts: false, remove: true }, url: 'https://www.ebay.com/usr/engrave_us' });
    expect(row.metrics.salesPerDay.guard).toMatchObject({ ok: false, reasonKey: 'research.shops.ebayCollecting', reasonParams: { items: 1 } });
    expect(row.metrics.soldItemsAllTime).toBe(1);
    const post = await run(listHandler, {}, 'POST', { input: 'WoodAndWords' });
    expect(post.statusCode).toBe(503);
    expect(post.body).toEqual({ error: 'unavailable', key: 'research.shops.unavailable' });
  });

  it('POST resolves the shop name, stores the watch + first reading, GET shows "first reading"', async () => {
    const res = await run(listHandler, {}, 'POST', { input: 'https://www.etsy.com/shop/WoodAndWords' });
    expect(res.statusCode).toBe(201);
    const w = res.body.data.watch;
    expect(w).toMatchObject({ type: 'etsyShop', marketplace: 'etsy', refId: '77', label: 'WoodAndWords', capabilities: { alerts: true, remove: true }, alertRules: { newListing: true, priceDropPct: 10, salesSpikeX: null } });
    expect(w.snapshots.count).toBe(1);
    expect(w.metrics.salesPerDay.guard.reasonKey).toBe('research.shops.firstReading');
    expect(w.metrics.new7d.value).toBe(1);
    expect(res.body.data).toMatchObject({ created: true, quota: { used: 1, limit: 10 } });
    expect(store.snaps).toHaveLength(1);
    expect(cache.has('public:etsy:shopListings:77:2026-10-15')).toBe(true);
    expect(etsyCalls.every((c) => c.startsWith('GET '))).toBe(true);

    const again = await run(listHandler, {}, 'POST', { type: 'etsyShop', marketplace: 'etsy', refId: 'WoodAndWords', label: 'WoodAndWords', alertRules: { newListing: true, priceDropPct: 10, salesSpikeX: null } });
    expect(again.statusCode).toBe(200);
    expect(store.watches).toHaveLength(1);
    expect(store.snaps).toHaveLength(1);

    const list = await run(listHandler, { mkt: 'etsy' });
    expect(list.body.data.quota).toEqual({ used: 1, limit: 10, plan: 'starter', stripeUpsell: true });
    expect(list.body.data.alertsAvailable).toBe(false);
    expect(list.body.source).toMatchObject({ source: 'research.sourceName.shopCounters', kind: 'measured', sampleUnit: 'shops' });
  });

  it('quota: 409 at the limit; shopify_free never upsells', async () => {
    p.user.findUnique.mockResolvedValue({ subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(NOW + 5 * DAY_MS) });
    for (const id of ['1', '2', '3']) store.watches.push({ id: `w000000${id}`, userId: 'user-1', type: 'query', marketplace: 'etsy', refId: `q${id}`, label: 'q', alertRules: {}, isActive: true, createdAt: day(3) });
    const res = await run(listHandler, {}, 'POST', { type: 'etsyShop', refId: '77' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'quota_exceeded', key: 'research.shops.quotaFull', used: 3, limit: 3 });
    p.shopifyShop.count.mockResolvedValue(1);
    const list = await run(listHandler);
    expect(list.body.data.quota).toMatchObject({ limit: 10, plan: 'shopify_free', stripeUpsell: false });
  });

  it('400 on bad input, 404 when the shop does not exist, 422 for ASIN', async () => {
    expect((await run(listHandler, {}, 'POST', { input: 'two words' })).body).toEqual({ error: 'bad_request', key: 'research.watch.inputInvalid' });
    expect((await run(listHandler, {}, 'POST', { input: 'NoSuchShop' })).statusCode).toBe(404);
    expect((await run(listHandler, {}, 'POST', { type: 'asin', refId: 'B000000001' })).statusCode).toBe(422);
    expect((await run(listHandler, {}, 'POST', { input: 'WoodAndWords', alertRules: { salesSpikeX: 99 } })).body.key).toBe('research.watch.rulesInvalid');
  });

  it('eBay seller watch goes to EbayTrackedSeller (existing table)', async () => {
    p.ebayTrackedSeller.findUnique.mockResolvedValue(null);
    p.ebayTrackedSeller.create.mockResolvedValue({ id: 'sel9' });
    p.ebayTrackedSeller.findMany.mockResolvedValue([{ id: 'sel9', sellerUsername: 'engrave_us', feedbackScore: null, createdAt: day(0), lastCheckedAt: null }]);
    const res = await run(listHandler, {}, 'POST', { input: 'https://www.ebay.com/usr/engrave_us' });
    expect(res.statusCode).toBe(201);
    expect(p.ebayTrackedSeller.create).toHaveBeenCalledWith({ data: { userId: 'user-1', sellerUsername: 'engrave_us' } });
    expect(res.body.data.watch.id).toBe('ebaySeller.sel9');
  });
});

describe('/api/research/watches/[id]', () => {
  beforeEach(() => {
    store.watches.push({ id: 'watch0001', userId: 'user-1', type: 'etsyShop', marketplace: 'etsy', refId: '77', label: 'WoodAndWords', alertRules: { newListing: true, priceDropPct: 10, salesSpikeX: null }, isActive: true, createdAt: day(20) });
    for (let d = 14; d >= 0; d--) store.snaps.push({ id: `s${d}`, type: 'etsyShop', marketplace: 'etsy', refId: '77', takenAt: day(d), metrics: snapMetrics(1000 + (14 - d) * 10, { price: { median: d >= 7 ? 50 : 45, p25: 40, p75: 60, n: 400, currency: 'USD', quality: 'ok' } }) });
    const ls = (fav: number): SnapListing[] => [
      { id: '1', t: 'New box', p: 40, c: 'USD', f: fav, cr: Math.floor((NOW - 2 * DAY_MS) / 1000), tags: ['recipe box', 'walnut box'], url: null },
      { id: '2', t: 'Old box', p: 50, c: 'USD', f: 100, cr: Math.floor((NOW - 90 * DAY_MS) / 1000), tags: ['recipe box'], url: null },
    ];
    cache.set('public:etsy:shopListings:77:2026-10-15', { data: { v: 1, fetchedAt: day(0).toISOString(), data: ls(30) }, expiresAt: new Date(NOW + DAY_MS) });
    cache.set('public:etsy:shopListings:77:2026-10-08', { data: { v: 1, fetchedAt: day(7).toISOString(), data: ls(10) }, expiresAt: new Date(NOW + DAY_MS) });
  });

  it('GET detail: measured 7d rate, price change, series, new listings, gains, tag gap', async () => {
    const res = await run(itemHandler, { id: 'watch0001' });
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(d.watch.metrics.salesPerDay.value).toBe(10);
    expect(d.watch.metrics.salesVsPrev.value).toBe(0);
    expect(d.watch.metrics.priceChange.value).toBeCloseTo(-0.1, 3);
    expect(d.watch.snapshots.count).toBe(15);
    expect(d.shop).toEqual({ since: '2020-09-13T12:26:40.000Z', rating: 4.9, reviewCount: 8100 });
    expect(d.sales).toHaveLength(30);
    expect(d.newListings.map((l: any) => l.id)).toEqual(['1']);
    expect(d.fastest[0]).toMatchObject({ id: '1', favoritesDelta7d: { value: 20, kind: 'measured' }, shareOfSales: { kind: 'estimate' } });
    expect(d.tagGap).toEqual([{ tag: 'recipe box', count: 2, share: 1 }]);
    expect(d.tagGapAvailable).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/"avg"|"mean"/);
  });

  it('PATCH alert rules merge; legacy rows are read-only; DELETE is soft', async () => {
    const patched = await run(itemHandler, { id: 'watch0001' }, 'PATCH', { alertRules: { salesSpikeX: 2 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.body.data.watch.alertRules).toEqual({ newListing: true, priceDropPct: 10, salesSpikeX: 2 });
    expect((await run(itemHandler, { id: 'ebaySeller.abc' }, 'PATCH', { label: 'x' })).statusCode).toBe(409);
    expect((await run(itemHandler, { id: 'watch0001' }, 'PATCH', {})).statusCode).toBe(400);
    const del = await run(itemHandler, { id: 'watch0001' }, 'DELETE');
    expect(del.body.data).toEqual({ id: 'watch0001', removed: true });
    expect(store.watches[0].isActive).toBe(false);
    expect(store.snaps.length).toBe(15);
    expect((await run(itemHandler, { id: 'watch0001' })).statusCode).toBe(404);
  });

  it('other users cannot read it', async () => {
    authUser.mockResolvedValue({ id: 'user-2' });
    expect((await run(itemHandler, { id: 'watch0001' })).statusCode).toBe(404);
  });
});

describe('POST /api/cron/research-snapshots', () => {
  it('skips when BR-1c is missing', async () => {
    store.enabled = false;
    const res = await run(cronHandler, {}, 'POST');
    expect(res.body).toMatchObject({ ok: true, skipped: 'unavailable' });
  });

  it('one reading per shop per day, alerts only once BR-7 types exist', async () => {
    store.watches.push(
      { id: 'watch0001', userId: 'user-1', type: 'etsyShop', marketplace: 'etsy', refId: '77', label: 'WoodAndWords', alertRules: { newListing: true, priceDropPct: null, salesSpikeX: null }, isActive: true, createdAt: day(20) },
      { id: 'watch0002', userId: 'user-2', type: 'etsyShop', marketplace: 'etsy', refId: '77', label: 'Rival', alertRules: { newListing: false, priceDropPct: null, salesSpikeX: null }, isActive: true, createdAt: day(20) },
    );
    store.snaps.push({ id: 'old', type: 'etsyShop', marketplace: 'etsy', refId: '77', takenAt: day(1), metrics: snapMetrics(990) });
    store.snaps.push({ id: 'ancient', type: 'etsyShop', marketplace: 'etsy', refId: '77', takenAt: day(500), metrics: snapMetrics(1) });
    const res = await run(cronHandler, {}, 'POST');
    expect(res.statusCode).toBe(200);
    expect(res.body.shops).toEqual({ due: 1, taken: 1, failed: 0, alreadyToday: 0 });
    expect(res.body.alerts).toEqual({ sent: 0, suppressed: 1 });
    expect(res.body.pruned).toBe(1);
    expect(notifySpy).not.toHaveBeenCalled();

    // Same day again: nothing fetched.
    etsyCalls.length = 0;
    const again = await run(cronHandler, {}, 'POST');
    expect(again.body.shops.alreadyToday).toBe(1);
    expect(etsyCalls).toHaveLength(0);

    // BR-7 deployed: next day raises for user-1 only.
    alertTypes.on = true;
    vi.setSystemTime(NOW + DAY_MS);
    fetchSpy.mockClear();
    store.snaps = store.snaps.filter((s) => s.id === 'old');
    const next = await run(cronHandler, {}, 'POST');
    expect(next.body.alerts.sent).toBe(1);
    expect(notifySpy).toHaveBeenCalledWith('user-1', expect.objectContaining({
      type: 'researchShopNewListings', titleKey: 'types.researchShopNewListings', link: '/app/research/shops?open=watch0001',
      params: expect.objectContaining({ shop: 'WoodAndWords', count: 1 }),
    }));
  });

  it('respects the cron guard', async () => {
    cronGuard.mockImplementationOnce(async (_req: any, res: any) => { res.status(401).json({ error: 'Unauthorized' }); return { ok: false }; });
    const res = await run(cronHandler, {}, 'POST');
    expect(res.statusCode).toBe(401);
  });
});

describe('review fixes (R3-A)', () => {
  const searchHandler = (u: string) => (u.includes('/listings/active?keywords=')
    ? new Response(JSON.stringify({ count: 1234, results: [listing(11), listing(12)] }), { status: 200 })
    : null);

  it('price drop is raised once, not again while the 7-day comparison still shows it', () => {
    const drop = { value: -0.12, kind: 'measured' as const, guard: { ok: true } };
    const rules = { newListing: false, priceDropPct: 10, salesSpikeX: null };
    expect(evaluateShopAlerts(rules, { newSincePrev: null, priceChange: drop, prevPriceChange: null, pairs: [] }).map((f) => f.type)).toEqual(['researchShopPriceDrop']);
    expect(evaluateShopAlerts(rules, { newSincePrev: null, priceChange: drop, prevPriceChange: { value: -0.11, kind: 'measured', guard: { ok: true } }, pairs: [] })).toEqual([]);
    expect(evaluateShopAlerts(rules, { newSincePrev: null, priceChange: drop, prevPriceChange: { value: -0.02, kind: 'measured', guard: { ok: true } }, pairs: [] })).toHaveLength(1);
  });

  it('eBay seller readings = distinct UTC days, not items x snapshots', () => {
    const snaps = [day(3), day(2), day(1)].map((t, i) => ({ timestamp: t, soldQuantity: 10 + i }));
    const m = ebaySellerMetrics([
      { id: 'a', seller: 's', totalSold: 1, currentPrice: 1, currency: 'USD', snapshots: snaps },
      { id: 'b', seller: 's', totalSold: 1, currentPrice: 1, currency: 'USD', snapshots: snaps },
    ]);
    expect(m.readings).toHaveLength(3);
  });

  it('POST: eBay saved query 422; Trendyol product watch needs the Pro feature (402, server side)', async () => {
    const ebayQ = await run(listHandler, {}, 'POST', { type: 'query', marketplace: 'ebay', refId: 'walnut box' });
    expect(ebayQ.statusCode).toBe(422);
    expect(ebayQ.body).toEqual({ error: 'unsupported', key: 'research.watch.ebayQueryUnsupported' });
    const locked = await run(listHandler, {}, 'POST', { type: 'trendyolProduct', refId: '123456', alertRules: { marginOver: 15 } });
    expect(locked.statusCode).toBe(402);
    expect(locked.body).toMatchObject({ reason: 'featureLocked', feature: 'arbitrage' });
    expect(store.watches).toHaveLength(0);
  });

  it('quota full: 409 before any Etsy call', async () => {
    p.user.findUnique.mockResolvedValue({ subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(NOW + 5 * DAY_MS) });
    for (const id of ['1', '2', '3']) store.watches.push({ id: `w000000${id}`, userId: 'user-1', type: 'query', marketplace: 'etsy', refId: `q${id}`, label: 'q', alertRules: {}, isActive: true, createdAt: day(3) });
    expect((await run(listHandler, {}, 'POST', { input: 'https://www.etsy.com/shop/WoodAndWords' })).statusCode).toBe(409);
    expect(etsyCalls).toHaveLength(0);
  });

  it('cron: watches past the owner limit are not read (expired trial) and the list marks them paused', async () => {
    p.user.findUnique.mockResolvedValue({ subscriptionPlan: 'trial', subscriptionStatus: 'expired', billingInterval: null, billingProvider: null, trialExpiresAt: new Date(NOW - 5 * DAY_MS) });
    store.watches.push({ id: 'watch0001', userId: 'user-1', type: 'etsyShop', marketplace: 'etsy', refId: '77', label: 'WoodAndWords', alertRules: {}, isActive: true, createdAt: day(20) });
    const res = await run(cronHandler, {}, 'POST');
    expect(res.body.overQuota).toBe(1);
    expect(res.body.shops.due).toBe(0);
    expect(etsyCalls).toHaveLength(0);
    const list = await run(listHandler);
    expect(list.body.data.rows[0].paused).toEqual({ reasonKey: 'research.shops.overQuota' });
    expect(list.body.data.rows[0].metrics.salesPerDay.guard.reasonKey).toBe('research.shops.overQuota');
  });

  it('cron: a query cached yesterday is read live again; takenAt = fetch time', async () => {
    const base = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const hit = searchHandler(String(url));
      if (hit) { etsyCalls.push(`GET ${url}`); return hit; }
      return base(url, init);
    });
    store.watches.push({ id: 'watch0001', userId: 'user-1', type: 'query', marketplace: 'etsy', refId: 'walnut box', label: 'walnut box', alertRules: {}, isActive: true, createdAt: day(5) });
    const yesterday = new Date(NOW - DAY_MS + 60_000).toISOString();
    cache.set(searchCacheKey('walnut box', 'US', null, 'score,desc,100,,'), { data: { v: 1, fetchedAt: yesterday, data: { query: 'walnut box', country: 'US', taxonomyId: null, total: 9, items: [], fetchedAt: yesterday } }, expiresAt: new Date(NOW + 60_000) });
    const res = await run(cronHandler, {}, 'POST');
    expect(res.body.queries).toMatchObject({ due: 1, taken: 1 });
    expect(etsyCalls.some((c) => c.includes('keywords=walnut'))).toBe(true);
    const snap = store.snaps.find((x) => x.type === 'query');
    expect(snap.metrics.total).toBe(1234);
    expect(new Date(snap.takenAt).getTime()).toBe(NOW);
  });

  it('cron: shops with the oldest (or no) reading go first', async () => {
    store.watches.push(
      { id: 'watch0001', userId: 'user-1', type: 'etsyShop', marketplace: 'etsy', refId: '88', label: 'Old', alertRules: {}, isActive: true, createdAt: day(30) },
      { id: 'watch0002', userId: 'user-1', type: 'etsyShop', marketplace: 'etsy', refId: '77', label: 'New', alertRules: {}, isActive: true, createdAt: day(1) },
    );
    store.snaps.push({ id: 'r88', type: 'etsyShop', marketplace: 'etsy', refId: '88', takenAt: day(1), metrics: snapMetrics(1) });
    await run(cronHandler, {}, 'POST');
    const firstShopCall = etsyCalls.find((c) => /\/shops\/\d+$/.test(c));
    expect(firstShopCall).toMatch(/\/shops\/77$/);
  });
});
