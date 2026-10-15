import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: vi.fn(), isStockSyncActive: () => false, channelEnabled: () => false }));
vi.mock('@/lib/integrations/trendyolApiClient', () => ({ createTrendyolClient: vi.fn() }));
vi.mock('@/lib/integrations/wixClient', () => ({ createWixClient: vi.fn() }));
vi.mock('@/lib/integrations/shopifyClient', () => ({ ShopifyClient: vi.fn(), getValidAccessToken: vi.fn() }));

import { batchOutcomes, createTrendyolSession, priceInventoryItem, sentItemFor } from '@/lib/catalogDrafts/executors/trendyol';
import { createShopifySession, shopifyRemoteValues } from '@/lib/catalogDrafts/executors/shopify';
import { createWixSession, wixRemoteValues } from '@/lib/catalogDrafts/executors/wix';
import { CatalogExecutorError, httpStatusOf, type CatalogDraftRecord } from '@/lib/catalogDrafts/service';

function draft(over: Partial<CatalogDraftRecord> = {}): CatalogDraftRecord {
  return {
    id: 'd1', userId: 'u1', marketplace: 'trendyol', storeId: 's1', externalId: 'BC1', status: 'syncing',
    baseUpdatedAt: null, baseSnapshot: { price: 100, listPrice: 120 }, fieldPatch: { price: 90 }, queuedActions: [],
    batchRequestId: null, lastSyncError: null, scheduledSendAt: null, createdAt: new Date(), updatedAt: new Date(), syncedAt: null,
    ...over,
  };
}

describe('Trendyol executor', () => {
  it('keeps salePrice ≤ listPrice', () => {
    expect(priceInventoryItem(draft(), { exists: true, updatedAt: null, values: { listPrice: 120 } })).toEqual({ barcode: 'BC1', salePrice: 90, listPrice: 120 });
    expect(priceInventoryItem(draft({ fieldPatch: { price: 150, quantity: 3 } }), { exists: true, updatedAt: null, values: { listPrice: 120 } }))
      .toEqual({ barcode: 'BC1', quantity: 3, salePrice: 150, listPrice: 150 });
  });

  it('maps batch items to synced / failed / pending', () => {
    const d1 = draft();
    const d2 = draft({ id: 'd2', externalId: 'BC2' });
    const d3 = draft({ id: 'd3', externalId: 'BC3' });
    const sent = new Map([['BC1', { barcode: 'BC1', salePrice: 90, listPrice: 120 }]]);
    const out = batchOutcomes({
      items: [
        { requestItem: { barcode: 'BC1' }, status: 'SUCCESS' },
        { requestItem: { barcode: 'BC2' }, status: 'FAILED', failureReasons: ['Fiyat hatalı'] },
      ],
    }, [d1, d2, d3], sent);
    expect(out.get('d1')).toEqual({ kind: 'synced', applied: { price: 90, listPrice: 120 } });
    expect(out.get('d2')).toEqual({ kind: 'failed', errorKey: 'listings.draftError.batchFailedReason', errorParams: { reason: 'Fiyat hatalı' } });
    expect(out.get('d3')).toEqual({ kind: 'pending' });
  });

  it('leaves an unfinished batch pending with its batchRequestId', async () => {
    const client: any = {
      updatePriceAndInventory: vi.fn(async () => ({ batchRequestId: 'B1' })),
      getBatchStatus: vi.fn(async () => ({ items: [] })),
    };
    const s = createTrendyolSession(client, 'u1', 's1', { pollAttempts: 1, pollIntervalMs: 0 });
    const res = await s.applyMany!([{ draft: draft(), remote: { exists: true, updatedAt: null, values: { listPrice: 120 } } }]);
    expect(res.get('d1')).toEqual({ kind: 'pending', batchRequestId: 'B1', sent: { barcode: 'BC1', salePrice: 90, listPrice: 120 } });
    expect(client.updatePriceAndInventory).toHaveBeenCalledWith([{ barcode: 'BC1', salePrice: 90, listPrice: 120 }]);
  });

  it('the cron poll reports the item that was really sent, never a rebuilt listPrice', () => {
    // Sent with the remote listPrice (130) while the base snapshot says 120.
    const stored = draft({ baseSnapshot: { price: 100, listPrice: 120, sentItem: { barcode: 'BC1', salePrice: 90, listPrice: 130 } } });
    expect(sentItemFor(stored)).toEqual({ barcode: 'BC1', salePrice: 90, listPrice: 130 });
    // Older pending drafts without a stored item: no listPrice is claimed.
    expect(sentItemFor(draft())).toEqual({ barcode: 'BC1', salePrice: 90 });
  });
});

