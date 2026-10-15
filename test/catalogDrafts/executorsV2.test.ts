// M6b-A: v2 executors (Trendyol content/price split + create, Wix steps, Shopify variants/images/SEO/create).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: vi.fn(), isStockSyncActive: () => false, channelEnabled: () => false }));
vi.mock('@/lib/integrations/trendyolApiClient', () => ({ createTrendyolClient: vi.fn() }));
vi.mock('@/lib/integrations/wixClient', () => ({ createWixClient: vi.fn() }));
vi.mock('@/lib/integrations/shopifyClient', () => ({ ShopifyClient: vi.fn(), getValidAccessToken: vi.fn() }));

import { contentItem, createItem, createTrendyolSession, sentBatchesFor } from '@/lib/catalogDrafts/executors/trendyol';
import { createWixSession, planWixMedia } from '@/lib/catalogDrafts/executors/wix';
import { createShopifySession, planShopifyImages } from '@/lib/catalogDrafts/executors/shopify';
import type { CatalogDraftRecord, RemoteState } from '@/lib/catalogDrafts/service';
import { trendyolValuesFromApi, wixValuesFromApi, shopifyValuesFromApi } from '@/lib/catalogDrafts/values';

function draft(over: Partial<CatalogDraftRecord> = {}): CatalogDraftRecord {
  return {
    id: 'd1', userId: 'u1', marketplace: 'trendyol', storeId: 's1', externalId: 'BC1', status: 'syncing',
    baseUpdatedAt: null, baseSnapshot: {}, fieldPatch: {}, queuedActions: [],
    batchRequestId: null, lastSyncError: null, scheduledSendAt: null, createdAt: new Date(), updatedAt: new Date(), syncedAt: null,
    ...over,
  };
}
const createAction = (payload: Record<string, unknown> = {}) => [{ type: 'create' as const, queuedAt: '2026-10-15T00:00:00Z', payload }];

// ─── Trendyol ────────────────────────────────────────────────────────────────

const tyProduct = {
  barcode: 'BC1', title: 'Old', productMainId: 'PM1', brandId: 10, pimCategoryId: 20, quantity: 4, stockCode: 'SC1',
  dimensionalWeight: 2, description: '<p>d</p>', currencyType: 'TRY', listPrice: 120, salePrice: 100, vatRate: 20, cargoCompanyId: 17,
  images: [{ url: 'https://cdn.example.com/1.jpg' }], attributes: [{ attributeId: 1, attributeValueId: 5, attributeValue: 'Red' }, { attributeId: 2, attributeValue: '20 cm' }],
};
const tyRemote = (): RemoteState => ({ exists: true, updatedAt: null, values: trendyolValuesFromApi(tyProduct), raw: tyProduct });

