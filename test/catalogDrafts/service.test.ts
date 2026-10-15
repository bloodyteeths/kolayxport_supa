import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDelegate } from './fakeDb';

const h = vi.hoisted(() => ({
  catalogDraft: null as any,
  shopifyProduct: { findUnique: vi.fn() },
  trendyolProduct: { findUnique: vi.fn() },
  wixProduct: { findUnique: vi.fn() },
  shopifyShop: { findFirst: vi.fn() },
  wixSite: { findFirst: vi.fn() },
  credential: { findUnique: vi.fn() },
  stockLink: { findFirst: vi.fn() },
  getStockSettings: vi.fn(),
  refreshHealth: vi.fn(async () => ({ written: 1 })),
}));

vi.mock('@/lib/prisma', () => {
  const client: any = {
    get catalogDraft() { return h.catalogDraft; },
    shopifyProduct: h.shopifyProduct,
    trendyolProduct: h.trendyolProduct,
    wixProduct: h.wixProduct,
    shopifyShop: h.shopifyShop,
    wixSite: h.wixSite,
    credential: h.credential,
    stockLink: h.stockLink,
    $transaction: async (fn: any) => fn({ $executeRaw: async () => 0, get catalogDraft() { return h.catalogDraft; } }),
  };
  return { default: client };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() } }));
vi.mock('@/lib/stock/settings', () => ({
  getStockSettings: h.getStockSettings,
  isStockSyncActive: (s: any) => Boolean(s?.enabled),
  channelEnabled: () => true,
}));
vi.mock('@/lib/listings/refreshHealth', () => ({ refreshHealth: h.refreshHealth }));
vi.mock('@/lib/catalogDrafts/executors/trendyol', () => ({ trendyolExecutor: {} }));
vi.mock('@/lib/catalogDrafts/executors/wix', () => ({ wixExecutor: {} }));
vi.mock('@/lib/catalogDrafts/executors/shopify', () => ({ shopifyExecutor: {} }));

import {
  CatalogDraftError,
  CatalogExecutorError,
  assertEditable,
  detectConflict,
  rebaseCatalogDraft,
  parseScheduledSendAt,
  resolvePendingCatalogBatches,
  sendCatalogDrafts,
  stageCatalogDraft,
  validateFieldPatch,
  catalogDraftsAvailable,
  type CatalogDraftRecord,
  type CatalogExecutors,
  type CatalogExecutorSession,
  type RemoteState,
} from '@/lib/catalogDrafts/service';

const USER = 'u1';
const SHOP = 'shop1';
const T0 = new Date('2026-10-01T10:00:00Z');

function shopifyCacheRow(over: Record<string, any> = {}) {
  return {
    title: 'Pink Baby Blanket',
    price: '24.90',
    totalInventory: 5,
    tags: ['baby'],
    status: 'active',
    trackInventory: true,
    variantCount: 1,
    shopifyUpdatedAt: T0,
    ...over,
  };
}

function draftRow(over: Record<string, any> = {}) {
  return {
    id: 'd1',
    userId: USER,
    marketplace: 'shopify',
    storeId: SHOP,
    externalId: 'p1',
    status: 'draft',
    baseUpdatedAt: T0,
    baseSnapshot: { title: 'Pink Baby Blanket', price: 24.9, quantity: 5, tags: ['baby'], status: 'active', variantCount: 1, trackInventory: true },
    fieldPatch: { price: 29.9 },
    queuedActions: [],
    batchRequestId: null,
    lastSyncError: null,
    scheduledSendAt: null,
    createdAt: T0,
    updatedAt: T0,
    syncedAt: null,
    ...over,
  };
}

