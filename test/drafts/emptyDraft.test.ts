// Empty open drafts (every staged change undone, e.g. photo delete → Undo): auto-cancelled, never sent, not counted.
// Etsy / eBay / CatalogDraft services against in-memory Prisma delegates; counters (listings grid, draft lists,
// "Send N" result parsing, scheduled-send tally).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDelegate } from '../catalogDrafts/fakeDb';

const h = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  getEtsyToken: vi.fn(async () => 'tok'),
  callEtsy: vi.fn(),
  getEbayToken: vi.fn(async () => 'tok'),
}));

vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, k: string) => h.db[k] }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() } }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveNotification: vi.fn(), notificationKeys: { draft: (id: string) => id }, NOTIFICATION_LINKS: {} }));
vi.mock('@/lib/listings/healthQueue', () => ({ queueHealthRefresh: vi.fn() }));
vi.mock('@/lib/etsy/http', () => ({ etsyFetch: vi.fn(), callEtsyAPI: h.callEtsy, etsyAuthHeaders: () => ({}) }));
vi.mock('@/lib/etsy/etsyToken', () => ({ getEtsyAccessToken: h.getEtsyToken }));
vi.mock('@/lib/etsy/rateBudget', () => ({
  EtsyPriority: { Interactive: 0 },
  withEtsyBudget: (_o: unknown, fn: () => unknown) => fn(),
  getEtsyBudgetContext: () => null,
}));
vi.mock('@/lib/etsy/mediaSafety', async (orig) => ({ ...(await orig<any>()), unlinkDraftUploadFile: vi.fn(async () => undefined) }));
vi.mock('@/lib/integrations/ebayClient', () => ({ getUserAccessToken: h.getEbayToken }));
vi.mock('@/lib/integrations/ebayRateLimiter', () => ({ callEbayRateLimited: vi.fn() }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: vi.fn(), isStockSyncActive: () => false, channelEnabled: () => true }));
vi.mock('@/lib/listings/refreshHealth', () => ({ refreshHealth: vi.fn(async () => ({})) }));
vi.mock('@/lib/catalogDrafts/executors/trendyol', () => ({ trendyolExecutor: {} }));
vi.mock('@/lib/catalogDrafts/executors/wix', () => ({ wixExecutor: {} }));
vi.mock('@/lib/catalogDrafts/executors/shopify', () => ({ shopifyExecutor: {} }));

import { isCatalogDraftEmpty, isEbayDraftEmpty, isEmptyPatchValue, isEtsyDraftEmpty } from '@/lib/drafts/emptyDraft';
import * as etsy from '@/lib/etsy/draftService';
import * as ebay from '@/lib/ebay/draftService';
import { listCatalogDrafts, patchCatalogDraft, sendCatalogDrafts } from '@/lib/catalogDrafts/service';
import { loadStoreDrafts, syncCountsFrom } from '@/lib/listings/query';
import { etsyAdapter } from '@/lib/listings/adapters/etsy';
import { toSendResult } from '@/components/domain/listings/useStagedChanges';

const T0 = new Date('2026-10-15T10:00:00Z');

/** Draft delegate whose findFirst/findMany answer `_count.media` / `media` from the media delegate (like Prisma). */
function draftDelegate(media: ReturnType<typeof createFakeDelegate>) {
  const d = createFakeDelegate();
  const withMedia = (r: any) => (r ? { ...r, media: media.rows.filter((m) => m.draftId === r.id), _count: { media: media.rows.filter((m) => m.draftId === r.id).length } } : r);
  const findFirst = d.findFirst.bind(d);
  const findUnique = d.findUnique.bind(d);
  const findMany = d.findMany.bind(d);
  return Object.assign(d, {
    findFirst: async (a: any) => (a?.select ? findFirst(a) : withMedia(await findFirst(a))),
    findUnique: async (a: any) => withMedia(await findUnique(a)),
    findMany: async (a: any) => (await findMany({ ...a, select: undefined })).map(withMedia),
  });
}

function mediaDelegate() {
  const m = createFakeDelegate();
  return Object.assign(m, {
    async deleteMany({ where }: any) {
      const before = m.rows.length;
      for (let i = m.rows.length - 1; i >= 0; i--) {
        const r = m.rows[i];
        if (r.draftId === where.draftId && (!where.id || where.id.in.includes(r.id))) m.rows.splice(i, 1);
      }
      return { count: before - m.rows.length };
    },
    async count({ where }: any) {
      return m.rows.filter((r) => r.draftId === where.draftId).length;
    },
  });
}

