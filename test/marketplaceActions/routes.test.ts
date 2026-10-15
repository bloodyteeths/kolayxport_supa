import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mocks ----------------------------------------------------------------
const authUser = vi.fn();
const wixUpsert = vi.fn();
const shopifyUpsert = vi.fn();
vi.mock('@/lib/prisma', () => ({
  default: {
    wixSite: { findFirst: vi.fn(async () => ({ id: 'ws1', siteId: 's1', instanceId: 'i1', accessToken: 't', tokenExpiresAt: null })), update: vi.fn() },
    credential: { findUnique: vi.fn(async () => null), update: vi.fn() },
    wixProduct: { upsert: (...a: any[]) => wixUpsert(...a) },
    shopifyShop: { findFirst: vi.fn(async () => ({ id: 'sh1', shopDomain: 'x.myshopify.com' })) },
    shopifyProduct: { upsert: (...a: any[]) => shopifyUpsert(...a) },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/listings/refreshHealth', () => ({ refreshHealth: vi.fn() }));

let wixMedia: string[] = [];
const wix = {
  getProduct: vi.fn(async () => ({ id: 'p1', name: 'P', media: { items: wixMedia.map((id) => ({ id })) } })),
  addProductsToCollection: vi.fn(async () => undefined),
  removeProductsFromCollection: vi.fn(async () => undefined),
  addProductMedia: vi.fn(async (_p: string, items: any[]) => { items.forEach((m) => wixMedia.push(m.mediaId ?? `u${wixMedia.length}`)); }),
  removeProductMedia: vi.fn(async (_p: string, ids: string[]) => { wixMedia = wixMedia.filter((id) => !ids.includes(id)); }),
  reorderProductMedia: vi.fn(async (_p: string, order: string[]) => { wixMedia = [...order]; return { order, changed: true }; }),
};
vi.mock('@/lib/integrations/wixClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/integrations/wixClient')>('@/lib/integrations/wixClient');
  return { ...actual, createWixClient: () => wix };
});

let shopImages: any[] = [];
const shop = {
  getProductImages: vi.fn(async () => shopImages.map((x) => ({ ...x }))),
  createProductImage: vi.fn(async (_p: string, img: any) => { const c = { id: 500 + shopImages.length, ...img }; shopImages.push(c); return c; }),
  updateProductImage: vi.fn(async (_p: string, id: string, u: any) => ({ id: Number(id), ...u })),
  deleteProductImage: vi.fn(async (_p: string, id: string) => { shopImages = shopImages.filter((x) => String(x.id) !== id); }),
  getProduct: vi.fn(async () => ({ id: 10, title: 'T', images: shopImages, variants: [] })),
};
vi.mock('@/lib/integrations/shopifyClient', () => ({
  ShopifyClient: vi.fn().mockImplementation(function () { return shop; }),
  getValidAccessToken: vi.fn(async () => 'tok'),
}));

import wixHandler from '@/pages/api/wix/products';
import shopifyHandler from '@/pages/api/shopify/products';
import { WIX_ALL_PRODUCTS_COLLECTION_ID } from '@/lib/integrations/wixClient';

function call(handler: (req: any, res: any) => any, method: string, query: Record<string, string>, body?: unknown) {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => undefined;
  return Promise.resolve(handler({ method, headers: {}, query, body } as any, res)).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: 'u1' });
  wixMedia = ['m1', 'm2'];
  shopImages = [{ id: 1, position: 1 }, { id: 2, position: 2 }];
});

