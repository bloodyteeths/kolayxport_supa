// Legacy eBay listings (created on eBay via the Trading API, cached with SKU `legacy-<itemId>`): the Inventory API
// cannot edit them, so staging is refused (409 EBAY_LEGACY_LISTING), sends skip them without calling eBay (reason
// `legacy`, not failed, row untouched) and no "changes not sent" counter includes them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDelegate } from '../catalogDrafts/fakeDb';

const h = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  getEbayToken: vi.fn(async () => 'tok'),
  callEbay: vi.fn(),
  notify: vi.fn(async () => undefined),
  user: { id: 'u1' } as any,
}));

vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, k: string) => h.db[k] }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn(async () => h.user), getAuthUserOrApiKey: vi.fn(async () => h.user) }));
vi.mock('@/lib/notifications', () => ({ notify: h.notify, resolveNotification: vi.fn(), notificationKeys: { draft: (id: string) => id }, NOTIFICATION_LINKS: {} }));
vi.mock('@/lib/notificationCenter/registry', () => ({ isKnownType: () => true }));
vi.mock('@/lib/listings/healthQueue', () => ({ queueHealthRefresh: vi.fn() }));
vi.mock('@/lib/integrations/ebayClient', () => ({ getUserAccessToken: h.getEbayToken }));
vi.mock('@/lib/integrations/ebayRateLimiter', () => ({ callEbayRateLimited: h.callEbay }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: vi.fn(), isStockSyncActive: () => false, channelEnabled: () => true }));
vi.mock('@/lib/listings/refreshHealth', () => ({ refreshHealth: vi.fn(async () => ({})) }));
vi.mock('@/lib/catalogDrafts/executors/trendyol', () => ({ trendyolExecutor: {} }));
vi.mock('@/lib/catalogDrafts/executors/wix', () => ({ wixExecutor: {} }));
vi.mock('@/lib/catalogDrafts/executors/shopify', () => ({ shopifyExecutor: {} }));

import { isLegacyEbayListing, isLegacyEbaySku, legacyEbayItemId } from '@/lib/ebay/legacy';
import { isUncountedDraft } from '@/lib/drafts/emptyDraft';
import * as ebay from '@/lib/ebay/draftService';
import { runScheduledSends } from '@/lib/drafts/scheduledSend';
import { loadStoreDrafts, syncCountsFrom } from '@/lib/listings/query';
import { ebayAdapter } from '@/lib/listings/adapters/ebay';
import { toSendResult } from '@/components/domain/listings/useStagedChanges';
import { ebayErrorInfo } from '@/components/domain/listing-editor/adapters/ebay';
import { EbayDraftClientError } from '@/lib/ebay/draftClient';
import draftsHandler from '@/pages/api/ebay-drafts/index';
import draftIdHandler from '@/pages/api/ebay-drafts/[id]/index';
import syncHandler from '@/pages/api/ebay-drafts/[id]/sync';
import bulkSyncHandler from '@/pages/api/ebay-drafts/bulk-sync';
import batchStageHandler from '@/pages/api/ebay-drafts/batch-stage';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

const T0 = new Date('2026-10-15T10:00:00Z');
const LEGACY = 'legacy-198020866463';

function call(handler: (req: any, res: any) => any, req: { method?: string; body?: unknown; query?: Record<string, string> }) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return Promise.resolve(handler({ method: req.method || 'GET', headers: {}, query: req.query || {}, body: req.body } as any, res)).then(() => res);
}

/** Draft delegate that answers `_count.media` / `media` like Prisma. */
function draftDelegate(media: ReturnType<typeof createFakeDelegate>) {
  const d = createFakeDelegate();
  const withMedia = (r: any) => (r ? { ...r, media: media.rows.filter((m) => m.draftId === r.id), syncAttempts: [], _count: { media: media.rows.filter((m) => m.draftId === r.id).length } } : r);
  const findFirst = d.findFirst.bind(d);
  const findMany = d.findMany.bind(d);
  return Object.assign(d, {
    findFirst: async (a: any) => (a?.select ? findFirst(a) : withMedia(await findFirst(a))),
    findMany: async (a: any) => (await findMany({ ...a, select: undefined, include: undefined, orderBy: undefined })).map(withMedia),
  });
}

const ebayDraft = (over: Record<string, any> = {}) => ({
  id: 'b1', userId: 'u1', sku: LEGACY, offerId: null, listingId: null, status: 'draft',
  baseSnapshotInventory: {}, baseSnapshotOffer: {}, inventoryPatch: { product: { title: 'New title' } }, offerPatch: {},
  variationPatch: null, queuedActions: [], scheduledSendAt: null, lastSyncError: null, syncedAt: null, updatedAt: T0, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: 'u1' };
  const media = createFakeDelegate();
  h.db = {
    ebayDraftMedia: Object.assign(media, { count: async ({ where }: any) => media.rows.filter((r) => r.draftId === where.draftId).length }),
    ebayListingDraft: draftDelegate(media),
    ebayDraftSyncAttempt: createFakeDelegate(),
    etsyListingDraft: createFakeDelegate(),
    catalogDraft: createFakeDelegate(),
  };
});

