// M6b-A: catalog draft v2 keys, creates, Review differences (diff / resolve).
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
  buildCatalogDiff,
  detectConflict,
  getCatalogDraftDiff,
  resolveCatalogDraft,
  sendCatalogDrafts,
  stageCatalogDraft,
  toDTO,
  type CatalogDraftRecord,
  type CatalogExecutors,
  type CatalogExecutorSession,
  type RemoteState,
} from '@/lib/catalogDrafts/service';
import {
  canonicalFieldKey,
  isHttpsUrl,
  mergeQueuedActions,
  normalizeTrendyolAttributes,
  validateCreatePayload,
  validateFieldPatch,
  validateQueuedActions,
} from '@/lib/catalogDrafts/schemas';
import { shopifyValuesFromApi, shopifyValuesFromCache, trendyolValuesFromApi, trendyolValuesFromCache, wixValuesFromApi, wixValuesFromCache } from '@/lib/catalogDrafts/values';

const USER = 'u1';
const SHOP = 'shop1';
const T0 = new Date('2026-10-01T10:00:00Z');
const LATER = new Date(T0.getTime() + 60_000);

function shopifyCacheRow(over: Record<string, any> = {}) {
  return {
    title: 'Pink Baby Blanket', description: '<p>Soft</p>', vendor: 'Belle', productType: 'Blanket',
    price: '24.90', compareAtPrice: null, totalInventory: 5, tags: ['baby'], status: 'active', trackInventory: true, variantCount: 1,
    variants: [{ id: 11, price: '24.90', compare_at_price: null, inventory_quantity: 5, sku: 'BB-1', inventory_management: 'shopify' }],
    seoTitle: 'Blanket', seoDescription: 'Soft blanket', shopifyUpdatedAt: T0,
    ...over,
  };
}

function draftRow(over: Record<string, any> = {}) {
  return {
    id: 'd1', userId: USER, marketplace: 'shopify', storeId: SHOP, externalId: 'p1', status: 'draft',
    baseUpdatedAt: T0,
    baseSnapshot: { title: 'Pink Baby Blanket', price: 24.9, quantity: 5, description: '<p>Soft</p>', seo: { title: 'Blanket', description: 'Soft blanket' }, variantCount: 1, trackInventory: true },
    fieldPatch: { description: '<p>Softer</p>' }, queuedActions: [], batchRequestId: null, lastSyncError: null, scheduledSendAt: null,
    createdAt: T0, updatedAt: T0, syncedAt: null,
    ...over,
  };
}

function fakeExecutors(remote: Partial<RemoteState> | null, impl: Partial<CatalogExecutorSession> = {}) {
  const apply = vi.fn(async (draft: CatalogDraftRecord) => ({ kind: 'synced' as const, applied: {} as any, ...(draft.externalId.startsWith('new:') ? { externalId: '999' } : {}) }));
  const readRemote = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, remote
    ? { exists: true, updatedAt: T0, values: { title: 'Pink Baby Blanket', price: 24.9, description: '<p>Soft</p>' }, ...remote }
    : { exists: false, updatedAt: null, values: {} }])));
  const session: CatalogExecutorSession = { readRemote, apply, writeCache: vi.fn(async () => undefined), ...impl };
  const executors = { shopify: { open: vi.fn(async () => session) }, wix: { open: vi.fn(async () => session) }, trendyol: { open: vi.fn(async () => session) } } as unknown as CatalogExecutors;
  return { executors, apply, readRemote, session };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.catalogDraft = createFakeDelegate();
  h.shopifyShop.findFirst.mockResolvedValue({ id: SHOP });
  h.wixSite.findFirst.mockResolvedValue({ id: 'site1' });
  h.credential.findUnique.mockResolvedValue({ trendyolSupplierId: 'sup1' });
  h.shopifyProduct.findUnique.mockResolvedValue(shopifyCacheRow());
  h.getStockSettings.mockResolvedValue(null);
  h.stockLink.findFirst.mockResolvedValue(null);
});

