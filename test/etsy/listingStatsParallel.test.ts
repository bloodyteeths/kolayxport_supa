// Etsy listing panel speed: getListingStats runs its independent Etsy calls in one parallel
// round (the shop calls too, when the page gives the shop id) and reads snapshot history
// while they run; the fast "core" answer shares the listing call. Mocked Etsy with fixed
// delays, no DB, no network. Timings are logged for profiling.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { etsyFetch, prismaMock } = vi.hoisted(() => ({
  etsyFetch: vi.fn(),
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

import { getListingStats, getListingCore, __clearListingCaches, type StatsMeta } from '@/lib/etsy/listingStats';

const ETSY_DELAY_MS = 120;
const money = (amount: number) => ({ amount, divisor: 100, currency_code: 'USD' });
const now = Math.floor(Date.now() / 1000);

let log: Array<{ path: string; start: number; end: number }> = [];
let t0 = 0;

function routeEtsy(shopId: number) {
  etsyFetch.mockImplementation(async (url: string) => {
    const path = url.replace('https://openapi.etsy.com/v3/application', '');
    const entry = { path, start: Date.now() - t0, end: 0 };
    log.push(entry);
    await new Promise((r) => setTimeout(r, ETSY_DELAY_MS));
    entry.end = Date.now() - t0;
    let body: unknown;
    if (/^\/listings\/\d+$/.test(path)) {
      body = { listing_id: 1, shop_id: shopId, title: 'Linen dress', price: money(2999), num_favorers: 120, views: 900, quantity: 4, tags: ['linen', 'dress'], original_creation_timestamp: now - 200 * 86400, description: 'x'.repeat(400) };
    } else if (/\/listings\/\d+\/reviews/.test(path)) {
      body = { count: 3, results: [{ created_timestamp: now - 5 * 86400 }, { created_timestamp: now - 9 * 86400 }, { created_timestamp: now - 400 * 86400 }] };
    } else if (/\/listings\/\d+\/images/.test(path)) {
      body = { count: 6, results: Array.from({ length: 6 }, () => ({})) };
    } else if (/^\/shops\/\d+$/.test(path)) {
      body = { shop_id: shopId, shop_name: 'LinenHaus', transaction_sold_count: 5000, review_count: 1000, review_average: 4.9 };
    } else if (/^\/shops\/\d+\/reviews/.test(path)) {
      body = { count: 2, results: [{ listing_id: 1, created_timestamp: now - 3 * 86400 }] };
    } else {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
}

/** Max number of Etsy calls in flight at the same time. */
function maxConcurrency() {
  let max = 0;
  for (const a of log) max = Math.max(max, log.filter((b) => b.start <= a.start && b.end > a.start).length);
  return max;
}

beforeEach(() => {
  __clearListingCaches();
  etsyFetch.mockReset();
  log = [];
  t0 = Date.now();
});

describe('getListingStats: parallel Etsy calls', () => {
  it('with the page\'s shop id: all 5 calls in ONE round (~1 Etsy latency, not 2)', async () => {
    routeEtsy(777001);
    const meta: StatsMeta = {};
    const start = Date.now();
    const res = await getListingStats('1000000001', { shopIdHint: '777001' }, meta);
    const elapsed = Date.now() - start;
    console.log('[listingStats timings, shop hint]', JSON.stringify({ elapsed, ...meta.timings, calls: log.map((l) => `${l.path} ${l.start}-${l.end}`) }));

    expect(log).toHaveLength(5);
    expect(maxConcurrency()).toBe(5);
    expect(Math.max(...log.map((l) => l.start))).toBeLessThan(ETSY_DELAY_MS / 2); // every call started up front
    expect(elapsed).toBeLessThan(ETSY_DELAY_MS * 2);
    expect(meta.apiCalls).toBe(5);
    expect(res.shop?.shopName).toBe('LinenHaus');
    expect(res.listing.favorites).toBe(120);
    expect(res.seoScore.total).toBeGreaterThan(0);
  });

  it('without a hint: listing + reviews + images in parallel, then the shop pair in parallel (2 rounds)', async () => {
    routeEtsy(777002);
    const meta: StatsMeta = {};
    const start = Date.now();
    await getListingStats('1000000002', {}, meta);
    const elapsed = Date.now() - start;
    console.log('[listingStats timings, no hint]', JSON.stringify({ elapsed, ...meta.timings }));
    const firstRound = log.filter((l) => l.start < ETSY_DELAY_MS / 2).map((l) => l.path).sort();
    expect(firstRound).toEqual(['/listings/1000000002', '/listings/1000000002/images', '/listings/1000000002/reviews?limit=100']);
    const shopCalls = log.filter((l) => l.path.startsWith('/shops/'));
    expect(shopCalls).toHaveLength(2);
    expect(Math.abs(shopCalls[0].start - shopCalls[1].start)).toBeLessThan(ETSY_DELAY_MS / 2);
    expect(elapsed).toBeLessThan(ETSY_DELAY_MS * 3);
  });

  it('a wrong hint is ignored: the listing\'s own shop is used', async () => {
    routeEtsy(777003);
    const res = await getListingStats('1000000003', { shopIdHint: '123' }, {});
    expect(log.some((l) => l.path === '/shops/777003')).toBe(true);
    expect(res.shop?.shopId).toBe('777003');
  });

  it('snapshot history is read while the Etsy calls run (not after them)', async () => {
    routeEtsy(777004);
    let dbStartedAt = -1;
    prismaMock.etsyPublicListingSnapshot.count.mockImplementationOnce(async () => { dbStartedAt = Date.now() - t0; return 0; });
    await getListingStats('1000000004', { shopIdHint: '777004' }, {});
    expect(dbStartedAt).toBeGreaterThanOrEqual(0);
    expect(dbStartedAt).toBeLessThan(ETSY_DELAY_MS / 2);
  });

  it('core + full of one page view make ONE listing call; core needs only that call', async () => {
    routeEtsy(777005);
    const coreMeta: StatsMeta = {};
    const fullMeta: StatsMeta = {};
    const [core, full] = await Promise.all([
      getListingCore('1000000005', {}, coreMeta),
      getListingStats('1000000005', { shopIdHint: '777005' }, fullMeta),
    ]);
    expect(log.filter((l) => l.path === '/listings/1000000005')).toHaveLength(1);
    expect(coreMeta.apiCalls).toBe(1);
    expect(fullMeta.apiCalls ?? 0).toBe(4); // reviews, images, shop, shop reviews (listing shared)
    expect(core).toMatchObject({ phase: 'core', listing: { favorites: 120, views: 900, tagCount: 2, price: 29.99 } });
    expect(core.listing.ageDays).toBeGreaterThanOrEqual(199);
    expect(full.listing.favorites).toBe(core.listing.favorites);
  });
});
