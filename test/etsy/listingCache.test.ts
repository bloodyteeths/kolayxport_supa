import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  listingFindUnique: vi.fn(),
  listingCreate: vi.fn(),
  listingUpdateMany: vi.fn(),
  listingDeleteMany: vi.fn(),
  offeringUpsert: vi.fn((x: any) => ({ op: 'upsert', x })),
  offeringDeleteMany: vi.fn((x: any) => ({ op: 'deleteMany', x })),
  transaction: vi.fn(async (ops: any[]) => ops),
  versionFindFirst: vi.fn(),
  versionCount: vi.fn(),
  etsyFetch: vi.fn(),
  attributeChange: vi.fn(),
  captureVersion: vi.fn(),
  captureTombstone: vi.fn(),
  upsertSeoCohort: vi.fn(),
  markOpenDraftsConflict: vi.fn(),
  checkDraftConflicts: vi.fn(),
  observeEtsyOfferings: vi.fn(),
  emitListingDeleted: vi.fn(),
  publishListingLive: vi.fn(),
  wasDeletedByKolayxport: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    etsyListing: { findUnique: m.listingFindUnique, create: m.listingCreate, updateMany: m.listingUpdateMany, deleteMany: m.listingDeleteMany },
    etsyListingOffering: { upsert: m.offeringUpsert, deleteMany: m.offeringDeleteMany },
    etsyListingVersion: { findFirst: m.versionFindFirst, count: m.versionCount },
    $transaction: m.transaction,
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/etsy/http', () => ({ etsyFetch: m.etsyFetch, etsyAuthHeaders: () => ({}) }));
vi.mock('@/lib/etsy/attribution', () => ({ attributeChange: m.attributeChange }));
vi.mock('@/lib/etsy/listingHistory', () => ({
  captureVersion: m.captureVersion,
  captureTombstone: m.captureTombstone,
  getLatestVersion: m.versionFindFirst,
}));
vi.mock('@/lib/etsy/seoExperiments', () => ({ upsertSeoCohort: m.upsertSeoCohort }));
vi.mock('@/lib/etsy/draftConflicts', () => ({
  checkDraftConflicts: m.checkDraftConflicts,
  hasOpenDraft: vi.fn(async () => false),
  markOpenDraftsConflict: m.markOpenDraftsConflict,
}));
vi.mock('@/lib/etsy/listingAlerts', async () => {
  const actual = await vi.importActual<any>('@/lib/etsy/listingAlerts');
  return {
    ...actual,
    emitListingAlerts: vi.fn(),
    emitListingDeleted: m.emitListingDeleted,
    hasRecentOrderForListing: vi.fn(async () => false),
    publishListingLive: m.publishListingLive,
    wasDeletedByKolayxport: m.wasDeletedByKolayxport,
  };
});
vi.mock('@/lib/etsy/listingReconcile', () => ({ reconcileShopListings: vi.fn() }));
vi.mock('@/lib/etsy/etsyToken', () => ({ getEtsyAccessToken: vi.fn(async () => 'tok') }));
vi.mock('@/lib/stock/hooks', () => ({ observeEtsyOfferings: m.observeEtsyOfferings, isListingStockManaged: vi.fn(async () => false) }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveByPrefix: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishLive: vi.fn() }));

import { applyListingPayload, handleEtsyListingEvent, handleListingRemoved, refreshListingFull } from '@/lib/etsy/listingCache';
import { isEtsyDeferError } from '@/lib/etsy/webhooks/types';

const remote = (ts: number, over: Record<string, any> = {}) => ({
  listing_id: 42,
  shop_id: 7,
  title: 'Box',
  description: 'd',
  tags: [],
  materials: [],
  price: { amount: 1000, divisor: 100, currency_code: 'USD' },
  state: 'active',
  updated_timestamp: ts,
  images: [{ listing_image_id: 1, rank: 1 }],
  inventory: {
    products: [
      { product_id: 1, sku: 'A', property_values: [{ property_id: 100, value_ids: [1], values: ['S'] }], offerings: [{ offering_id: 1, quantity: 3, is_enabled: true }] },
      { product_id: 2, sku: 'B', property_values: [{ property_id: 100, value_ids: [2], values: ['L'] }], offerings: [{ offering_id: 2, quantity: 0, is_enabled: true }] },
    ],
    quantity_on_property: [100],
  },
  videos: [],
  ...over,
});
const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

beforeEach(() => {
  Object.values(m).forEach((fn: any) => fn.mockClear?.());
  m.listingFindUnique.mockReset();
  m.listingUpdateMany.mockReset();
  m.etsyFetch.mockReset();
  m.attributeChange.mockResolvedValue({ attribution: 'external' });
  m.captureVersion.mockResolvedValue({ versionId: 'v1', changedKeys: ['title'], diff: {}, batchKey: null, baseline: false });
  m.observeEtsyOfferings.mockResolvedValue({ observed: 0, echoes: 0 });
  m.versionFindFirst.mockResolvedValue(null);
  m.wasDeletedByKolayxport.mockResolvedValue(false);
  m.versionCount.mockResolvedValue(0);
});