describe('Trendyol executor v2', () => {
  it('content item = the live product ⊕ the patch, never partial; carries the final price', () => {
    const item = contentItem(draft({ fieldPatch: { title: 'New', attributes: [{ attributeId: 1, attributeValueId: 6 }], price: 90 } }), tyRemote());
    expect(item).toEqual({
      barcode: 'BC1', title: 'New', productMainId: 'PM1', brandId: 10, categoryId: 20, quantity: 4, stockCode: 'SC1', dimensionalWeight: 2,
      description: '<p>d</p>', currencyType: 'TRY', listPrice: 120, salePrice: 90, vatRate: 20, cargoCompanyId: 17,
      images: [{ url: 'https://cdn.example.com/1.jpg' }], attributes: [{ attributeId: 1, attributeValueId: 6 }],
    });
    const noBrand = { ...tyProduct, brandId: undefined };
    expect(() => contentItem(draft({ fieldPatch: { title: 'x' } }), { exists: true, updatedAt: null, values: trendyolValuesFromApi(noBrand), raw: noBrand }))
      .toThrow(expect.objectContaining({ errorKey: 'listings.draftError.contentIncomplete' }));
  });

  it('splits content and price into two batches and syncs only when both succeed', async () => {
    const client: any = {
      updateProducts: vi.fn(async () => ({ batchRequestId: 'C1' })),
      updatePriceAndInventory: vi.fn(async () => ({ batchRequestId: 'P1' })),
      getBatchStatus: vi.fn(async (id: string) => ({ items: [{ requestItem: { barcode: 'BC1' }, status: id === 'C1' ? 'SUCCESS' : 'IN_PROGRESS' }] })),
    };
    const s = createTrendyolSession(client, 'u1', 's1', { pollAttempts: 1, pollIntervalMs: 0 });
    const d = draft({ fieldPatch: { title: 'New', price: 90, quantity: 3 } });
    const res = await s.applyMany!([{ draft: d, remote: tyRemote() }]);
    expect(client.updateProducts).toHaveBeenCalledWith([expect.objectContaining({ barcode: 'BC1', title: 'New', salePrice: 90, quantity: 3, brandId: 10 })]);
    expect(client.updatePriceAndInventory).toHaveBeenCalledWith([{ barcode: 'BC1', quantity: 3, salePrice: 90, listPrice: 120 }]);
    const out: any = res.get('d1');
    expect(out).toMatchObject({ kind: 'pending', batchRequestId: 'P1' });
    expect(out.batches.map((b: any) => [b.kind, b.batchRequestId])).toEqual([['content', 'C1'], ['price', 'P1']]);

    // The cron poll re-checks both batches stored on the draft.
    const pending = draft({ fieldPatch: d.fieldPatch, baseSnapshot: { sentBatches: out.batches } });
    client.getBatchStatus.mockImplementation(async () => ({ items: [{ requestItem: { barcode: 'BC1' }, status: 'SUCCESS' }] }));
    const polled = await s.pollBatch!('P1', [pending]);
    expect(polled.get('d1')).toMatchObject({ kind: 'synced', applied: { title: 'New', price: 90, quantity: 3 } });
    expect(sentBatchesFor(draft(), 'B0')).toEqual([{ kind: 'price', batchRequestId: 'B0', item: { barcode: 'BC1' } }]);
  });

  it('a failed content item fails the draft with the reason and the step', async () => {
    const client: any = {
      updateProducts: vi.fn(async () => ({ batchRequestId: 'C1' })),
      getBatchStatus: vi.fn(async () => ({ items: [{ requestItem: { barcode: 'BC1' }, status: 'FAILED', failureReasons: ['Görsel kalitesi yetersiz'] }] })),
    };
    const s = createTrendyolSession(client, 'u1', 's1', { pollAttempts: 1, pollIntervalMs: 0 });
    const res = await s.applyMany!([{ draft: draft({ fieldPatch: { images: ['https://cdn.example.com/2.jpg'] } }), remote: tyRemote() }]);
    expect(res.get('d1')).toMatchObject({ errorKey: 'listings.draftError.batchFailedReason', errorParams: { reason: 'Görsel kalitesi yetersiz', step: 'content' } });
  });

  it('create: refuses an incomplete item before sending; a complete one becomes the barcode on success', async () => {
    expect(() => createItem(draft({ externalId: 'new:c1', queuedActions: createAction({ barcode: 'B9' }), fieldPatch: { title: 'T' } })))
      .toThrow(expect.objectContaining({ errorKey: 'listings.draftError.createIncomplete', errorParams: expect.objectContaining({ fields: expect.stringContaining('brandId') }) }));
    const client: any = {
      createProducts: vi.fn(async () => ({ batchRequestId: 'N1' })),
      getBatchStatus: vi.fn(async () => ({ items: [{ requestItem: { barcode: 'B9' }, status: 'SUCCESS' }] })),
    };
    const s = createTrendyolSession(client, 'u1', 's1', { pollAttempts: 1, pollIntervalMs: 0 });
    const d = draft({
      externalId: 'new:c1',
      queuedActions: createAction({ barcode: 'B9', brandId: 1, categoryId: 2, cargoCompanyId: 3 }),
      fieldPatch: { title: 'T', description: 'D', stockCode: 'S', dimensionalWeight: 1, price: 50, vatRate: 20, images: ['https://cdn.example.com/a.jpg'] },
    });
    const res = await s.applyMany!([{ draft: d, remote: { exists: false, updatedAt: null, values: {} } }]);
    expect(client.createProducts).toHaveBeenCalledWith([expect.objectContaining({ barcode: 'B9', productMainId: 'S', listPrice: 50, salePrice: 50, quantity: 0, currencyType: 'TRY' })]);
    expect(res.get('d1')).toMatchObject({ kind: 'synced', externalId: 'B9', applied: { title: 'T', price: 50 } });
  });
});

// ─── Wix ─────────────────────────────────────────────────────────────────────