function fakeSession(remote: Partial<RemoteState> | null, impl: Partial<CatalogExecutorSession> = {}) {
  const apply = vi.fn(async (draft: CatalogDraftRecord) => ({ kind: 'synced' as const, applied: { ...draft.fieldPatch } }));
  const writeCache = vi.fn(async () => undefined);
  const session: CatalogExecutorSession = {
    readRemote: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, remote
      ? { exists: true, updatedAt: T0, values: { price: 24.9, quantity: 5, title: 'Pink Baby Blanket' }, ...remote }
      : { exists: false, updatedAt: null, values: {} }]))),
    apply,
    writeCache,
    ...impl,
  };
  const executors = { shopify: { open: vi.fn(async () => session) }, wix: { open: vi.fn() }, trendyol: { open: vi.fn(async () => session) } } as unknown as CatalogExecutors;
  return { session, executors, apply, writeCache };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.catalogDraft = createFakeDelegate();
  h.shopifyShop.findFirst.mockResolvedValue({ id: SHOP });
  h.shopifyProduct.findUnique.mockResolvedValue(shopifyCacheRow());
  h.getStockSettings.mockResolvedValue(null);
  h.stockLink.findFirst.mockResolvedValue(null);
});

describe('validation', () => {
  it('normalizes price and quantity and rejects fields the marketplace cannot stage', () => {
    expect(validateFieldPatch('shopify', { price: '19,999', quantity: 3, title: '  New  ' }).set).toEqual({ price: 20, quantity: 3, title: 'New' });
    expect(() => validateFieldPatch('trendyol', { tags: ['x'] })).toThrow(CatalogDraftError);
    expect(() => validateFieldPatch('wix', { tags: ['a'] })).toThrow(/cannot be staged/);
    expect(() => validateFieldPatch('shopify', { price: 0 })).toThrow(CatalogDraftError);
    expect(() => validateFieldPatch('shopify', { quantity: 1.5 })).toThrow(CatalogDraftError);
    expect(validateFieldPatch('shopify', { price: null }).remove).toEqual(['price']);
    expect(validateFieldPatch('shopify', { tags: ['A', 'a', ' b '] }).set.tags).toEqual(['A', 'b']);
  });

  it('parses scheduledSendAt: undefined keeps, null clears, past/garbage rejected', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(parseScheduledSendAt(undefined, now)).toBeUndefined();
    expect(parseScheduledSendAt(null, now)).toBeNull();
    expect(parseScheduledSendAt('2026-10-15T13:00:00Z', now)?.toISOString()).toBe('2026-10-15T13:00:00.000Z');
    expect(() => parseScheduledSendAt('2026-10-14T13:00:00Z', now)).toThrow(CatalogDraftError);
    expect(() => parseScheduledSendAt('nope', now)).toThrow(CatalogDraftError);
    expect(() => parseScheduledSendAt('2028-10-15T13:00:00Z', now)).toThrow(CatalogDraftError);
  });
});

describe('detectConflict', () => {
  const base = { ...draftRow(), baseSnapshot: { price: 24.9, quantity: 5 } } as any;
  const rec = (o: any = {}) => ({ ...base, ...o, baseUpdatedAt: o.baseUpdatedAt ?? T0 }) as CatalogDraftRecord;

  it('no conflict when the remote is not newer than the base', () => {
    expect(detectConflict(rec(), { exists: true, updatedAt: T0, values: { price: 99 } }).conflict).toBe(false);
  });
  it('conflict when a patched field changed remotely', () => {
    const r = detectConflict(rec(), { exists: true, updatedAt: new Date(T0.getTime() + 1000), values: { price: 27 } });
    expect(r).toEqual({ conflict: true, changedFields: ['price'] });
  });
  it('newer timestamp but patched field unchanged → no conflict', () => {
    expect(detectConflict(rec(), { exists: true, updatedAt: new Date(T0.getTime() + 1000), values: { price: 24.9 } }).conflict).toBe(false);
  });
  it('no timestamps (Trendyol): field-level only', () => {
    expect(detectConflict(rec({ baseUpdatedAt: null }), { exists: true, updatedAt: null, values: { price: 24.9 } }).conflict).toBe(false);
    expect(detectConflict({ ...rec(), baseUpdatedAt: null }, { exists: true, updatedAt: null, values: { price: 25 } }).conflict).toBe(true);
  });
  it('a field the remote already holds (earlier partial send) is not a conflict', () => {
    const partial = rec({ baseSnapshot: { title: 'Old', price: 24.9 }, fieldPatch: { title: 'New', price: 29.9 } });
    // Our own earlier write changed the title; the price write failed.
    expect(detectConflict(partial, { exists: true, updatedAt: new Date(T0.getTime() + 1000), values: { title: 'New', price: 24.9 } }))
      .toEqual({ conflict: false, changedFields: [] });
    // Somebody else changed the price: still a conflict.
    expect(detectConflict(partial, { exists: true, updatedAt: new Date(T0.getTime() + 1000), values: { title: 'New', price: 27 } }))
      .toEqual({ conflict: true, changedFields: ['price'] });
  });
  it('product gone → conflict', () => {
    expect(detectConflict(rec(), { exists: false, updatedAt: null, values: {} }).conflict).toBe(true);
  });
});

