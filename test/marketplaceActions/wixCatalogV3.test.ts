import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from '../fixtures/wix/catalogV3.sample.json';
import { WixApiClient, WIX_ALL_PRODUCTS_COLLECTION_ID } from '@/lib/integrations/wixClient';
import {
  WixV3UnsupportedError,
  buildV3ProductCreate,
  buildV3ProductUpdate,
  findAllProductsCategoryId,
  groupInventoryByProduct,
  groupVariantsByProduct,
  isCatalogV1UnsupportedError,
  normalizeCatalogVersion,
  parseCatalogVersion,
  v3InventoryToV2Item,
  v3MediaItems,
  wixV3CategoryToCollection,
  wixV3ProductToV1,
} from '@/lib/integrations/wixCatalogV3';
import { wixValuesFromApi } from '@/lib/catalogDrafts/values';

// Fixture: a real Catalog V3 site read (query products, read-only variants,
// inventory items, categories), scrubbed of names/ids/urls.
const [singleRaw, multiRaw] = fixture.query.products as any[];
const variantsBy = groupVariantsByProduct(fixture.variants.variants);
const inventoryBy = groupInventoryByProduct(fixture.inventory.inventoryItems);
const allProductsId = findAllProductsCategoryId(fixture.categories.categories)!;
const v1Error = `Wix API 501: ${JSON.stringify(fixture.v1Unsupported)}`;

describe('catalog version detection (pure)', () => {
  it('reads the versioning endpoint answer', () => {
    expect(parseCatalogVersion(fixture.version)).toBe('V3');
    expect(parseCatalogVersion({ catalogVersion: 'V1_CATALOG' })).toBe('V1');
    expect(parseCatalogVersion({ catalogVersion: 'STORES_NOT_INSTALLED' })).toBeNull();
    expect(parseCatalogVersion(null)).toBeNull();
  });

  it('normalizes the stored WixSite value', () => {
    expect(normalizeCatalogVersion('V3')).toBe('V3');
    expect(normalizeCatalogVersion('V1')).toBe('V1');
    expect(normalizeCatalogVersion('v3')).toBeNull();
    expect(normalizeCatalogVersion(null)).toBeNull();
  });

  it('recognises the 501 a V3 site gives a V1 call, and nothing else', () => {
    expect(isCatalogV1UnsupportedError(new Error(v1Error))).toBe(true);
    expect(isCatalogV1UnsupportedError(new Error('Wix API 501: {"details":{"applicationError":{"code":"UNIMPLEMENTED"}}}'))).toBe(true);
    expect(isCatalogV1UnsupportedError(new Error('Wix API 500: boom'))).toBe(false);
    expect(isCatalogV1UnsupportedError(new Error('Wix API 404: {"message":"Entity not found"}'))).toBe(false);
  });
});

