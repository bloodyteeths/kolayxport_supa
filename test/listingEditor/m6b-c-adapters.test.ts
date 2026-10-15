// M6b-C: the Trendyol / Wix / Shopify editor adapters (CatalogDraft staging), the section config rows and the
// route helpers. Nothing here reaches a marketplace: fetch is stubbed and every write is a CatalogDraft stage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  catalogErrorInfo,
  catalogFailureCauseKey,
  createCatalogAdapter,
  interpretSendSummary,
  newCatalogLocalId,
  patchForStage,
  toCatalogDraftRow,
  toEngineId,
  toExternalId,
  CatalogSendError,
  CATALOG_PENDING_STATUS,
  createWasSent,
} from '@/components/domain/listing-editor/adapters/catalog';
import { CatalogDraftClientError } from '@/lib/catalogDrafts/client';
import {
  TRENDYOL_ADAPTER_SPEC,
  blankTrendyolFields,
  encodeTrendyolAttributes,
  overlayTrendyol,
  trendyolAdapter,
  trendyolCreatePayload,
  trendyolFieldsFromCopy,
  trendyolFieldsFromProduct,
  trendyolScoreInput,
  trendyolToPatch,
  validateTrendyolFields,
} from '@/components/domain/listing-editor/adapters/trendyol';
import {
  applyWixMediaOps,
  blankWixFields,
  overlayWix,
  wixAdapter,
  wixFieldsFromRow,
  wixFinalizePatch,
  wixMediaOps,
  wixToPatch,
  validateWixFields,
} from '@/components/domain/listing-editor/adapters/wix';
import {
  applyShopifyImageOps,
  blankShopifyFields,
  overlayShopify,
  SHOPIFY_ADAPTER_SPEC,
  shopifyAdapter,
  shopifyFieldsFromProduct,
  shopifyImageOps,
  shopifyToPatch,
  validateShopifyFields,
} from '@/components/domain/listing-editor/adapters/shopify';
import { encodeAttributes } from '@/components/domain/listing-editor/sections/marketplaceSectionShared';
import { FIELD_GROUP, FIELD_SECTION, resolveEditorHash, sectionForField, sectionsFor } from '@/lib/listingEditor/sections';
import { summarizeChanges } from '@/components/domain/listing-editor/changeSummary';
import type { DraftRow } from '@/lib/listingEditor/types';
import type { CatalogDraftDTO, SendSummary } from '@/lib/catalogDrafts/client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function dto(over: Partial<CatalogDraftDTO> = {}): CatalogDraftDTO {
  return {
    id: 'd1',
    marketplace: 'trendyol',
    storeId: 's1',
    externalId: '869000',
    status: 'draft',
    baseSnapshot: {},
    fieldPatch: {},
    queuedActions: [],
    batchRequestId: null,
    lastSyncError: null,
    baseUpdatedAt: null,
    scheduledSendAt: null,
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-10-15T10:00:00.000Z',
    syncedAt: null,
    queuedDelete: false,
    isCreate: false,
    ...over,
  } as CatalogDraftDTO;
}

/** fetch stub: records calls, answers by URL. */
function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const out = handler(url, init);
    const status = (out as { __status?: number })?.__status ?? 200;
    return { ok: status < 400, status, json: async () => out } as Response;
  }));
  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('catalog ids and draft rows', () => {
  it('maps the engine local id to new:<id> and back; real ids pass through', () => {
    expect(toExternalId('-cabc')).toBe('new:cabc');
    expect(toEngineId('new:cabc')).toBe('-cabc');
    expect(toExternalId('8690000000017')).toBe('8690000000017');
    expect(toEngineId('7d8f-guid')).toBe('7d8f-guid');
    const id = newCatalogLocalId(() => 0.5);
    expect(id).toMatch(/^-c[0-9a-z]{24}$/);
  });

  it('shows a catalog create as create_listing to the engine and keeps the stored error key', () => {
    const row = toCatalogDraftRow(dto({
      externalId: 'new:cxyz',
      status: 'failed',
      lastSyncError: 'listings.draftError.batchFailed',
      queuedActions: [{ type: 'create', queuedAt: 'x', payload: { brandId: 3 } }],
    }))!;
    expect(row.listingId).toBe('-cxyz');
    expect(row.queuedActions[0]).toMatchObject({ type: 'create_listing', payload: { brandId: 3 } });
    expect((row.raw as { lastSyncErrorKey: string }).lastSyncErrorKey).toBe('listings.draftError.batchFailed');
    expect(catalogFailureCauseKey(row)).toBe('listings.draftError.batchFailed');
    expect(catalogFailureCauseKey({ status: 'failed', lastSyncError: 'Something broke' })).toBe('listings.sendError.generic');
    expect(catalogFailureCauseKey({ status: 'conflict', lastSyncError: null })).toBe('listings.draftError.conflict');
  });

  it('patchForStage drops unchanged and unset keys with null', () => {
    const body = patchForStage({ title: 'B', price: 10, quantity: undefined }, { title: 'A', price: 10, quantity: 3 }, ['title', 'price', 'quantity']);
    expect(body).toEqual({ title: 'B', price: null, quantity: null });
    // Create: no base, every set key is sent.
    expect(patchForStage({ title: 'B', price: undefined }, null, ['title', 'price'])).toEqual({ title: 'B', price: null });
  });
});

