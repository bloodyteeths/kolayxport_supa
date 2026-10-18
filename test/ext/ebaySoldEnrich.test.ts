// eBay search overlay speed: product_database (extension path) looks up sold quantities only
// for the first-viewport items, caches them per item for 24 h, and answers within the time box
// even when item lookups are slow (fake timers; no network, no DB).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest } from 'next';

const USER = 'user_ebay_fast';

vi.mock('@/lib/prisma', async () => ({ default: (await import('./fakeResearchStore')).fakePrisma }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn(async () => ({ id: USER })) }));
vi.mock('@/lib/security/internalApiKey', () => ({ hasValidInternalApiKeyHeader: vi.fn(() => false) }));
vi.mock('@/lib/integrations/ebayClient', () => ({
  getEbayTokenFor: vi.fn(async () => ({ token: 'app-token' })),
  getApplicationToken: vi.fn(async () => 'app-token'),
  getUserAccessToken: vi.fn(async () => 'user-token'),
}));

/** 20 search results with legacy ids 100000000001..20; `searches[q]` overrides. */
const ids = Array.from({ length: 20 }, (_, i) => String(100000000001 + i));
const summary = (id: string) => ({ title: 'Towel ' + id, price: { value: '20.00', currency: 'USD' }, legacyItemId: id, seller: { username: 's' + id } });
let searchIds: string[] = ids;
let itemDelayMs = 0;
const itemCalls: string[] = [];

vi.mock('@/lib/integrations/ebayRateLimiter', () => ({
  callEbayRateLimited: vi.fn(async (url: string) => {
    if (url.includes('/item_summary/search')) return { total: searchIds.length, itemSummaries: searchIds.map(summary) };
    const id = (url.match(/legacy_item_id=(\d+)/) || [])[1] || '';
    itemCalls.push(id);
    if (itemDelayMs) await new Promise((r) => setTimeout(r, itemDelayMs));
    return { title: 'Item ' + id, price: { value: '25.00', currency: 'USD' }, estimatedAvailabilities: [{ estimatedSoldQuantity: Number(id.slice(-2)), estimatedRemainingQuantity: 5 }] };
  }),
}));

import { store, makeRes } from './fakeResearchStore';
import { budgetKey, istanbulDay, quotaKey, GLOBAL_USER_ID, SHARED_USER_ID } from '@/lib/ext/researchQuota';
import { itemCacheKey, enrichSoldQuantities, pickEnrichIds, EXT_TIME_BOX_MS } from '@/lib/ebay/soldEnrich';
import researchHandler from '@/pages/api/clawd/ebay-research';

const EXT = { 'x-kx-client': 'ext/9.9.0', 'x-kx-page-view': 'pvfast00000001' };
const req = (query: Record<string, string>, headers: Record<string, string> = EXT) =>
  ({ method: 'GET', headers, query, body: {} } as unknown as NextApiRequest);
const pd = (q: string, extra: Record<string, string> = {}) =>
  ({ action: 'product_database', q, limit: '50', sort: 'bestMatch', marketplace_id: 'EBAY_US', ...extra });
const budget = () => store.count(GLOBAL_USER_ID, budgetKey('ebay', istanbulDay().day));

