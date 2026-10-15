// R1-B: `search_market` / `analyze_niche` in pages/api/clawd/etsy.ts delegate to lib/research/etsySearch
// and keep the legacy JSON shape (research.md §15; BUILD_PLAN §3 clawd/etsy.ts order).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawListing } from './fixtures';

const { authUser, cacheFind, cacheUpsert, budget } = vi.hoisted(() => ({
  authUser: vi.fn(),
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  budget: { usedFraction: 0 },
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: {
    researchCache: { findUnique: (...a: unknown[]) => cacheFind(...a), upsert: (...a: unknown[]) => cacheUpsert(...a) },
  },
}));
vi.mock('@/lib/etsy/rateBudget', async (orig) => {
  const real = await orig<typeof import('@/lib/etsy/rateBudget')>();
  return { ...real, getBudgetSnapshot: () => ({ ...real.getBudgetSnapshot(), usedFraction: budget.usedFraction }) };
});

import handler from '@/pages/api/clawd/etsy';

function run(query: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method: 'GET', headers: {}, query } as any, res)).then(() => res);
}

const etsyCalls: string[] = [];
const fetchSpy = vi.fn();

function listings(n: number) {
  return Array.from({ length: n }, (_, i) => rawListing({
    listing_id: 1000 + i,
    shop_id: 500 + (i % 7),
    price: { amount: 2000 + i * 100, divisor: 100, currency_code: 'USD' },
    tags: i % 2 ? ['keepsake box', 'memory box'] : ['keepsake box', 'wood box'],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  etsyCalls.length = 0;
  authUser.mockResolvedValue({ id: 'user-1' });
  budget.usedFraction = 0;
  cacheFind.mockResolvedValue(null);
  cacheUpsert.mockResolvedValue({});
  fetchSpy.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('exchangerate-api')) return new Response(JSON.stringify({ rates: { USD: 1 } }), { status: 200 });
    if (u.includes('/listings/active')) {
      etsyCalls.push(u);
      return new Response(JSON.stringify({ count: 4321, results: listings(30) }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('clawd/etsy search_market (R1-B delegation)', () => {
  it('keeps the legacy shape: numeric ids, decoded titles, robust priceStats with median-carrying avg', async () => {
    const res = await run({ action: 'search_market', keywords: 'keepsake box', limit: '100' });
    expect(res.statusCode).toBe(200);
    const b = res.body;
    expect(b.total).toBe(4321);
    expect(b.items).toHaveLength(30);
    expect(typeof b.items[0].listing_id).toBe('number');
    expect(typeof b.items[0].shop_id).toBe('number');
    expect(b.items[0].title).toBe('Mom\'s "Best" Keepsake Box & Gift');
    expect(b.items[0]).toHaveProperty('original_creation_timestamp');
    expect(b.priceStats.currency).toBe('USD');
    expect(b.priceStats.avg).toBe(b.priceStats.median);
    expect(b.priceStats.count).toBe(b.priceStats.n);
    expect(b.priceStats).toHaveProperty('p25');
    expect(b.priceStats).toHaveProperty('p75');
    expect(b.tagFrequency[0]).toEqual({ tag: 'keepsake box', count: 30, pct: 100 });
    expect(b.titleKeywords.length).toBeGreaterThan(0);
    expect(b.shopIds.every((id: unknown) => typeof id === 'number')).toBe(true);
    expect(b).toMatchObject({ cached: false, stale: false, budgetLimited: false });
    expect(typeof b.fetchedAt).toBe('string');
    // One page (30 < 100) and written to the shared cache.
    expect(etsyCalls).toHaveLength(1);
    expect(cacheUpsert).toHaveBeenCalled();
  });

  it('400 without keywords', async () => {
    const res = await run({ action: 'search_market' });
    expect(res.statusCode).toBe(400);
  });

  it('503 with code research_budget when the budget breaker is on and nothing is cached', async () => {
    budget.usedFraction = 0.9;
    const res = await run({ action: 'search_market', keywords: 'keepsake box' });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('research_budget');
    expect(etsyCalls).toHaveLength(0);
  });

  it('passes Etsy upstream errors through as legacy { error }', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (String(url).includes('/listings/active')) return new Response('bad', { status: 400 });
      throw new Error('unexpected');
    });
    const res = await run({ action: 'search_market', keywords: 'keepsake box' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('etsy_upstream');
  });
});

describe('clawd/etsy analyze_niche (R1-B delegation)', () => {
  it('keeps the legacy shape and shares the search_market cache entry for the same params', async () => {
    const res = await run({ action: 'analyze_niche', keywords: 'keepsake box', limit: '200' });
    expect(res.statusCode).toBe(200);
    const b = res.body;
    expect(b.query).toBe('keepsake box');
    expect(b.totalResults).toBe(4321);
    expect(b.itemCount).toBe(30);
    expect(b.priceStats.avg).toBe(b.priceStats.median);
    expect(typeof b.priceStats.spread).toBe('number');
    expect(b.competition).toMatchObject({ uniqueShops: 7 });
    expect(['high', 'medium', 'low']).toContain(b.competition.barrierLevel);
    expect(b.velocity).toHaveProperty('topPerformers');
    expect(b.engagement).toHaveProperty('avgEngagementRate');
    expect(b).not.toHaveProperty('demandScore');

    const nicheKey = cacheUpsert.mock.calls[0][0].where.userId_cacheKey.cacheKey;
    cacheUpsert.mockClear();
    await run({ action: 'search_market', keywords: 'keepsake box', limit: '200' });
    expect(cacheUpsert.mock.calls[0][0].where.userId_cacheKey.cacheKey).toBe(nicheKey);
  });
});

describe('clawd/etsy analyze_niche listing age', () => {
  it('ages listings from original_creation_timestamp, not the renewal created_timestamp', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 24 * 3600;
    fetchSpy.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('exchangerate-api')) return new Response(JSON.stringify({ rates: { USD: 1 } }), { status: 200 });
      if (u.includes('/listings/active')) {
        const results = [rawListing({ listing_id: 42, num_favorers: 600, original_creation_timestamp: nowSec - 600 * DAY, created_timestamp: nowSec - 2 * DAY })];
        return new Response(JSON.stringify({ count: 1, results }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    const res = await run({ action: 'analyze_niche', keywords: 'old renewed box' });
    expect(res.statusCode).toBe(200);
    const top = res.body.velocity.topPerformers[0];
    expect(top.listing_id).toBe(42);
    expect(top.ageMonths).toBe(20);
    // 600 favs / 20 months * 3%, not 600 / 1 month * 3% from the renew date
    expect(top.estMonthlySales).toBe(0.9);
  });
});

describe('clawd/etsy get_discovery_data (retired, R0)', () => {
  it('still returns the empty honest payload', async () => {
    const res = await run({ action: 'get_discovery_data' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ trendingNiches: [], hotKeywords: [], seasonalTips: [] });
    expect(etsyCalls).toHaveLength(0);
  });
});