describe('schemas: v2 field validation', () => {
  it('accepts every §6 key per marketplace and resolves aliases', () => {
    const t = validateFieldPatch('trendyol', {
      salePrice: '749,00', listPrice: 899, vatRate: 20, quantity: 42, stockCode: ' AK-001 ', dimensionalWeight: 2,
      title: 'Kişiye özel kutu', description: '<p>x</p>', images: ['https://cdn.example.com/a.jpg'],
      attributes: [{ attributeId: 47, attributeValueId: 9 }, { attributeId: 12, customAttributeValue: ' 20x15 cm ' }],
    }).set;
    expect(t).toMatchObject({ price: 749, listPrice: 899, vatRate: 20, stockCode: 'AK-001', images: ['https://cdn.example.com/a.jpg'] });
    expect(t.attributes).toEqual([{ attributeId: 12, customAttributeValue: '20x15 cm' }, { attributeId: 47, attributeValueId: 9 }]);

    const w = validateFieldPatch('wix', {
      name: 'Blanket', discount: { type: 'PERCENT', value: 10 }, sku: 'WX-12', weight: '0,4', ribbon: 'New', visible: true,
      customTextFields: [{ title: 'Name to engrave', maxLength: 20, mandatory: true }], trackInventory: true, quantity: 12,
      collectionIds: ['c1', 'c1', 'c2'], media: [{ op: 'remove', mediaId: 'm1' }, { op: 'reorder', ids: ['m3', 'm2'] }, { op: 'add', url: 'https://x.example.com/p.jpg' }],
    }).set;
    expect(w).toMatchObject({ title: 'Blanket', weight: 0.4, collectionIds: ['c1', 'c2'], discount: { type: 'PERCENT', value: 10 } });

    const s = validateFieldPatch('shopify', {
      body_html: '<p>Soft</p>', product_type: 'Blanket', vendor: 'Belle', compareAtPrice: 0, weight: 300, weightUnit: 'g',
      seo: { title: 'Blanket', description: '' },
      variants: [{ id: '12', price: '39', compareAtPrice: null, inventoryQuantity: 8, expectedQuantity: 7 }, { id: 11, sku: 'BB-P-S' }],
      images: [{ op: 'add', src: 'https://kolayxport.com/u/a.jpg?sig=1', alt: 'Pink' }, { op: 'delete', id: '77' }, { op: 'reorder', id: '78', position: 1 }, { op: 'alt', id: '78', alt: 'Front' }],
    }).set;
    expect(s).toMatchObject({ description: '<p>Soft</p>', productType: 'Blanket', compareAtPrice: 0, seo: { title: 'Blanket', description: '' } });
    expect(s.variants?.map((v) => v.id)).toEqual(['11', '12']);
    expect(canonicalFieldKey('trendyol', 'salePrice')).toBe('price');
  });

  it('refuses keys of another marketplace and bad values, with params.field', () => {
    expect(() => validateFieldPatch('trendyol', { collectionIds: ['a'] })).toThrow(expect.objectContaining({ code: 'FIELD_NOT_SUPPORTED' }));
    expect(() => validateFieldPatch('trendyol', { images: [] })).toThrow(expect.objectContaining({ code: 'INVALID_IMAGES' }));
    expect(() => validateFieldPatch('trendyol', { images: ['http://x.example.com/a.jpg'] })).toThrow(expect.objectContaining({ code: 'INVALID_IMAGES' }));
    expect(() => validateFieldPatch('trendyol', { images: Array.from({ length: 9 }, (_, i) => `https://x.example.com/${i}.jpg`) })).toThrow(CatalogDraftError);
    expect(() => validateFieldPatch('trendyol', { vatRate: 18 })).toThrow(expect.objectContaining({ code: 'INVALID_VAT', params: { field: 'vatRate' } }));
    expect(() => validateFieldPatch('trendyol', { attributes: [{ attributeId: 1, attributeValueId: 2, customAttributeValue: 'x' }] })).toThrow(expect.objectContaining({ code: 'INVALID_ATTRIBUTES' }));
    expect(() => validateFieldPatch('trendyol', { attributes: [{ attributeId: 1, attributeValueId: 2 }, { attributeId: 1, attributeValueId: 3 }] })).toThrow(CatalogDraftError);
    expect(() => validateFieldPatch('wix', { discount: { type: 'PERCENT', value: 100 } })).toThrow(expect.objectContaining({ code: 'INVALID_DISCOUNT' }));
    expect(() => validateFieldPatch('wix', { title: 'x'.repeat(81) })).toThrow(expect.objectContaining({ code: 'INVALID_TITLE', params: { field: 'title', max: 80 } }));
    expect(() => validateFieldPatch('wix', { media: [{ op: 'add', url: 'https://localhost/a.jpg' }] })).toThrow(expect.objectContaining({ code: 'INVALID_MEDIA' }));
    expect(() => validateFieldPatch('shopify', { images: [{ op: 'add', src: 'https://x.example.com/a.jpg', attachment: 'AAAA' }] })).toThrow(expect.objectContaining({ code: 'INVALID_MEDIA' }));
    expect(() => validateFieldPatch('shopify', { variants: [{ id: '1' }] })).toThrow(expect.objectContaining({ code: 'INVALID_VARIANTS' }));
    expect(() => validateFieldPatch('shopify', { variants: [{ id: 'abc', price: 1 }] })).toThrow(expect.objectContaining({ code: 'INVALID_VARIANTS' }));
    expect(() => validateFieldPatch('shopify', { seo: { title: 'x'.repeat(256) } })).toThrow(expect.objectContaining({ code: 'INVALID_TEXT' }));
    expect(() => validateFieldPatch('shopify', { weightUnit: 'ton' })).toThrow(CatalogDraftError);
    expect(validateFieldPatch('shopify', { body_html: null }).remove).toEqual(['description']);
  });

  it('https check refuses private hosts and credentials', () => {
    expect(isHttpsUrl('https://cdn.example.com/a.jpg')).toBe(true);
    for (const u of ['http://a.example.com/x', 'https://user:p@a.example.com/x', 'https://10.0.0.2/x', 'https://192.168.1.2/x', 'https://localhost/x', 'nope']) {
      expect(isHttpsUrl(u)).toBe(false);
    }
  });

  it('create actions: payload per marketplace, merged across stages, null drops a key', () => {
    expect(validateCreatePayload('trendyol', { barcode: '8691234567890', brandId: '12', categoryId: 3 }).set).toEqual({ barcode: '8691234567890', brandId: 12, categoryId: 3 });
    expect(() => validateCreatePayload('trendyol', { barcode: 'bad barcode' })).toThrow(expect.objectContaining({ code: 'INVALID_CREATE' }));
    expect(() => validateCreatePayload('shopify', { brandId: 1 })).toThrow(expect.objectContaining({ code: 'FIELD_NOT_SUPPORTED' }));
    expect(() => validateQueuedActions('trendyol', [{ type: 'delete' }])).toThrow(expect.objectContaining({ code: 'ACTION_NOT_SUPPORTED' }));
    const first = validateQueuedActions('trendyol', [{ type: 'create', payload: { barcode: 'B1', brandId: 1 } }])!;
    const second = validateQueuedActions('trendyol', [{ type: 'create', payload: { brandId: null, categoryId: 5 } }])!;
    const merged = mergeQueuedActions(first, second);
    expect(merged).toHaveLength(1);
    expect(merged[0].payload).toEqual({ barcode: 'B1', categoryId: 5 });
  });
});

