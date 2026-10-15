// research legacy port: the Price gap indexes are refilled without the legacy ArbitrageScanner
// (lib/arbitrage/indexRefresh.ts, scheduler job `arbitrage-index-refresh`, POST /api/research/price-gap/refresh).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, trFetchedAt, ebFetchedAt, authUser, requireFeature, appToken } = vi.hoisted(() => ({
  calls: [] as string[],
  trFetchedAt: { value: null as Date | null },
  ebFetchedAt: { value: null as Date | null },
  authUser: vi.fn(),
  requireFeature: vi.fn(),
  appToken: vi.fn(async () => 'app-token'),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    trendyolProductIndex: { findFirst: vi.fn(async () => (trFetchedAt.value ? { fetchedAt: trFetchedAt.value } : null)) },
    ebayProductIndex: { findFirst: vi.fn(async () => (ebFetchedAt.value ? { fetchedAt: ebFetchedAt.value } : null)) },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/integrations/ebayClient', () => ({ getApplicationToken: () => appToken() }));
vi.mock('@/lib/integrations/trendyolSearch', () => ({
  TRENDYOL_CATEGORIES: [
    { slug: 'havlu-x-c839', label: 'Towels', labelTr: 'Havlu', ebaySearch: 'Turkish towel' },
    { slug: 'kilim-x-c1853', label: 'Kilim', labelTr: 'Kilim', ebaySearch: 'kilim rug' },
  ],
}));
vi.mock('@/lib/arbitrage/trendyolIndexer', () => ({
  indexTrendyolCategory: vi.fn(async (slug: string) => {
    calls.push(`trendyol:${slug}`);
    return { slug, indexed: 48 };
  }),
}));
vi.mock('@/lib/arbitrage/ebayIndexer', () => ({
  CATEGORY_SEARCH_QUERIES: { 'havlu-x-c839': ['Turkish towel'], 'kilim-x-c1853': ['kilim rug'] },
  indexEbayCategory: vi.fn(async (slug: string, token: string) => {
    calls.push(`ebay:${slug}:${token}`);
    return { slug, queries: 1, indexed: 120, errors: [] };
  }),
}));
vi.mock('@/lib/arbitrage/matcher', () => ({
  matchAndCalculateCategory: vi.fn(async (slug: string) => {
    calls.push(`match:${slug}`);
    return { results: [], productsScanned: 48, matchStats: { total: 48, exact: 3, equivalent: 4, similar: 5, noMatch: 36 } };
  }),
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/billing/requireFeature', () => ({
  requireFeature: (...a: unknown[]) => requireFeature(...a),
  isFeatureLockedError: (e: unknown) => Boolean((e as { locked?: boolean })?.locked),
}));

import {
  EBAY_REFRESH_AFTER_MS,
  ebayIndexStale,
  isIndexedCategory,
  refreshArbitrageCategory,
  runArbitrageIndexRefresh,
} from '@/lib/arbitrage/indexRefresh';
import handler, { MAX_REFRESHES_PER_HOUR, __resetRefreshSlotsForTests } from '@/pages/api/research/price-gap/refresh';
import { allJobs } from '@/lib/scheduler/jobs';
import { canRefreshGapIndex, gapIndexUpdatedAt } from '@/lib/research/priceGap';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const HOUR = 3_600_000;

function run(method: string, body?: unknown) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query: {}, body } as any, res)).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  trFetchedAt.value = null;
  ebFetchedAt.value = null;
  authUser.mockResolvedValue({ id: 'user-1' });
  requireFeature.mockResolvedValue(undefined);
  __resetRefreshSlotsForTests();
});

