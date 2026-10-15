import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mocks ----------------------------------------------------------------
const authUser = vi.fn();
const etsyFindMany = vi.fn();
const ebayFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  default: {
    etsyListingDraft: { findMany: (...a: any[]) => etsyFindMany(...a) },
    ebayListingDraft: { findMany: (...a: any[]) => ebayFindMany(...a) },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const etsyUpsert = vi.fn();
const assertShopOwnership = vi.fn();
const recoverStale = vi.fn();
vi.mock('@/lib/etsy/draftService', () => ({
  upsertDraftPatch: (...a: any[]) => etsyUpsert(...a),
  assertShopOwnership: (...a: any[]) => assertShopOwnership(...a),
  recoverStaleSyncingDrafts: (...a: any[]) => recoverStale(...a),
}));
const canSpend = vi.fn();
vi.mock('@/lib/etsy/rateBudget', () => ({
  EtsyPriority: { Critical: 0, Webhook: 1, Reconcile: 2, Interactive: 3 },
  canSpend: (...a: any[]) => canSpend(...a),
}));

const ebayUpsert = vi.fn();
vi.mock('@/lib/ebay/draftService', () => ({ upsertDraftPatch: (...a: any[]) => ebayUpsert(...a) }));

const stageCatalog = vi.fn();
vi.mock('@/lib/catalogDrafts/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/catalogDrafts/service')>('@/lib/catalogDrafts/service');
  return { ...actual, stageCatalogDraft: (...a: any[]) => stageCatalog(...a) };
});

import etsyHandler from '@/pages/api/etsy-drafts/batch-stage';
import ebayHandler from '@/pages/api/ebay-drafts/batch-stage';
import catalogHandler from '@/pages/api/catalog-drafts/index';
import { EtsyDraftError } from '@/lib/etsy/draftErrors';
import { EbayDraftError } from '@/lib/ebay/draftErrors';
import { CatalogDraftError } from '@/lib/catalogDrafts/service';
import { BATCH_STAGE_MAX_ITEMS, mapWithConcurrency, sanitizeEtsyBatchFields } from '@/lib/bulk/batchStage';

function call(handler: (req: any, res: any) => any, body: unknown, method = 'POST') {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query: {}, body } as any, res)).then(() => res);
}

const LONG_TITLE = 'A'.repeat(141);

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: 'u1' });
  etsyFindMany.mockResolvedValue([]);
  ebayFindMany.mockResolvedValue([]);
  assertShopOwnership.mockResolvedValue(undefined);
  recoverStale.mockResolvedValue(0);
  canSpend.mockReturnValue({ ok: true });
  etsyUpsert.mockImplementation(async (p: any) => ({ id: `d-${p.listingId}`, status: 'draft' }));
  ebayUpsert.mockImplementation(async (p: any) => ({ id: `e-${p.sku}`, status: 'draft' }));
  stageCatalog.mockImplementation(async (p: any) => ({ id: `c-${p.externalId}`, status: 'draft' }));
});