describe('send summary → result (never forced)', () => {
  const summary = (r: Partial<SendSummary['results'][number]>): SendSummary => ({
    results: [{ draftId: 'd1', status: 'success', ...r } as SendSummary['results'][number]],
    sent: [], failed: [], conflicts: [], pending: [], skipped: [],
  });
  it('success returns the created id; pending is a success with pending', () => {
    expect(interpretSendSummary('d1', summary({ status: 'success', externalId: '777' }))).toMatchObject({ listingId: '777' });
    expect(interpretSendSummary('d1', summary({ status: 'success' }))).toMatchObject({ listingId: null });
    expect(interpretSendSummary('d1', summary({ status: 'pending' }))).toMatchObject({ pending: true, listingId: null });
  });
  it('conflict, failure and skips throw typed errors the adapter maps', () => {
    const spec = TRENDYOL_ADAPTER_SPEC.error;
    try {
      interpretSendSummary('d1', summary({ status: 'conflict', errorKey: 'listings.draftError.conflict' }));
      throw new Error('no throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogSendError);
      expect(catalogErrorInfo(spec, err)).toMatchObject({ conflict: true, status: 409, key: 'listings.draftError.conflict' });
    }
    try {
      interpretSendSummary('d1', summary({ status: 'failed', errorKey: 'listings.draftError.batchFailedReason', errorParams: { reason: 'Görsel', field: 'images' } }));
    } catch (err) {
      const info = catalogErrorInfo(spec, err);
      expect(info).toMatchObject({ conflict: false, key: 'listings.draftError.batchFailedReason', params: { reason: 'Görsel' } });
      expect(info.issues?.[0]).toMatchObject({ field: 'images', section: 'photos', severity: 'block_sync' });
    }
    // The stored key's params come back on the row for the failed banner.
    const row = toCatalogDraftRow(dto({ status: 'failed', lastSyncError: 'listings.draftError.batchFailedReason' }))!;
    expect((row.raw as { syncAttempts: unknown[] }).syncAttempts).toEqual([{ status: 'failed', result: { errorKey: 'listings.draftError.batchFailedReason', errorParams: { reason: 'Görsel', field: 'images' } } }]);
    expect(() => interpretSendSummary('d1', summary({ status: 'skipped', reason: 'queued_delete' }))).toThrow('listingEditor.catalog.confirmRemoval');
    expect(() => interpretSendSummary('d1', summary({ status: 'skipped', reason: 'not_sendable' }))).toThrow('listings.draftError.notEditable');
  });
  it('API errors: 400 with a field → inline issue; 409 is a conflict only for CONFLICT; network', () => {
    const shopify = { marketplace: 'shopify' as const, sectionFor: (f: string) => (FIELD_SECTION[f] ?? 'title'), formKeyFor: (k: string) => (k === 'seo.title' ? 'seoTitle' : k) };
    const e400 = new CatalogDraftClientError(400, { code: 'INVALID_TEXT', key: 'listings.draftError.textTooLong', params: { field: 'seo.title', max: 255 } });
    expect(catalogErrorInfo(shopify, e400).issues?.[0]).toMatchObject({ field: 'seoTitle', section: 'seo', severity: 'block_save' });
    expect(catalogErrorInfo(shopify, new CatalogDraftClientError(409, { code: 'DRAFT_NOT_EDITABLE', key: 'listings.draftError.notEditable' })).conflict).toBe(false);
    expect(catalogErrorInfo(shopify, new TypeError('Failed to fetch')).network).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const tyProduct = {
  barcode: '8690000000017',
  title: 'Ki&#351;iye &ouml;zel kutu',
  description: '<p>It&#39;s hand made</p>',
  images: [{ url: 'https://cdn.dsmcdn.com/1.jpg' }, { url: 'https://cdn.dsmcdn.com/2.jpg' }],
  attributes: [{ attributeId: 47, attributeValueId: 9 }, { attributeId: 3, attributeValue: 'Naturel', attributeName: 'Renk' }],
  salePrice: 749,
  listPrice: 899,
  vatRate: 20,
  quantity: 42,
  stockCode: 'AK-001',
  dimensionalWeight: 2,
  productMainId: 'AK',
  brandId: 11,
  brand: 'Belle',
  categoryId: 500,
  categoryName: 'Kutular',
  cargoCompanyId: 10,
  approved: true,
  rejected: false,
  blacklisted: false,
};

describe('Trendyol adapter', () => {
  it('reads the product entity-decoded; attributes use the sections\' encoding', () => {
    const f = trendyolFieldsFromProduct(tyProduct);
    expect(f.title).toBe('Kişiye özel kutu');
    expect(f.description).toBe("<p>It's hand made</p>");
    expect(f.images).toHaveLength(2);
    expect(f.attributes).toBe(encodeAttributes([{ attributeId: 3, customAttributeValue: 'Naturel' }, { attributeId: 47, attributeValueId: 9 }]));
    expect(f).toMatchObject({ price: 749, listPrice: 899, vatRate: 20, quantity: 42, brandId: 11, brandName: 'Belle', categoryId: 500 });
  });

  it('stages only what changed; create-only and label fields never enter the patch', () => {
    const remote = trendyolFieldsFromProduct(tyProduct);
    const current = { ...remote, title: 'Yeni başlık', brandName: 'X', barcode: 'other' };
    const body = patchForStage(trendyolToPatch(current), trendyolToPatch(remote), TRENDYOL_ADAPTER_SPEC.patchKeys('edit', current, remote));
    expect(body.title).toBe('Yeni başlık');
    expect(body.price).toBeNull();
    expect('barcode' in body).toBe(false);
    expect(trendyolAdapter.changedKeys(remote, current)).toEqual(['title']);
    // Create: the blank defaults (VAT 20%) are not changes; a typed title is.
    expect(trendyolAdapter.changedKeys(null, blankTrendyolFields())).toEqual([]);
    expect(trendyolAdapter.changedKeys(null, { ...blankTrendyolFields(), title: 'A', brandName: 'B' })).toEqual(['title']);
    expect(shopifyAdapter.changedKeys(null, blankShopifyFields())).toEqual([]);
  });

  it('create payload and overlay round-trip (labels kept on the device)', () => {
    const f = { ...blankTrendyolFields(), barcode: ' 8690000000017 ', brandId: 11 as const, categoryId: '' as const };
    expect(trendyolCreatePayload(f)).toMatchObject({ barcode: '8690000000017', brandId: 11, categoryId: null, productMainId: null });
    const { fields, applied, extra } = overlayTrendyol(blankTrendyolFields(), { title: 'A', price: 12.5, attributes: [{ attributeId: 2, attributeValueId: 5 }], unknown: 1 }, { brandId: 11, barcode: 'B1' });
    expect(fields).toMatchObject({ title: 'A', price: 12.5, brandId: 11, barcode: 'B1' });
    expect(fields.attributes).toBe(encodeTrendyolAttributes([{ attributeId: 2, attributeValueId: 5 }]));
    expect(extra).toEqual({ unknown: 1 });
    expect(applied).toBe(5);
  });

  it('validates: list price below sale blocks staging; create completeness only blocks Send', () => {
    const remote = trendyolFieldsFromProduct(tyProduct);
    const issues = validateTrendyolFields({ ...remote, listPrice: 500 }, 'edit');
    expect(issues).toEqual([expect.objectContaining({ field: 'listPrice', severity: 'block_save', key: 'listings.draftError.listBelowSale' })]);
    expect(validateTrendyolFields({ ...remote, title: '' }, 'edit')[0]).toMatchObject({ field: 'title', severity: 'block_save' });
    const create = validateTrendyolFields(blankTrendyolFields(), 'create');
    expect(create.every((i) => i.severity === 'block_sync')).toBe(true);
    expect(create.map((i) => i.field)).toEqual(expect.arrayContaining(['title', 'price', 'listPrice', 'quantity', 'stockCode', 'barcode', 'categoryId', 'brandId', 'cargoCompanyId', 'images']));
    expect(validateTrendyolFields({ ...blankTrendyolFields(), barcode: 'bad code!' }, 'create').find((i) => i.field === 'barcode')).toMatchObject({ severity: 'block_save' });
  });

  it('copy from Etsy keeps photos (≤ 8 https) and price; score input reads labels and attributes', () => {
    const c = trendyolFieldsFromCopy({ title: 'x'.repeat(150), description: 'd', tags: [], price: 30, imageUrls: ['http://img.example.com/1.jpg', ...Array.from({ length: 10 }, (_, i) => `https://img.example.com/${i}.jpg`)] });
    expect(c.title).toHaveLength(100);
    expect(c.images).toHaveLength(8);
    expect(c).toMatchObject({ price: 30, listPrice: 30 });
    const s = trendyolScoreInput(trendyolFieldsFromProduct(tyProduct), {}, { approved: true });
    expect(s).toMatchObject({ brandName: 'Belle', categoryName: 'Kutular', attributeCount: 2, imageCount: 2, approved: true });
  });

  it('stageFields: edit merges into the product draft; an all-reverted draft is discarded', async () => {
    const remote = trendyolFieldsFromProduct(tyProduct);
    const calls = stubFetch((url, init) => {
      if (url === '/api/catalog-drafts' && init?.method === 'POST') return { draft: dto({ fieldPatch: {} }) };
      if (url.startsWith('/api/catalog-drafts/d1') && init?.method === 'DELETE') return { draft: dto({ status: 'cancelled' }) };
      return {};
    });
    const ctx = { shopId: 's1', listingId: '8690000000017' };
    // Nothing differs and there is no draft: no request at all.
    expect(await trendyolAdapter.stageFields({ ctx, mode: 'edit', remote, current: remote, extra: {}, draft: null })).toBeNull();
    expect(calls).toHaveLength(0);
    const existing = toCatalogDraftRow(dto({ fieldPatch: { title: 'old' } }));
    const out = await trendyolAdapter.stageFields({ ctx, mode: 'edit', remote, current: remote, extra: {}, draft: existing });
    expect(out).toBeNull();
    expect(calls[0]).toMatchObject({ url: '/api/catalog-drafts', method: 'POST', body: { marketplace: 'trendyol', storeId: 's1', externalId: '8690000000017' } });
    expect(calls[0].body.fields.title).toBeNull();
    expect(calls[1]).toMatchObject({ url: '/api/catalog-drafts/d1', method: 'DELETE' });
  });

  it('stageFields: create stages new:<id> with the create action and its payload', async () => {
    const calls = stubFetch(() => ({ draft: dto({ externalId: 'new:cabc', queuedActions: [{ type: 'create', queuedAt: 'x', payload: {} }] }) }));
    const current = { ...blankTrendyolFields(), title: 'Kutu', brandId: 11 as const };
    const row = await trendyolAdapter.stageFields({ ctx: { shopId: '', listingId: '-cabc' }, mode: 'create', remote: null, current, extra: {}, draft: null });
    expect(row?.listingId).toBe('-cabc');
    expect(calls[0].body).toMatchObject({ externalId: 'new:cabc', fields: { title: 'Kutu' }, queuedActions: [{ type: 'create', payload: { brandId: 11 } }] });
    expect('storeId' in calls[0].body).toBe(false);
  });

  it('stageActions ignores the engine\'s publish; removeActions never drops a create', async () => {
    const calls = stubFetch(() => ({ draft: dto() }));
    expect(await trendyolAdapter.stageActions({ shopId: '', listingId: '1' }, [{ type: 'publish' }])).toBeNull();
    expect(await trendyolAdapter.removeActions('d1', ['create_listing', 'publish'])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('edit: a value Trendyol needs cannot be cleared (it would be a silent no-op); a product without it is not blocked', () => {
    const f = trendyolFieldsFromProduct(tyProduct);
    expect(f.filledKeys).toEqual(['images', 'price', 'listPrice', 'vatRate', 'quantity', 'stockCode', 'dimensionalWeight']);
    const cleared = validateTrendyolFields({ ...f, images: [], price: '', stockCode: '' }, 'edit');
    expect(cleared.map((i) => [i.field, i.severity])).toEqual([['images', 'block_save'], ['price', 'block_save'], ['stockCode', 'block_save']]);
    const noDesi = trendyolFieldsFromProduct({ ...tyProduct, dimensionalWeight: null });
    expect(validateTrendyolFields({ ...noDesi, title: 'Yeni' }, 'edit')).toEqual([]);
    // A same-marketplace copy never carries the read-only fact.
    expect(trendyolFieldsFromCopy({ title: 'x', description: '', tags: [], catalogFields: { ...f } } as never).filledKeys).toBeUndefined();
  });

  it('send passes the type-to-confirmed delete (result: deleted), never an unconfirmed archive', async () => {
    const calls = stubFetch(() => ({ results: [{ draftId: 'd1', status: 'success' }], sent: ['d1'], failed: [], conflicts: [], pending: [], skipped: [] }));
    const del = toCatalogDraftRow(dto({ queuedActions: [{ type: 'delete', queuedAt: 'x' }] }))!;
    const sent = await wixAdapter.send(del);
    expect(calls[0].body).toEqual({ draftIds: ['d1'], confirmDeleteIds: ['d1'] });
    // The frame leaves the editor on `deleted` (the server result carries no such flag).
    expect(sent.deleted).toBe(true);
    const plain = await wixAdapter.send(toCatalogDraftRow(dto())!);
    expect(plain.deleted).toBeUndefined();
    const archive = toCatalogDraftRow(dto({ queuedActions: [{ type: 'archive', queuedAt: 'x' }] }))!;
    // No editor path confirms an archive yet: refused before any request, with a pointer to the grid.
    await expect(trendyolAdapter.send(archive)).rejects.toMatchObject({ key: 'listingEditor.catalog.archiveInGrid' });
    expect(calls).toHaveLength(2);
    await trendyolAdapter.send(archive, { confirmedArchive: true });
    expect(calls[2].body.confirmDeleteIds).toEqual(['d1']);
  });

  it('pending Trendyol batch: an edit is a success with pending; a create throws so the engine reloads the syncing draft', async () => {
    stubFetch(() => ({ results: [{ draftId: 'd1', status: 'pending' }], sent: [], failed: [], conflicts: [], pending: ['d1'], skipped: [] }));
    const edit = await trendyolAdapter.send(toCatalogDraftRow(dto())!);
    expect(edit).toMatchObject({ pending: true, listingId: null });
    const create = toCatalogDraftRow(dto({ externalId: 'new:cpend', queuedActions: [{ type: 'create', queuedAt: 'x', payload: {} }] }))!;
    await expect(trendyolAdapter.send(create)).rejects.toMatchObject({ key: 'listingEditor.catalog.sendPending', status: CATALOG_PENDING_STATUS });
    expect(createWasSent('-cpend')).toBe(false);
  });

  it('a created product never gets a second create from the same workspace (non-numeric ids stay on /new)', async () => {
    const calls = stubFetch((url) =>
      url.includes('/send')
        ? { results: [{ draftId: 'd1', status: 'success', externalId: 'f1e2d3c4-guid' }], sent: ['d1'], failed: [], conflicts: [], pending: [], skipped: [] }
        : { draft: dto() },
    );
    const create = toCatalogDraftRow(dto({ marketplace: 'wix', externalId: 'new:cguid', queuedActions: [{ type: 'create', queuedAt: 'x', payload: {} }] }))!;
    const r = await wixAdapter.send(create);
    expect(r.listingId).toBe('f1e2d3c4-guid');
    expect(createWasSent('-cguid')).toBe(true);
    const n = calls.length;
    await expect(
      wixAdapter.stageFields({ ctx: { shopId: 's1', listingId: '-cguid' }, mode: 'create', remote: null, current: { ...blankWixFields(), title: 'x' }, extra: {}, draft: create }),
    ).rejects.toMatchObject({ key: 'listingEditor.catalog.createdReload' });
    expect(calls).toHaveLength(n);
  });

  it('loadDraft by ?draft= ignores finished drafts and other marketplaces', async () => {
    stubFetch((url) => (url.endsWith('/d1') ? { draft: dto({ status: 'synced' }) } : { draft: dto({ id: 'd2', marketplace: 'wix' }) }));
    expect(await trendyolAdapter.loadDraft({ shopId: '', draftId: 'd1' })).toBeNull();
    expect(await trendyolAdapter.loadDraft({ shopId: '', draftId: 'd2' })).toBeNull();
  });

  it('load reads the live product by barcode; missing → 404, no credentials → 401', async () => {
    stubFetch((url) => {
      if (url.startsWith('/api/trendyol/products')) return { content: [tyProduct] };
      return { rows: [{ id: '8690000000017', status: 'active', externalUrl: 'https://www.trendyol.com/x' }], store: { id: 's1', name: 'Belle', currency: 'TRY' } };
    });
    const loaded = await trendyolAdapter.load({ shopId: 's1', listingId: '8690000000017' });
    expect(loaded.meta).toMatchObject({ id: '8690000000017', state: 'active', url: 'https://www.trendyol.com/x', currency: 'TRY' });
    expect((loaded.meta.raw as Record<string, unknown>).brandName).toBe('Belle');
    stubFetch((url) => (url.startsWith('/api/trendyol') ? { content: [] } : {}));
    await expect(trendyolAdapter.load({ shopId: 's1', listingId: 'nope' })).rejects.toMatchObject({ status: 404 });
    stubFetch(() => ({ __status: 400, error: 'Trendyol credentials not configured' }));
    await expect(trendyolAdapter.load({ shopId: 's1', listingId: 'nope' })).rejects.toMatchObject({ status: 401 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const wixRow = {
  wixProductId: 'p-1',
  title: 'Baby blanket',
  description: '<p>Soft</p>',
  price: '39.00',
  discountPrice: '34.00',
  currency: 'USD',
  trackInventory: true,
  inStock: true,
  quantity: 12,
  images: [
    { id: 'm1', image: { url: 'https://static.wixstatic.com/media/1.jpg' } },
    { id: 'm1', image: { url: 'https://static.wixstatic.com/media/1.jpg' } },
    { id: 'm2', image: { url: 'https://static.wixstatic.com/media/2.jpg' } },
    { id: 'm3', image: { url: 'https://static.wixstatic.com/media/3.jpg' } },
  ],
  collectionIds: ['00000000-000000-000000-000000000001', 'c2', 'c1'],
  customTextFields: [{ title: 'Name', maxLength: 20, mandatory: true }],
  visible: true,
  ribbon: 'New',
  sku: 'WX-12',
  weight: 0.4,
  variants: [{ id: 'v' }],
};

describe('Wix adapter (legacy data-loss fix: collections and discount are staged)', () => {
  it('reads the cache row: deduped media, derived discount, seller collections only', () => {
    const f = wixFieldsFromRow(wixRow);
    expect(f.imageIds).toEqual(['m1', 'm2', 'm3']);
    expect(f).toMatchObject({ price: 39, discountType: 'AMOUNT', discountValue: 5, collectionIds: ['c2', 'c1'], quantity: 12 });
  });

  it('media ops: remove, reorder of the kept ones, appended adds; overlay shows the result', () => {
    const urls = ['u1', 'u2', 'u3'];
    const ids = ['m1', 'm2', 'm3'];
    const ops = wixMediaOps(urls, ids, ['u3', 'u1', 'https://new/4.jpg']);
    expect(ops).toEqual([{ op: 'remove', mediaId: 'm2' }, { op: 'reorder', ids: ['m3', 'm1'] }, { op: 'add', url: 'https://new/4.jpg' }]);
    expect(applyWixMediaOps(urls, ids, ops)).toEqual(['u3', 'u1', 'https://new/4.jpg']);
    expect(wixMediaOps(urls, ids, urls)).toEqual([]);
    expect(wixMediaOps(urls, ids, ['u1', 'u3'])).toEqual([{ op: 'remove', mediaId: 'm2' }]);
  });

  it('collections and discount are in the patch; a price edit re-sends a known discount, never a guessed one', () => {
    const cached = wixFieldsFromRow(wixRow);
    // The cache keeps the sale price only: today's amount off is shown, marked unknown.
    expect(cached).toMatchObject({ discountType: 'AMOUNT', discountValue: 5, discountKnown: false, discountGuess: 5, loadedPrice: 39 });
    const known = { ...cached, discountKnown: true };
    const current = { ...known, price: 45 as const, collectionIds: ['c1', 'c3'] };
    const next = wixToPatch(current, known);
    const raw = patchForStage(next, wixToPatch(known, known), ['price', 'discount', 'collectionIds', 'title']);
    expect(raw).toMatchObject({ price: 45, discount: null, collectionIds: ['c1', 'c3'], title: null });
    expect(wixFinalizePatch(raw, { remote: known, next }).discount).toEqual({ type: 'AMOUNT', value: 5 });
    // Unknown discount (a 20% sale must never become a fixed amount): not re-sent, and the price edit is blocked
    // until the seller sets the discount themselves.
    const guessed = { ...cached, price: 45 as const };
    const nextG = wixToPatch(guessed, cached);
    const rawG = patchForStage(nextG, wixToPatch(cached, cached), ['price', 'discount']);
    expect(wixFinalizePatch(rawG, { remote: cached, next: nextG }).discount).toBeNull();
    expect(validateWixFields(guessed, 'edit')).toEqual([expect.objectContaining({ field: 'price', severity: 'block_save', key: 'listingEditor.wix.discountUnknown' })]);
    expect(validateWixFields({ ...guessed, discountType: 'PERCENT', discountValue: 20 }, 'edit')).toEqual([]);
    expect(validateWixFields({ ...cached, title: 'Other' }, 'edit')).toEqual([]);
  });

  it('photos: only new ones count against the 15-per-send limit; existing photos are never dropped', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://static.wixstatic.com/media/${i}.jpg`);
    const f = { ...wixFieldsFromRow(wixRow), images: many, remoteImages: many };
    expect(validateWixFields({ ...f, title: 'Other' }, 'edit').filter((i) => i.field === 'images')).toEqual([]);
    const sixteenNew = Array.from({ length: 16 }, (_, i) => `https://n.example/${i}.jpg`);
    expect(validateWixFields({ ...f, images: [...many, ...sixteenNew] }, 'edit').map((i) => i.field)).toContain('images');
  });

  it('a cleared weight is staged as 0; a cleared price / tracked stock is blocked (never a silent no-op)', () => {
    const remote = { ...wixFieldsFromRow(wixRow), weight: 1.2 as const, discountKnown: true };
    expect(wixToPatch({ ...remote, weight: '' }, remote).weight).toBe(0);
    expect(validateWixFields({ ...remote, price: '' }, 'edit').map((i) => i.key)).toContain('listingEditor.catalog.required');
    expect(validateWixFields({ ...remote, trackInventory: true, quantity: '' }, 'edit').map((i) => i.field)).toContain('quantity');
  });

  it('multi-site: a cache page of another site is refused (never edited or staged against the wrong site)', async () => {
    stubFetch((url) => (url.startsWith('/api/wix/products') ? { content: [{ ...wixRow, wixSiteId: 'site-A' }], totalPages: 1 } : { rows: [], store: null }));
    await expect(wixAdapter.load({ shopId: 'site-B', listingId: String(wixRow.wixProductId) })).rejects.toMatchObject({ status: 404, key: 'listingEditor.wix.otherSite' });
    const calls = stubFetch((url) => (url.startsWith('/api/wix/products') ? { content: [{ ...wixRow, wixSiteId: 'site-B' }], totalPages: 1 } : { rows: [], store: null }));
    await expect(wixAdapter.load({ shopId: 'site-B', listingId: String(wixRow.wixProductId) })).resolves.toBeTruthy();
    expect(calls[0].url).toContain('site=site-B');
  });

  it('stock: quantity only while tracked, in stock only while not; variant products never stage price or stock', () => {
    const remote = wixFieldsFromRow(wixRow);
    expect(wixToPatch({ ...remote, trackInventory: false }, remote)).toMatchObject({ quantity: undefined, inStock: true });
    const multi = { ...remote, variantCount: 3 };
    expect(wixToPatch(multi, multi)).toMatchObject({ price: undefined, quantity: undefined, inStock: undefined });
  });

  it('overlay maps discount / media / text fields back; validation mirrors the server', () => {
    const base = wixFieldsFromRow(wixRow);
    const { fields } = overlayWix(base, { discount: { type: 'PERCENT', value: 10 }, media: [{ op: 'remove', mediaId: 'm1' }], customTextFields: [] });
    expect(fields).toMatchObject({ discountType: 'PERCENT', discountValue: 10, customTextFields: '[]' });
    expect(fields.images).toEqual(['https://static.wixstatic.com/media/2.jpg', 'https://static.wixstatic.com/media/3.jpg']);
    expect(validateWixFields({ ...base, discountValue: 50 }, 'edit')[0]).toMatchObject({ field: 'discountValue', severity: 'block_save' });
    expect(validateWixFields({ ...blankWixFields(), title: 'x' }, 'create').map((i) => i.field)).toEqual(['price']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const shProduct = {
  id: 101,
  title: 'Pink blanket',
  body_html: '<p>Soft &amp; warm</p>',
  vendor: 'Belle',
  product_type: 'Blanket',
  status: 'active',
  tags: 'baby gift, nursery',
  updated_at: '2026-10-14T10:00:00Z',
  images: [{ id: 2, src: 'https://cdn.shopify.com/2.jpg', position: 2 }, { id: 1, src: 'https://cdn.shopify.com/1.jpg', position: 1 }],
  variants: [{ id: 9, price: '39.00', compare_at_price: '49.00', sku: 'BB', inventory_quantity: 8, inventory_management: 'shopify', weight: 0.5, weight_unit: 'kg' }],
};

describe('Shopify adapter (no more live writes on Save)', () => {
  it('reads the product, SEO and locations', () => {
    const f = shopifyFieldsFromProduct({ product: shProduct, seo: { title: 'T', description: 'D' }, locationCount: 1 });
    expect(f.images).toEqual(['https://cdn.shopify.com/1.jpg', 'https://cdn.shopify.com/2.jpg']);
    expect(f.imageIds).toEqual(['1', '2']);
    expect(f).toMatchObject({ tags: ['baby gift', 'nursery'], price: 39, compareAtPrice: 49, quantity: 8, trackInventory: true, seoTitle: 'T', seoLoaded: true });
    expect(f.description).toBe('<p>Soft &amp; warm</p>');
    expect(shopifyFieldsFromProduct({ product: shProduct, seo: null }).seoLoaded).toBe(false);
  });

  it('image ops: delete, positioned add, positions; overlay rebuilds the order', () => {
    const urls = ['a', 'b', 'c'];
    const ids = ['1', '2', '3'];
    const ops = shopifyImageOps(urls, ids, ['c', 'https://n/x.jpg', 'a']);
    expect(ops).toEqual([
      { op: 'delete', id: '2' },
      { op: 'add', src: 'https://n/x.jpg', position: 2 },
      { op: 'reorder', id: '3', position: 1 },
      { op: 'reorder', id: '1', position: 3 },
    ]);
    expect(applyShopifyImageOps(urls, ids, ops)).toEqual(['c', 'https://n/x.jpg', 'a']);
    expect(shopifyImageOps(urls, ids, urls)).toEqual([]);
  });

  it('clearing compare-at stages 0; SEO stages both; variant edits only on variant products; untracked stock is not staged', () => {
    const remote = shopifyFieldsFromProduct({ product: shProduct, seo: { title: 'T', description: 'D' }, locationCount: 1 });
    const p = shopifyToPatch({ ...remote, compareAtPrice: '', seoTitle: 'New' }, remote, 'edit');
    expect(p).toMatchObject({ compareAtPrice: 0, seo: { title: 'New', description: 'D' }, quantity: undefined });
    // Unchanged single-variant stock: the same value as the base, so the stage drops it.
    expect(patchForStage(p, shopifyToPatch(remote, remote, 'edit'), ['variants', 'quantity'])).toEqual({ variants: null, quantity: null });
    const untracked = { ...remote, trackInventory: false };
    expect(shopifyToPatch(untracked, untracked, 'edit').quantity).toBeUndefined();
    const multiLoc = { ...remote, locationCount: 2 };
    expect(shopifyToPatch(multiLoc, multiLoc, 'edit').quantity).toBeUndefined();
    const multi = { ...remote, variantCount: 2, variants: JSON.stringify([{ id: '9', price: 41, expectedQuantity: 8 }]) };
    expect(shopifyToPatch(multi, { ...remote, variantCount: 2 }, 'edit')).toMatchObject({ price: undefined, variants: [{ id: '9', price: 41, expectedQuantity: 8 }] });
  });

  it('single-variant stock is staged on the variant with expectedQuantity (STOCK_CHANGED at Send); overlay reads it back', () => {
    const remote = shopifyFieldsFromProduct({ product: shProduct, seo: { title: 'T', description: 'D' }, locationCount: 1 });
    expect(remote.variantId).toBe('9');
    const p = shopifyToPatch({ ...remote, quantity: 5 }, remote, 'edit');
    expect(p).toMatchObject({ quantity: undefined, variants: [{ id: '9', inventoryQuantity: 5, expectedQuantity: 8 }] });
    expect(overlayShopify(remote, { variants: [{ id: '9', inventoryQuantity: 5, expectedQuantity: 8 }] }).fields).toMatchObject({ quantity: 5, variants: '[]' });
    // Create has no variant yet: plain quantity.
    expect(shopifyToPatch({ ...blankShopifyFields(), quantity: 3 }, null, 'create')).toMatchObject({ quantity: 3, variants: undefined });
  });

  it('SEO not read: the key is not owned, a staged value stays untouched, typed SEO is blocked', () => {
    const remote = shopifyFieldsFromProduct({ product: shProduct, seo: null, locationCount: 1 });
    expect(shopifyToPatch({ ...remote, seoTitle: 'Typed' }, remote, 'edit').seo).toBeUndefined();
    expect(SHOPIFY_ADAPTER_SPEC.patchKeys('edit', remote, remote)).not.toContain('seo');
    const { fields, extra } = overlayShopify(remote, { seo: { title: 'Earlier', description: 'Kept' } });
    expect(fields.seoTitle).toBe('');
    expect(extra.seo).toEqual({ title: 'Earlier', description: 'Kept' });
    expect(validateShopifyFields({ ...remote, seoTitle: 'Typed' }, 'edit')).toEqual([expect.objectContaining({ field: 'seoTitle', key: 'listingEditor.shopify.seoUnavailable', section: 'seo' })]);
  });

  it('overlay + validation', () => {
    const base = shopifyFieldsFromProduct({ product: shProduct, seo: { title: '', description: '' } });
    const { fields } = overlayShopify(base, { seo: { title: 'S' }, compareAtPrice: 0, tags: ['a', 'b'], status: 'archived' });
    expect(fields).toMatchObject({ seoTitle: 'S', compareAtPrice: '', tags: ['a', 'b'], status: 'archived' });
    expect(validateShopifyFields({ ...base, seoDescription: 'x'.repeat(321) }, 'edit')[0]).toMatchObject({ field: 'seoDescription', section: 'seo' });
    expect(blankShopifyFields().status).toBe('draft');
    expect(shopifyAdapter.changedKeys(base, { ...base, locationCount: 3, seoLoaded: false })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('create defaults (remembered per store, typed)', () => {
  it('keeps only known keys of the right type', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
    trendyolAdapter.writeCreateDefaults('s1', { ...blankTrendyolFields(), vatRate: 10, cargoCompanyId: 7, brandName: 'Belle' });
    expect(trendyolAdapter.readCreateDefaults('s1')).toEqual({ vatRate: 10, cargoCompanyId: 7, brandName: 'Belle' });
    store.set('kx.trendyol.createDefaults.s1', JSON.stringify({ vatRate: 'x', title: 'no' }));
    expect(trendyolAdapter.readCreateDefaults('s1')).toEqual({});
  });
});

describe('section config rows (marketplace-editors §3)', () => {
  it('Trendyol create starts with Category & brand; edit keeps the default order', () => {
    const create = sectionsFor('trendyol', 'create');
    // No Variants chip while creating (the section renders nothing for a new product).
    expect(create.map((s) => s.id)).toEqual(['details', 'photos', 'title', 'attributes', 'price', 'shipping']);
    expect(sectionsFor('wix', 'create').map((s) => s.id)).not.toContain('variations');
    expect(sectionsFor('shopify', 'create').map((s) => s.id)).not.toContain('variations');
    expect(sectionsFor('etsy', 'create').map((s) => s.id)).toContain('variations');
    expect(create[0].titleKey).toBe('listingEditor.section.categoryBrand');
    const edit = sectionsFor('trendyol', 'edit');
    expect(edit.map((s) => s.id)).toEqual(['photos', 'title', 'attributes', 'price', 'variations', 'details', 'shipping']);
    expect(edit.find((s) => s.id === 'details')?.titleKey).toBe('listingEditor.section.details');
    expect(edit.find((s) => s.id === 'price')?.titleKey).toBe('listingEditor.section.priceStock');
  });
  it('field → section is marketplace-aware (Wix weight is in Price & inventory) and hash links follow it', () => {
    expect(sectionForField('weight')).toBe('shipping');
    expect(sectionForField('weight', 'wix')).toBe('price');
    expect(sectionForField('weight', 'shopify')).toBe('shipping');
    expect(resolveEditorHash('#weight', 'wix', 'edit')).toEqual({ section: 'price', field: 'weight' });
    expect(resolveEditorHash('#variations', 'wix', 'create')).toBeNull();
    const issue = validateWixFields({ ...wixFieldsFromRow(wixRow), discountKnown: true, weight: -1 }, 'edit').find((i) => i.field === 'weight');
    expect(issue?.section).toBe('price');
  });
  it('Wix has no shipping section; Shopify titles; Etsy is unchanged', () => {
    expect(sectionsFor('wix', 'edit').map((s) => s.id)).toEqual(['photos', 'title', 'price', 'variations', 'details', 'personalization']);
    const sh = sectionsFor('shopify', 'edit');
    expect(sh.find((s) => s.id === 'tags')?.titleKey).toBe('listingEditor.section.tagsOrg');
    expect(sh.find((s) => s.id === 'variations')?.titleKey).toBe('listingEditor.section.variants');
    expect(sh.map((s) => s.id)).toContain('seo');
    const etsy = sectionsFor('etsy', 'edit');
    expect(etsy.find((s) => s.id === 'photos')?.titleKey).toBe('listingEditor.section.photos');
    expect(etsy.find((s) => s.id === 'tags')?.titleKey).toBe('listingEditor.section.tags');
  });
  it('every catalog form key that can change has a change group (it counts in "Not sent yet")', () => {
    const keys = [
      'title', 'description', 'images', 'attributes', 'price', 'listPrice', 'vatRate', 'quantity', 'stockCode', 'dimensionalWeight',
      'barcode', 'productMainId', 'brandId', 'categoryId', 'cargoCompanyId', 'shipmentAddressId', 'returningAddressId',
      'discountType', 'discountValue', 'sku', 'weight', 'ribbon', 'visible', 'trackInventory', 'inStock', 'collectionIds', 'customTextFields',
      'tags', 'vendor', 'productType', 'status', 'compareAtPrice', 'weightUnit', 'seoTitle', 'seoDescription', 'variants',
    ];
    expect(keys.filter((k) => !FIELD_GROUP[k])).toEqual([]);
    const remote = trendyolFieldsFromProduct(tyProduct);
    const changes = summarizeChanges({ mode: 'edit', remote, current: { ...remote, listPrice: 950, attributes: '[]' }, draft: null });
    expect(changes.map((c) => c.group)).toEqual(['price', 'categoryDetails']);
  });
});

describe('draft row → engine contract', () => {
  it('a finished create re-keys the row to the real id (the engine then edits, never re-creates)', () => {
    const row = toCatalogDraftRow(dto({ externalId: '869', queuedActions: [{ type: 'create', queuedAt: 'x', completedAt: 'y' }] })) as DraftRow;
    expect(row.listingId).toBe('869');
    expect(row.queuedActions[0]).toMatchObject({ type: 'create_listing', completedAt: 'y' });
  });
  it('a factory adapter keeps unknown draft keys as extra (they stay in the draft)', () => {
    const a = createCatalogAdapter(TRENDYOL_ADAPTER_SPEC);
    const row = toCatalogDraftRow(dto({ fieldPatch: { title: 'A', somethingElse: 1 } }));
    const { extra, fields } = a.overlay(blankTrendyolFields(), row);
    expect(fields.title).toBe('A');
    expect(extra).toEqual({ somethingElse: 1 });
  });
});