describe('values: cache and API agree', () => {
  it('Trendyol attributes and images normalise from the API, the cache and the patch alike', () => {
    const api = trendyolValuesFromApi({ title: 'T', salePrice: 10, images: [{ url: 'https://a/1.jpg' }], attributes: [{ attributeId: 2, attributeValueId: 5, attributeValue: 'Red' }, { attributeId: 1, attributeValue: 'Custom' }], pimCategoryId: 9, brandId: 4 });
    const cache = trendyolValuesFromCache({ title: 'T', salePrice: '10.00', images: [{ url: 'https://a/1.jpg' }], attributes: [{ attributeId: 1, customValue: 'Custom' }, { attributeId: 2, attributeValueId: 5 }], categoryId: 9, brandId: 4 });
    expect(api.attributes).toEqual(cache.attributes);
    expect(api.images).toEqual(cache.images);
    expect(api.categoryId).toBe(9);
    expect(normalizeTrendyolAttributes(null)).toEqual([]);
  });

  it('Wix and Shopify cache rows and API products give the same canonical shape', () => {
    const wApi = wixValuesFromApi({ id: 'w', name: 'N', priceData: { price: 20, discountedPrice: 18 }, discount: { type: 'AMOUNT', value: 2 }, collectionIds: ['00000000-000000-000000-000000000001', 'c1'], media: { items: [{ id: 'm1', image: { url: 'https://w/1.jpg' } }] } });
    const wCache = wixValuesFromCache({ title: 'N', price: '20', discountPrice: '18', collectionIds: ['c1'] });
    expect(wApi).toMatchObject({ discounted: true, collectionIds: ['c1'], discount: { type: 'AMOUNT', value: 2 }, mediaItems: [{ id: 'm1', url: 'https://w/1.jpg' }] });
    expect(wCache).toMatchObject({ discounted: true, collectionIds: ['c1'] });
    const sApi = shopifyValuesFromApi({ id: 1, title: 'T', body_html: '<p>x</p>', tags: 'a, b', variants: shopifyCacheRow().variants }, { title: 'S', description: '' });
    const sCache = shopifyValuesFromCache(shopifyCacheRow({ description: '<p>x</p>', title: 'T', seoTitle: 'S', seoDescription: null }));
    expect(sApi.variants).toEqual(sCache.variants);
    expect(sApi.seo).toEqual(sCache.seo);
    expect(sApi).toMatchObject({ description: '<p>x</p>', sku: 'BB-1', price: 24.9 });
    // Unknown variants are not "no variants": a cache row without the JSON has no `variants` key.
    expect(shopifyValuesFromCache(shopifyCacheRow({ variants: null }))).not.toHaveProperty('variants');
  });
});

