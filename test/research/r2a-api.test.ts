// R2-A endpoints: /api/research/keywords (views, progressive, tracked, detail, history), /keywords/track, /keywords/note,
// and the clawd rank actions delegating to lib/research/rank.ts (research.md §6, §10, §16; BUILD_PLAN §3).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NOW, rawListing } from './fixtures';

const { authUser, cacheFind, cacheUpsert, budget, p, noteDelegate } = vi.hoisted(() => ({
  authUser: vi.fn(),
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  budget: { usedFraction: 0 },
  noteDelegate: { current: null as null | Record<string, ReturnType<typeof vi.fn>> },
  p: {
    etsyShop: { findMany: vi.fn(), findFirst: vi.fn() },
    credential: { findFirst: vi.fn() },
    etsyListing: { findMany: vi.fn(), findFirst: vi.fn() },
    etsyListingDailyStat: { findMany: vi.fn() },
    etsyListingVersion: { findMany: vi.fn() },
    seoExperiment: { findMany: vi.fn() },
    rankTrackedKeyword: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    rankSnapshot: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, {
    get(_t, key: string) {
      if (key === 'researchCache') return { findUnique: (...a: unknown[]) => cacheFind(...a), upsert: (...a: unknown[]) => cacheUpsert(...a) };
      if (key === 'researchKeywordNote') return noteDelegate.current ?? undefined;
      return (p as Record<string, unknown>)[key];
    },
  }),
}));
vi.mock('@/lib/etsy/rateBudget', async (orig) => {
  const real = await orig<typeof import('@/lib/etsy/rateBudget')>();
  return { ...real, getBudgetSnapshot: () => ({ ...real.getBudgetSnapshot(), usedFraction: budget.usedFraction }) };
});
vi.mock('@/lib/etsy/etsyToken', () => ({ getEtsyAccessToken: vi.fn(async () => 'token') }));

import keywordsHandler from '@/pages/api/research/keywords';
import trackHandler from '@/pages/api/research/keywords/track';
import noteHandler from '@/pages/api/research/keywords/note';
import clawdHandler from '@/pages/api/clawd/etsy';
import { metricsCacheKey, poolCacheKey, type KeywordMetrics, type PoolCandidate } from '@/lib/research/keywordPool';

function run(handler: (req: any, res: any) => unknown, query: Record<string, unknown> = {}, method = 'GET', body?: unknown) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query, body } as any, res)).then(() => res);
}

const env = (data: unknown, fetchedAt: string, fresh: boolean) => ({
  data: { v: 1, fetchedAt, data }, expiresAt: new Date(Date.now() + (fresh ? 3_600_000 : -3_600_000)),
});

const metric = (keyword: string, over: Partial<KeywordMetrics> = {}): KeywordMetrics => ({
  keyword, mkt: 'etsy', country: 'US', total: 1820, n: 48, top48: 18, priceBand: { p25: 38, p75: 72, currency: 'USD', n: 48 },
  demand: { tier: 4, inputs: [] }, monthly: null, fetchedAt: '2026-10-15T09:00:00.000Z', ...over,
});

const POOL: PoolCandidate[] = ['wooden jewelry box', 'engraved jewelry box', 'personalized keepsake box', 'ring box', 'memory box', 'walnut box']
  .map((keyword, i) => ({ keyword, origin: [i === 0 ? 'seed' : 'tags'] }));

/** Seeds the shared cache: the pool, `metricsFor` keywords (fresh or stale), every signal lookup. */
function seedCache(opts: { pool?: PoolCandidate[] | null; metricsFor?: string[]; stale?: boolean } = {}) {
  const pool = opts.pool === undefined ? POOL : opts.pool;
  const withMetrics = new Set(opts.metricsFor ?? []);
  cacheFind.mockImplementation(async ({ where }: any) => {
    const key: string = where.userId_cacheKey.cacheKey;
    if (written.has(key)) return written.get(key);
    if (pool && key === poolCacheKey('etsy', 'wooden jewelry box', 'US')) return env(pool, '2026-10-15T08:00:00.000Z', true);
    for (const k of withMetrics) if (key === metricsCacheKey('etsy', k, 'US')) return env(metric(k), '2026-10-15T09:00:00.000Z', !opts.stale);
    if (key.startsWith('public:trends:')) return env({ mean: 40, monthly: null }, '2026-10-15T08:00:00.000Z', true);
    if (key.startsWith('public:autocomplete:')) return env(2, '2026-10-15T08:00:00.000Z', true);
    return null;
  });
}