describe('assertEditable', () => {
  it('refuses a Wix price edit while a sale price differs', () => {
    expect(() => assertEditable('wix', { price: 10 }, { discounted: true })).toThrow(expect.objectContaining({ code: 'DISCOUNTED' }));
    expect(() => assertEditable('wix', { title: 'x' }, { discounted: true })).not.toThrow();
    expect(() => assertEditable('wix', { price: 10 }, { discounted: false })).not.toThrow();
  });
});

describe('rebaseCatalogDraft (keep my changes)', () => {
  it('takes the remote as the new base and returns a conflict to draft, without sending', async () => {
    h.catalogDraft.rows.push(draftRow({ status: 'conflict', lastSyncError: 'listings.draftError.conflict', baseSnapshot: { price: 24.9, sentItem: { barcode: 'x' } } }));
    const later = new Date(T0.getTime() + 60_000);
    const { executors, apply } = fakeSession({ updatedAt: later, values: { price: 26, quantity: 5, title: 'Pink Baby Blanket' } });
    const r = await rebaseCatalogDraft('d1', USER, { executors });
    expect(r).toMatchObject({ status: 'draft', lastSyncError: null, fieldPatch: { price: 29.9 } });
    expect(r.baseSnapshot).toMatchObject({ price: 26 });
    expect(r.baseSnapshot).not.toHaveProperty('sentItem');
    expect(r.baseUpdatedAt?.getTime()).toBe(later.getTime());
    expect(apply).not.toHaveBeenCalled();
    // The next send compares against the new base: no conflict.
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.sent).toEqual(['d1']);
  });

  it('refuses an open draft, someone else\'s draft and a product gone remotely', async () => {
    h.catalogDraft.rows.push(draftRow(), draftRow({ id: 'd2', status: 'conflict' }));
    const { executors } = fakeSession({});
    await expect(rebaseCatalogDraft('d1', USER, { executors })).rejects.toMatchObject({ code: 'DRAFT_NOT_EDITABLE' });
    await expect(rebaseCatalogDraft('d2', 'other', { executors })).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' });
    const gone = fakeSession(null);
    await expect(rebaseCatalogDraft('d2', USER, { executors: gone.executors })).rejects.toMatchObject({ code: 'REMOTE_MISSING' });
    expect(h.catalogDraft.rows[1].status).toBe('conflict');
  });
});

describe('stageCatalogDraft', () => {
  it('creates one open draft from the cache snapshot and merges later edits into it', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { price: 29.9 } });
    expect(a.status).toBe('draft');
    expect(a.baseSnapshot).toMatchObject({ price: 24.9, quantity: 5 });
    const b = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { title: 'New title', price: null } });
    expect(b.id).toBe(a.id);
    expect(b.fieldPatch).toEqual({ title: 'New title' });
    expect(h.catalogDraft.rows).toHaveLength(1);
  });

  it('keeps a conflict a conflict when edited, and returns a failed draft to draft', async () => {
    h.catalogDraft.rows.push(draftRow({ status: 'conflict', lastSyncError: 'listings.draftError.conflict' }));
    const c = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { quantity: 4 } });
    expect(c.status).toBe('conflict');
    h.catalogDraft.rows[0].status = 'failed';
    const f = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { quantity: 4 } });
    expect(f.status).toBe('draft');
    expect(f.lastSyncError).toBeNull();
  });

  it('refuses price/stock on multi-variant products, delete mixed with edits, and scheduling a delete', async () => {
    h.shopifyProduct.findUnique.mockResolvedValueOnce(shopifyCacheRow({ variantCount: 3 }));
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { price: 10 } })).rejects.toMatchObject({ code: 'MULTI_VARIANT' });
    await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { title: 'x' } });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', queuedActions: [{ type: 'delete' }] })).rejects.toMatchObject({ code: 'DELETE_NOT_EXCLUSIVE' });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p2', queuedActions: [{ type: 'delete' }], scheduledSendAt: new Date(Date.now() + 3600_000).toISOString() })).rejects.toMatchObject({ code: 'SCHEDULE_DELETE_REFUSED' });
  });

  it('refuses stock edits while stock sync manages the product', async () => {
    h.getStockSettings.mockResolvedValue({ enabled: true });
    h.stockLink.findFirst.mockResolvedValue({ id: 'link1' });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { quantity: 2 } })).rejects.toMatchObject({ code: 'STOCK_MANAGED' });
  });

  it('is unavailable (503) until the CatalogDraft model is deployed', async () => {
    h.catalogDraft = undefined;
    expect(catalogDraftsAvailable()).toBe(false);
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { price: 1 } })).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 });
  });
});