describe('assertEditable (v2 rules)', () => {
  it('Shopify single-variant keys, Wix stock tracking, discount and Trendyol list/archived', () => {
    expect(() => assertEditable('shopify', { sku: 'x' }, { variantCount: 2 })).toThrow(expect.objectContaining({ code: 'MULTI_VARIANT' }));
    expect(() => assertEditable('shopify', { variants: [{ id: '1', price: 2 }] }, { variantCount: 2 })).not.toThrow();
    expect(() => assertEditable('wix', { quantity: 3 }, { trackInventory: false })).toThrow(expect.objectContaining({ code: 'NOT_TRACKED' }));
    expect(() => assertEditable('wix', { quantity: 3, trackInventory: true }, { trackInventory: false })).not.toThrow();
    expect(() => assertEditable('wix', { inStock: false }, { trackInventory: true })).toThrow(expect.objectContaining({ code: 'IN_STOCK_TRACKED' }));
    expect(() => assertEditable('wix', { price: 10, discount: { type: 'NONE', value: 0 } }, { discounted: true })).not.toThrow();
    expect(() => assertEditable('wix', { discount: { type: 'AMOUNT', value: 30 } }, { price: 20 })).toThrow(expect.objectContaining({ code: 'INVALID_DISCOUNT' }));
    expect(() => assertEditable('trendyol', { listPrice: 5 }, { price: 10 })).toThrow(expect.objectContaining({ code: 'LIST_BELOW_SALE' }));
    expect(() => assertEditable('trendyol', { title: 'x' }, { archived: true })).toThrow(expect.objectContaining({ code: 'ARCHIVED' }));
  });
});