describe('lib/arbitrage/indexRefresh', () => {
  it('eBay side is re-read only once its newest row is ~a day old', () => {
    expect(ebayIndexStale(null, NOW)).toBe(true);
    expect(ebayIndexStale(new Date(NOW - EBAY_REFRESH_AFTER_MS + 60_000), NOW)).toBe(false);
    expect(ebayIndexStale(new Date(NOW - EBAY_REFRESH_AFTER_MS), NOW)).toBe(true);
    expect(isIndexedCategory('havlu-x-c839')).toBe(true);
    expect(isIndexedCategory('../etc')).toBe(false);
  });

  it('one category: Trendyol always, eBay when stale (app token), then matches', async () => {
    const r = await refreshArbitrageCategory('havlu-x-c839', { nowMs: NOW });
    expect(r).toEqual({ slug: 'havlu-x-c839', trendyol: 48, ebay: 120, matched: 12, errors: [] });
    expect(calls).toEqual(['trendyol:havlu-x-c839', 'ebay:havlu-x-c839:app-token', 'match:havlu-x-c839']);
    calls.length = 0;
    ebFetchedAt.value = new Date(NOW - HOUR);
    const fresh = await refreshArbitrageCategory('havlu-x-c839', { nowMs: NOW });
    expect(fresh.ebay).toBeNull();
    expect(calls).toEqual(['trendyol:havlu-x-c839', 'match:havlu-x-c839']);
  });

  it('full run: every indexed category, one app token for the run, stops on abort', async () => {
    const s = await runArbitrageIndexRefresh({ nowMs: NOW, pauseMs: 0 });
    expect(s).toEqual({ categories: 2, done: 2, trendyolRows: 96, ebayCategories: 2, failed: 0, aborted: false });
    expect(appToken).toHaveBeenCalledTimes(1);
    const ac = new AbortController();
    ac.abort();
    expect(await runArbitrageIndexRefresh({ signal: ac.signal, pauseMs: 0 })).toMatchObject({ done: 0, aborted: true });
  });

  it('is registered with the scheduler every 6 hours (the Trendyol rows live 6 h)', () => {
    const job = allJobs.find((j) => j.name === 'arbitrage-index-refresh');
    expect(job).toMatchObject({ intervalMinutes: 360, maxAttemptsPerBucket: 1 });
    expect(allJobs.find((j) => j.name === 'research-ebay-items')).toMatchObject({ dailyAtUtc: '06:30' });
  });
});

describe('POST /api/research/price-gap/refresh', () => {
  it('405 / 401 / 402 (Pro, server first) / 400 for an unknown category', async () => {
    expect((await run('GET')).statusCode).toBe(405);
    authUser.mockResolvedValueOnce(null);
    expect((await run('POST', { cat: 'havlu-x-c839' })).statusCode).toBe(401);
    requireFeature.mockRejectedValueOnce({ locked: true, body: () => ({ error: 'featureLocked', feature: 'arbitrage' }) });
    const locked = await run('POST', { cat: 'havlu-x-c839' });
    expect(locked.statusCode).toBe(402);
    expect(locked.body).toEqual({ error: 'featureLocked', feature: 'arbitrage' });
    expect((await run('POST', { cat: 'nope' })).body).toEqual({ error: 'bad_request', key: 'research.gap.error.categoryNotIndexed' });
    expect(calls).toEqual([]);
  });

  it('read less than an hour ago → nothing fetched, the current date back', async () => {
    trFetchedAt.value = new Date(Date.now() - 10 * 60_000);
    const res = await run('POST', { cat: 'havlu-x-c839' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ category: 'havlu-x-c839', refreshed: false, updatedAt: trFetchedAt.value.toISOString() });
    expect(calls).toEqual([]);
  });

  it('stale → refreshes that one category; per-user limit answers 429', async () => {
    const res = await run('POST', JSON.stringify({ cat: 'kilim-x-c1853' }));
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ category: 'kilim-x-c1853', refreshed: true });
    expect(calls[0]).toBe('trendyol:kilim-x-c1853');
    for (let i = 1; i < MAX_REFRESHES_PER_HOUR; i++) expect((await run('POST', { cat: 'kilim-x-c1853' })).statusCode).toBe(200);
    const limited = await run('POST', { cat: 'kilim-x-c1853' });
    expect(limited.statusCode).toBe(429);
    expect(limited.body).toEqual({ error: 'rate_limited', key: 'research.gap.refreshFailed' });
  });
});

describe('client freshness helpers (lib/research/priceGap)', () => {
  it('newest row read; refresh allowed with no read or after an hour', () => {
    expect(gapIndexUpdatedAt([{ fetchedAt: null }, { fetchedAt: '2026-10-15T08:00:00.000Z' }, { fetchedAt: '2026-10-15T10:00:00.000Z' }])).toBe('2026-10-15T10:00:00.000Z');
    expect(gapIndexUpdatedAt([])).toBeNull();
    expect(canRefreshGapIndex(null, NOW)).toBe(true);
    expect(canRefreshGapIndex(new Date(NOW - 30 * 60_000).toISOString(), NOW)).toBe(false);
    expect(canRefreshGapIndex(new Date(NOW - 2 * HOUR).toISOString(), NOW)).toBe(true);
  });
});
