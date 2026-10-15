import { describe, it, expect } from 'vitest';
import { listingStatus } from '@/lib/ds/status';
import type { ListingMarketplace } from '@/lib/listings/types';
import type { ListingsAdapter, SchemaCaps, StoreContext } from '@/lib/listings/query';
import { etsyAdapter, etsyDraftOverlay } from '@/lib/listings/adapters/etsy';
import { ebayAdapter, ebayDraftOverlay } from '@/lib/listings/adapters/ebay';
import { trendyolAdapter, trendyolRejectNote, catalogDraftOverlay } from '@/lib/listings/adapters/trendyol';
import { wixAdapter } from '@/lib/listings/adapters/wix';
import { shopifyAdapter } from '@/lib/listings/adapters/shopify';
import { matches } from './g1-fakeDb';

const NO_CAPS: SchemaCaps = { health: false, skus: false, scheduledSendAt: false, drafts: true };
const ALL_CAPS: SchemaCaps = { health: true, skus: true, scheduledSendAt: true, drafts: true };

function ctx(over: Partial<StoreContext> = {}): StoreContext {
  return {
    userId: 'u1',
    store: { id: 's1', name: 'Shop', currency: 'USD', lastPulledAt: null },
    stores: [],
    storeWhere: {},
    meta: {},
    ...over,
  };
}

function product<T extends Record<string, unknown[]>>(axes: T): Record<keyof T, unknown>[] {
  let out: Record<string, unknown>[] = [{}];
  for (const [k, vals] of Object.entries(axes)) out = out.flatMap((o) => vals.map((v) => ({ ...o, [k]: v })));
  return out as Record<keyof T, unknown>[];
}

const STATUS_ROWS: Record<ListingMarketplace, Record<string, unknown>[]> = {
  etsy: product({ state: ['active', 'draft', 'inactive', 'expired', 'sold_out', 'soldout', 'edit', 'removed', 'weird'] }),
  ebay: product({ status: ['PUBLISHED', 'published', 'ENDED', 'ended', 'DRAFT', 'UNPUBLISHED'], quantity: [0, 3] }),
  trendyol: product({ approved: [true, false], onSale: [true, false], rejected: [true, false], blacklisted: [true, false], archived: [true, false], quantity: [0, 2] }),
  wix: product({ visible: [true, false], inStock: [true, false], trackInventory: [true, false], quantity: [0, 4] }),
  shopify: product({ status: ['active', 'ACTIVE', 'draft', 'archived', null, 'weird'], trackInventory: [true, false], totalInventory: [0, 5] }),
};

const ADAPTERS: Record<ListingMarketplace, ListingsAdapter> = { etsy: etsyAdapter, ebay: ebayAdapter, trendyol: trendyolAdapter, wix: wixAdapter, shopify: shopifyAdapter };

describe('statusWhere agrees with listingStatus (lib/ds/status/listings.ts)', () => {
  for (const mp of Object.keys(ADAPTERS) as ListingMarketplace[]) {
    it(`${mp}: every row matches exactly the where of its status key`, () => {
      const a = ADAPTERS[mp];
      for (const row of STATUS_ROWS[mp]) {
        const expected = listingStatus(row as never, mp);
        expect(a.statusKeys).toContain(expected);
        for (const key of a.statusKeys) {
          const w = a.statusWhere(key);
          expect({ row, key, hit: !!w && matches(row, w) }).toEqual({ row, key, hit: expected === key });
        }
      }
    });
  }
  it('keys a marketplace never produces have no where', () => {
    expect(etsyAdapter.statusWhere('in_review')).toBeNull();
    expect(wixAdapter.statusWhere('draft')).toBeNull();
    expect(ebayAdapter.statusWhere('expired')).toBeNull();
  });
});