describe('stageCatalogDraft: creates', () => {
  it('starts a new-product draft with new:<id>, then merges fields and the create payload into it', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'new', queuedActions: [{ type: 'create' }], fields: { title: 'Blanket' } });
    expect(a.externalId).toMatch(/^new:c[0-9a-z]{24}$/);
    expect(a.baseSnapshot).toEqual({});
    expect(a.baseUpdatedAt).toBeNull();
    expect(h.shopifyProduct.findUnique).not.toHaveBeenCalled();
    expect(toDTO(h.catalogDraft.rows[0])).toMatchObject({ isCreate: true, queuedDelete: false });

    const b = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: a.externalId, fields: { price: 39, tags: ['baby'] } });
    expect(b.id).toBe(a.id);
    expect(b.fieldPatch).toEqual({ title: 'Blanket', price: 39, tags: ['baby'] });
    expect(h.catalogDraft.rows).toHaveLength(1);
  });

  it('Trendyol create payload autosaves through repeated create actions', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'trendyol', externalId: 'new', queuedActions: [{ type: 'create', payload: { categoryId: 5 } }] });
    const b = await stageCatalogDraft({ userId: USER, marketplace: 'trendyol', externalId: a.externalId, queuedActions: [{ type: 'create', payload: { brandId: 7, barcode: 'B-1' } }] });
    expect(b.queuedActions).toHaveLength(1);
    expect(b.queuedActions[0].payload).toEqual({ categoryId: 5, brandId: 7, barcode: 'B-1' });
  });

  it('refuses create on an existing product, a create with a delete, unknown new ids and removing the create', async () => {
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', queuedActions: [{ type: 'create' }] })).rejects.toMatchObject({ code: 'ACTION_NOT_SUPPORTED' });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'new', queuedActions: [{ type: 'create' }, { type: 'delete' }] })).rejects.toMatchObject({ code: 'DELETE_NOT_EXCLUSIVE' });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'new:cunknown', fields: { title: 'x' } })).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' });
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'new', queuedActions: [{ type: 'create' }] });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: a.externalId, removeQueuedActions: ['create'] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('stock-managed check covers variant quantities', async () => {
    h.getStockSettings.mockResolvedValue({ enabled: true });
    h.stockLink.findFirst.mockResolvedValue({ id: 'link' });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { variants: [{ id: '11', inventoryQuantity: 2 }] } })).rejects.toMatchObject({ code: 'STOCK_MANAGED' });
    await expect(stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'p1', fields: { variants: [{ id: '11', price: 2 }] } })).resolves.toBeTruthy();
  });
});