describe('Shopify executor', () => {
  const product = (over: any = {}) => ({
    id: 1, title: 'T', status: 'active', tags: 'a, b', updated_at: '2026-10-01T00:00:00Z',
    variants: [{ id: 11, price: '10.00', inventory_quantity: 4, inventory_management: 'shopify', inventory_item_id: 99 }],
    ...over,
  });

  it('reads canonical values', () => {
    expect(shopifyRemoteValues(product())).toMatchObject({ title: 'T', price: 10, quantity: 4, tags: ['a', 'b'], variantCount: 1, trackInventory: true });
  });

  it('refuses stock over several locations before writing anything', async () => {
    const client: any = { updateProduct: vi.fn(), updateProductVariant: vi.fn(), setInventoryLevel: vi.fn() };
    const readLevels = vi.fn(async () => [{ location_id: 1, available: 4 }, { location_id: 2, available: 0 }]);
    const s = createShopifySession(client, 'u1', 'shop1', readLevels);
    const d = draft({ marketplace: 'shopify', externalId: '1', fieldPatch: { title: 'New', quantity: 2 } });
    await expect(s.apply!(d, { exists: true, updatedAt: null, values: {}, raw: product() })).rejects.toMatchObject({ errorKey: 'listings.draftError.multiLocation' });
    expect(client.updateProduct).not.toHaveBeenCalled();
  });

  it('writes title, price and stock on a single-variant product', async () => {
    const client: any = { updateProduct: vi.fn(), updateProductVariant: vi.fn(), setInventoryLevel: vi.fn() };
    const s = createShopifySession(client, 'u1', 'shop1', vi.fn(async () => [{ location_id: 7, available: 4 }]));
    const d = draft({ marketplace: 'shopify', externalId: '1', fieldPatch: { title: 'New', price: 12.5, quantity: 2, tags: ['x'] } });
    const out = await s.apply!(d, { exists: true, updatedAt: null, values: {}, raw: product() });
    expect(client.updateProduct).toHaveBeenCalledWith('1', { title: 'New', tags: 'x' });
    expect(client.updateProductVariant).toHaveBeenCalledWith('11', { price: '12.5' });
    expect(client.setInventoryLevel).toHaveBeenCalledWith('99', '7', 2);
    expect(out).toEqual({ kind: 'synced', applied: { title: 'New', tags: ['x'], price: 12.5, quantity: 2 } });
  });
});

describe('Wix executor', () => {
  it('refuses stock on a product with variants', async () => {
    const client: any = {
      updateProduct: vi.fn(),
      getInventoryItem: vi.fn(async () => ({ id: 'inv', trackQuantity: true, variants: [{ variantId: 'a' }, { variantId: 'b' }] })),
    };
    const s = createWixSession(client, 'u1', 'site1');
    const d = draft({ marketplace: 'wix', externalId: 'w1', fieldPatch: { quantity: 3 } });
    await expect(s.apply!(d, { exists: true, updatedAt: null, values: { variantCount: 1 } })).rejects.toBeInstanceOf(CatalogExecutorError);
    expect(client.updateProduct).not.toHaveBeenCalled();
  });

  it('sets stock by the difference from the current quantity', async () => {
    const client: any = {
      updateProduct: vi.fn(async () => ({ id: 'w1', priceData: { price: 9, discountedPrice: 9 } })),
      getInventoryItem: vi.fn(async () => ({ id: 'inv', trackQuantity: true, variants: [{ variantId: 'v', quantity: 5 }] })),
      updateInventoryVariants: vi.fn(),
    };
    const s = createWixSession(client, 'u1', 'site1');
    const d = draft({ marketplace: 'wix', externalId: 'w1', fieldPatch: { quantity: 2, price: 9 } });
    const out = await s.apply!(d, { exists: true, updatedAt: null, values: { variantCount: 1 } });
    expect(client.updateProduct).toHaveBeenCalledWith('w1', { priceData: { price: 9 } });
    expect(client.updateInventoryVariants).toHaveBeenCalledWith('inv', [{ variantId: 'v', quantity: -3 }]);
    expect(out).toEqual({ kind: 'synced', applied: { price: 9, discountPrice: 9, quantity: 2 } });
  });

  it('refuses a price edit on a discounted product before writing anything', async () => {
    const client: any = { updateProduct: vi.fn() };
    const s = createWixSession(client, 'u1', 'site1');
    const values = wixRemoteValues({ id: 'w1', name: 'T', priceData: { price: 20, discountedPrice: 15 } });
    expect(values).toMatchObject({ price: 20, discounted: true });
    expect(wixRemoteValues({ id: 'w1', priceData: { price: 20, discountedPrice: 20 } }).discounted).toBe(false);
    const d = draft({ marketplace: 'wix', externalId: 'w1', fieldPatch: { price: 18 } });
    await expect(s.apply!(d, { exists: true, updatedAt: null, values })).rejects.toMatchObject({ errorKey: 'listings.draftError.wixDiscounted' });
    expect(client.updateProduct).not.toHaveBeenCalled();
  });
});

describe('httpStatusOf', () => {
  it('reads the three client error shapes', () => {
    expect(httpStatusOf({ status: 404, body: {} })).toBe(404);
    expect(httpStatusOf(new Error('Wix API 401: nope'))).toBe(401);
    expect(httpStatusOf(new Error('Shopify API GET /products/1.json failed: 404 - {}'))).toBe(404);
    expect(httpStatusOf(new Error('boom'))).toBeNull();
  });
});