describe('etsy toRow', () => {
  const base = {
    id: 'c1',
    etsyListingId: BigInt('1490012234'),
    title: '&quot;Mom&#39;s&quot; Keepsake Box &amp; Lid',
    priceAmount: 6400,
    priceDivisor: 100,
    priceCurrencyCode: 'USD',
    quantity: 42,
    state: 'active',
    url: null,
    shopSectionId: BigInt('52047899318'),
    views: 10,
    numFavorers: 2,
    thumbnailUrl75x75: 't75',
    thumbnailUrl170x135: null,
    imageCount: 7,
    hasVideo: true,
    isPersonalizable: false,
    hasVariations: false,
    etsyCreatedTimestamp: 1700000000,
    etsyUpdatedTimestamp: 0,
  };
  it('decodes entities, converts money and ids, falls back to the 75px thumb', () => {
    const r = etsyAdapter.toRow(base, ctx(), NO_CAPS);
    expect(r.id).toBe('1490012234');
    expect(r.title).toBe('"Mom\'s" Keepsake Box & Lid');
    expect(r.metaLine).toEqual(['ID 1490012234']);
    expect(r.price).toEqual({ amount: 64, currency: 'USD' });
    expect(r.qty).toBe(42);
    expect(r.thumbUrl).toBe('t75');
    expect(r.status).toBe('active');
    expect(r.editable).toEqual({ price: true, qty: true });
    expect(r.health).toEqual({ score: null, used: 0, total: 0, fails: [] });
    expect(r.updatedAt).toBeNull();
    expect(r.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(r.extra.section).toBe('52047899318');
    expect(r.externalUrl).toBe('https://www.etsy.com/listing/1490012234');
  });
  it('variations make price and qty read-only; skus and health appear once the columns exist', () => {
    const r = etsyAdapter.toRow({ ...base, hasVariations: true, skus: ['BB-PINK'], healthScore: 78.4, healthChecksUsed: 9, healthChecksTotal: 12, healthFails: ['video'] }, ctx(), ALL_CAPS);
    expect(r.editable).toEqual({ price: false, qty: false, reason: 'variations' });
    expect(r.metaLine).toEqual(['ID 1490012234', 'BB-PINK']);
    expect(r.health).toEqual({ score: 78, used: 9, total: 12, fails: ['video'] });
  });
  it('rejects non-numeric listing ids', () => {
    expect(etsyAdapter.toDbId('abc')).toBeUndefined();
    expect(etsyAdapter.toDbId('123')).toBe(BigInt(123));
    expect(etsyAdapter.toDbId('9223372036854775807')).toBe(BigInt('9223372036854775807'));
    expect(etsyAdapter.toDbId('9999999999999999999')).toBeUndefined(); // > int64: match nothing, never a Prisma 500
    expect(etsyAdapter.searchWhere('9999999999999999999', NO_CAPS)).toEqual({ OR: [{ title: { contains: '9999999999999999999', mode: 'insensitive' } }] });
  });
});

describe('other adapters toRow', () => {
  it('ebay: string price, SKU meta, itm url', () => {
    const r = ebayAdapter.toRow({ sku: 'BB-1', title: 'A &amp; B', priceValue: '12.50', priceCurrency: 'USD', quantity: 0, status: 'PUBLISHED', imageUrl: null, imageUrls: ['i1'], listingId: '99', ebayUpdatedAt: '2026-10-01T00:00:00.000Z' }, ctx(), NO_CAPS);
    expect(r).toMatchObject({ id: 'BB-1', title: 'A & B', metaLine: ['SKU BB-1'], thumbUrl: 'i1', price: { amount: 12.5, currency: 'USD' }, status: 'sold_out', externalUrl: 'https://www.ebay.com/itm/99', updatedAt: '2026-10-01T00:00:00.000Z' });
  });
  it('trendyol: rejected rows carry the reason as statusNote', () => {
    const r = trendyolAdapter.toRow({ barcode: '869', stockCode: 'SC1', title: 'T', salePrice: '199.90', currencyType: 'TRY', quantity: 3, approved: false, rejected: true, rejectReasons: [{ reason: 'Görsel uygun değil' }, 'Marka hatalı'] }, ctx(), NO_CAPS);
    expect(r.status).toBe('rejected');
    expect(r.statusNote).toBe('Görsel uygun değil · Marka hatalı');
    expect(r.metaLine).toEqual(['869', 'SC1']);
    expect(r.price).toEqual({ amount: 199.9, currency: 'TRY' });
    expect(trendyolRejectNote(null)).toBeUndefined();
  });
  it('wix: discount price shown, compare-at = list price, untracked qty is null and read-only', () => {
    const r = wixAdapter.toRow({ wixProductId: 'w1', title: 'W', price: 20, discountPrice: 15, currency: 'EUR', trackInventory: false, inStock: true, quantity: 0, visible: true, variants: [{}], collectionIds: ['c1', 'c2'], slug: 'w' }, ctx({ meta: { siteUrl: 'https://shop.example' } }), NO_CAPS);
    expect(r.price).toEqual({ amount: 15, currency: 'EUR' });
    expect(r.qty).toBeNull();
    expect(r.editable).toEqual({ price: true, qty: false, reason: 'not_tracked' });
    expect(r.extra).toMatchObject({ collection: 'c1', collectionCount: 2, compareAt: 20, variants: 1 });
    expect(r.externalUrl).toBe('https://shop.example/product-page/w');
    const multi = wixAdapter.toRow({ wixProductId: 'w2', title: 'W', price: 20, trackInventory: true, variants: [{}, {}], visible: true, inStock: true, quantity: 3 }, ctx(), NO_CAPS);
    expect(multi.editable).toEqual({ price: false, qty: false, reason: 'variations' });
  });
  it('wix: discountedPrice equal to price (Wix always sends it) is not a discount', () => {
    const r = wixAdapter.toRow({ wixProductId: 'w3', title: 'W', price: 20, discountPrice: 20, currency: 'EUR', trackInventory: true, quantity: 1, visible: true, inStock: true }, ctx(), NO_CAPS);
    expect(r.price).toEqual({ amount: 20, currency: 'EUR' });
    expect(r.extra).toMatchObject({ compareAt: null });
  });
  it('shopify: "from" price when several variants, product url from the shop domain', () => {
    const r = shopifyAdapter.toRow({ shopifyProductId: '7', title: 'S', price: '9.5', currency: 'USD', variantCount: 3, trackInventory: true, totalInventory: 4, status: 'active', handle: 'shirt' }, ctx({ meta: { shopDomain: 'x.myshopify.com' } }), NO_CAPS);
    expect(r.price).toEqual({ amount: 9.5, currency: 'USD', from: true });
    expect(r.editable.reason).toBe('variations');
    expect(r.externalUrl).toBe('https://x.myshopify.com/products/shirt');
    expect(shopifyAdapter.exportFields({ variants: [{ sku: '' }, { sku: 'SK-2' }], tags: ['a &amp; b'] }, NO_CAPS)).toEqual({ sku: 'SK-2', tags: ['a & b'], description: null });
  });
});

describe('draft overlays', () => {
  it('etsy: price/quantity/title from fieldPatch, other patches named', () => {
    const o = etsyDraftOverlay({ fieldPatch: { price: '64,50', quantity: 3, title: 'New &amp; Better', tags: ['a'] }, inventoryPatch: { products: [] }, taxonomyPatch: null });
    expect(o.draft).toEqual({ price: 64.5, qty: 3, title: 'New & Better' });
    expect(o.changedFields.sort()).toEqual(['price', 'quantity', 'tags', 'title', 'variations']);
  });
  it('ebay: offer price and ship-to quantity paths', () => {
    const o = ebayDraftOverlay({
      inventoryPatch: { product: { title: 'T2', imageUrls: [] }, availability: { shipToLocationAvailability: { quantity: 7 } } },
      offerPatch: { pricingSummary: { price: { value: '19.99', currency: 'USD' } } },
    });
    expect(o.draft).toEqual({ price: 19.99, qty: 7, title: 'T2' });
    expect(o.changedFields.sort()).toEqual(['images', 'price', 'quantity', 'title']);
  });
  it('catalog: fieldPatch keys', () => {
    expect(catalogDraftOverlay({ fieldPatch: { price: 5, visible: false } })).toEqual({ changedFields: ['price', 'visible'], draft: { price: 5 } });
  });
});

describe('filters', () => {
  it('etsy section filter accepts ids and "none"', () => {
    const [w] = etsyAdapter.filterWheres({ marketplace: 'etsy', sort: 'updated.desc', page: 1, size: 50, section: '5,none' }, NO_CAPS);
    expect(matches({ shopSectionId: BigInt(5) }, w)).toBe(true);
    expect(matches({ shopSectionId: null }, w)).toBe(true);
    expect(matches({ shopSectionId: BigInt(6) }, w)).toBe(false);
  });
  it('wix price sort and range run in memory over the effective shown price', () => {
    expect(wixAdapter.sortColumn('price', NO_CAPS)).toBe('memory');
    expect(wixAdapter.filterWheres({ marketplace: 'wix', sort: 'updated.desc', page: 1, size: 50, priceMin: 10, priceMax: 16 }, NO_CAPS)).toEqual([]);
    const p = wixAdapter.memoryPrice!.price;
    expect(p({ price: 20, discountPrice: 15 })).toBe(15);
    expect(p({ price: 20, discountPrice: 20 })).toBe(20);
    expect(p({ price: 20, discountPrice: null })).toBe(20);
    expect(p({ price: null, discountPrice: 7 })).toBe(7);
  });
  it('trendyol approval filter', () => {
    const [w] = trendyolAdapter.filterWheres({ marketplace: 'trendyol', sort: 'updated.desc', page: 1, size: 50, approval: 'in_review' }, NO_CAPS);
    expect(matches({ approved: false, rejected: false, blacklisted: false }, w)).toBe(true);
    expect(matches({ approved: false, rejected: true, blacklisted: false }, w)).toBe(false);
  });
});
