import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  etsyShopFindUnique: vi.fn(),
  etsyShopUpdateMany: vi.fn(),
  etsyListingFindMany: vi.fn(),
  etsyListingUpdateMany: vi.fn(),
  offeringFindMany: vi.fn(),
  etsyFetch: vi.fn(),
  applyListingPayload: vi.fn(),
  refreshListingDetailed: vi.fn(),
  handleListingRemoved: vi.fn(),
  enqueueSyntheticEtsyEvent: vi.fn(),
  observeEtsyOfferings: vi.fn(),
  writeDailyTotals: vi.fn(),
  emitListingAlerts: vi.fn(),
  publishLive: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    etsyShop: { findUnique: m.etsyShopFindUnique, updateMany: m.etsyShopUpdateMany },
    etsyListing: { findMany: m.etsyListingFindMany, updateMany: m.etsyListingUpdateMany },
    etsyListingOffering: { findMany: m.offeringFindMany },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/etsy/etsyToken', () => ({ getEtsyAccessToken: vi.fn(async () => 'token') }));
vi.mock('@/lib/etsy/http', () => ({ etsyFetch: m.etsyFetch, etsyAuthHeaders: () => ({}) }));
vi.mock('@/lib/etsy/listingCache', () => ({
  ETSY_API_BASE: 'https://openapi.etsy.com/v3/application',
  applyListingPayload: m.applyListingPayload,
  refreshListingDetailed: m.refreshListingDetailed,
  handleListingRemoved: m.handleListingRemoved,
}));
vi.mock('@/lib/etsy/webhooks/queueOps', () => ({ enqueueSyntheticEtsyEvent: m.enqueueSyntheticEtsyEvent }));
vi.mock('@/lib/stock/hooks', () => ({ observeEtsyOfferings: m.observeEtsyOfferings }));
vi.mock('@/lib/etsy/listingStatsDaily', () => ({ writeDailyTotals: m.writeDailyTotals }));
vi.mock('@/lib/etsy/listingAlerts', async () => {
  const actual = await vi.importActual<any>('@/lib/etsy/listingAlerts');
  return { ...actual, emitListingAlerts: m.emitListingAlerts, publishListingLive: vi.fn() };
});
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveByPrefix: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishLive: m.publishLive }));

import { postConnectListingMode, reconcileShopListings, reconcileComplete, syncListingsFailure, unseenIds } from '@/lib/etsy/listingReconcile';

type PageMap = Record<string, any[] | Error>;

function respond(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function setPages(pages: PageMap) {
  m.etsyFetch.mockImplementation(async (url: string) => {
    const u = new URL(url);
    const key = `${u.searchParams.get('state')}:${u.searchParams.get('offset')}`;
    const v = pages[key];
    if (v instanceof Error) return respond({ error: v.message }, 500);
    return respond({ results: v || [] });
  });
}

const L = (id: number, state = 'active', ts = 100, qty = 5) => ({
  listing_id: id,
  state,
  updated_timestamp: ts,
  views: 10,
  num_favorers: 1,
  images: [],
  inventory: { products: [{ product_id: 1, sku: 'A', property_values: [], offerings: [{ offering_id: 2, quantity: qty, is_enabled: true }] }] },
});

const cachedRow = (id: number, ts = 100) => ({
  id: `row${id}`,
  etsyListingId: BigInt(id),
  etsyUpdatedTimestamp: ts,
  contentHash: 'h',
  state: 'active',
  title: 't',
  lastRefreshAt: null,
  views: 10,
  numFavorers: 1,
  inventorySyncedAt: new Date(),
});

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.etsyShopFindUnique.mockResolvedValue({ userId: 'u1', isActive: true, needsReauth: false, lastListingSyncAt: new Date('2026-01-01T00:00:00Z') });
  m.etsyShopUpdateMany.mockResolvedValue({ count: 1 });
  m.offeringFindMany.mockResolvedValue([]);
  m.writeDailyTotals.mockResolvedValue(0);
  m.applyListingPayload.mockResolvedValue({ stale: false, prevState: 'active', newState: 'active', changedKeys: [], attribution: 'unknown', title: 't' });
});