/** What the code under test wrote to the shared cache (read back on the next call). */
const written = new Map<string, unknown>();
const fetchSpy = vi.fn();
const etsyCalls: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  etsyCalls.length = 0;
  noteDelegate.current = null;
  authUser.mockResolvedValue({ id: 'user-1' });
  budget.usedFraction = 0;
  written.clear();
  cacheUpsert.mockImplementation(async ({ where, create }: any) => { written.set(where.userId_cacheKey.cacheKey, { data: create.data, expiresAt: create.expiresAt }); return {}; });
  seedCache();
  p.etsyShop.findMany.mockResolvedValue([{ shopId: '555' }]);
  p.etsyShop.findFirst.mockResolvedValue({ id: 'shop-row' });
  p.credential.findFirst.mockResolvedValue(null);
  p.etsyListing.findMany.mockResolvedValue([
    { etsyListingId: BigInt(11), etsyShopId: '555', title: 'Walnut &amp; Oak Box', tags: ['ring box', 'walnut box'] },
    { etsyListingId: BigInt(12), etsyShopId: '555', title: 'Ring Box', tags: ['ring box'] },
  ]);
  p.etsyListing.findFirst.mockResolvedValue(null);
  p.rankTrackedKeyword.findMany.mockResolvedValue([]);
  p.etsyListingDailyStat.findMany.mockResolvedValue([]);
  p.etsyListingVersion.findMany.mockResolvedValue([]);
  p.seoExperiment.findMany.mockResolvedValue([]);
  fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('exchangerate-api')) return new Response(JSON.stringify({ rates: { USD: 1 } }), { status: 200 });
    if (u.includes('openapi.etsy.com')) {
      etsyCalls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.includes('/listings/active')) {
        const results = Array.from({ length: 48 }, (_, i) => rawListing({ listing_id: 9000 + i, tags: i < 12 ? ['walnut box'] : ['other'] }));
        return new Response(JSON.stringify({ count: 3456, results }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

const noEtsyWrites = () => etsyCalls.every((c) => c.startsWith('GET '));

describe('GET /api/research/keywords — views', () => {
  it('everything cached → all rows, Suggested order, no next, no live Etsy call, inMyShop from own tags', async () => {
    seedCache({ metricsFor: POOL.map((c) => c.keyword) });
    const res = await run(keywordsHandler, { q: 'wooden jewelry box' });
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(d.rows).toHaveLength(6);
    expect(d.next).toBeUndefined();
    expect(d.progress).toEqual({ done: 6, total: 6 });
    expect(d.volumeAvailable).toBe(false);
    expect(d.rows.find((r: any) => r.keyword === 'ring box').inMyShop).toBe(2);
    expect(d.rows.find((r: any) => r.keyword === 'walnut box').listings[0].title).toBe('Walnut & Oak Box');
    expect(res.body.source).toMatchObject({ source: 'research.sourceName.etsyKeywords', sampleUnit: 'keywords', sampleTotal: 6, kind: 'measured' });
    expect(etsyCalls).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toMatch(/"avg"|"mean"/);
  });

  it('progressive: resolves ≤ 4 keywords per call (1 Etsy call each) and offers next', async () => {
    seedCache({ metricsFor: ['wooden jewelry box'] });
    const res = await run(keywordsHandler, { q: 'wooden jewelry box' });
    const d = res.body.data;
    expect(d.progress).toEqual({ done: 5, total: 6 });
    expect(d.next).toBe('1');
    expect(d.rows).toHaveLength(5);
    expect(etsyCalls.filter((c) => c.includes('/listings/active'))).toHaveLength(4);
    expect(d.rows.find((r: any) => r.keyword === 'ring box').competition.value).toBe(3456);
    expect(cacheUpsert).toHaveBeenCalled();
    // The next poll resolves the rest from the shared cache + 1 live call, and stops offering `next`.
    const again = await run(keywordsHandler, { q: 'wooden jewelry box', cursor: d.next });
    expect(again.body.data.progress).toEqual({ done: 6, total: 6 });
    expect(again.body.data.next).toBeUndefined();
    expect(again.body.data.rows).toHaveLength(6);
    expect(again.body.data.rows.map((r: any) => r.keyword).slice(0, 2)).toEqual(['wooden jewelry box', 'walnut box']); // 18, then 12 of 48
    expect(again.body.data.rows[1].top48).toEqual({ value: 12, kind: 'measured', guard: { ok: true } });
    expect(etsyCalls.filter((c) => c.includes('/listings/active'))).toHaveLength(5);
    expect(noEtsyWrites()).toBe(true);
  });

  it('budget breach: stale cached rows only, budget error, no next, no Etsy call', async () => {
    budget.usedFraction = 0.9;
    seedCache({ metricsFor: ['wooden jewelry box', 'ring box'], stale: true });
    const res = await run(keywordsHandler, { q: 'wooden jewelry box' });
    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toContainEqual({ section: 'all', key: 'research.error.budget' });
    expect(res.body.data.rows.map((r: any) => r.keyword).sort()).toEqual(['ring box', 'wooden jewelry box']);
    expect(res.body.data.next).toBeUndefined();
    expect(res.body.data.fetchedAt).toBe('2026-10-15T09:00:00.000Z');
    expect(etsyCalls).toHaveLength(0);
  });

  it('budget breach with no pool cached → data null + budget error (banner, not an error page)', async () => {
    budget.usedFraction = 0.95;
    seedCache({ pool: null });
    const res = await run(keywordsHandler, { q: 'wooden jewelry box' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
    expect(res.body.errors).toEqual([{ section: 'all', key: 'research.error.budget' }]);
  });

  it('?listing adds current tags issues and the listing tags to the pool; 404 for a foreign listing', async () => {
    seedCache({ metricsFor: [...POOL.map((c) => c.keyword), 'engraved walnut box', 'a really long keepsake tag here'] });
    p.etsyListing.findFirst.mockResolvedValueOnce({
      etsyShopId: '555', etsyListingId: BigInt(77), title: 'Wooden Jewelry Box, Engraved Gift', thumbnailUrl170x135: 'https://img/t.jpg', thumbnailUrl75x75: null,
      tags: ['engraved walnut box', 'a really long keepsake tag here'],
    });
    const res = await run(keywordsHandler, { listing: '77', 'f.notInTitle': '1' });
    const d = res.body.data;
    expect(d.query).toBe('wooden jewelry box');
    expect(d.current).toMatchObject({ listingId: '77', shopId: '555', issues: { count: 2, max: 13, long: 1 } });
    expect(d.rows.every((r: any) => r.titleOverlap.length === 0)).toBe(true);
    p.etsyListing.findFirst.mockResolvedValueOnce(null);
    expect((await run(keywordsHandler, { listing: '78' })).statusCode).toBe(404);
  });

  it('mine view: own tags by use; Trendyol → marketplace error; empty seed → 400; 401 without session', async () => {
    seedCache({ pool: null, metricsFor: ['ring box', 'walnut box'] });
    const mine = await run(keywordsHandler, { view: 'mine' });
    expect(mine.body.data.rows.map((r: any) => r.keyword)).toEqual(['ring box', 'walnut box']);
    expect(mine.body.source.source).toBe('research.sourceName.myShopTags');
    expect((await run(keywordsHandler, { q: 'x', mkt: 'trendyol' })).body.errors[0]).toEqual({ section: 'marketplace', key: 'research.kw.mktUnavailable' });
    expect((await run(keywordsHandler, {})).body).toEqual({ error: 'bad_request', key: 'research.empty.keywords' });
    authUser.mockResolvedValueOnce(null);
    expect((await run(keywordsHandler, { q: 'x' })).statusCode).toBe(401);
  });
});

describe('GET /api/research/keywords — tracked, history, detail', () => {
  const at = (d: number) => new Date(NOW - d * 86_400_000);

  it('tracked view: position, 7-day change, best, measured sales around the last send, experiment link', async () => {
    p.rankTrackedKeyword.findMany.mockResolvedValue([{
      id: 'trk1', keyword: 'engraved jewelry box', etsyShopId: '555', etsyListingId: '77', listingTitle: 'Old title', createdAt: at(30),
      snapshots: [{ rank: 34, checkedAt: new Date() }, { rank: 75, checkedAt: new Date(Date.now() - 8 * 86_400_000) }],
    }]);
    p.etsyListing.findMany.mockResolvedValue([{ etsyShopId: '555', etsyListingId: BigInt(77), title: 'Engraved &amp; Walnut', thumbnailUrl170x135: 't.jpg', thumbnailUrl75x75: null }]);
    p.etsyListingDailyStat.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ etsyListingId: BigInt(77), date: new Date(Date.now() - i * 86_400_000), unitsSold: 2 })));
    p.etsyListingVersion.findMany.mockResolvedValue([{ etsyListingId: BigInt(77), capturedAt: new Date(Date.now() - 10 * 86_400_000) }]);
    p.seoExperiment.findMany.mockResolvedValue([{ id: 'exp1', status: 'collecting', changedAt: at(10), listingIds: [BigInt(77)] }]);
    const res = await run(keywordsHandler, { view: 'tracked' });
    const t = res.body.data.tracked[0];
    expect(res.body.data.rows).toEqual([]);
    expect(t.rank).toMatchObject({ now: 34, delta7: 41, best: 34 });
    expect(t.listing).toMatchObject({ id: '77', title: 'Engraved & Walnut', thumbUrl: 't.jpg' });
    expect(t.sales14d.last14).toMatchObject({ value: 28, kind: 'measured', guard: { ok: true } });
    expect(t.sales14d.lastSendAt).not.toBeNull();
    expect(t.sales14d.afterDays).toBe(11);
    expect(t.experiment).toMatchObject({ id: 'exp1', status: 'collecting' });
    expect(res.body.source.source).toBe('research.sourceName.rankTracker');
    expect(etsyCalls).toHaveLength(0);
  });

  it('tracked view: a send 80 days ago still gets its 14-day "before" window (stats loaded past the send look-back)', async () => {
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000);
    p.rankTrackedKeyword.findMany.mockResolvedValue([{
      id: 'trk1', keyword: 'walnut box', etsyShopId: '555', etsyListingId: '77', listingTitle: 'T', createdAt: ago(85), snapshots: [],
    }]);
    p.etsyListingDailyStat.findMany.mockImplementation(async ({ where }: any) =>
      Array.from({ length: 110 }, (_, i) => ({ etsyListingId: BigInt(77), date: ago(i), unitsSold: 1 })).filter((r) => r.date >= where.date.gte));
    p.etsyListingVersion.findMany.mockResolvedValue([{ etsyListingId: BigInt(77), capturedAt: ago(80) }]);
    const res = await run(keywordsHandler, { view: 'tracked' });
    const t = res.body.data.tracked[0];
    expect(t.sales14d.beforeSend).toMatchObject({ value: 14, guard: { ok: true } });
    const since = p.etsyListingDailyStat.findMany.mock.calls[0][0].where.date.gte as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual((90 + 14) * 86_400_000 - 1000);
  });

  it('history: scoped to the user (404 otherwise), points oldest first with send markers', async () => {
    p.rankTrackedKeyword.findFirst.mockResolvedValueOnce(null);
    expect((await run(keywordsHandler, { history: 'trk-other' })).statusCode).toBe(404);
    expect(p.rankTrackedKeyword.findFirst.mock.calls[0][0].where).toEqual({ id: 'trk-other', userId: 'user-1' });
    p.rankTrackedKeyword.findFirst.mockResolvedValueOnce({
      id: 'trk1', keyword: 'walnut box', etsyShopId: '555', etsyListingId: '77',
      snapshots: [{ rank: 10, checkedAt: at(0) }, { rank: null, checkedAt: at(2) }],
    });
    p.etsyListingVersion.findMany.mockResolvedValueOnce([{ id: 'v1', capturedAt: at(1) }]);
    const res = await run(keywordsHandler, { history: 'trk1' });
    expect(res.body.data.points.map((x: any) => x.rank)).toEqual([null, 10]);
    expect(res.body.data.markers).toEqual([{ at: at(1).toISOString(), kind: 'send', id: 'v1' }]);
  });

  it('detail: top 48 + co-occurring tags (keyword itself excluded) + robust price band', async () => {
    const res = await run(keywordsHandler, { detail: 'walnut box' });
    const d = res.body.data;
    expect(d.top.length).toBeGreaterThan(0);
    expect(d.cooccurring.some((w: any) => w.tag === 'walnut box')).toBe(false);
    expect(d.price.median).not.toBeUndefined();
    expect(d.total.value).toBe(3456);
    expect(noEtsyWrites()).toBe(true);
  });
});