describe('isLegacyEbaySku / isLegacyEbayListing', () => {
  it('identifies the synthetic legacy-<itemId> SKU; the EbayListing flag wins', () => {
    expect(isLegacyEbaySku(LEGACY)).toBe(true);
    expect(isLegacyEbaySku('SKU-1791538300470')).toBe(false);
    expect(isLegacyEbaySku('legacy-')).toBe(false);
    expect(isLegacyEbaySku(undefined)).toBe(false);
    expect(legacyEbayItemId(LEGACY)).toBe('198020866463');
    expect(isLegacyEbayListing({ isLegacy: true, sku: 'X' })).toBe(true);
    expect(isLegacyEbayListing({ isLegacy: false, sku: LEGACY })).toBe(true);
    expect(isLegacyEbayListing({ isLegacy: false, sku: 'SKU-1' })).toBe(false);
  });

  it('en/tr strings exist under ebay.draftSync.legacyListing', () => {
    expect((en as any).ebay.draftSync.legacyListing).toMatch(/eBay/);
    expect((tr as any).ebay.draftSync.legacyListing).toBe("Bu ilan eBay'de oluşturulmuş; düzenlemek için eBay'i kullanın.");
  });
});

describe('staging is refused for legacy listings', () => {
  it('upsertDraftPatch throws 409 EBAY_LEGACY_LISTING before reading eBay or writing a row', async () => {
    await expect(ebay.upsertDraftPatch({ userId: 'u1', sku: LEGACY, inventoryFields: { product: { title: 'x' } } }))
      .rejects.toMatchObject({ name: 'EbayDraftError', code: 'EBAY_LEGACY_LISTING', status: 409, key: 'ebay.draftSync.legacyListing' });
    expect(h.db.ebayListingDraft.rows).toHaveLength(0);
    expect(h.getEbayToken).not.toHaveBeenCalled();
  });

  it('also when an older draft for that SKU is still open (it is left untouched)', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft());
    await expect(ebay.upsertDraftPatch({ userId: 'u1', sku: LEGACY, offerFields: { pricingSummary: { price: { value: '9' } } } }))
      .rejects.toMatchObject({ code: 'EBAY_LEGACY_LISTING' });
    expect(h.db.ebayListingDraft.rows[0]).toMatchObject({ status: 'draft', offerPatch: {} });
  });

  it('POST /api/ebay-drafts answers 409 with the draft error shape', async () => {
    const res = await call(draftsHandler, { method: 'POST', body: { sku: LEGACY, inventoryFields: { product: { title: 'x' } } } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'EBAY_LEGACY_LISTING', key: 'ebay.draftSync.legacyListing' });
    expect(typeof res.body.error).toBe('string');
  });

  it('POST /api/ebay-drafts/batch-stage refuses the legacy item and stages the others', async () => {
    const res = await call(batchStageHandler, { method: 'POST', body: { items: [{ sku: LEGACY, offerFields: { a: 1 } }] } });
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([{ listingId: LEGACY, ok: false, code: 'EBAY_LEGACY_LISTING', key: 'ebay.draftSync.legacyListing' }]);
    expect(h.db.ebayListingDraft.rows).toHaveLength(0);
  });

  it('scheduling a legacy draft is refused (409); unscheduling is not checked', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft());
    const res = await call(draftIdHandler, { method: 'PATCH', query: { id: 'b1' }, body: { scheduledSendAt: '2026-10-20T10:00:00Z' } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'EBAY_LEGACY_LISTING', key: 'ebay.draftSync.legacyListing' });
    expect(h.db.ebayListingDraft.rows[0].scheduledSendAt).toBeNull();
  });

  it('the editor adapter keeps the full key (no ebay.ebay. prefix) and still prefixes relative keys', () => {
    expect(ebayErrorInfo(new EbayDraftClientError(409, { code: 'EBAY_LEGACY_LISTING', key: 'ebay.draftSync.legacyListing' })).key).toBe('ebay.draftSync.legacyListing');
    expect(ebayErrorInfo(new EbayDraftClientError(409, { code: 'DRAFT_SYNCING', key: 'draftSync.draftSyncing' })).key).toBe('ebay.draftSync.draftSyncing');
  });
});

