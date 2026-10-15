// M6b-A review fixes: Wix inventory through the existing client method, §5.2 create order, non-idempotent media
// adds pruned after a partial failure, stale Trendyol batch bookkeeping, staging on a product a create just made.
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
vi.mock('@/lib/integrations/trendyolApiClient', () => ({ createTrendyolClient: vi.fn() }));
vi.mock('@/lib/integrations/shopifyClient', () => ({ ShopifyClient: vi.fn(), getValidAccessToken: vi.fn() }));

import { WixApiClient } from '@/lib/integrations/wixClient';
import { createWixSession, wixInventoryPlan } from '@/lib/catalogDrafts/executors/wix';
import { createShopifySession } from '@/lib/catalogDrafts/executors/shopify';
import { sentBatchesFor } from '@/lib/catalogDrafts/executors/trendyol';
import {
  CatalogExecutorError,
  applyRemainingPatch,
  sendCatalogDrafts,
  stageCatalogDraft,
  type CatalogDraftRecord,
  type CatalogExecutors,
  type CatalogExecutorSession,
  type RemoteState,
} from '@/lib/catalogDrafts/service';
import { shopifyValuesFromApi } from '@/lib/catalogDrafts/values';

const USER = 'u1';
const NOW = new Date('2026-10-15T10:00:00Z');

function draft(over: Partial<CatalogDraftRecord> = {}): CatalogDraftRecord {
  return {
    id: 'd1', userId: USER, marketplace: 'wix', storeId: 'site1', externalId: 'w1', status: 'syncing',
    baseUpdatedAt: null, baseSnapshot: {}, fieldPatch: {}, queuedActions: [],
    batchRequestId: null, lastSyncError: null, scheduledSendAt: null, createdAt: NOW, updatedAt: NOW, syncedAt: null,
    ...over,
  };
}
const createAction = () => [{ type: 'create' as const, queuedAt: NOW.toISOString(), payload: {} }];
const absent: RemoteState = { exists: false, updatedAt: null, values: {} };

/** A client with exactly the real WixApiClient method set (no `updateInventoryItem`), calls recorded in order. */
function realShapeWixClient(over: Record<string, any> = {}) {
  const calls: string[] = [];
  const methods = Object.getOwnPropertyNames(WixApiClient.prototype).filter((n) => n !== 'constructor');
  const client: Record<string, any> = {};
  for (const n of methods) client[n] = vi.fn(async () => { calls.push(n); return {}; });
  client.createProduct = vi.fn(async () => { calls.push('createProduct'); return { id: 'new-w', priceData: { price: 10 } }; });
  client.getInventoryItem = vi.fn(async () => { calls.push('getInventoryItem'); return { id: 'inv', trackQuantity: false, variants: [{ variantId: 'v0', quantity: 0 }] }; });
  Object.assign(client, over);
  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.catalogDraft = createFakeDelegate();
  h.wixSite.findFirst.mockResolvedValue({ id: 'site1' });
  h.wixProduct.findUnique.mockResolvedValue(null);
  h.getStockSettings.mockResolvedValue(null);
  h.stockLink.findFirst.mockResolvedValue(null);
});