describe('/api/research/keywords/track', () => {
  it('POST tracks for an owned shop, checks rank now, never writes to Etsy', async () => {
    p.rankTrackedKeyword.upsert.mockImplementation(async ({ where }: any) => ({ id: `id-${where.userId_etsyListingId_keyword.keyword}` }));
    p.rankSnapshot.create.mockResolvedValue({});
    p.etsyListing.findFirst.mockResolvedValue({ title: 'Walnut Box' });
    const res = await run(trackHandler, {}, 'POST', { listingId: '9005', shopId: '555', keywords: ['Walnut Box', 'walnut box', 'ring box'] });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tracked).toBe(2);
    expect(res.body.data.checked[0]).toMatchObject({ keyword: 'walnut box', rank: 6, totalResults: 3456 });
    expect(p.rankSnapshot.create).toHaveBeenCalledTimes(2);
    expect(noEtsyWrites()).toBe(true);
  });

  it('POST checkNow:false skips the rank check; foreign shop → 403; bad body → 400', async () => {
    p.rankTrackedKeyword.upsert.mockResolvedValue({ id: 'x' });
    p.etsyListing.findFirst.mockResolvedValue({ title: 'A' });
    const res = await run(trackHandler, {}, 'POST', { listingId: '1', shopId: '555', keywords: ['a tag'], checkNow: false });
    expect(res.body.data.checked).toEqual([]);
    expect(etsyCalls).toHaveLength(0);
    p.etsyShop.findFirst.mockResolvedValueOnce(null);
    expect((await run(trackHandler, {}, 'POST', { listingId: '1', shopId: '999', keywords: ['a tag'] })).statusCode).toBe(403);
    expect((await run(trackHandler, {}, 'POST', { listingId: 'x', shopId: '555', keywords: ['a tag'] })).statusCode).toBe(400);
  });

  it('POST for a listing that is not in the user\'s shop cache → 404, nothing tracked', async () => {
    p.etsyListing.findFirst.mockResolvedValue(null);
    p.rankTrackedKeyword.upsert.mockClear();
    const res = await run(trackHandler, {}, 'POST', { listingId: '123456', shopId: '555', keywords: ['a tag'] });
    expect(res.statusCode).toBe(404);
    expect(p.rankTrackedKeyword.upsert).not.toHaveBeenCalled();
    expect(etsyCalls).toHaveLength(0);
  });

  it('DELETE deactivates only the user’s rows', async () => {
    p.rankTrackedKeyword.updateMany.mockResolvedValue({ count: 1 });
    const res = await run(trackHandler, {}, 'DELETE', { ids: ['trk1'] });
    expect(res.body.data).toEqual({ tracked: 1 });
    expect(p.rankTrackedKeyword.updateMany.mock.calls[0][0].where).toMatchObject({ userId: 'user-1', isActive: true });
    expect((await run(trackHandler, {}, 'DELETE', {})).statusCode).toBe(400);
  });
});