describe('V3 → V1 product mapping (real V3 sample)', () => {
  const single = wixV3ProductToV1(singleRaw, { variants: variantsBy.get(singleRaw.id), inventory: inventoryBy.get(singleRaw.id), allProductsCategoryId: allProductsId });
  const multi = wixV3ProductToV1(multiRaw, { variants: variantsBy.get(multiRaw.id), inventory: inventoryBy.get(multiRaw.id), allProductsCategoryId: allProductsId });

  it('maps a single-variant product with modifiers', () => {
    expect(single).toMatchObject({
      id: singleRaw.id,
      catalogVersion: 'V3',
      revision: '1',
      name: singleRaw.name,
      visible: true,
      productType: 'physical',
      description: '<p>Sample description</p>',
      priceData: { currency: 'TRY', price: 2999, discountedPrice: 2999 },
      discount: { type: 'NONE', value: 0 },
      stock: { trackInventory: false, inStock: true },
      manageVariants: false,
    });
    expect(single.variants).toHaveLength(1);
    expect(single.variants[0].choices).toEqual({});
    // Two FREE_TEXT modifiers → V1 custom text fields; the TEXT_CHOICES modifier → a V1 product option.
    expect(single.customTextFields).toHaveLength(2);
    expect(single.customTextFields[0]).toMatchObject({ maxLength: 15, mandatory: true });
    expect(single.productOptions).toHaveLength(1);
    expect(single.productOptions[0].optionType).toBe('drop_down');
  });

  it('maps the automatic All Products category to the protected V1 constant', () => {
    expect(single.collectionIds).toContain(WIX_ALL_PRODUCTS_COLLECTION_ID);
    expect(single.collectionIds).not.toContain(allProductsId);
    expect(single.collectionIds).toHaveLength(2);
  });

  it('keeps media order and ids (V1 media.items / mainMedia)', () => {
    const ids = singleRaw.media.itemsInfo.items.map((i: any) => i.id);
    expect(single.media.items.map((m: any) => m.id)).toEqual(ids);
    expect(single.media.mainMedia.id).toBe(ids[0]);
    expect(single.media.items[0].image.url).toMatch(/^https:\/\//);
  });

  it('maps option variants, sale prices and tracked inventory', () => {
    expect(multi.variants).toHaveLength(12);
    const v = multi.variants.find((x: any) => x.id === '00000000-0000-4000-8000-000000000034');
    expect(v).toMatchObject({
      choices: { Beden: '1 Yaş', renk: 'Mavi' },
      variant: { priceData: { price: 3500, discountedPrice: 3400 }, visible: true },
      stock: { trackQuantity: true, quantity: 5, inStock: true },
    });
    // Product price = the cheapest variant (list 3500, selling 3400) → a V1 AMOUNT discount.
    expect(multi.priceData).toMatchObject({ price: 3500, discountedPrice: 3400 });
    expect(multi.discount).toEqual({ type: 'AMOUNT', value: 100 });
    expect(multi.manageVariants).toBe(true);
    expect(multi.productOptions.map((o: any) => [o.name, o.optionType])).toEqual([['Beden', 'drop_down'], ['renk', 'color']]);
    // 6 tracked inventory items × 5 in the sample.
    expect(multi.stock).toMatchObject({ trackInventory: true, quantity: 30 });
  });

  it('feeds the catalog-draft canonical values like a V1 product', () => {
    const vals = wixValuesFromApi(multi);
    expect(vals).toMatchObject({ price: 3500, discountPrice: 3400, discounted: true, variantCount: 12, discount: { type: 'AMOUNT', value: 100 } });
    expect(vals.collectionIds).not.toContain(WIX_ALL_PRODUCTS_COLLECTION_ID);
  });

  it('maps inventory items to the Stores V2 inventory item shape', () => {
    const inv = v3InventoryToV2Item(multiRaw.id, inventoryBy.get(multiRaw.id)!);
    expect(inv.id).toBe(multiRaw.id);
    expect(inv.trackQuantity).toBe(true);
    expect(inv.variants[0]).toEqual({ variantId: '00000000-0000-4000-8000-000000000034', quantity: 5, inStock: true, availableForPreorder: false });
    const untracked = v3InventoryToV2Item(singleRaw.id, inventoryBy.get(singleRaw.id)!);
    expect(untracked.trackQuantity).toBe(false);
    expect(untracked.variants[0]).not.toHaveProperty('quantity');
  });

  it('maps categories to the collections shape', () => {
    const cols = fixture.categories.categories.map(wixV3CategoryToCollection);
    expect(cols[0]).toMatchObject({ id: WIX_ALL_PRODUCTS_COLLECTION_ID, numberOfProducts: 251, categoryId: allProductsId });
    expect(cols[1]).toMatchObject({ id: '00000000-0000-4000-8000-000000000054', numberOfProducts: 3 });
  });
});

describe('V1 payload → V3 writes', () => {
  const singleFull = { ...singleRaw, variantsInfo: { variants: variantsBy.get(singleRaw.id)!.map((v: any) => ({ ...v, id: v.variantId, choices: v.optionChoices })) } };
  const multiFull = { ...multiRaw, variantsInfo: { variants: variantsBy.get(multiRaw.id)!.map((v: any) => ({ ...v, id: v.variantId, choices: v.optionChoices })) } };

  it('sets price + discount on the variant, sending options and the whole variant list', () => {
    const body = buildV3ProductUpdate({ name: 'New', priceData: { price: 100 }, discount: { type: 'PERCENT', value: 10 }, visible: false }, singleFull);
    expect(body).toMatchObject({ id: singleRaw.id, revision: '1', name: 'New', visible: false, options: [] });
    expect(body.variantsInfo.variants).toHaveLength(1);
    expect(body.variantsInfo.variants[0].id).toBe(singleFull.variantsInfo.variants[0].id);
    expect(body.variantsInfo.variants[0].price).toEqual({ actualPrice: { amount: '90.00' }, compareAtPrice: { amount: '100.00' } });
    expect(body.variantsInfo.variants[0]).not.toHaveProperty('media');
    expect(body.variantsInfo.variants[0]).not.toHaveProperty('inventoryStatus');
  });

  it('a price without a discount keeps the current amount off; NONE clears it', () => {
    const one = { ...multiFull, variantsInfo: { variants: [multiFull.variantsInfo.variants[0]] } };
    expect(buildV3ProductUpdate({ priceData: { price: 4000 } }, one).variantsInfo.variants[0].price).toEqual({ actualPrice: { amount: '3900.00' }, compareAtPrice: { amount: '4000.00' } });
    expect(buildV3ProductUpdate({ priceData: { price: 4000 }, discount: { type: 'NONE', value: 0 } }, one).variantsInfo.variants[0].price).toEqual({ actualPrice: { amount: '4000.00' } });
  });

  it('refuses what V3 cannot take as given (nothing sent)', () => {
    expect(() => buildV3ProductUpdate({ priceData: { price: 1 } }, multiFull)).toThrow(WixV3UnsupportedError); // variants priced differently
    expect(() => buildV3ProductUpdate({ sku: 'X' }, multiFull)).toThrow(/SKU/);
    expect(() => buildV3ProductUpdate({ seoData: {} }, singleFull)).toThrow(/seoData/);
    expect(() => buildV3ProductUpdate({ ribbon: '' }, { ...singleFull, ribbon: { id: 'r1', name: 'Sale' } })).toThrow(/ribbon/);
  });

  it('custom text fields replace only the FREE_TEXT modifiers', () => {
    const body = buildV3ProductUpdate({ customTextFields: [{ title: 'Name', maxLength: 20, mandatory: false }] }, singleFull);
    expect(body.modifiers.map((m: any) => m.modifierRenderType)).toEqual(['TEXT_CHOICES', 'FREE_TEXT']);
    expect(body.modifiers[0].id).toBe(singleRaw.modifiers[0].id);
    expect(body.modifiers[1]).toMatchObject({ modifierRenderType: 'FREE_TEXT', mandatory: false, freeTextSettings: { title: 'Name', maxCharCount: 20 } });
    expect(body).not.toHaveProperty('variantsInfo');
  });

  it('builds a Create Product With Inventory body', () => {
    expect(buildV3ProductCreate({ name: 'Box', priceData: { price: 50 }, sku: 'B1', weight: 0.4, visible: true, productType: 'physical' })).toEqual({
      product: {
        name: 'Box',
        productType: 'PHYSICAL',
        physicalProperties: {},
        visible: true,
        variantsInfo: { variants: [{ price: { actualPrice: { amount: '50.00' } }, inventoryItem: { inStock: true }, physicalProperties: { weight: 0.4 }, sku: 'B1' }] },
      },
    });
    expect(() => buildV3ProductCreate({ name: 'File', priceData: { price: 5 }, productType: 'digital' })).toThrow(WixV3UnsupportedError);
  });

  it('builds the media list for add / remove / reorder', () => {
    expect(v3MediaItems(['a', 'b', 'c'], { remove: ['b'], add: [{ url: 'https://x/y.jpg' }, { mediaId: 'm1' }] })).toEqual([{ id: 'a' }, { id: 'c' }, { url: 'https://x/y.jpg' }, { id: 'm1' }]);
    expect(v3MediaItems(['a', 'b', 'c'], { order: ['c', 'a', 'b'] })).toEqual([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
  });
});

// ─── client routing (fetch mocked) ──────────────────────────

type Call = { url: string; method: string; body: any };
let calls: Call[];
let responder: (c: Call) => { status?: number; json?: any };

beforeEach(() => {
  calls = [];
  responder = () => ({ json: {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const c: Call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const r = responder(c);
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const path = (c: Call) => c.url.replace('https://www.wixapis.com', '').split('?')[0];

/** A V3 site: V1 catalog calls get the real 501, V3 calls get the fixture. */
function v3Site(c: Call) {
  const p = path(c);
  if (p.startsWith('/stores/v1/') || p.startsWith('/stores/v2/inventoryItems')) return { status: 501, json: fixture.v1Unsupported };
  if (p === '/stores/v3/provision/version') return { json: fixture.version };
  if (p === '/stores/v3/products/query') return { json: fixture.query };
  if (p === '/stores/v3/products/query-variants') return { json: fixture.variants };
  if (p === '/stores/v3/inventory-items/query') {
    const ids: string[] = c.body?.query?.filter?.productId?.$in || [];
    return { json: { inventoryItems: fixture.inventory.inventoryItems.filter((i: any) => ids.includes(i.productId)), pagingMetadata: { cursors: {} } } };
  }
  if (p === '/categories/v1/categories/query') return { json: { ...fixture.categories, pagingMetadata: { hasNext: false } } };
  if (p.startsWith('/stores/v3/products/')) return { json: { product: { ...singleRaw, variantsInfo: { variants: [] } } } };
  return { json: {} };
}

const client = (opts?: ConstructorParameters<typeof WixApiClient>[2]) =>
  new WixApiClient({ siteId: 's1', instanceId: 'i1', accessToken: 'tok', tokenExpiresAt: new Date(Date.now() + 3_600_000) }, undefined, opts);

describe('WixApiClient catalog version', () => {
  it('asks the versioning endpoint once and stores the answer', async () => {
    responder = v3Site;
    const onCatalogVersion = vi.fn();
    const c = client({ onCatalogVersion });
    expect(await c.resolveCatalogVersion()).toBe('V3');
    expect(await c.resolveCatalogVersion()).toBe('V3');
    expect(calls.filter((x) => path(x) === '/stores/v3/provision/version')).toHaveLength(1);
    expect(onCatalogVersion).toHaveBeenCalledWith('V3');
  });

  it('a failed versioning call leaves the version unknown', async () => {
    responder = () => ({ status: 403, json: { message: 'forbidden' } });
    expect(await client().resolveCatalogVersion()).toBeNull();
  });

  it('falls back to the 501 of a V1 call: switches to V3, stores it, and goes straight to V3 next time', async () => {
    responder = v3Site;
    const onCatalogVersion = vi.fn();
    const c = client({ onCatalogVersion });
    const { collections, totalResults } = await c.queryCollections();
    expect(calls.map(path)).toEqual(['/stores/v1/collections/query', '/categories/v1/categories/query']);
    expect(totalResults).toBe(2);
    expect(collections[0].id).toBe(WIX_ALL_PRODUCTS_COLLECTION_ID);
    expect(onCatalogVersion).toHaveBeenCalledWith('V3');
    expect(c.getKnownCatalogVersion()).toBe('V3');
    calls = [];
    await c.queryCollections();
    expect(calls.map(path)).toEqual(['/categories/v1/categories/query']);
  });

  it('a known V1 site makes only V1 calls (no versioning call)', async () => {
    responder = () => ({ json: { collections: [{ id: 'c1', name: 'A' }], totalResults: 1 } });
    const c = client({ catalogVersion: 'V1' });
    await c.queryCollections();
    expect(calls.map(path)).toEqual(['/stores/v1/collections/query']);
  });

  it('other V1 errors are not treated as V3', async () => {
    responder = () => ({ status: 500, json: { message: 'boom' } });
    await expect(client().queryCollections()).rejects.toThrow(/Wix API 500/);
    expect(calls).toHaveLength(1);
  });
});

describe('WixApiClient on a V3 site', () => {
  it('pages every product with its variants and inventory (sync)', async () => {
    responder = v3Site;
    const c = client({ catalogVersion: 'V3' });
    const seen: any[] = [];
    const n = await c.forEachProductPage(async (ps) => {
      seen.push(...ps);
    });
    expect(n).toBe(2);
    expect(seen.map((p) => p.id)).toEqual([singleRaw.id, multiRaw.id]);
    expect(seen[1].variants).toHaveLength(12);
    expect(seen[1].stock.quantity).toBe(30);
    const variantsCall = calls.find((x) => path(x) === '/stores/v3/products/query-variants')!;
    expect(variantsCall.body.query.filter['productData.productId'].$in).toEqual([singleRaw.id, multiRaw.id]);
  });

  it('sets absolute quantities through Bulk Update Inventory Items with revisions', async () => {
    responder = v3Site;
    const c = client({ catalogVersion: 'V3' });
    await c.setInventoryVariantQuantities(multiRaw.id, [{ variantId: '00000000-0000-4000-8000-000000000034', quantity: 7 }]);
    const upd = calls.find((x) => path(x) === '/stores/v3/bulk/inventory-items/update')!;
    expect(upd.method).toBe('POST');
    expect(upd.body.inventoryItems).toEqual([{ inventoryItem: { id: fixture.inventory.inventoryItems[0].id, revision: '1', quantity: 7 } }]);
    expect(upd.body.reason).toBe('MANUAL');
  });

  it('increments by reading the current quantity (inventory id = product id)', async () => {
    responder = v3Site;
    const c = client({ catalogVersion: 'V3' });
    const inv = await c.getInventoryItem(multiRaw.id);
    expect(inv.id).toBe(multiRaw.id);
    await c.updateInventoryVariants(inv.id, [{ variantId: '00000000-0000-4000-8000-000000000034', quantity: -2 }]);
    const upd = calls.find((x) => path(x) === '/stores/v3/bulk/inventory-items/update')!;
    expect(upd.body.inventoryItems[0].inventoryItem.quantity).toBe(3);
  });

  it('adds a product to a category with the Wix Stores app id', async () => {
    responder = v3Site;
    await client({ catalogVersion: 'V3' }).addProductsToCollection('cat1', ['p1']);
    const call = calls[0];
    expect(path(call)).toBe('/categories/v1/bulk/categories/cat1/add-items');
    expect(call.body).toEqual({ items: [{ catalogItemId: 'p1', appId: '215238eb-22a5-4c36-9e7b-e7c08025e04e' }], treeReference: { appNamespace: '@wix/stores' } });
  });

  it('reorders media in one Update Product with the current revision', async () => {
    responder = v3Site;
    const ids = singleRaw.media.itemsInfo.items.map((i: any) => i.id);
    const wanted = [...ids].reverse();
    const res = await client({ catalogVersion: 'V3' }).reorderProductMedia(singleRaw.id, wanted);
    expect(res).toEqual({ order: wanted, changed: true });
    const patch = calls.find((x) => x.method === 'PATCH')!;
    expect(path(patch)).toBe(`/stores/v3/products/${singleRaw.id}`);
    expect(patch.body.product).toEqual({ id: singleRaw.id, revision: '1', media: { itemsInfo: { items: wanted.map((id: string) => ({ id })) } } });
  });
});