describe('Wix inventory and create order', () => {
  it('a default create (tracking on + quantity) reaches createProduct with the real client and sets the quantity', async () => {
    expect('updateInventoryItem' in WixApiClient.prototype).toBe(false);
    const { client, calls } = realShapeWixClient();
    const s = createWixSession(client as any, USER, 'site1');
    const d = draft({
      externalId: 'new:a', queuedActions: createAction(),
      fieldPatch: { title: 'N', price: 10, trackInventory: true, quantity: 7, collectionIds: ['c1'], media: [{ op: 'add', url: 'https://cdn.example.com/a.jpg' }] },
    });
    const out = await s.apply!(d, absent);
    expect(out).toMatchObject({ kind: 'synced', externalId: 'new-w', applied: { trackInventory: true, quantity: 7 } });
    expect(client.setInventoryVariantQuantities).toHaveBeenCalledWith('new-w', [{ variantId: 'v0', quantity: 7 }]);
    // §5.2: create → collections → media → inventory.
    expect(calls.filter((c) => c !== 'getInventoryItem')).toEqual(['createProduct', 'addProductsToCollection', 'addProductMedia', 'setInventoryVariantQuantities']);
  });

  it('a create with a quantity but no tracking value turns tracking on; untracked + in stock needs no inventory write', async () => {
    const { client } = realShapeWixClient();
    const s = createWixSession(client as any, USER, 'site1');
    await s.apply!(draft({ externalId: 'new:b', queuedActions: createAction(), fieldPatch: { title: 'N', price: 10, quantity: 3 } }), absent);
    expect(client.setInventoryVariantQuantities).toHaveBeenCalledWith('new-w', [{ variantId: 'v0', quantity: 3 }]);

    const second = realShapeWixClient();
    const out = await createWixSession(second.client as any, USER, 'site1')
      .apply!(draft({ externalId: 'new:c', queuedActions: createAction(), fieldPatch: { title: 'N', price: 10, trackInventory: false, inStock: true } }), absent);
    expect(out).toMatchObject({ kind: 'synced', applied: { trackInventory: false } });
    expect(second.client.setInventoryVariantQuantities).not.toHaveBeenCalled();
  });

  it('tracking off / out of stock needs the missing client method and is refused before anything is created', async () => {
    const { client } = realShapeWixClient();
    const s = createWixSession(client as any, USER, 'site1');
    await expect(s.apply!(draft({ externalId: 'new:d', queuedActions: createAction(), fieldPatch: { title: 'N', price: 10, trackInventory: false, inStock: false } }), absent))
      .rejects.toMatchObject({ errorKey: 'listings.draftError.actionUnavailable' });
    expect(client.createProduct).not.toHaveBeenCalled();
  });

  it('edit: turning tracking on writes absolute quantities through setInventoryVariantQuantities', async () => {
    const { client } = realShapeWixClient({
      getInventoryItem: vi.fn(async () => ({ id: 'inv', trackQuantity: false, variants: [{ variantId: 'v0', quantity: 2 }] })),
    });
    const s = createWixSession(client as any, USER, 'site1');
    const remote: RemoteState = { exists: true, updatedAt: null, values: { variantCount: 1, trackInventory: false } };
    const out = await s.apply!(draft({ fieldPatch: { trackInventory: true, quantity: 9 } }), remote);
    expect(client.setInventoryVariantQuantities).toHaveBeenCalledWith('w1', [{ variantId: 'v0', quantity: 9 }]);
    expect(out).toMatchObject({ kind: 'synced', applied: { trackInventory: true, quantity: 9 } });
    expect(wixInventoryPlan({ quantity: 4 }, { trackQuantity: true })).toBe('increment');
    expect(wixInventoryPlan({ trackInventory: false }, { trackQuantity: true })).toBe('untracked');
  });

  it('a create whose inventory step fails after the media adds leaves no media add for Retry', async () => {
    const { client } = realShapeWixClient({
      setInventoryVariantQuantities: vi.fn(async () => { throw new Error('Wix API 500: x'); }),
    });
    const s = createWixSession(client as any, USER, 'site1');
    const d = draft({
      externalId: 'new:e', queuedActions: createAction(),
      fieldPatch: { title: 'N', price: 10, quantity: 2, media: [{ op: 'add', url: 'https://cdn.example.com/a.jpg' }] },
    });
    const err = await s.apply!(d, absent).catch((e) => e);
    expect(err).toMatchObject({ errorKey: 'listings.draftError.partial.inventory', createdExternalId: 'new-w' });
    expect(applyRemainingPatch(d.fieldPatch, err.remainingPatch)).toEqual({ title: 'N', price: 10, quantity: 2 });
  });
});

describe('Shopify image adds are not repeated by Retry', () => {
  const product = {
    id: 1, title: 'T', status: 'active', updated_at: '2026-10-01T00:00:00Z',
    variants: [{ id: 11, price: '10.00', inventory_quantity: 4, inventory_management: 'shopify', inventory_item_id: 99 }],
    images: [{ id: 501, src: 'https://cdn.shopify.com/1.jpg', position: 1 }],
  };
  const remote: RemoteState = { exists: true, updatedAt: null, values: shopifyValuesFromApi(product), raw: product };

  it('add 3, one fails: the stored draft keeps only the failed add, so the retry uploads it once', async () => {
    const client: any = {
      updateProduct: vi.fn(), updateProductVariant: vi.fn(), setInventoryLevel: vi.fn(), updateProductImage: vi.fn(), deleteProductImage: vi.fn(),
      createProductImage: vi.fn(async (_id: string, img: { src: string }) => { if (img.src.endsWith('b.jpg')) throw new Error('Shopify API 422'); return {}; }),
    };
    const s = createShopifySession(client, USER, 'shop1', async () => [{ location_id: 7, available: 4 }]);
    const ops = [
      { op: 'add' as const, src: 'https://cdn.example.com/a.jpg' },
      { op: 'add' as const, src: 'https://cdn.example.com/b.jpg' },
      { op: 'add' as const, src: 'https://cdn.example.com/c.jpg' },
      { op: 'alt' as const, id: '501', alt: 'Front' },
    ];
    const d = draft({ marketplace: 'shopify', storeId: 'shop1', externalId: '1', fieldPatch: { title: 'New', images: ops } });
    const err = await s.apply!(d, remote).catch((e) => e);
    expect(err).toMatchObject({ errorKey: 'listings.draftError.partial.images' });
    const left = applyRemainingPatch(d.fieldPatch, err.remainingPatch);
    expect(left.images).toEqual([{ op: 'add', src: 'https://cdn.example.com/b.jpg' }, { op: 'alt', id: '501', alt: 'Front' }]);

    client.createProductImage.mockReset();
    client.createProductImage.mockResolvedValue({});
    await s.apply!(draft({ ...d, fieldPatch: left }), remote);
    expect(client.createProductImage).toHaveBeenCalledTimes(1);
    expect(client.createProductImage).toHaveBeenCalledWith('1', { src: 'https://cdn.example.com/b.jpg' });
  });

  it('send: a created-but-failed draft stores the executor remaining patch (no media add left)', async () => {
    const a = await stageCatalogDraft({
      userId: USER, marketplace: 'wix', externalId: 'new', queuedActions: [{ type: 'create' }],
      fields: { title: 'N', price: 10, media: [{ op: 'add', url: 'https://cdn.example.com/a.jpg' }] },
    });
    const session: CatalogExecutorSession = {
      readRemote: vi.fn(async () => new Map()),
      apply: vi.fn(async () => {
        throw new CatalogExecutorError('listings.draftError.partial.inventory', 'boom', { step: 'inventory' }, { createdExternalId: 'w9', remainingPatch: { media: [] } });
      }),
      writeCache: vi.fn(async () => undefined),
    };
    const executors = { wix: { open: vi.fn(async () => session) } } as unknown as CatalogExecutors;
    await sendCatalogDrafts(USER, [a.id], { executors, interDraftDelayMs: 0 });
    expect(h.catalogDraft.rows[0]).toMatchObject({ status: 'failed', externalId: 'w9', fieldPatch: { title: 'N', price: 10 } });
    expect(h.catalogDraft.rows[0].fieldPatch.media).toBeUndefined();
  });
});