function etsyDraft(over: Record<string, any> = {}) {
  return {
    id: 'e1', userId: 'u1', etsyShopId: 'shop1', etsyListingId: BigInt(1001), status: 'draft',
    fieldPatch: {}, taxonomyPatch: null, inventoryPatch: null, variationImagesPatch: null, personalizationPatch: null,
    queuedActions: [], scheduledSendAt: null, lastSyncError: null, syncedAt: null, updatedAt: T0, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const etsyMedia = mediaDelegate();
  const ebayMedia = mediaDelegate();
  h.db = {
    etsyDraftMedia: etsyMedia,
    etsyListingDraft: draftDelegate(etsyMedia),
    etsyDraftSyncAttempt: createFakeDelegate(),
    ebayDraftMedia: ebayMedia,
    ebayListingDraft: draftDelegate(ebayMedia),
    ebayDraftSyncAttempt: createFakeDelegate(),
    catalogDraft: createFakeDelegate(),
    shopifyShop: { findFirst: async () => ({ id: 'shop1' }) },
  };
});

describe('isEmptyPatchValue / is*DraftEmpty', () => {
  it('treats null, {}, [] and all-undefined objects as empty', () => {
    for (const v of [null, undefined, {}, [], { title: undefined }]) expect(isEmptyPatchValue(v)).toBe(true);
    for (const v of [{ title: 'x' }, { price: null }, [1], 0, '']) expect(isEmptyPatchValue(v)).toBe(false);
  });

  it('the exact production shape of the bug is empty; any content or a schedule is not', () => {
    const bug = { status: 'draft', fieldPatch: {}, taxonomyPatch: null, inventoryPatch: null, variationImagesPatch: null, personalizationPatch: null, queuedActions: [] };
    expect(isEtsyDraftEmpty(bug, 0)).toBe(true);
    expect(isEtsyDraftEmpty(bug, 1)).toBe(false);
    expect(isEtsyDraftEmpty({ ...bug, personalizationPatch: { remove: true } }, 0)).toBe(false);
    expect(isEtsyDraftEmpty({ ...bug, queuedActions: [{ type: 'renew' }] }, 0)).toBe(false);
    expect(isEtsyDraftEmpty({ ...bug, scheduledSendAt: T0 }, 0)).toBe(false);
    expect(isEtsyDraftEmpty({ ...bug, scheduledSendAt: T0 }, 0, { ignoreSchedule: true })).toBe(true);
    expect(isEbayDraftEmpty({ inventoryPatch: {}, offerPatch: {}, variationPatch: null, queuedActions: [] }, 0)).toBe(true);
    expect(isEbayDraftEmpty({ inventoryPatch: {}, offerPatch: { pricingSummary: {} }, queuedActions: [] }, 0)).toBe(false);
    expect(isCatalogDraftEmpty({ fieldPatch: {}, queuedActions: [] })).toBe(true);
    expect(isCatalogDraftEmpty({ fieldPatch: { price: 3 }, queuedActions: [] })).toBe(false);
  });
});