describe('sends skip legacy drafts without calling eBay', () => {
  it('syncDraft: skipped/legacy, row unchanged, no attempt, no token', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft({ status: 'failed', lastSyncError: 'ebay.draftSync.rejected' }));
    const before = { ...h.db.ebayListingDraft.rows[0] };
    expect(await ebay.syncDraft('b1', 'u1')).toMatchObject({ status: 'skipped', reason: 'legacy', draftId: 'b1', code: 'EBAY_LEGACY_LISTING' });
    expect(h.db.ebayListingDraft.rows[0]).toEqual(before);
    expect(h.db.ebayDraftSyncAttempt.rows).toHaveLength(0);
    expect(h.getEbayToken).not.toHaveBeenCalled();
    expect(h.callEbay).not.toHaveBeenCalled();
  });

  it('an empty legacy draft is also left as it is (not cancelled)', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft({ inventoryPatch: {} }));
    expect(await ebay.syncDraft('b1', 'u1')).toMatchObject({ status: 'skipped', reason: 'legacy' });
    expect(h.db.ebayListingDraft.rows[0].status).toBe('draft');
  });

  it('POST /api/ebay-drafts/[id]/sync answers 200 skipped', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft());
    const res = await call(syncHandler, { method: 'POST', query: { id: 'b1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'skipped', reason: 'legacy' });
  });

  it('bulk-sync reports legacy drafts as skipped, never failed', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft(), ebayDraft({ id: 'b2', sku: 'legacy-197008549496', status: 'failed' }));
    const res = await call(bulkSyncHandler, { method: 'POST', body: { draftIds: ['b1', 'b2'] } });
    expect(res.body).toMatchObject({ success: 0, failed: 0, conflicts: 0, skipped: 2, legacyDrafts: ['b1', 'b2'], emptyDrafts: [] });
    expect(res.body.results.every((r: any) => r.status === 'skipped' && r.reason === 'legacy')).toBe(true);
    expect(h.getEbayToken).not.toHaveBeenCalled();
    // The send bar's parser: neither sent nor failed.
    expect(toSendResult(res.body, ['b1', 'b2'])).toEqual({ sent: [], failed: [], conflicts: [] });
  });

  it('bulkSyncDrafts helper marks them skipped: legacy', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft());
    expect(await ebay.bulkSyncDrafts(['b1'], 'u1')).toEqual([{ draftId: 'b1', success: true, skipped: 'legacy' }]);
  });

  it('scheduled send: tallied as legacy (no failure, no warning notification), eBay never called', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft({ scheduledSendAt: T0 }));
    const syncEbay = vi.fn();
    const s = await runScheduledSends({
      now: new Date(T0.getTime() + 60_000),
      interDraftDelayMs: 0,
      deps: { supported: (k) => k === 'ebay', syncEbay: syncEbay as any, notify: h.notify as any },
    });
    expect(syncEbay).not.toHaveBeenCalled();
    expect(s.byUser.u1.ebay).toMatchObject({ sent: 0, failed: 0, skipped: 0, legacy: 1 });
    expect(h.notify).not.toHaveBeenCalled();
    // Row stays open (only the schedule was cleared by the claim).
    expect(h.db.ebayListingDraft.rows[0]).toMatchObject({ status: 'draft', scheduledSendAt: null, inventoryPatch: { product: { title: 'New title' } } });
  });
});

describe('counts exclude legacy drafts', () => {
  it('isUncountedDraft: legacy eBay drafts in any open status; never other models', () => {
    expect(isUncountedDraft('EbayListingDraft', ebayDraft())).toBe(true);
    expect(isUncountedDraft('EbayListingDraft', ebayDraft({ status: 'conflict' }))).toBe(true);
    expect(isUncountedDraft('EbayListingDraft', ebayDraft({ sku: 'SKU-1' }))).toBe(false);
    expect(isUncountedDraft('CatalogDraft', { sku: LEGACY, status: 'draft', fieldPatch: { a: 1 }, queuedActions: [] })).toBe(false);
  });

  it('GET /api/ebay-drafts leaves legacy drafts out of the list (send bar), but returns them for ?sku= (editor Discard)', async () => {
    h.db.ebayListingDraft.rows.push(ebayDraft(), ebayDraft({ id: 'b2', sku: 'SKU-1' }));
    const list = await call(draftsHandler, { method: 'GET' });
    expect(list.body.count).toBe(1);
    expect(list.body.drafts.map((d: any) => d.id)).toEqual(['b2']);
    const one = await call(draftsHandler, { method: 'GET', query: { sku: LEGACY } });
    expect(one.body.drafts.map((d: any) => d.id)).toEqual(['b1']);
  });

  it('listings grid (send bar + row badges): a legacy draft is not pending', async () => {
    const rows = [ebayDraft(), ebayDraft({ id: 'b2', sku: 'legacy-197105625421' }), ebayDraft({ id: 'b3', sku: 'SKU-1' })];
    const findMany = vi.fn(async () => rows.map((r) => ({ ...r, _count: { media: 0 } })));
    const caps = { health: false, skus: false, scheduledSendAt: true, drafts: true };
    const now = new Date(T0.getTime() + 60_000);
    const drafts = await loadStoreDrafts({ ebayListingDraft: { findMany } } as any, ebayAdapter.drafts!, { userId: 'u1', store: { id: 'ebay' } } as any, caps, now);
    expect((findMany.mock.calls[0] as any[])[0].select).toMatchObject({ sku: true });
    expect([...drafts.keys()]).toEqual(['SKU-1']);
    expect(syncCountsFrom(drafts, now).pending).toBe(1);
  });
});