describe('Trendyol batch bookkeeping', () => {
  it('a stored batch list without the current batch id is stale and never polled', () => {
    const stale = draft({
      marketplace: 'trendyol', externalId: 'BC1', fieldPatch: { price: 90 },
      baseSnapshot: { sentBatches: [{ kind: 'content', batchRequestId: 'A', item: { barcode: 'BC1' } }, { kind: 'price', batchRequestId: 'B', item: { barcode: 'BC1' } }] },
    });
    expect(sentBatchesFor(stale, 'C').map((b) => b.batchRequestId)).toEqual(['C']);
    expect(sentBatchesFor(stale, 'B').map((b) => b.batchRequestId)).toEqual(['A', 'B']);
  });

  it('a pending send replaces the earlier sentBatches / sentItem', async () => {
    h.credential.findUnique.mockResolvedValue({ trendyolSupplierId: 'sup1' });
    h.trendyolProduct.findUnique.mockResolvedValue({ barcode: 'BC1', title: 'T', salePrice: 100, listPrice: 120, quantity: 3, trendyolLastUpdate: null });
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'trendyol', externalId: 'BC1', fields: { price: 90 } });
    const row = h.catalogDraft.rows[0];
    row.baseSnapshot = { ...row.baseSnapshot, sentItem: { barcode: 'BC1', title: 'old' }, sentBatches: [{ kind: 'content', batchRequestId: 'A', item: { barcode: 'BC1' } }] };
    row.status = 'failed';
    const session: CatalogExecutorSession = {
      readRemote: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { exists: true, updatedAt: null, values: { price: 100 } }]))),
      applyMany: vi.fn(async () => new Map([[a.id, { kind: 'pending' as const, batchRequestId: 'C', sent: { barcode: 'BC1', salePrice: 90 } }]])),
      writeCache: vi.fn(async () => undefined),
    };
    const executors = { trendyol: { open: vi.fn(async () => session) } } as unknown as CatalogExecutors;
    const res = await sendCatalogDrafts(USER, [a.id], { executors, interDraftDelayMs: 0 });
    expect(res.pending).toEqual([a.id]);
    expect(row.batchRequestId).toBe('C');
    expect(row.baseSnapshot.sentBatches).toBeUndefined();
    expect(row.baseSnapshot.sentItem).toEqual({ barcode: 'BC1', salePrice: 90 });
  });
});

describe('staging on a product a create just made (no cache row yet)', () => {
  it('stages on the created-but-failed draft, and on a product whose create synced', async () => {
    const a = await stageCatalogDraft({ userId: USER, marketplace: 'wix', externalId: 'new', queuedActions: [{ type: 'create' }], fields: { title: 'N', price: 10, trackInventory: true } });
    const row = h.catalogDraft.rows[0];
    Object.assign(row, { status: 'failed', externalId: 'w9', baseSnapshot: {}, queuedActions: row.queuedActions.map((q: any) => ({ ...q, completedAt: NOW.toISOString() })) });
    const edited = await stageCatalogDraft({ userId: USER, marketplace: 'wix', externalId: 'w9', fields: { title: 'Renamed', quantity: 4 } });
    expect(edited).toMatchObject({ id: a.id, status: 'draft', externalId: 'w9', fieldPatch: { title: 'Renamed', quantity: 4 } });

    row.status = 'synced';
    const next = await stageCatalogDraft({ userId: USER, marketplace: 'wix', externalId: 'w9', fields: { title: 'Again' } });
    expect(next.id).not.toBe(a.id);
    expect(next).toMatchObject({ externalId: 'w9', baseSnapshot: {}, baseUpdatedAt: null, fieldPatch: { title: 'Again' } });

    await expect(stageCatalogDraft({ userId: USER, marketplace: 'wix', externalId: 'unknown', fields: { title: 'x' } }))
      .rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });
});