const existing = (ts: number, extra: Record<string, any> = {}) => ({
  id: 'row', etsyUpdatedTimestamp: ts, contentHash: 'old', state: 'active', title: 'Box', lastRefreshAt: null, ...extra,
});

describe('timestamp-guarded upsert', () => {
  it('an older refresh can never overwrite a newer cached listing', async () => {
    m.listingUpdateMany.mockResolvedValue({ count: 0 });
    const r = await applyListingPayload({
      userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook',
      fetched: { listing: remote(100), images: remote(100).images, inventory: remote(100).inventory, videos: [] },
      existing: existing(200),
    });
    expect(m.listingUpdateMany.mock.calls[0][0].where).toEqual({ etsyShopId: '7', etsyListingId: BigInt(42), etsyUpdatedTimestamp: { lte: 100 } });
    expect(r.stale).toBe(true);
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.captureVersion).not.toHaveBeenCalled();
  });

  it('writes offerings keyed by variantKey and versions a content change', async () => {
    m.listingUpdateMany.mockResolvedValue({ count: 1 });
    const r = await applyListingPayload({
      userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook',
      fetched: { listing: remote(300), images: remote(300).images, inventory: remote(300).inventory, videos: [] },
      existing: existing(200),
    });
    expect(r.stale).toBe(false);
    const upserts = m.offeringUpsert.mock.calls.map((c: any[]) => c[0].where.etsyShopId_etsyListingId_variantKey.variantKey);
    expect(upserts).toHaveLength(2);
    upserts.forEach((k: string) => expect(k).toMatch(/^[0-9a-f]{40}$/));
    expect(m.offeringDeleteMany.mock.calls[0][0].where.variantKey.notIn).toEqual(upserts);
    expect(m.captureVersion).toHaveBeenCalledTimes(1);
    expect(m.upsertSeoCohort).toHaveBeenCalledTimes(1);
  });
});

describe('refreshListingFull', () => {
  it('listing.updated costs one listing call (+ inventory when not embedded)', async () => {
    m.listingFindUnique.mockResolvedValue(existing(200));
    m.listingUpdateMany.mockResolvedValue({ count: 1 });
    m.etsyFetch.mockResolvedValue(ok(remote(300)));
    const r = await refreshListingFull({ userId: 'u', shopId: '7', listingId: BigInt(42), accessToken: 't', source: 'manual_refresh' });
    expect(m.etsyFetch.mock.calls.length).toBeLessThanOrEqual(2);
    // getListing's includes enum has no Inventory — Etsy 400s on it.
    expect(String(m.etsyFetch.mock.calls[0][0])).toContain('/listings/42?includes=Images,Videos');
    expect(String(m.etsyFetch.mock.calls[0][0])).not.toContain('Inventory');
    expect(r.offerings).toHaveLength(2);
    expect(r.remoteUpdatedTs).toBe(300);
  });

  it('a 404 reports deleted without touching the cache', async () => {
    m.listingFindUnique.mockResolvedValue(existing(200));
    m.etsyFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => 'not found' });
    const r = await refreshListingFull({ userId: 'u', shopId: '7', listingId: BigInt(42), accessToken: 't', source: 'draft_sync' });
    expect(r.deleted).toBe(true);
    expect(m.listingDeleteMany).not.toHaveBeenCalled();
  });

  it('a listing of another shop is never cached under this shop', async () => {
    m.listingFindUnique.mockResolvedValue(null);
    m.etsyFetch.mockResolvedValue(ok(remote(300, { shop_id: 999 })));
    const r = await refreshListingFull({ userId: 'u', shopId: '7', listingId: BigInt(42), accessToken: 't', source: 'reconcile' });
    expect(r.stale).toBe(true);
    expect(m.listingCreate).not.toHaveBeenCalled();
  });
});