describe('/api/research/keywords/note (BR-1b guard)', () => {
  it('503 unavailable while the model is missing; upserts once the delegate exists', async () => {
    const off = await run(noteHandler, {}, 'POST', { keyword: 'walnut box', etsySearches30d: 2410 });
    expect(off.statusCode).toBe(503);
    expect(off.body).toEqual({ error: 'unavailable', key: 'research.kw.volumeUnavailable' });
    noteDelegate.current = {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create }: any) => ({ keyword: create.keyword, etsySearches30d: create.etsySearches30d, enteredAt: new Date(NOW) })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    };
    const on = await run(noteHandler, {}, 'POST', { keyword: 'Walnut Box', etsySearches30d: 2410 });
    expect(on.body.data).toMatchObject({ keyword: 'walnut box', value: 2410 });
    expect(noteDelegate.current.upsert.mock.calls[0][0].where).toEqual({ userId_keyword: { userId: 'user-1', keyword: 'walnut box' } });
    expect((await run(noteHandler, {}, 'POST', { keyword: 'walnut box', etsySearches30d: -5 })).statusCode).toBe(400);
  });

  it('missing table (P2021) → unavailable, not a 500', async () => {
    noteDelegate.current = {
      findMany: vi.fn(), deleteMany: vi.fn(),
      upsert: vi.fn(async () => { throw Object.assign(new Error('table missing'), { code: 'P2021' }); }),
    };
    expect((await run(noteHandler, {}, 'POST', { keyword: 'walnut box', etsySearches30d: 1 })).statusCode).toBe(503);
  });
});