describe('pure helpers', () => {
  it('reconcileComplete requires every page and write to succeed', () => {
    expect(reconcileComplete({ pageFailed: false, writeErrors: 0, budgetStopped: false })).toBe(true);
    expect(reconcileComplete({ pageFailed: true, writeErrors: 0, budgetStopped: false })).toBe(false);
    expect(reconcileComplete({ pageFailed: false, writeErrors: 1, budgetStopped: false })).toBe(false);
    expect(reconcileComplete({ pageFailed: false, writeErrors: 0, budgetStopped: true })).toBe(false);
  });
  it('syncListingsFailure maps hard failures to non-2xx and keeps partial runs 200', () => {
    expect(syncListingsFailure({ success: true, fetched: 0, errors: [] })).toBeNull();
    expect(syncListingsFailure({ success: false, fetched: 0, errors: ['needs_reauth'] })).toMatchObject({ status: 409, code: 'ETSY_REAUTH' });
    expect(syncListingsFailure({ success: false, fetched: 0, errors: ['shop_not_found'] })).toMatchObject({ status: 404 });
    expect(syncListingsFailure({ success: false, fetched: 0, errors: ['budget'] })).toMatchObject({ status: 503 });
    expect(syncListingsFailure({ success: false, fetched: 0, errors: ['deferred:active:0'] })).toMatchObject({ status: 503 });
    expect(syncListingsFailure({ success: false, fetched: 0, errors: ['fetch:active:0:x'] })).toMatchObject({ status: 502 });
    expect(syncListingsFailure({ success: false, fetched: 40, errors: ['fetch:draft:0:x'] })).toBeNull();
  });
  it('postConnectListingMode is silent only for a never-imported or re-owned shop', () => {
    expect(postConnectListingMode({ ownerChanged: false, lastListingSyncAt: null, cachedCount: 0 })).toBe('initial');
    expect(postConnectListingMode({ ownerChanged: true, lastListingSyncAt: new Date(), cachedCount: 9 })).toBe('initial');
    expect(postConnectListingMode({ ownerChanged: false, lastListingSyncAt: new Date(), cachedCount: 0 })).toBe('nightly');
    expect(postConnectListingMode({ ownerChanged: false, lastListingSyncAt: null, cachedCount: 3 })).toBe('nightly');
  });
  it('unseenIds caps deletion checks', () => {
    const ids = Array.from({ length: 300 }, (_, i) => String(i));
    expect(unseenIds(ids, new Set(['0', '1']))).toHaveLength(200);
  });
});