describe('handleEtsyListingEvent', () => {
  const ctx = (types: string[]) => ({
    eventId: 'ev1', userId: 'u', shopId: '7', resourceKey: 'listing:42', eventTypes: new Set(types),
    firstReceivedAt: new Date(), attempt: 1, listingId: BigInt(42),
  });

  it('defers (min_interval) when the listing was refreshed < 30 s ago', async () => {
    m.listingFindUnique.mockResolvedValue(existing(200, { lastRefreshAt: new Date(Date.now() - 5_000) }));
    const err = await handleEtsyListingEvent(ctx(['listing.updated'])).catch((e) => e);
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.reason).toBe('min_interval');
    expect(err.retryAfterMs).toBeGreaterThan(20_000);
    expect(m.etsyFetch).not.toHaveBeenCalled();
  });

  it('listing.deleted takes the removal path without an Etsy call', async () => {
    m.listingFindUnique.mockResolvedValue({ title: 'Box', state: 'active' });
    m.markOpenDraftsConflict.mockResolvedValue(1);
    const r = await handleEtsyListingEvent(ctx(['listing.updated', 'listing.deleted']));
    expect(m.etsyFetch).not.toHaveBeenCalled();
    expect(m.captureTombstone).toHaveBeenCalled();
    expect(m.listingDeleteMany).toHaveBeenCalled();
    expect(m.markOpenDraftsConflict).toHaveBeenCalledWith('7', BigInt(42), 'etsy.draftSync.deletedOnEtsy');
    expect(m.observeEtsyOfferings).toHaveBeenCalledWith(expect.objectContaining({ listingState: 'removed', offerings: [] }));
    expect(m.emitListingDeleted).toHaveBeenCalledWith(expect.objectContaining({ suppress: false }));
    expect(r.outcome).toBe('done');
  });

  it('refresh -> conflicts -> observe; a stock lock-busy defer is rethrown', async () => {
    m.listingFindUnique.mockResolvedValue(existing(200));
    m.listingUpdateMany.mockResolvedValue({ count: 1 });
    m.etsyFetch.mockResolvedValue(ok(remote(300)));
    m.checkDraftConflicts.mockResolvedValue(0);
    m.observeEtsyOfferings.mockResolvedValue({ observed: 2, echoes: 0, deferMs: 5000 });
    const err = await handleEtsyListingEvent(ctx(['listing.updated'])).catch((e) => e);
    expect(m.checkDraftConflicts).toHaveBeenCalled();
    expect(m.observeEtsyOfferings).toHaveBeenCalledWith(expect.objectContaining({ source: 'webhook', eventId: 'ev1' }));
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.reason).toBe('lock_busy');
    expect(m.publishListingLive).toHaveBeenCalled();
  });
});

describe('side effects survive a retry after the row was committed', () => {
  it('a retry with the same hash still versions + reports the state transition from the last version', async () => {
    // First attempt: commits the row (hash + state 'inactive') and then "crashes".
    m.listingUpdateMany.mockResolvedValue({ count: 1 });
    const inactive = remote(300, { state: 'inactive' });
    const fetched = { listing: inactive, images: inactive.images, inventory: inactive.inventory, videos: [] };
    await applyListingPayload({ userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook', fetched, existing: existing(200) });
    const committedHash = m.listingUpdateMany.mock.calls[0][0].data.contentHash as string;
    m.captureVersion.mockClear();
    m.attributeChange.mockClear();

    // Retry: the cache row already carries the new hash/state, the last version does not.
    m.versionFindFirst.mockResolvedValue({ contentHash: 'old', state: 'active', snapshot: null });
    const r = await applyListingPayload({
      userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook', fetched,
      existing: existing(300, { contentHash: committedHash, state: 'inactive' }),
    });
    expect(m.attributeChange).toHaveBeenCalledTimes(1);
    expect(m.captureVersion).toHaveBeenCalledWith(expect.objectContaining({ prevHash: 'old', hash: committedHash }));
    expect(r.prevState).toBe('active');
    expect(r.newState).toBe('inactive');
  });

  it('no version and no transition when the last version already has this hash', async () => {
    m.listingUpdateMany.mockResolvedValue({ count: 1 });
    const l = remote(300);
    const fetched = { listing: l, images: l.images, inventory: l.inventory, videos: [] };
    await applyListingPayload({ userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook', fetched, existing: existing(200) });
    const h = m.listingUpdateMany.mock.calls[0][0].data.contentHash as string;
    m.captureVersion.mockClear();
    m.versionFindFirst.mockResolvedValue({ contentHash: h, state: 'active', snapshot: null });
    const r = await applyListingPayload({
      userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook', fetched,
      existing: existing(300, { contentHash: h }),
    });
    expect(m.captureVersion).not.toHaveBeenCalled();
    expect(r.prevState).toBe('active');
  });
});

describe('handleListingRemoved (unmocked)', () => {
  it('reconcile removal never observes stock', async () => {
    m.listingFindUnique.mockResolvedValue({ title: 'Box', state: 'active' });
    m.markOpenDraftsConflict.mockResolvedValue(0);
    await handleListingRemoved({ userId: 'u', shopId: '7', listingId: BigInt(42), source: 'reconcile', observeStock: false });
    expect(m.observeEtsyOfferings).not.toHaveBeenCalled();
    expect(m.listingDeleteMany).toHaveBeenCalled();
    expect(m.captureTombstone).toHaveBeenCalledWith(expect.objectContaining({ attribution: 'unknown' }));
  });
  it('defaults to no observation for reconcile/initial sources, observation for webhooks', async () => {
    m.listingFindUnique.mockResolvedValue({ title: 'Box', state: 'active' });
    m.markOpenDraftsConflict.mockResolvedValue(0);
    await handleListingRemoved({ userId: 'u', shopId: '7', listingId: BigInt(42), source: 'initial' });
    expect(m.observeEtsyOfferings).not.toHaveBeenCalled();
    await handleListingRemoved({ userId: 'u', shopId: '7', listingId: BigInt(42), source: 'webhook' });
    expect(m.observeEtsyOfferings).toHaveBeenCalledWith(expect.objectContaining({ listingState: 'removed', offerings: [] }));
  });
});