describe('send: creates', () => {
  it('a create skips the remote read and conflict check, then the draft takes the new id', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'new', queuedActions: [{ type: 'create' }], fields: { title: 'Blanket' } });
    const { executors, apply, readRemote } = fakeExecutors({});
    const res = await sendCatalogDrafts(USER, [a.id], { executors, interDraftDelayMs: 0 });
    expect(readRemote).not.toHaveBeenCalled();
    expect(apply.mock.calls[0][1]).toMatchObject({ exists: false });
    expect(res.results[0]).toMatchObject({ status: 'success', externalId: '999' });
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'synced', externalId: '999' });
    expect(h.catalogDraft.rows[0].queuedActions[0].completedAt).toBeTruthy();
  });

  it('a step failure after the product exists turns the draft into an edit draft of it (no second create)', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'wix', externalId: 'new', queuedActions: [{ type: 'create' }], fields: { title: 'N', price: 10, collectionIds: ['c1'] } });
    const { executors } = fakeExecutors({}, {
      apply: vi.fn(async () => { throw new CatalogExecutorError('listings.draftError.partial.collections', 'boom', { step: 'collections' }, { createdExternalId: 'wix-new-1' }); }),
    });
    const res = await sendCatalogDrafts(USER, [a.id], { executors, interDraftDelayMs: 0 });
    expect(res.failed).toEqual([{ id: a.id, errorKey: 'listings.draftError.partial.collections', errorParams: { step: 'collections' } }]);
    expect(res.results[0].externalId).toBe('wix-new-1');
    const row = h.catalogDraft.rows[0];
    expect(row).toMatchObject({ status: 'failed', externalId: 'wix-new-1', baseSnapshot: {}, baseUpdatedAt: null, fieldPatch: { title: 'N', price: 10, collectionIds: ['c1'] } });
    expect(toDTO(row).isCreate).toBe(false);

    // Retry: an ordinary edit send of the created product (read + apply), never a create.
    const retry = fakeExecutors({ updatedAt: LATER, values: { title: 'N', price: 10, collectionIds: [] } });
    const again = await sendCatalogDrafts(USER, [a.id], { executors: retry.executors, interDraftDelayMs: 0 });
    expect(retry.readRemote).toHaveBeenCalledWith(['wix-new-1'], expect.anything());
    expect(again.sent).toEqual([a.id]);
  });
});

describe('conflicts on v2 keys', () => {
  const rec = (over: Record<string, any>) => ({ ...draftRow(), ...over }) as unknown as CatalogDraftRecord;

  it('seo and variants compare only what the draft touches; op lists never conflict', () => {
    const d = rec({ fieldPatch: { seo: { title: 'New' } }, baseSnapshot: { seo: { title: 'Old', description: 'D' } } });
    expect(detectConflict(d, { exists: true, updatedAt: LATER, values: { seo: { title: 'Old', description: 'Changed' } } }).conflict).toBe(false);
    expect(detectConflict(d, { exists: true, updatedAt: LATER, values: { seo: { title: 'Theirs', description: 'D' } } })).toEqual({ conflict: true, changedFields: ['seo'] });

    const variants = [{ id: '11', price: 10, compareAtPrice: null, inventoryQuantity: 5, sku: 'A' }, { id: '12', price: 20, compareAtPrice: null, inventoryQuantity: 1, sku: 'B' }];
    const v = rec({ fieldPatch: { variants: [{ id: '11', price: 12 }] }, baseSnapshot: { variants } });
    const other = variants.map((x) => (x.id === '12' ? { ...x, price: 25 } : x));
    expect(detectConflict(v, { exists: true, updatedAt: LATER, values: { variants: other } }).conflict).toBe(false);
    const mine = variants.map((x) => (x.id === '11' ? { ...x, price: 11 } : x));
    expect(detectConflict(v, { exists: true, updatedAt: LATER, values: { variants: mine } }).changedFields).toEqual(['variants']);
    const gone = variants.filter((x) => x.id !== '11');
    expect(detectConflict(v, { exists: true, updatedAt: LATER, values: { variants: gone } }).conflict).toBe(true);

    const ops = rec({ fieldPatch: { images: [{ op: 'delete', id: '5' }] }, baseSnapshot: {} });
    expect(detectConflict(ops, { exists: true, updatedAt: LATER, values: {} }).conflict).toBe(false);
  });

  it('Trendyol attributes compare as a set (order and value shape do not matter)', () => {
    const d = rec({
      marketplace: 'trendyol', baseUpdatedAt: null,
      fieldPatch: { attributes: [{ attributeId: 1, attributeValueId: 2 }] },
      baseSnapshot: { attributes: [{ attributeId: 3, customAttributeValue: 'x' }, { attributeId: 1, attributeValueId: 9 }] },
    });
    expect(detectConflict(d, { exists: true, updatedAt: null, values: { attributes: [{ attributeId: 1, attributeValueId: 9 }, { attributeId: 3, customAttributeValue: 'x' }] } }).conflict).toBe(false);
    expect(detectConflict(d, { exists: true, updatedAt: null, values: { attributes: [{ attributeId: 1, attributeValueId: 7 }] } }).conflict).toBe(true);
  });
});