describe('Etsy: undo to empty', () => {
  it('removing the only staged media (Undo) cancels the draft and keeps the row', async () => {
    h.db.etsyListingDraft.rows.push(etsyDraft());
    h.db.etsyDraftMedia.rows.push({ id: 'm1', draftId: 'e1', kind: 'image', operation: 'delete', localPath: null });
    const r = await etsy.removeDraftMedia('e1', 'u1', ['m1']);
    expect(r).toMatchObject({ removedIds: ['m1'], cancelled: true });
    expect(h.db.etsyListingDraft.rows).toHaveLength(1);
    expect(h.db.etsyListingDraft.rows[0].status).toBe('cancelled');
    expect(h.callEtsy).not.toHaveBeenCalled();
  });

  it('a draft that still holds something stays open', async () => {
    h.db.etsyListingDraft.rows.push(etsyDraft({ fieldPatch: { title: 'New title' } }), etsyDraft({ id: 'e2', status: 'failed' }));
    h.db.etsyDraftMedia.rows.push(
      { id: 'm1', draftId: 'e1', kind: 'image', operation: 'delete', localPath: null },
      { id: 'm2', draftId: 'e2', kind: 'image', operation: 'delete', localPath: null },
      { id: 'm3', draftId: 'e2', kind: 'image', operation: 'reorder', localPath: null },
    );
    expect(await etsy.removeDraftMedia('e1', 'u1', ['m1'])).toMatchObject({ cancelled: false });
    expect(await etsy.removeDraftMedia('e2', 'u1', ['m2'])).toMatchObject({ cancelled: false });
    expect(h.db.etsyListingDraft.rows.map((d: any) => d.status)).toEqual(['draft', 'failed']);
  });

  it('removing the last queued action cancels; a scheduled draft is not empty', async () => {
    h.db.etsyListingDraft.rows.push(etsyDraft({ queuedActions: [{ type: 'renew' }] }), etsyDraft({ id: 'e2', queuedActions: [{ type: 'renew' }], scheduledSendAt: T0 }));
    const d = await etsy.removeQueuedActions('e1', 'u1', ['renew']);
    expect(d?.status).toBe('cancelled');
    expect((await etsy.removeQueuedActions('e2', 'u1', ['renew']))?.status).toBe('draft');
  });

  it('replacing the field patch with nothing (editor revert) cancels; a plain `fields: {}` stage (media upload route) does not', async () => {
    h.db.etsyShop = { findFirst: async () => ({ id: 's' }) };
    h.db.etsyListingDraft.rows.push(etsyDraft());
    // The media route stages `fields: {}` to get a draft id, then adds the file: that must not cancel.
    const kept = await etsy.upsertDraftPatch({ userId: 'u1', shopId: 'shop1', listingId: '1001', fields: {} });
    expect(kept?.status).toBe('draft');
    await etsy.upsertDraftPatch({ userId: 'u1', shopId: 'shop1', listingId: '1001', fields: { title: 'x' } });
    const reverted = await etsy.upsertDraftPatch({ userId: 'u1', shopId: 'shop1', listingId: '1001', fields: {}, replaceFields: true });
    expect(reverted?.status).toBe('cancelled');
  });

  it('never cancels a draft that is being sent', async () => {
    h.db.etsyListingDraft.rows.push(etsyDraft({ status: 'syncing' }));
    expect(await etsy.cancelDraftIfEmpty('e1', 'u1')).toBe(false);
    expect(h.db.etsyListingDraft.rows[0].status).toBe('syncing');
  });

  it('does not cancel when the draft changed after it was checked (atomic on updatedAt)', async () => {
    h.db.etsyListingDraft.rows.push(etsyDraft());
    const real = h.db.etsyListingDraft.updateMany;
    h.db.etsyListingDraft.updateMany = async (a: any) => {
      // A stage lands between the check and the conditional update.
      Object.assign(h.db.etsyListingDraft.rows[0], { fieldPatch: { title: 'x' }, updatedAt: new Date(T0.getTime() + 1) });
      return real(a);
    };
    expect(await etsy.cancelDraftIfEmpty('e1', 'u1')).toBe(false);
    expect(h.db.etsyListingDraft.rows[0].status).toBe('draft');
  });

  it('send skips an empty draft: cancelled, reported as skipped/empty, Etsy never called', async () => {
    h.db.etsyListingDraft.rows.push(etsyDraft({ status: 'failed', scheduledSendAt: T0 }));
    const r = await etsy.syncDraft('e1', 'u1');
    expect(r).toEqual({ status: 'skipped', reason: 'empty', draftId: 'e1' });
    expect(h.db.etsyListingDraft.rows[0]).toMatchObject({ status: 'cancelled', scheduledSendAt: null });
    expect(h.getEtsyToken).not.toHaveBeenCalled();
    expect(h.callEtsy).not.toHaveBeenCalled();
    expect(h.db.etsyDraftSyncAttempt.rows).toHaveLength(0);
  });
});

describe('eBay: undo to empty', () => {
  const ebayDraft = (over: Record<string, any> = {}) => ({
    id: 'b1', userId: 'u1', sku: 'SKU1', status: 'draft', inventoryPatch: {}, offerPatch: {}, variationPatch: null,
    queuedActions: [], scheduledSendAt: null, updatedAt: T0, ...over,
  });

  it('removing the last queued action cancels; with a patch left it stays open', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft({ queuedActions: [{ type: 'withdraw' }] }), ebayDraft({ id: 'b2', offerPatch: { pricingSummary: { price: { value: '5' } } }, queuedActions: [{ type: 'withdraw' }] }));
    expect((await ebay.removeQueuedActions('b1', 'u1', ['withdraw']))?.status).toBe('cancelled');
    expect((await ebay.removeQueuedActions('b2', 'u1', ['withdraw']))?.status).toBe('draft');
  });

  it('send skips an empty draft without calling eBay', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft());
    expect(await ebay.syncDraft('b1', 'u1')).toEqual({ status: 'skipped', reason: 'empty', draftId: 'b1' });
    expect(h.db.ebayListingDraft.rows[0].status).toBe('cancelled');
    expect(h.getEbayToken).not.toHaveBeenCalled();
    expect(h.db.ebayDraftSyncAttempt.rows).toHaveLength(0);
  });
});