// ---------------------------------------------------------------------------
describe('/api/wix/products M6b-B actions', () => {
  it('collections_add: per-collection results and a cache refresh', async () => {
    const r = await call(wixHandler, 'POST', { action: 'collections_add' }, { productId: 'p1', collectionIds: ['c1', 'c2', 'c1'] });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.results.map((x: any) => x.id)).toEqual(['c1', 'c2']);
    expect(wix.addProductsToCollection).toHaveBeenCalledTimes(2);
    expect(wixUpsert).toHaveBeenCalledTimes(1);
    expect(r.body.product.id).toBe('p1');
  });

  it('collections_remove: All products is refused per item, others go through', async () => {
    const r = await call(wixHandler, 'POST', { action: 'collections_remove' }, { productId: 'p1', collectionIds: [WIX_ALL_PRODUCTS_COLLECTION_ID, 'c3'] });
    expect(r.body.ok).toBe(false);
    expect(r.body.results[0]).toMatchObject({ ok: false, code: 'COLLECTION_PROTECTED', key: 'listingEditor.wix.collectionProtected' });
    expect(wix.removeProductsFromCollection).toHaveBeenCalledWith('c3', ['p1']);
  });

  it('collections_* validates input', async () => {
    const r1 = await call(wixHandler, 'POST', { action: 'collections_add' }, { collectionIds: ['c1'] });
    expect(r1.statusCode).toBe(400);
    expect(r1.body).toMatchObject({ code: 'INVALID_INPUT', key: 'listings.draftError.invalidInput' });
    const r2 = await call(wixHandler, 'POST', { action: 'collections_add' }, { productId: 'p1', collectionIds: [] });
    expect(r2.statusCode).toBe(400);
    const r3 = await call(wixHandler, 'GET', { action: 'collections_add' });
    expect(r3.statusCode).toBe(400);
    expect(r3.body.error).toMatch(/Unknown action/);
  });

  it('media_add: url and mediaId adds, invalid url is a 400 with INVALID_URL', async () => {
    const r = await call(wixHandler, 'POST', { action: 'media_add' }, { productId: 'p1', media: [{ url: 'https://kolayxport.com/i/a.jpg' }, { mediaId: 'm7' }] });
    expect(r.statusCode).toBe(200);
    expect(wix.addProductMedia).toHaveBeenCalledWith('p1', [{ url: 'https://kolayxport.com/i/a.jpg' }, { mediaId: 'm7' }]);
    expect(r.body.mediaIds).toEqual(['m1', 'm2', 'u2', 'm7']);
    const bad = await call(wixHandler, 'POST', { action: 'media_add' }, { productId: 'p1', media: [{ url: 'http://x/a.jpg' }] });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatchObject({ code: 'INVALID_URL', key: 'listingEditor.media.invalidUrl' });
  });

  it('media_remove: stale ids are skipped, not failed', async () => {
    const r = await call(wixHandler, 'POST', { action: 'media_remove' }, { productId: 'p1', mediaIds: ['m1', 'zz'] });
    expect(r.body.ok).toBe(true);
    expect(wix.removeProductMedia).toHaveBeenCalledWith('p1', ['m1']);
    expect(r.body.results[1]).toMatchObject({ skipped: true, code: 'NOT_FOUND' });
    expect(r.body.mediaIds).toEqual(['m2']);
  });

  it('media_reorder: PUT with the exact set reorders; a different set is a 409', async () => {
    const r = await call(wixHandler, 'PUT', { action: 'media_reorder' }, { productId: 'p1', ids: ['m2', 'm1'] });
    expect(r.statusCode).toBe(200);
    expect(wix.reorderProductMedia).toHaveBeenCalledWith('p1', ['m2', 'm1']);
    expect(r.body.mediaIds).toEqual(['m2', 'm1']);
    const stale = await call(wixHandler, 'PUT', { action: 'media_reorder' }, { productId: 'p1', ids: ['m1'] });
    expect(stale.statusCode).toBe(409);
    expect(stale.body).toMatchObject({ code: 'MEDIA_SET_MISMATCH', key: 'listingEditor.media.orderStale' });
  });
});

// ---------------------------------------------------------------------------
describe('/api/shopify/products?action=images', () => {
  it('GET lists images', async () => {
    const r = await call(shopifyHandler, 'GET', { action: 'images', id: '10' });
    expect(r.statusCode).toBe(200);
    expect(r.body.images.map((x: any) => x.id)).toEqual([1, 2]);
  });

  it('POST adds one image and refreshes the cache', async () => {
    const r = await call(shopifyHandler, 'POST', { action: 'images', id: '10' }, { src: 'https://kolayxport.com/i/a.jpg', alt: 'Pink' });
    expect(r.statusCode).toBe(200);
    expect(shop.createProductImage).toHaveBeenCalledWith('10', { src: 'https://kolayxport.com/i/a.jpg', alt: 'Pink' });
    expect(r.body.results[0]).toMatchObject({ ok: true, id: '502' });
    expect(shopifyUpsert).toHaveBeenCalledTimes(1);
  });

  it('POST { ops } applies a staged batch', async () => {
    const r = await call(shopifyHandler, 'POST', { action: 'images', id: '10' }, { ops: [{ op: 'delete', id: '1' }, { op: 'reorder', id: '2', position: 1 }] });
    expect(r.body.ok).toBe(true);
    expect(shop.deleteProductImage).toHaveBeenCalledWith('10', '1');
    expect(shop.updateProductImage).toHaveBeenCalledWith('10', '2', { position: 1 });
  });

  it('PUT updates alt and position in one call; DELETE removes', async () => {
    const r = await call(shopifyHandler, 'PUT', { action: 'images', id: '10', imageId: '2' }, { alt: 'Blue', position: 1 });
    expect(r.body.ok).toBe(true);
    expect(shop.updateProductImage).toHaveBeenCalledWith('10', '2', { alt: 'Blue', position: 1 });
    const d = await call(shopifyHandler, 'DELETE', { action: 'images', id: '10', imageId: '1' });
    expect(d.body.ok).toBe(true);
    expect(shop.deleteProductImage).toHaveBeenCalledWith('10', '1');
  });

  it('validates ids, bodies and methods', async () => {
    expect((await call(shopifyHandler, 'GET', { action: 'images', id: 'abc' })).statusCode).toBe(400);
    expect((await call(shopifyHandler, 'PUT', { action: 'images', id: '10', imageId: '2' }, {})).statusCode).toBe(400);
    const bad = await call(shopifyHandler, 'POST', { action: 'images', id: '10' }, { src: 'http://x/a.jpg' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatchObject({ code: 'INVALID_URL', key: 'listingEditor.media.invalidUrl' });
    expect((await call(shopifyHandler, 'PATCH', { action: 'images', id: '10' })).statusCode).toBe(405);
    expect(shop.createProductImage).not.toHaveBeenCalled();
  });

  it('a failed write is a 200 with a per-op i18n key', async () => {
    shop.deleteProductImage.mockRejectedValueOnce(new Error('Shopify API DELETE /x failed: 404 - gone'));
    const r = await call(shopifyHandler, 'DELETE', { action: 'images', id: '10', imageId: '1' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.results[0]).toMatchObject({ code: 'REMOTE_MISSING', key: 'listings.draftError.remoteMissing' });
  });
});
