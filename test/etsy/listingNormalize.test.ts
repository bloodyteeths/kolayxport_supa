import { describe, it, expect } from 'vitest';
import {
  buildOfferingRows,
  buildSnapshot,
  contentHash,
  diffSnapshots,
  fillMissingParts,
  isStockRelevantChange,
  listingRowFromEtsy,
  offeringsStockDiffer,
  seoChangeKinds,
  stableStringify,
} from '@/lib/etsy/listingNormalize';

function product(o: { pid?: number; vid?: number | null; value?: string; productId?: number; offeringId?: number; qty?: number; enabled?: boolean; sku?: string; amount?: number }) {
  return {
    product_id: o.productId ?? 111,
    sku: o.sku ?? 'SKU-1',
    is_deleted: false,
    property_values:
      o.pid === undefined
        ? []
        : [{ property_id: o.pid, property_name: 'Size', value_ids: o.vid === null ? [] : [o.vid ?? 1], values: [o.value ?? 'Small'] }],
    offerings: [
      {
        offering_id: o.offeringId ?? 222,
        quantity: o.qty ?? 5,
        is_enabled: o.enabled ?? true,
        is_deleted: false,
        price: { amount: o.amount ?? 1999, divisor: 100, currency_code: 'USD' },
      },
    ],
  };
}

function listing(over: Record<string, any> = {}) {
  return {
    listing_id: 1,
    shop_id: 10,
    title: 'Wooden Keepsake Box',
    description: 'Hand made',
    tags: ['keepsake box', 'wood'],
    materials: ['wood'],
    price: { amount: 1999, divisor: 100, currency_code: 'USD' },
    quantity: 5,
    views: 100,
    num_favorers: 7,
    state: 'active',
    updated_timestamp: 1_700_000_000,
    created_timestamp: 1_600_000_000,
    taxonomy_id: 123,
    who_made: 'i_did',
    when_made: 'made_to_order',
    is_supply: false,
    images: [
      { listing_image_id: 1, rank: 1, alt_text: 'front', url_75x75: 'a', url_170x135: 'b', url_570xN: 'c' },
      { listing_image_id: 2, rank: 2, alt_text: null },
    ],
    inventory: { products: [product({ pid: 100, vid: 1, value: 'Small' }), product({ pid: 100, vid: 2, value: 'Large', productId: 112 })], quantity_on_property: [100] },
    ...over,
  };
}

function snap(l: any) {
  return buildSnapshot(l, l.images ?? null, l.inventory ?? null, null);
}

describe('listingNormalize: content hash', () => {
  it('ignores quantity, views, favorites, updated_timestamp, product_id and offering_id', () => {
    const a = listing();
    const b = listing({
      quantity: 1,
      views: 999,
      num_favorers: 50,
      updated_timestamp: 1_800_000_000,
      inventory: {
        products: [
          product({ pid: 100, vid: 1, value: 'Small', productId: 9001, offeringId: 9002, qty: 0 }),
          product({ pid: 100, vid: 2, value: 'Large', productId: 9003, offeringId: 9004, qty: 1 }),
        ],
        quantity_on_property: [100],
      },
    });
    expect(contentHash(snap(a))).toBe(contentHash(snap(b)));
  });

  it('survives Etsy value-id churn on a re-PUT (offerings keyed by value)', () => {
    const a = listing();
    const b = listing({
      inventory: {
        products: [product({ pid: 100, vid: 777, value: 'Small' }), product({ pid: 100, vid: 778, value: 'Large' })],
        quantity_on_property: [100],
      },
    });
    expect(contentHash(snap(a))).toBe(contentHash(snap(b)));
  });

  it('changes when the title, an offering isEnabled or the state changes', () => {
    const base = contentHash(snap(listing()));
    expect(contentHash(snap(listing({ title: 'New title' })))).not.toBe(base);
    expect(contentHash(snap(listing({ state: 'inactive' })))).not.toBe(base);
    const disabled = listing({
      inventory: { products: [product({ pid: 100, vid: 1, value: 'Small', enabled: false }), product({ pid: 100, vid: 2, value: 'Large' })], quantity_on_property: [100] },
    });
    expect(contentHash(snap(disabled))).not.toBe(base);
  });

  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe('listingNormalize: diffSnapshots', () => {
  it('detects an image reorder and alt text change without add/remove', () => {
    const a = listing();
    const b = listing({
      images: [
        { listing_image_id: 2, rank: 1, alt_text: 'new alt' },
        { listing_image_id: 1, rank: 2, alt_text: 'front' },
      ],
    });
    const d = diffSnapshots(snap(a), snap(b));
    expect(d.changedKeys).toEqual(['images']);
    expect(d.diff.images).toEqual({ added: [], removed: [], reordered: true, altChanged: ['2'] });
  });

  it('reports tag adds/removes and title from/to', () => {
    const d = diffSnapshots(snap(listing()), snap(listing({ title: 'B', tags: ['wood', 'gift box'] })));
    expect(d.changedKeys).toEqual(expect.arrayContaining(['title', 'tags']));
    expect(d.diff.tags.added).toEqual(['gift box']);
    expect(d.diff.tags.removed).toEqual(['keepsake box']);
    expect(seoChangeKinds(d.changedKeys)).toEqual(['title', 'tags']);
  });

  it('never diffs parts that were not fetched', () => {
    const full = snap(listing());
    const partial = buildSnapshot(listing(), null, null, null);
    expect(diffSnapshots(full, partial).changedKeys).toEqual([]);
    const filled = fillMissingParts(partial, full);
    expect(contentHash(filled)).toBe(contentHash(full));
  });

  it('isStockRelevantChange: state and isEnabled only', () => {
    const a = snap(listing());
    expect(isStockRelevantChange(diffSnapshots(a, snap(listing({ state: 'sold_out' }))))).toBe(true);
    expect(isStockRelevantChange(diffSnapshots(a, snap(listing({ title: 'x' }))))).toBe(false);
  });
});

describe('listingNormalize: offerings and rows', () => {
  it('builds offering rows keyed by variantKey with normalized SKUs', () => {
    const rows = buildOfferingRows({ products: [product({ pid: 100, vid: 1, sku: ' ab-1 ' }), product({})] });
    expect(rows).toHaveLength(2);
    expect(rows[0].variantKey).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[1].variantKey).toBe('');
    expect(rows[0].skuNormalized).toBe('AB-1');
    expect(rows[0].quantity).toBe(5);
  });

  it('offeringsStockDiffer compares quantity and isEnabled by variantKey', () => {
    const a = [{ variantKey: 'k', quantity: 1, isEnabled: true }];
    expect(offeringsStockDiffer(a, [{ variantKey: 'k', quantity: 1, isEnabled: true }])).toBe(false);
    expect(offeringsStockDiffer(a, [{ variantKey: 'k', quantity: 0, isEnabled: true }])).toBe(true);
    expect(offeringsStockDiffer(a, [{ variantKey: 'k2', quantity: 1, isEnabled: true }])).toBe(true);
  });

  it('cache row keeps thumbnails only when images were fetched', () => {
    const withImages = listingRowFromEtsy(listing(), listing().images);
    expect(withImages.thumbnailUrl75x75).toBe('a');
    expect(withImages.imageCount).toBe(2);
    const without = listingRowFromEtsy(listing(), null);
    expect('thumbnailUrl75x75' in without).toBe(false);
  });
});