describe('reconcileShopListings', () => {
  it('never deletes a listing whose individual GET returns 200; tombstones a 404', async () => {
    m.etsyListingFindMany.mockResolvedValue([cachedRow(1), cachedRow(2), cachedRow(3)]);
    setPages({ 'active:0': [L(1)] });
    m.refreshListingDetailed.mockImplementation(async ({ listingId }: any) =>
      String(listingId) === '2' ? { deleted: false, newState: 'edit' } : { deleted: true, newState: 'removed' },
    );
    const r = await reconcileShopListings('shop1', { mode: 'nightly' });
    expect(r.success).toBe(true);
    expect(m.refreshListingDetailed).toHaveBeenCalledTimes(2);
    expect(m.handleListingRemoved).toHaveBeenCalledTimes(1);
    expect(m.handleListingRemoved.mock.calls[0][0].listingId).toBe(BigInt(3));
    expect(r.removed).toBe(1);
    // the reconcile never observes stock: removal skips it and hands it to the worker
    expect(m.handleListingRemoved.mock.calls[0][0].observeStock).toBe(false);
    expect(m.enqueueSyntheticEtsyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKey: 'listing:3', eventType: 'reconcile.changed', priority: 2 }),
    );
    expect(m.observeEtsyOfferings).not.toHaveBeenCalled();
    expect(m.etsyShopUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastListingSyncAt: expect.any(Date), lastListingReconcileAt: expect.any(Date) }) }),
    );
    // unchanged listing 1 is not rewritten
    expect(m.applyListingPayload).not.toHaveBeenCalled();
  });

  it('a failed page keeps lastListingSyncAt, skips deletion checks and reports partial', async () => {
    m.etsyListingFindMany.mockResolvedValue([cachedRow(1), cachedRow(2)]);
    setPages({ 'active:0': [L(1)], 'draft:0': new Error('boom') });
    const r = await reconcileShopListings('shop1', { mode: 'full' });
    expect(r.success).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.lastSyncAt).toBe('2026-01-01T00:00:00.000Z');
    expect(m.refreshListingDetailed).not.toHaveBeenCalled();
    expect(m.handleListingRemoved).not.toHaveBeenCalled();
    expect(m.etsyShopUpdateMany).not.toHaveBeenCalled();
  });

  it('never observes stock; offering drift enqueues a synthetic listing event', async () => {
    m.etsyListingFindMany.mockResolvedValue([cachedRow(1, 100)]);
    m.offeringFindMany.mockResolvedValue([{ etsyListingId: BigInt(1), variantKey: '', quantity: 5, isEnabled: true }]);
    setPages({ 'active:0': [L(1, 'active', 200, 2)] });
    const r = await reconcileShopListings('shop1', { mode: 'nightly' });
    expect(m.applyListingPayload).toHaveBeenCalledTimes(1);
    expect(m.applyListingPayload.mock.calls[0][0].source).toBe('reconcile');
    expect(m.enqueueSyntheticEtsyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKey: 'listing:1', eventType: 'reconcile.changed', priority: 2 }),
    );
    expect(m.observeEtsyOfferings).not.toHaveBeenCalled();
    expect(r.synced).toBe(1);
  });

  it('writes rows newer than the cache and keeps the response shape', async () => {
    m.etsyListingFindMany.mockResolvedValue([]);
    setPages({ 'active:0': [L(5), L(6)], 'sold_out:0': [L(7, 'sold_out')] });
    const r = await reconcileShopListings('shop1', { mode: 'initial' });
    expect(Object.keys(r).sort()).toEqual(['errors', 'fetched', 'lastSyncAt', 'partial', 'removed', 'success', 'synced']);
    expect(r).toMatchObject({ success: true, synced: 3, fetched: 3, removed: 0 });
    expect(m.applyListingPayload.mock.calls.every((c: any[]) => c[0].source === 'initial')).toBe(true);
    expect(m.writeDailyTotals).toHaveBeenCalledWith('shop1', expect.arrayContaining([expect.objectContaining({ listingId: BigInt(5) })]), expect.any(Date));
    // open listing pages refetch from the DB on these (no per-row listing events)
    const kinds = m.publishLive.mock.calls.map((c: any[]) => c[1]).filter((e: any) => e.type === 'sync' && e.scope === 'listings:etsy').map((e: any) => e.kind);
    expect(kinds[0]).toBe('started');
    expect(kinds).toContain('progress');
    expect(kinds[kinds.length - 1]).toBe('finished');
  });

  it('a nightly reconcile alerts on a deactivation missed during a reauth gap', async () => {
    m.etsyListingFindMany.mockResolvedValue([cachedRow(1, 100)]);
    setPages({ 'inactive:0': [L(1, 'inactive', 200)] });
    m.applyListingPayload.mockResolvedValue({ stale: false, prevState: 'active', newState: 'inactive', changedKeys: ['state'], attribution: 'unknown', title: 't' });
    await reconcileShopListings('shop1', { mode: 'nightly' });
    expect(m.emitListingAlerts).toHaveBeenCalledWith(expect.objectContaining({ alerts: ['listingDeactivated'] }));
  });

  it('a shop that needs reauth makes no Etsy calls', async () => {
    m.etsyShopFindUnique.mockResolvedValue({ userId: 'u1', isActive: true, needsReauth: true, lastListingSyncAt: null });
    const r = await reconcileShopListings('shop1', { mode: 'nightly' });
    expect(r.errors).toEqual(['needs_reauth']);
    expect(m.etsyFetch).not.toHaveBeenCalled();
  });
});