describe('CatalogDraft: undo to empty', () => {
  const cd = (over: Record<string, any> = {}) => ({
    id: 'c1', userId: 'u1', marketplace: 'shopify', storeId: 'shop1', externalId: 'p1', status: 'draft',
    baseSnapshot: {}, baseUpdatedAt: T0, fieldPatch: {}, queuedActions: [], scheduledSendAt: null, lastSyncError: null,
    batchRequestId: null, syncedAt: null, createdAt: T0, updatedAt: T0, ...over,
  });

  it('un-queuing the last action cancels; with a field left it stays open', async () => {
    h.db.catalogDraft.rows.push(cd({ queuedActions: [{ type: 'archive' }] }), cd({ id: 'c2', externalId: 'p2', fieldPatch: { price: 9 }, queuedActions: [{ type: 'archive' }] }));
    expect((await patchCatalogDraft('c1', 'u1', { removeQueuedActions: ['archive'] })).status).toBe('cancelled');
    expect((await patchCatalogDraft('c2', 'u1', { removeQueuedActions: ['archive'] })).status).toBe('draft');
  });

  it('send skips an empty draft (skipped/empty, not failed) and never opens the executor', async () => {
    h.db.catalogDraft.rows.push(cd());
    const open = vi.fn();
    const res = await sendCatalogDrafts('u1', ['c1'], { executors: { shopify: { open } } as any, interDraftDelayMs: 0 });
    expect(res.skipped).toEqual([{ id: 'c1', reason: 'empty' }]);
    expect(res.failed).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(h.db.catalogDraft.rows[0].status).toBe('cancelled');
  });

  it('the draft list (listOpen / "Send N") excludes an empty open draft', async () => {
    h.db.catalogDraft.rows.push(cd(), cd({ id: 'c2', externalId: 'p2', fieldPatch: { price: 9 } }));
    const list = await listCatalogDrafts({ userId: 'u1', marketplace: 'shopify', storeId: 'shop1' });
    expect(list.map((d) => d.id)).toEqual(['c2']);
  });
});

describe('counters exclude empty drafts', () => {
  it('listings grid counts.sync: an empty open draft is not pending', async () => {
    h.db.etsyListingDraft.rows.push(
      etsyDraft(), // the bug: empty open draft
      etsyDraft({ id: 'e2', etsyListingId: BigInt(1002), fieldPatch: { title: 'x' } }),
      etsyDraft({ id: 'e3', etsyListingId: BigInt(1003) }),
    );
    h.db.etsyDraftMedia.rows.push({ id: 'm1', draftId: 'e3', kind: 'image', operation: 'delete' }); // media-only: not empty
    const ctx = { userId: 'u1', store: { id: 'shop1' } } as any;
    const caps = { health: false, skus: false, scheduledSendAt: true, drafts: true };
    // The fake delegate has no `AND`; the store / window filter is not what this test is about.
    const findMany = vi.fn(async () => Promise.all(h.db.etsyListingDraft.rows.map((r: any) => h.db.etsyListingDraft.findUnique({ where: { id: r.id } }))));
    const drafts = await loadStoreDrafts({ etsyListingDraft: { findMany } } as any, etsyAdapter.drafts, ctx, caps, new Date(T0.getTime() + 60_000));
    // It asks for the columns the emptiness check needs (patches, media count, schedule).
    expect((findMany.mock.calls[0] as any[])[0].select).toMatchObject({ fieldPatch: true, _count: { select: { media: true } }, scheduledSendAt: true });
    expect([...drafts.keys()].sort()).toEqual(['1002', '1003']);
    expect(syncCountsFrom(drafts, new Date(T0.getTime() + 60_000)).pending).toBe(2);
  });

  it('a bulk send result skipped as empty is neither sent nor failed', () => {
    const r = toSendResult({ results: [{ draftId: 'a', status: 'skipped', reason: 'empty' }, { draftId: 'b', status: 'success' }] }, ['a', 'b']);
    expect(r).toEqual({ sent: ['b'], failed: [], conflicts: [] });
  });
});