describe('clawd rank actions delegate to lib/research/rank.ts (legacy shape, user-scoped)', () => {
  it('remove_tracked_keyword only touches the acting user’s rows; 404 for another user’s id', async () => {
    p.rankTrackedKeyword.updateMany.mockResolvedValue({ count: 0 });
    p.rankTrackedKeyword.findFirst.mockResolvedValue(null);
    const res = await run(clawdHandler, { action: 'remove_tracked_keyword', shop_id: '555', keyword_id: 'someone-else' }, 'DELETE');
    expect(res.statusCode).toBe(404);
    expect(p.rankTrackedKeyword.updateMany.mock.calls[0][0].where).toMatchObject({ userId: 'user-1' });
  });

  it('add_tracked_keyword normalizes like the hub (NFC, single-spaced) and rejects out-of-range keywords', async () => {
    p.rankTrackedKeyword.upsert.mockResolvedValue({ id: 'trk9' });
    p.rankSnapshot.create.mockResolvedValue({});
    await run(clawdHandler, { action: 'add_tracked_keyword', shop_id: '555' }, 'POST', { keyword: '  Walnut   Box ', listing_id: '77' });
    expect(p.rankTrackedKeyword.upsert.mock.calls.at(-1)[0].where.userId_etsyListingId_keyword.keyword).toBe('walnut box');
    const bad = await run(clawdHandler, { action: 'add_tracked_keyword', shop_id: '555' }, 'POST', { keyword: 'x', listing_id: '77' });
    expect(bad.statusCode).toBe(400);
  });

  it('get_tracked_keywords keeps the legacy shape; check_keyword_rank keeps { rank, page, totalResults }', async () => {
    p.rankTrackedKeyword.findMany.mockResolvedValue([{
      id: 'k1', keyword: 'walnut box', etsyListingId: '9005', listingTitle: 'T', createdAt: new Date(),
      snapshots: [{ rank: 20, page: 1, totalResults: 9, checkedAt: at0() }, { rank: 6, page: 1, totalResults: 9, checkedAt: new Date() }],
    }]);
    const list = await run(clawdHandler, { action: 'get_tracked_keywords', shop_id: '555' });
    expect(list.body.keywords[0]).toMatchObject({ id: 'k1', rank: 6, change: 14, snapshotCount: 2 });
    const rank = await run(clawdHandler, { action: 'check_keyword_rank', shop_id: '555', keyword: 'walnut box', listing_id: '9005' });
    expect(rank.body).toEqual({ rank: 6, page: 1, totalResults: 3456 });
  });
});

function at0() { return new Date(NOW - 5 * 86_400_000); }