const wixProduct = (over: any = {}) => ({
  id: 'w1', name: 'N', priceData: { price: 20, discountedPrice: 20 }, collectionIds: ['00000000-000000-000000-000000000001', 'c1'],
  stock: { trackInventory: true, quantity: 5 }, media: { items: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }, ...over,
});
const wixRemote = (p = wixProduct()): RemoteState => ({ exists: true, updatedAt: null, values: wixValuesFromApi(p), raw: p });

describe('Wix executor v2', () => {
  it('plans media: stale removes skipped, latest reorder over what is left, adds appended once', () => {
    expect(planWixMedia([
      { op: 'remove', mediaId: 'm2' }, { op: 'remove', mediaId: 'gone' },
      { op: 'reorder', ids: ['m1', 'm3'] }, { op: 'reorder', ids: ['m3'] },
      { op: 'add', url: 'https://a.example.com/x.jpg' }, { op: 'add', url: 'https://a.example.com/x.jpg' },
    ], ['m1', 'm2', 'm3'])).toEqual({ remove: ['m2'], order: ['m3', 'm1'], add: ['https://a.example.com/x.jpg'] });
  });

  it('sends discount with the price, diffs collections, applies media; every rendered field is in the payload', async () => {
    const client: any = {
      updateProduct: vi.fn(async () => ({ priceData: { price: 39, discountedPrice: 34 } })),
      addProductsToCollection: vi.fn(), removeProductsFromCollection: vi.fn(),
      removeProductMedia: vi.fn(), reorderProductMedia: vi.fn(), addProductMedia: vi.fn(),
    };
    const s = createWixSession(client, 'u1', 'site1');
    const d = draft({
      marketplace: 'wix', externalId: 'w1',
      fieldPatch: {
        title: 'Blanket', description: '<p>x</p>', price: 39, discount: { type: 'AMOUNT', value: 5 }, sku: 'WX', weight: 0.4, ribbon: 'New', visible: true,
        customTextFields: [{ title: 'Name', maxLength: 20, mandatory: true }], collectionIds: ['c2'], media: [{ op: 'remove', mediaId: 'm1' }],
      },
    });
    const out = await s.apply!(d, wixRemote(wixProduct({ priceData: { price: 20, discountedPrice: 15 } })));
    expect(client.updateProduct).toHaveBeenCalledWith('w1', {
      name: 'Blanket', description: '<p>x</p>', priceData: { price: 39 }, discount: { type: 'AMOUNT', value: 5 }, sku: 'WX', weight: 0.4,
      visible: true, ribbon: 'New', customTextFields: [{ title: 'Name', maxLength: 20, mandatory: true }],
    });
    expect(client.addProductsToCollection).toHaveBeenCalledWith('c2', ['w1']);
    expect(client.removeProductsFromCollection).toHaveBeenCalledWith('c1', ['w1']);
    expect(client.removeProductsFromCollection).not.toHaveBeenCalledWith('00000000-000000-000000-000000000001', expect.anything());
    expect(client.removeProductMedia).toHaveBeenCalledWith('w1', ['m1']);
    expect(out).toMatchObject({ kind: 'synced', applied: { price: 39, discountPrice: 34, collectionIds: ['c2'] } });
  });

  it('refuses before writing when a needed client method is missing', async () => {
    const client: any = { updateProduct: vi.fn() };
    const s = createWixSession(client, 'u1', 'site1');
    await expect(s.apply!(draft({ marketplace: 'wix', externalId: 'w1', fieldPatch: { title: 'x', collectionIds: ['c2'] } }), wixRemote()))
      .rejects.toMatchObject({ errorKey: 'listings.draftError.actionUnavailable' });
    expect(client.updateProduct).not.toHaveBeenCalled();
  });

  it('a later step failing after the product PATCH is a partial failure', async () => {
    const client: any = {
      updateProduct: vi.fn(async () => ({})),
      addProductsToCollection: vi.fn(async () => { throw new Error('Wix API 500: x'); }), removeProductsFromCollection: vi.fn(),
    };
    const s = createWixSession(client, 'u1', 'site1');
    await expect(s.apply!(draft({ marketplace: 'wix', externalId: 'w1', fieldPatch: { title: 'x', collectionIds: ['c1', 'c2'] } }), wixRemote()))
      .rejects.toMatchObject({ errorKey: 'listings.draftError.partial.collections', errorParams: { step: 'collections' } });
  });

  it('create: product first, then collections; a later failure reports the created id', async () => {
    const client: any = {
      createProduct: vi.fn(async () => ({ id: 'new-w', priceData: { price: 10 } })),
      addProductsToCollection: vi.fn(async () => { throw new Error('Wix API 500: x'); }),
    };
    const s = createWixSession(client, 'u1', 'site1');
    const d = draft({ marketplace: 'wix', externalId: 'new:c1', queuedActions: createAction(), fieldPatch: { title: 'N', price: 10, discount: { type: 'PERCENT', value: 10 }, collectionIds: ['c1'] } });
    await expect(s.apply!(d, { exists: false, updatedAt: null, values: {} }))
      .rejects.toMatchObject({ errorKey: 'listings.draftError.partial.collections', createdExternalId: 'new-w' });
    expect(client.createProduct).toHaveBeenCalledWith(expect.objectContaining({ name: 'N', priceData: { price: 10 }, discount: { type: 'PERCENT', value: 10 }, productType: 'physical' }));

    const ok: any = { createProduct: vi.fn(async () => ({ id: 'new-w' })) };
    const out = await createWixSession(ok, 'u1', 'site1').apply!(draft({ marketplace: 'wix', externalId: 'new:c2', queuedActions: createAction(), fieldPatch: { title: 'N', price: 10 } }), { exists: false, updatedAt: null, values: {} });
    expect(out).toMatchObject({ kind: 'synced', externalId: 'new-w' });
    await expect(createWixSession(ok, 'u1', 'site1').apply!(draft({ marketplace: 'wix', externalId: 'new:c3', queuedActions: createAction(), fieldPatch: { title: 'N' } }), { exists: false, updatedAt: null, values: {} }))
      .rejects.toMatchObject({ errorKey: 'listings.draftError.createIncomplete' });
  });
});