describe('sendCatalogDrafts', () => {
  it('sends, marks synced and writes the cache', async () => {
    h.catalogDraft.rows.push(draftRow());
    const { executors, apply, writeCache } = fakeSession({});
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.sent).toEqual(['d1']);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledWith('p1', { price: 29.9 }, { deleted: false });
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'synced', lastSyncError: null, scheduledSendAt: null });
    expect(h.refreshHealth).toHaveBeenCalledWith('shopify', { storeId: SHOP, userId: USER, ids: ['p1'] });
  });

  it('sends the version staged after its read: re-reads after the claim', async () => {
    h.catalogDraft.rows.push(draftRow());
    const realUpdateMany = h.catalogDraft.updateMany;
    let first = true;
    h.catalogDraft.updateMany = async (args: any) => {
      // A stage lands between the send's read and its claim.
      if (first) { first = false; h.catalogDraft.rows[0].fieldPatch = { price: 31 }; }
      return realUpdateMany(args);
    };
    const { executors, apply, writeCache } = fakeSession({});
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.sent).toEqual(['d1']);
    expect(apply.mock.calls[0][0].fieldPatch).toEqual({ price: 31 });
    expect(writeCache).toHaveBeenCalledWith('p1', { price: 31 }, { deleted: false });
  });

  it('a delete queued between the read and the claim still needs its confirmation', async () => {
    h.catalogDraft.rows.push(draftRow({ fieldPatch: {} }));
    const realUpdateMany = h.catalogDraft.updateMany;
    let first = true;
    h.catalogDraft.updateMany = async (args: any) => {
      if (first) { first = false; h.catalogDraft.rows[0].queuedActions = [{ type: 'delete', queuedAt: T0.toISOString() }]; }
      return realUpdateMany(args);
    };
    const { executors, apply } = fakeSession({});
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.skipped).toEqual([{ id: 'd1', reason: 'queued_delete' }]);
    expect(apply).not.toHaveBeenCalled();
    expect(h.catalogDraft.rows[0].status).toBe('draft');
  });

  it('never forces a conflict: the draft becomes conflict and nothing is written', async () => {
    h.catalogDraft.rows.push(draftRow());
    const { executors, apply } = fakeSession({ updatedAt: new Date(T0.getTime() + 60_000), values: { price: 26 } });
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.conflicts).toEqual(['d1']);
    expect(res.results[0].changedFields).toEqual(['price']);
    expect(apply).not.toHaveBeenCalled();
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'conflict', lastSyncError: 'listings.draftError.conflict' });
  });

  it('skips a queued delete unless confirmed, and sends it once confirmed', async () => {
    h.catalogDraft.rows.push(draftRow({ fieldPatch: {}, queuedActions: [{ type: 'delete', queuedAt: T0.toISOString() }] }));
    const { executors, apply } = fakeSession({}, {
      apply: vi.fn(async () => ({ kind: 'synced' as const, applied: {}, deleted: true })),
    });
    const skipped = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(skipped.skipped).toEqual([{ id: 'd1', reason: 'queued_delete' }]);
    expect(h.catalogDraft.rows[0].status).toBe('draft');
    expect(apply).not.toHaveBeenCalled();

    const sent = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0, confirmDeleteIds: ['d1'] });
    expect(sent.sent).toEqual(['d1']);
    expect(h.catalogDraft.rows[0].queuedActions[0].completedAt).toBeTruthy();
  });

  it('keeps the draft as failed with an i18n key when the write fails', async () => {
    h.catalogDraft.rows.push(draftRow());
    const { executors } = fakeSession({}, {
      apply: vi.fn(async () => { throw new CatalogExecutorError('listings.draftError.multiLocation'); }),
    });
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.failed).toEqual([{ id: 'd1', errorKey: 'listings.draftError.multiLocation' }]);
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'failed', lastSyncError: 'listings.draftError.multiLocation' });
  });

  it('does not claim a draft that is already sending, synced or cancelled', async () => {
    h.catalogDraft.rows.push(draftRow({ status: 'syncing', updatedAt: new Date() }), draftRow({ id: 'd2', status: 'synced' }));
    const { executors, apply } = fakeSession({});
    const res = await sendCatalogDrafts(USER, ['d1', 'd2', 'missing'], { executors, interDraftDelayMs: 0 });
    expect(res.skipped.map((s) => s.reason)).toEqual(['not_sendable', 'not_sendable', 'not_found']);
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps a Trendyol batch pending and resolves it later', async () => {
    h.catalogDraft.rows.push(draftRow({ marketplace: 'trendyol', storeId: 'sup1', externalId: 'BC1', baseUpdatedAt: null, baseSnapshot: { price: 24.9 } }));
    const pollBatch = vi.fn(async (_b: string, drafts: CatalogDraftRecord[]) => new Map(drafts.map((d) => [d.id, { kind: 'synced' as const, applied: { price: 29.9 } }])));
    const { executors } = fakeSession({ updatedAt: null, values: { price: 24.9 } }, {
      apply: undefined,
      applyMany: vi.fn(async (items) => new Map(items.map(({ draft }) => [draft.id, { kind: 'pending' as const, batchRequestId: 'B1' }]))),
      pollBatch,
    });
    const res = await sendCatalogDrafts(USER, ['d1'], { executors, interDraftDelayMs: 0 });
    expect(res.pending).toEqual(['d1']);
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'syncing', batchRequestId: 'B1' });

    const r = await resolvePendingCatalogBatches({ executors });
    expect(r).toEqual({ synced: 1, failed: 0, pending: 0 });
    expect(pollBatch).toHaveBeenCalledWith('B1', expect.any(Array));
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'synced', batchRequestId: null });
  });

  it('a batch that cannot be polled still times out instead of staying locked', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    h.catalogDraft.rows.push(
      draftRow({ marketplace: 'trendyol', storeId: 'sup1', externalId: 'BC1', status: 'syncing', batchRequestId: 'B1', updatedAt: old }),
      draftRow({ id: 'd2', marketplace: 'trendyol', storeId: 'sup1', externalId: 'BC2', status: 'syncing', batchRequestId: 'B2', updatedAt: new Date() }),
    );
    const executors = { trendyol: { open: vi.fn(async () => { throw new CatalogExecutorError('listings.draftError.notConnected'); }) } } as unknown as CatalogExecutors;
    const r = await resolvePendingCatalogBatches({ executors });
    expect(r).toEqual({ synced: 0, failed: 1, pending: 1 });
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'failed', lastSyncError: 'listings.draftError.batchTimeout', batchRequestId: null });
    expect(h.catalogDraft.rows[1].status).toBe('syncing');

    // Poll errors (e.g. an expired batch id) time out the same way.
    h.catalogDraft.rows[1].updatedAt = old;
    const { executors: polling } = fakeSession({}, { pollBatch: vi.fn(async () => { throw new Error('Trendyol API 400'); }) });
    expect(await resolvePendingCatalogBatches({ executors: polling })).toEqual({ synced: 0, failed: 1, pending: 0 });
    expect(h.catalogDraft.rows[1].status).toBe('failed');
  });

  it('caps a send at 500 drafts', async () => {
    const { executors } = fakeSession({});
    await expect(sendCatalogDrafts(USER, Array.from({ length: 501 }, (_, i) => `x${i}`), { executors })).rejects.toMatchObject({ code: 'TOO_MANY' });
  });
});