beforeEach(() => {
  store.reset();
  store.setUser(USER, 'starter');
  searchIds = ids;
  itemDelayMs = 0;
  itemCalls.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('pickEnrichIds', () => {
  it('first-viewport ids first, then result order, capped', () => {
    const items = ids.map(summary);
    expect(pickEnrichIds(items, 3, ['100000000009', '999'])).toEqual(['100000000009', '100000000001', '100000000002']);
    expect(pickEnrichIds(items, 0)).toEqual([]);
    expect(pickEnrichIds(items, 50)).toHaveLength(20);
  });
});

describe('product_database (extension): first viewport only + per-item cache', () => {
  it('looks up 8 items (not 20), the requested viewport ids first, and counts 1 + 8 eBay calls', async () => {
    const r = makeRes();
    await researchHandler(req(pd('turkish towel', { enrich: '8', enrich_ids: '100000000015,100000000016' })), r);
    expect(r.state.status).toBe(200);
    expect(itemCalls).toHaveLength(8);
    expect(itemCalls.slice(0, 2).sort()).toEqual(['100000000015', '100000000016']);
    const enriched = r.state.body.items.filter((i: any) => i.enriched === true);
    expect(enriched).toHaveLength(8);
    expect(r.state.body.pendingIds).toEqual([]);
    expect(budget()).toBe(9);
    expect(store.count(USER, quotaKey(istanbulDay().day))).toBe(1);
  });

  it('per-item results are reused by another search and another user (24 h shared cache)', async () => {
    await researchHandler(req(pd('turkish towel')), makeRes());
    expect(itemCalls).toHaveLength(8);
    const row = store.get(SHARED_USER_ID, itemCacheKey('EBAY_US', '100000000001'));
    expect(row?.data).toMatchObject({ soldQuantity: 1, remainingQuantity: 5 });
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600e3);

    // Different query (new search cache key), same first items: no item lookups at all.
    itemCalls.length = 0;
    const r2 = makeRes();
    await researchHandler(req(pd('cotton towel'), { 'x-kx-client': 'ext/9.9.0' }), r2);
    expect(itemCalls).toHaveLength(0);
    expect(r2.state.body.items.slice(0, 8).every((i: any) => i.enriched === true && i.enrichSource === 'cache')).toBe(true);
    expect(budget()).toBe(9 + 1); // only the Browse search
  });

  it('web-app call keeps 20 lookups and never touches the per-item cache', async () => {
    const before = store.snapshot();
    const r = makeRes();
    await researchHandler(req(pd('turkish towel'), {}), r);
    expect(itemCalls).toHaveLength(20);
    expect(r.state.body.pendingIds).toBeUndefined();
    expect(store.snapshot()).toBe(before);
  });
});

describe('product_database (extension): time box', () => {
  it('answers within ~4 s when item lookups are slow, marks the rest pending, and a re-poll fills them without eBay calls', async () => {
    vi.useFakeTimers();
    itemDelayMs = 30_000; // every item lookup takes 30 s
    const r = makeRes();
    const t0 = Date.now();
    let done = false;
    const p = researchHandler(req(pd('slow towel')), r).then(() => { done = true; });

    await vi.advanceTimersByTimeAsync(EXT_TIME_BOX_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(done).toBe(true);
    expect(Date.now() - t0).toBeLessThanOrEqual(EXT_TIME_BOX_MS + 100);
    expect(r.state.status).toBe(200);
    expect(r.state.body.items).toHaveLength(20);
    expect(r.state.body.pendingIds).toHaveLength(8);
    expect(r.state.body.items.filter((i: any) => i.enrichPending === true)).toHaveLength(8);
    expect(r.state.body.total).toBe(20);
    expect(budget()).toBe(9); // the 8 lookups still count: they complete in the background

    // The lookups finish later (two waves of 4) and land in the per-item cache.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(store.get(SHARED_USER_ID, itemCacheKey('EBAY_US', '100000000003'))?.data).toMatchObject({ soldQuantity: 3 });

    // Re-poll: shared-cache hit (free) merged with the per-item cache.
    const calls = itemCalls.length;
    const r2 = makeRes();
    await researchHandler(req(pd('slow towel')), r2);
    expect(itemCalls.length).toBe(calls);
    expect(r2.state.body.pendingIds).toEqual([]);
    expect(r2.state.body.items.slice(0, 8).every((i: any) => i.enriched === true && !i.enrichPending)).toBe(true);
    expect(store.count(USER, quotaKey(istanbulDay().day))).toBe(1);
  });

  it('enrichSoldQuantities: bounded concurrency, returns at the deadline', async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchDetails = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1000));
      inFlight--;
      return { soldQuantity: 7, remainingQuantity: 1 };
    };
    const p = enrichSoldQuantities(ids.map(summary), { marketplaceId: 'EBAY_US', max: 8, concurrency: 4, deadline: Date.now() + 1500, fetchDetails });
    await vi.advanceTimersByTimeAsync(1600);
    const res = await p;
    expect(maxInFlight).toBe(4);
    expect(res.timedOut).toBe(true);
    expect(res.items.filter((i) => i.enriched === true)).toHaveLength(4); // first wave done at 1 s
    expect(res.pendingIds).toHaveLength(4); // second wave still running at 1.5 s
    expect(res.apiCalls).toBe(8);
  });
});