// ─── Shopify ─────────────────────────────────────────────────────────────────

const shopifyProduct = (over: any = {}) => ({
  id: 1, title: 'T', status: 'active', tags: 'a', updated_at: '2026-10-01T00:00:00Z',
  variants: [
    { id: 11, price: '10.00', inventory_quantity: 4, inventory_management: 'shopify', inventory_item_id: 99 },
    { id: 12, price: '12.00', inventory_quantity: 1, inventory_management: 'shopify', inventory_item_id: 98 },
  ],
  images: [{ id: 501, src: 'https://s/1.jpg', position: 1 }, { id: 502, src: 'https://s/2.jpg', position: 2 }],
  ...over,
});
const shRemote = (p = shopifyProduct()): RemoteState => ({ exists: true, updatedAt: null, values: shopifyValuesFromApi(p), raw: p });
const shClient = () => ({
  getProduct: vi.fn(async () => shopifyProduct()),
  updateProduct: vi.fn(), updateProductVariant: vi.fn(), setInventoryLevel: vi.fn(), createProduct: vi.fn(),
  createProductImage: vi.fn(), updateProductImage: vi.fn(), deleteProductImage: vi.fn(),
});

describe('Shopify executor v2', () => {
  it('variant rows: one failing row never blocks the others; expectedQuantity guards stock', async () => {
    const client: any = shClient();
    const readLevels = vi.fn(async (item: string) => (item === '99' ? [{ location_id: 7, available: 6 }] : [{ location_id: 7, available: 1 }]));
    const s = createShopifySession(client, 'u1', 'shop1', readLevels);
    const d = draft({
      marketplace: 'shopify', externalId: '1',
      fieldPatch: { variants: [{ id: '11', inventoryQuantity: 8, expectedQuantity: 4 }, { id: '12', price: 13, inventoryQuantity: 2, expectedQuantity: 1 }, { id: '13', price: 1 }] },
    });
    const err: any = await s.apply!(d, shRemote()).catch((e) => e);
    expect(client.updateProductVariant).toHaveBeenCalledWith('12', { price: '13.00' });
    expect(client.setInventoryLevel).toHaveBeenCalledWith('98', '7', 2);
    expect(client.setInventoryLevel).not.toHaveBeenCalledWith('99', expect.anything(), expect.anything());
    expect(err).toMatchObject({ errorKey: 'listings.draftError.partial.variants', details: { variants: [{ id: '11', code: 'STOCK_CHANGED' }, { id: '13', code: 'NOT_FOUND' }] } });
  });

  it('a retry after our own partial write is not "stock changed"', async () => {
    const client: any = shClient();
    const s = createShopifySession(client, 'u1', 'shop1', vi.fn(async () => [{ location_id: 7, available: 8 }]));
    const d = draft({ marketplace: 'shopify', externalId: '1', fieldPatch: { variants: [{ id: '11', inventoryQuantity: 8, expectedQuantity: 4 }] } });
    await expect(s.apply!(d, shRemote())).resolves.toMatchObject({ kind: 'synced' });
    expect(client.setInventoryLevel).not.toHaveBeenCalled();
  });

  it('image ops: stale deletes skipped, adds once, latest reorder/alt per image; SEO through the writer', async () => {
    expect(planShopifyImages([
      { op: 'delete', id: '501' }, { op: 'delete', id: '999' },
      { op: 'add', src: 'https://k/a.jpg' }, { op: 'add', src: 'https://k/a.jpg' },
      { op: 'reorder', id: '502', position: 3 }, { op: 'reorder', id: '502', position: 1 }, { op: 'reorder', id: '501', position: 2 },
      { op: 'alt', id: '502', alt: 'Front' },
    ], ['501', '502'])).toEqual({
      del: ['501'], add: [{ op: 'add', src: 'https://k/a.jpg' }], reorder: [{ op: 'reorder', id: '502', position: 1 }], alt: [{ op: 'alt', id: '502', alt: 'Front' }],
    });
    const client: any = shClient();
    const seo = { read: vi.fn(async () => ({ title: 'S', description: '' })), write: vi.fn(async (_id: string, v: any) => ({ title: v.title ?? '', description: v.description ?? '' })) };
    const s = createShopifySession(client, 'u1', 'shop1', vi.fn(), seo);
    const d = draft({ marketplace: 'shopify', externalId: '1', fieldPatch: { vendor: 'Belle', productType: 'Blanket', description: '<p>x</p>', images: [{ op: 'alt', id: '501', alt: 'Pink' }], seo: { title: 'Page' } } });
    const out = await s.apply!(d, shRemote());
    expect(client.updateProduct).toHaveBeenCalledWith('1', { body_html: '<p>x</p>', vendor: 'Belle', product_type: 'Blanket' });
    expect(client.updateProductImage).toHaveBeenCalledWith('1', '501', { alt: 'Pink' });
    expect(seo.write).toHaveBeenCalledWith('1', { title: 'Page' });
    expect(out).toMatchObject({ kind: 'synced', applied: { vendor: 'Belle', seo: { title: 'Page', description: '' } } });

    const r = await s.readRemote(['1'], { keys: ['seo'] });
    expect(seo.read).toHaveBeenCalledWith('1');
    expect(r.get('1')?.values.seo).toEqual({ title: 'S', description: '' });
  });

  it('single-variant keys are refused on multi-variant products before writing', async () => {
    const client: any = shClient();
    const s = createShopifySession(client, 'u1', 'shop1', vi.fn());
    await expect(s.apply!(draft({ marketplace: 'shopify', externalId: '1', fieldPatch: { title: 'x', compareAtPrice: 20 } }), shRemote()))
      .rejects.toMatchObject({ errorKey: 'listings.cell.variationsReadOnly' });
    expect(client.updateProduct).not.toHaveBeenCalled();
  });

  it('create: Draft status by default, single variant, then images; an image failure reports the created id', async () => {
    const client: any = shClient();
    client.createProduct.mockResolvedValue({ id: 777, variants: [{ id: 1, inventory_item_id: 5 }] });
    client.createProductImage.mockRejectedValue(new Error('Shopify API POST failed: 422 - bad'));
    const s = createShopifySession(client, 'u1', 'shop1', vi.fn(async () => [{ location_id: 7, available: 0 }]));
    const d = draft({
      marketplace: 'shopify', externalId: 'new:c1', queuedActions: createAction(),
      fieldPatch: { title: 'Blanket', price: 39, compareAtPrice: 49, quantity: 3, tags: ['baby'], images: [{ op: 'add', src: 'https://k/a.jpg' }] },
    });
    const err: any = await s.apply!(d, { exists: false, updatedAt: null, values: {} }).catch((e) => e);
    expect(client.createProduct).toHaveBeenCalledWith({
      title: 'Blanket', tags: 'baby', status: 'draft',
      variants: [{ price: '39', compare_at_price: '49', inventory_management: 'shopify' }],
    });
    expect(client.setInventoryLevel).toHaveBeenCalledWith('5', '7', 3);
    expect(err).toMatchObject({ errorKey: 'listings.draftError.partial.images', createdExternalId: '777', details: { ops: [{ index: 0, op: 'add' }] } });
  });
});