// ---------------------------------------------------------------------------
describe('lib/bulk/batchStage — sanitizeEtsyBatchFields', () => {
  it('keeps valid values, normalises strict decimal strings', () => {
    const r = sanitizeEtsyBatchFields({ title: "Mom's Box & Lid", price: '12.50', quantity: '3' });
    expect(r.fields).toEqual({ title: "Mom's Box & Lid", price: 12.5, quantity: 3 });
    expect(r.rejected).toEqual([]);
  });

  it('rejects abc, a 141-character title and unknown fields, and stages the rest', () => {
    const r = sanitizeEtsyBatchFields({ title: LONG_TITLE, price: 'abc', quantity: 2, state: 'active' });
    expect(r.fields).toEqual({ quantity: 2 });
    expect(r.rejected.map((i) => i.field).sort()).toEqual(['price', 'state', 'title']);
    expect(r.rejected.find((i) => i.field === 'title')?.key).toBe('etsy.validation.titleTooLong');
    expect(r.rejected.find((i) => i.field === 'price')?.key).toBe('bulk.stage.priceFormat');
    expect(r.rejected.find((i) => i.field === 'state')).toEqual({ field: 'state', key: 'bulk.stage.fieldNotEditable', params: { field: 'state' } });
  });

  it('refuses locale-ambiguous price strings (parsing is the client\'s job) and bad quantities', () => {
    expect(sanitizeEtsyBatchFields({ price: '12,50' }).rejected[0].field).toBe('price');
    expect(sanitizeEtsyBatchFields({ price: 12.345 }).rejected[0].field).toBe('price');
    expect(sanitizeEtsyBatchFields({ price: 0 }).rejected[0].field).toBe('price');
    expect(sanitizeEtsyBatchFields({ quantity: 1.5 }).rejected[0].field).toBe('quantity');
    expect(sanitizeEtsyBatchFields({ quantity: 0 }).rejected[0].key).toBe('etsy.validation.quantityMin');
    expect(sanitizeEtsyBatchFields({ shop_section_id: 'x1' }).rejected[0].field).toBe('shop_section_id');
    expect(sanitizeEtsyBatchFields({ shop_section_id: '123' }).fields).toEqual({ shop_section_id: 123 });
  });

  it('gives the specific reason: price format vs price ≤ 0, quantity range, id format', () => {
    expect(sanitizeEtsyBatchFields({ price: 12.505 }).rejected[0]).toEqual({ field: 'price', key: 'bulk.stage.priceFormat' });
    expect(sanitizeEtsyBatchFields({ price: '1234567890' }).rejected[0].key).toBe('bulk.stage.priceFormat');
    expect(sanitizeEtsyBatchFields({ price: -3 }).rejected[0].key).toBe('etsy.validation.pricePositive');
    expect(sanitizeEtsyBatchFields({ price: '0' }).rejected[0].key).toBe('etsy.validation.pricePositive');
    expect(sanitizeEtsyBatchFields({ quantity: 1000 }).rejected[0]).toEqual({ field: 'quantity', key: 'bulk.stage.quantityRange', params: { min: 0, max: 999 } });
    expect(sanitizeEtsyBatchFields({ quantity: '12345' }).rejected[0].key).toBe('bulk.stage.quantityRange');
    expect(sanitizeEtsyBatchFields({ taxonomy_id: 'abc' }).rejected[0]).toEqual({ field: 'taxonomy_id', key: 'bulk.stage.idInvalid', params: { field: 'taxonomy_id' } });
  });

  it('replaceFields passes editor-only keys through (never state) and keeps block_sync values as warnings', () => {
    const r = sanitizeEtsyBatchFields({ return_policy_id: 5, item_weight: 2, should_auto_renew: true, title: 'Ok', state: 'active' }, { replaceFields: true });
    expect(r.fields).toEqual({ return_policy_id: 5, item_weight: 2, should_auto_renew: true, title: 'Ok' });
    expect(r.rejected).toEqual([{ field: 'state', key: 'bulk.stage.fieldNotEditable', params: { field: 'state' } }]);
    // Without replaceFields the same keys are refused.
    expect(sanitizeEtsyBatchFields({ return_policy_id: 5 }).rejected[0].key).toBe('bulk.stage.fieldNotEditable');
  });

  it('mapWithConcurrency keeps order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency(Array.from({ length: 23 }, (_, i) => i), 5, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual(Array.from({ length: 23 }, (_, i) => i * 2));
    expect(peak).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/etsy-drafts/batch-stage', () => {
  it('405 / 401 / 400 envelope errors', async () => {
    expect((await call(etsyHandler, {}, 'GET')).statusCode).toBe(405);
    authUser.mockResolvedValueOnce(null);
    expect((await call(etsyHandler, { shopId: 's1', items: [{ listingId: '1' }] })).statusCode).toBe(401);
    expect((await call(etsyHandler, { items: [{ listingId: '1' }] })).body.key).toBe('bulk.stage.invalidRequest');
    expect((await call(etsyHandler, { shopId: 's1', items: [] })).statusCode).toBe(400);
    const tooMany = await call(etsyHandler, { shopId: 's1', items: Array.from({ length: BATCH_STAGE_MAX_ITEMS + 1 }, (_, i) => ({ listingId: String(i + 1), fields: { quantity: 1 } })) });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.body).toMatchObject({ code: 'TOO_MANY', key: 'bulk.stage.tooMany', params: { max: 50 } });
    expect(etsyUpsert).not.toHaveBeenCalled();
  });

  it('404 with a qualified key when the shop is not the user\'s', async () => {
    assertShopOwnership.mockRejectedValueOnce(new EtsyDraftError('SHOP_NOT_FOUND', 'nope', { status: 404, key: 'draftSync.shopNotFound' }));
    const res = await call(etsyHandler, { shopId: 's1', items: [{ listingId: '1', fields: { quantity: 1 } }] });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ code: 'SHOP_NOT_FOUND', key: 'etsy.draftSync.shopNotFound' });
  });

  it('acceptance shape: 200 listings × 3 columns → 4 requests of 50, 200 drafts staged, 0 Etsy writes, ≤ 5 in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    etsyUpsert.mockImplementation(async (p: any) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { id: `d-${p.listingId}`, status: 'draft' };
    });
    const rows = Array.from({ length: 200 }, (_, i) => ({
      listingId: String(1000 + i),
      fields: { title: `Wooden keepsake box ${i} & lid`, price: 12.5 + i, quantity: (i % 9) + 1 },
    }));
    let staged = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const res = await call(etsyHandler, { shopId: 's1', items: rows.slice(i, i + 50) });
      expect(res.statusCode).toBe(200);
      expect(res.body.results).toHaveLength(50);
      staged += res.body.results.filter((r: any) => r.ok).length;
    }
    expect(staged).toBe(200);
    expect(etsyUpsert).toHaveBeenCalledTimes(200);
    expect(peak).toBeLessThanOrEqual(5);
    expect(assertShopOwnership).toHaveBeenCalledTimes(4); // once per request
    for (const [p] of etsyUpsert.mock.calls) {
      expect(Object.keys(p.fields).sort()).toEqual(['price', 'quantity', 'title']);
      expect(p).not.toHaveProperty('queuedActions');
      expect(p).not.toHaveProperty('media');
      expect(p.replaceFields).toBe(false);
    }
  });

  it('partial items: invalid cells are reported as rejected, the rest is staged; all-invalid items fail with issues', async () => {
    const res = await call(etsyHandler, {
      shopId: 's1',
      items: [
        { listingId: '1', fields: { title: 'Fine', price: 'abc', quantity: 2 } },
        { listingId: '2', fields: { title: LONG_TITLE } },
        { listingId: '3', fields: { price: '12.50' } },
      ],
    });
    const [a, b, c] = res.body.results;
    expect(a).toMatchObject({ listingId: '1', ok: true, draftId: 'd-1', status: 'draft' });
    expect(a.rejected).toEqual([{ field: 'price', key: 'bulk.stage.priceFormat' }]);
    expect(etsyUpsert.mock.calls.find(([p]: any) => p.listingId === '1')[0].fields).toEqual({ title: 'Fine', quantity: 2 });
    expect(b).toMatchObject({ listingId: '2', ok: false, code: 'VALIDATION_FAILED', key: 'etsy.validation.titleTooLong' });
    expect(b.issues[0].field).toBe('title');
    expect(c).toMatchObject({ listingId: '3', ok: true });
    expect(etsyUpsert.mock.calls.find(([p]: any) => p.listingId === '3')[0].fields).toEqual({ price: 12.5 });
    expect(etsyUpsert).toHaveBeenCalledTimes(2);
  });

  it('replaceFields (revert) writes the whole remaining patch, refuses it whole when a value is invalid', async () => {
    const res = await call(etsyHandler, {
      shopId: 's1',
      items: [
        { listingId: '1', fields: {}, replaceFields: true },
        { listingId: '2', fields: { title: 'Ok', price: 'abc' }, replaceFields: true },
      ],
    });
    expect(res.body.results[0]).toMatchObject({ ok: true });
    expect(etsyUpsert).toHaveBeenCalledTimes(1);
    expect(etsyUpsert.mock.calls[0][0]).toMatchObject({ listingId: '1', fields: {}, replaceFields: true });
    expect(res.body.results[1]).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('replaceFields revert of a draft the editor touched (editor-only keys) is staged', async () => {
    const res = await call(etsyHandler, {
      shopId: 's1',
      items: [{ listingId: '7', fields: { return_policy_id: 9, is_personalizable: true, description: 'kept' }, replaceFields: true }],
    });
    expect(res.body.results[0]).toMatchObject({ listingId: '7', ok: true });
    expect(etsyUpsert.mock.calls[0][0]).toMatchObject({ fields: { return_policy_id: 9, is_personalizable: true, description: 'kept' }, replaceFields: true });
  });

  it('per-item failures never fail the batch: bad id, duplicate, empty, syncing, budget, engine errors', async () => {
    canSpend.mockReturnValue({ ok: false, retryAfterMs: 120_000, reason: 'budget' });
    etsyUpsert.mockImplementation(async (p: any) => {
      if (p.listingId === '7') throw new EtsyDraftError('DELETE_NOT_EXCLUSIVE', 'x', { status: 409, key: 'draftSync.deleteNotExclusive' });
      if (p.listingId === '8') throw new Error('db down');
      return { id: `d-${p.listingId}`, status: 'conflict' };
    });
    // 6/7/8 have open drafts so the budget gate doesn't apply to them.
    etsyFindMany.mockResolvedValue([
      { etsyListingId: BigInt(5), status: 'syncing' },
      { etsyListingId: BigInt(6), status: 'conflict' },
      { etsyListingId: BigInt(7), status: 'draft' },
      { etsyListingId: BigInt(8), status: 'draft' },
    ]);
    const res = await call(etsyHandler, {
      shopId: 's1',
      items: [
        { listingId: 'abc', fields: { quantity: 1 } },
        { listingId: '6', fields: { quantity: 1 } },
        { listingId: '6', fields: { quantity: 2 } },
        { listingId: '4' },
        { listingId: '5', fields: { quantity: 1 } },
        { listingId: '9', fields: { quantity: 1 } },
        { listingId: '7', fields: { quantity: 1 } },
        { listingId: '8', fields: { quantity: 1 } },
      ],
    });
    expect(res.statusCode).toBe(200);
    const by = res.body.results;
    expect(by[0]).toMatchObject({ ok: false, code: 'INVALID_LISTING_ID', key: 'etsy.draftSync.invalidListingId' });
    expect(by[1]).toMatchObject({ ok: true, listingId: '6', status: 'conflict' });
    expect(by[2]).toMatchObject({ ok: false, code: 'DUPLICATE_ITEM', key: 'bulk.stage.duplicate' });
    expect(by[3]).toMatchObject({ ok: false, code: 'EMPTY_ITEM', key: 'bulk.stage.empty' });
    expect(by[4]).toMatchObject({ ok: false, code: 'DRAFT_SYNCING', key: 'etsy.draftSync.draftSyncing' });
    expect(by[5]).toMatchObject({ ok: false, code: 'BUDGET', key: 'bulk.stage.budget', params: { minutes: 2 } });
    expect(by[6]).toMatchObject({ ok: false, code: 'DELETE_NOT_EXCLUSIVE', key: 'etsy.draftSync.deleteNotExclusive' });
    expect(by[7]).toMatchObject({ ok: false, code: 'STAGE_FAILED', key: 'etsy.draftSync.failed' });
    expect(canSpend).toHaveBeenCalledWith('s1', 3, 2);
    expect(canSpend).toHaveBeenCalledTimes(1); // only listing 9 needed a new draft
  });

  it('never forwards queuedActions or media, so a delete cannot be queued through the batch', async () => {
    await call(etsyHandler, {
      shopId: 's1',
      items: [{ listingId: '1', fields: { quantity: 1 }, queuedActions: [{ type: 'delete' }], media: [{ kind: 'image', operation: 'delete', etsyMediaId: '1' }] }],
    });
    const p = etsyUpsert.mock.calls[0][0];
    expect(p).not.toHaveProperty('queuedActions');
    expect(p).not.toHaveProperty('media');
    expect(Object.keys(p).sort()).toEqual(['fields', 'inventory', 'listingId', 'replaceFields', 'shopId', 'userId']);
  });

  it('stages an inventory-only item (SKU column)', async () => {
    const inventory = { products: [{ sku: 'BOX-1', offerings: [] }] };
    const res = await call(etsyHandler, { shopId: 's1', items: [{ listingId: '1', inventory }] });
    expect(res.body.results[0].ok).toBe(true);
    expect(etsyUpsert.mock.calls[0][0]).toMatchObject({ inventory, fields: undefined });
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/ebay-drafts/batch-stage', () => {
  it('stages per SKU with preserveConflict, never queued actions', async () => {
    const res = await call(ebayHandler, {
      items: [
        { sku: 'A-1', offerFields: { pricingSummary: { price: { value: '10.00', currency: 'USD' } } }, queuedActions: [{ type: 'delete' }] },
        { sku: 'B-2', inventoryFields: { product: { title: 'New' } } },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      { listingId: 'A-1', ok: true, draftId: 'e-A-1', status: 'draft' },
      { listingId: 'B-2', ok: true, draftId: 'e-B-2', status: 'draft' },
    ]);
    for (const [p] of ebayUpsert.mock.calls) {
      expect(p.preserveConflict).toBe(true);
      expect(p).not.toHaveProperty('queuedActions');
      expect(p).not.toHaveProperty('media');
      expect(p).not.toHaveProperty('variationFields');
    }
  });

  it('maps errors per item with qualified keys', async () => {
    ebayFindMany.mockResolvedValue([{ sku: 'S', status: 'syncing' }]);
    ebayUpsert.mockImplementation(async (p: any) => {
      if (p.sku === 'R') throw new EbayDraftError('REAUTH_REQUIRED', 'x', { status: 401, key: 'draftSync.reauthRequired' });
      if (p.sku === 'D') throw new Error('db down');
      return { id: 'e', status: 'failed' };
    });
    const res = await call(ebayHandler, {
      items: [{ sku: 'S', offerFields: {} }, { sku: 'R', offerFields: {} }, { sku: 'D', offerFields: {} }, { sku: '' }, { sku: 'X' }, { sku: 'F', offerFields: {} }],
    });
    const r = res.body.results;
    expect(r[0]).toMatchObject({ ok: false, code: 'DRAFT_SYNCING', key: 'ebay.draftSync.draftSyncing' });
    expect(r[1]).toMatchObject({ ok: false, code: 'REAUTH_REQUIRED', key: 'ebay.draftSync.reauthRequired' });
    expect(r[2]).toMatchObject({ ok: false, code: 'STAGE_FAILED', key: 'ebay.draftSync.failed' });
    expect(r[3]).toMatchObject({ ok: false, code: 'INVALID_SKU', key: 'bulk.stage.invalidItem' });
    expect(r[4]).toMatchObject({ ok: false, code: 'EMPTY_ITEM' });
    expect(r[5]).toMatchObject({ ok: true, status: 'failed' });
  });

  it('never stages into an open draft with a queued delete (DELETE_NOT_EXCLUSIVE)', async () => {
    ebayFindMany.mockResolvedValue([
      { sku: 'DEL', status: 'draft', queuedActions: [{ type: 'delete', queuedAt: '2026-10-01T00:00:00Z' }] },
      { sku: 'END', status: 'failed', queuedActions: [{ type: 'end' }] },
    ]);
    const res = await call(ebayHandler, {
      items: [{ sku: 'DEL', offerFields: { pricingSummary: { price: { value: '5.00', currency: 'USD' } } } }, { sku: 'END', inventoryFields: { product: { title: 'T' } } }],
    });
    const r = res.body.results;
    expect(r[0]).toEqual({ listingId: 'DEL', ok: false, code: 'DELETE_NOT_EXCLUSIVE', key: 'bulk.stage.deleteQueued' });
    expect(r[1]).toMatchObject({ listingId: 'END', ok: true });
    expect(ebayUpsert).toHaveBeenCalledTimes(1);
    expect(ebayUpsert.mock.calls[0][0].sku).toBe('END');
    expect(ebayFindMany.mock.calls[0][0].select).toMatchObject({ queuedActions: true });
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/catalog-drafts { items[] }', () => {
  it('stages every item (no queued actions, no schedule) and keeps the single-item path', async () => {
    const res = await call(catalogHandler, {
      marketplace: 'wix',
      storeId: 'site1',
      items: [
        { externalId: 'p1', fields: { price: 10 }, queuedActions: [{ type: 'delete' }], scheduledSendAt: '2027-01-01T00:00:00Z' },
        { externalId: 'p2', fields: { title: 'T', price: null } },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      { listingId: 'p1', ok: true, draftId: 'c-p1', status: 'draft' },
      { listingId: 'p2', ok: true, draftId: 'c-p2', status: 'draft' },
    ]);
    expect(stageCatalog.mock.calls[0][0]).toEqual({ userId: 'u1', marketplace: 'wix', storeId: 'site1', externalId: 'p1', fields: { price: 10 } });

    const single = await call(catalogHandler, { marketplace: 'wix', externalId: 'p3', fields: { price: 2 } });
    expect(single.statusCode).toBe(200);
    expect(single.body.draft.id).toBe('c-p3');
  });

  it('maps CatalogDraftError per item; envelope errors are 400', async () => {
    stageCatalog.mockImplementation(async (p: any) => {
      if (p.externalId === 'm') throw new CatalogDraftError('MULTI_VARIANT');
      if (p.externalId === 'x') throw new Error('boom');
      return { id: 'c', status: 'conflict' };
    });
    const res = await call(catalogHandler, {
      marketplace: 'shopify',
      items: [{ externalId: 'm', fields: { price: 1 } }, { externalId: 'x', fields: { price: 1 } }, { externalId: 'ok', fields: { price: 1 } }, { externalId: 'e' }, { externalId: 'ok', fields: { price: 2 } }],
    });
    const r = res.body.results;
    expect(r[0]).toMatchObject({ ok: false, code: 'MULTI_VARIANT', key: 'listings.cell.variationsReadOnly' });
    expect(r[1]).toMatchObject({ ok: false, code: 'INTERNAL', key: 'listings.draftError.internal' });
    expect(r[2]).toMatchObject({ ok: true, status: 'conflict' });
    expect(r[3]).toMatchObject({ ok: false, code: 'EMPTY_ITEM' });
    expect(r[4]).toMatchObject({ ok: false, code: 'DUPLICATE_ITEM' });

    expect((await call(catalogHandler, { marketplace: 'wix', items: [] })).statusCode).toBe(400);
  });

  it('drops invalid fields one at a time and stages the rest; an all-invalid item fails with issues', async () => {
    const res = await call(catalogHandler, {
      marketplace: 'wix',
      items: [
        { externalId: 'a', fields: { title: 'Good', price: 'abc', quantity: 3 } },
        { externalId: 'b', fields: { price: -1, quantity: 1.5 } },
      ],
    });
    const [a, b] = res.body.results;
    expect(a).toMatchObject({ listingId: 'a', ok: true });
    expect(a.rejected).toEqual([{ field: 'price', key: 'listings.validate.priceInvalid' }]);
    expect(stageCatalog.mock.calls[0][0].fields).toEqual({ title: 'Good', quantity: 3 });
    expect(b).toMatchObject({ listingId: 'b', ok: false, code: 'VALIDATION_FAILED' });
    expect(b.issues.map((i: any) => i.field)).toEqual(['price', 'quantity']);
    expect(stageCatalog).toHaveBeenCalledTimes(1);
    expect((await call(catalogHandler, { marketplace: 'nope', items: [{ externalId: 'a' }] })).statusCode).toBe(400);
  });
});
