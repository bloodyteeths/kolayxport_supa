import { describe, expect, it } from 'vitest';
import { mergeFreshInventoryQuantities, productKeys, reportedVariantKey, stripEditorFields } from '@/lib/etsy/inventoryMerge';
import { etsyVariantKeys, pairsFromEtsyProduct } from '@/lib/etsy/variantKey';

const product = (size: string, valueId: number | null, qty: number, pid = 100) => ({
  sku: `SKU-${size}`,
  property_values: [{ property_id: pid, property_name: 'Size', values: [size], value_ids: valueId === null ? [] : [valueId] }],
  offerings: [{ quantity: qty, price: { amount: 1000, divisor: 100 }, is_enabled: true }],
});

describe('mergeFreshInventoryQuantities', () => {
  it('keeps the fresh remote quantity for variants the user did not change', () => {
    const base = [product('S', 1, 5), product('M', 2, 5)];
    const draft = [product('S', 1, 5), product('M', 2, 9)]; // user changed M
    const fresh = [product('S', 1, 3), product('M', 2, 4)]; // sales happened since
    const r = mergeFreshInventoryQuantities({ draftProducts: draft, baseProducts: base, freshProducts: fresh });
    expect(r.products[0].offerings[0].quantity).toBe(3); // untouched -> fresh
    expect(r.products[1].offerings[0].quantity).toBe(9); // user's value kept
    expect(r.userChangedVariantKeys.has(productKeys(draft[1]).variantKey)).toBe(true);
    expect(r.userChangedVariantKeys.has(productKeys(draft[0]).variantKey)).toBe(false);
    expect(r.refreshed).toEqual([{ variantKey: productKeys(draft[0]).variantKey, from: 5, to: 3 }]);
  });

  it('matches by value when Etsy regenerated value ids (custom properties)', () => {
    const base = [product('S', null, 5, 513)];
    const draft = [product('S', null, 5, 513)];
    const fresh = [product('S', 999, 2, 513)];
    const r = mergeFreshInventoryQuantities({ draftProducts: draft, baseProducts: base, freshProducts: fresh });
    expect(r.products[0].offerings[0].quantity).toBe(2);
  });

  it('folds deprecated property 508 to 513 like the sanitizer', () => {
    const r = mergeFreshInventoryQuantities({
      draftProducts: [product('Red', null, 4, 508)],
      baseProducts: [product('Red', null, 4, 513)],
      freshProducts: [product('Red', null, 1, 513)],
    });
    expect(r.products[0].offerings[0].quantity).toBe(1);
  });

  it('without a base inventory treats every variant as user-changed (today\'s behaviour)', () => {
    const draft = [product('S', 1, 5)];
    const r = mergeFreshInventoryQuantities({ draftProducts: draft, baseProducts: null, freshProducts: [product('S', 1, 1)] });
    expect(r.products).toBe(draft);
    expect(r.hadBase).toBe(false);
    expect(r.userChangedVariantKeys.size).toBe(1);
  });

  it('new variations (not in the base) keep the draft quantity', () => {
    const r = mergeFreshInventoryQuantities({
      draftProducts: [product('S', 1, 5), product('XL', null, 7)],
      baseProducts: [product('S', 1, 5)],
      freshProducts: [product('S', 1, 5)],
    });
    expect(r.products[1].offerings[0].quantity).toBe(7);
    expect(r.userChangedVariantKeys.size).toBe(1);
  });

  it('a single-offering listing (no variations) merges too', () => {
    const single = (q: number) => ({ sku: 'X', property_values: [], offerings: [{ quantity: q }] });
    const r = mergeFreshInventoryQuantities({ draftProducts: [single(10)], baseProducts: [single(10)], freshProducts: [single(6)] });
    expect(r.products[0].offerings[0].quantity).toBe(6);
  });

  it('with the editor\'s loaded quantity, a restock back to the old base value is kept (not replaced by the fresh qty)', () => {
    // Draft created on day 1 (base 5). Sales drop Etsy to 2. Day 3 the editor loads 2, user restocks to 5.
    const base = [product('S', 1, 5)];
    const draft = [{ ...product('S', 1, 5), kx_loaded_quantity: 2 }];
    const fresh = [product('S', 1, 2)];
    const r = mergeFreshInventoryQuantities({ draftProducts: draft, baseProducts: base, freshProducts: fresh });
    expect(r.products[0].offerings[0].quantity).toBe(5);
    expect(r.userChangedVariantKeys.has(reportedVariantKey(draft[0]))).toBe(true);
  });

  it('with the loaded quantity, an untouched variant still takes the fresh qty (even without a base inventory)', () => {
    const draft = [{ ...product('S', 1, 2), kx_loaded_quantity: 2 }];
    const fresh = [product('S', 1, 1)];
    const r = mergeFreshInventoryQuantities({ draftProducts: draft, baseProducts: null, freshProducts: fresh });
    expect(r.products[0].offerings[0].quantity).toBe(1);
    expect(r.userChangedVariantKeys.size).toBe(0);
  });

  it('reports user-changed keys UNFOLDED (508 stays 508) so the stock hook can match them', () => {
    const draft = [product('Red', null, 9, 508)];
    const r = mergeFreshInventoryQuantities({
      draftProducts: draft,
      baseProducts: [product('Red', null, 4, 513)],
      freshProducts: [product('Red', null, 1, 513)],
    });
    expect(r.products[0].offerings[0].quantity).toBe(9);
    expect(r.userChangedVariantKeys.has(reportedVariantKey(draft[0]))).toBe(true);
    expect(reportedVariantKey(draft[0])).toBe(etsyVariantKeys(pairsFromEtsyProduct(draft[0])).variantKey);
    expect(reportedVariantKey(draft[0])).not.toBe(productKeys(draft[0]).variantKey);
  });

  it('stripEditorFields removes the loaded-quantity marker', () => {
    const p = { ...product('S', 1, 2), kx_loaded_quantity: 2 };
    expect('kx_loaded_quantity' in stripEditorFields(p)).toBe(false);
  });
});