describe('Review differences: diff and resolve', () => {
  it('diff lists both-sides first, then draft-only, then marketplace-only; hides bookkeeping', () => {
    const d = {
      ...draftRow(),
      fieldPatch: { title: 'Mine', description: '<p>Softer</p>', images: [{ op: 'delete', id: '5' }] },
      baseSnapshot: { title: 'Base', description: '<p>Soft</p>', vendor: 'Belle', variantCount: 1, sentItem: { x: 1 } },
      queuedActions: [],
    } as unknown as CatalogDraftRecord;
    const diff = buildCatalogDiff(d, { exists: true, updatedAt: LATER, values: { title: 'Theirs', description: '<p>Soft</p>', vendor: 'Other', variantCount: 1, mediaItems: [{ id: '5', url: 'https://s/5.jpg' }] } });
    expect(diff.fields.map((f) => [f.key, f.inDraft, f.changedRemotely])).toEqual([
      ['title', true, true], ['description', true, false], ['images', true, false], ['vendor', false, true],
    ]);
    expect(diff.fields[2]).toMatchObject({ draft: [{ op: 'delete', id: '5' }], remote: [{ id: '5', url: 'https://s/5.jpg' }] });
    expect(diff.remoteUpdatedAt).toBe(LATER.toISOString());
  });

  it('resolve keeps chosen fields, drops the rest of the conflicts, rebases, never sends', async () => {
    h.catalogDraft.rows.push(draftRow({
      status: 'conflict', lastSyncError: 'listings.draftError.conflict',
      fieldPatch: { title: 'Mine', description: '<p>Softer</p>', seo: { title: 'My SEO' } },
      baseSnapshot: { title: 'Base', description: '<p>Soft</p>', seo: { title: 'Blanket', description: 'D' }, sentBatches: [] },
    }));
    const { executors, apply } = fakeExecutors({ updatedAt: LATER, values: { title: 'Theirs', description: '<p>Soft</p>', seo: { title: 'Their SEO', description: 'D' } } });
    const r = await resolveCatalogDraft('d1', USER, ['title'], { executors });
    expect(r.status).toBe('draft');
    expect(r.fieldPatch).toEqual({ title: 'Mine', description: '<p>Softer</p>' });
    expect(r.baseSnapshot).toMatchObject({ title: 'Theirs', seo: { title: 'Their SEO' } });
    expect(r.baseSnapshot).not.toHaveProperty('sentBatches');
    expect(apply).not.toHaveBeenCalled();
  });

  it('diff/resolve refuse new-product drafts and sending drafts', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'shopify', externalId: 'new', queuedActions: [{ type: 'create' }] });
    const { executors } = fakeExecutors({});
    await expect(getCatalogDraftDiff(a.id, USER, { executors })).rejects.toMatchObject({ code: 'CREATE_DRAFT' });
    h.catalogDraft.rows.push(draftRow({ id: 'd9', status: 'syncing' }));
    await expect(getCatalogDraftDiff('d9', USER, { executors })).rejects.toMatchObject({ code: 'DRAFT_NOT_EDITABLE' });
    await expect(resolveCatalogDraft('d9', USER, [], { executors })).rejects.toMatchObject({ code: 'DRAFT_NOT_EDITABLE' });
  });

  it('reads SEO only when a draft patches it', async () => {
    h.catalogDraft.rows.push(draftRow({ fieldPatch: { seo: { title: 'x' } } }));
    const { executors, readRemote } = fakeExecutors({});
    await getCatalogDraftDiff('d1', USER, { executors });
    expect(readRemote).toHaveBeenCalledWith(['p1'], { keys: ['seo'] });
  });
});
