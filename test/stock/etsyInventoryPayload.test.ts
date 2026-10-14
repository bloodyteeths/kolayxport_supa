import { describe, expect, it } from 'vitest';
import {
  StructureChangedError,
  assertSameStructure,
  buildQuantityOnlyInventoryPayload,
  expandChangesToQuantityGroups,
  payloadAllZero,
  productVariantKey,
  productsFromInventory,
} from '@/lib/stock/etsyInventoryPayload';

function product(id: number, size: string, sizeVid: number, color: string, colorVid: number, qty: number, sku: string) {
  return {
    product_id: id,
    sku,
    is_deleted: false,
    property_values: [
      { property_id: 100, property_name: 'Size', scale_id: 1, scale_name: 'US', value_ids: [sizeVid], values: [size] },
      { property_id: 200, property_name: 'Color', scale_id: null, scale_name: null, value_ids: [colorVid], values: [color] },
    ],
    offerings: [{ offering_id: id * 10, quantity: qty, is_enabled: true, is_deleted: false, readiness_state_id: 7, price: { amount: 2599, divisor: 100, currency_code: 'USD' } }],
  };
}

const GET = {
  products: [product(1, 'S', 11, 'Red', 21, 5, 'TS-S-R'), product(2, 'S', 11, 'Blue', 22, 5, 'TS-S-B'), product(3, 'M', 12, 'Red', 21, 2, 'TS-M-R'), product(4, 'M', 12, 'Blue', 22, 2, 'TS-M-B')],
  price_on_property: [],
  quantity_on_property: [100],
  sku_on_property: [100, 200],
  readiness_state_on_property: [],
  listing_id: 999,
};

describe('buildQuantityOnlyInventoryPayload', () => {
  it('strips server ids, converts prices, keeps structure, changes only quantity', () => {
    const k = productVariantKey(GET.products[0]);
    const payload = buildQuantityOnlyInventoryPayload(GET, new Map([[k, { quantity: 3 }]]));
    expect(payload.listing_id).toBeUndefined();
    expect(payload.quantity_on_property).toEqual([100]);
    expect(payload.sku_on_property).toEqual([100, 200]);
    const p0 = payload.products[0];
    expect(p0.product_id).toBeUndefined();
    expect(p0.is_deleted).toBeUndefined();
    expect(p0.property_values[0].scale_name).toBeUndefined();
    expect(p0.property_values[0].scale_id).toBe(1);
    expect(p0.offerings[0].offering_id).toBeUndefined();
    expect(p0.offerings[0].price).toBe(25.99);
    expect(p0.offerings[0].readiness_state_id).toBe(7);
    expect(p0.offerings[0].quantity).toBe(3);
    expect(payload.products[1].offerings[0].quantity).toBe(5);
    expect(payload.products.map((p: any) => p.sku)).toEqual(['TS-S-R', 'TS-S-B', 'TS-M-R', 'TS-M-B']);
    // The source GET is untouched.
    expect(GET.products[0].offerings[0].quantity).toBe(5);
  });

  it('sets is_enabled for a disabled variation', () => {
    const k = productVariantKey(GET.products[2]);
    const payload = buildQuantityOnlyInventoryPayload(GET, new Map([[k, { isEnabled: false }]]));
    expect(payload.products[2].offerings[0].is_enabled).toBe(false);
    expect(payload.products[2].offerings[0].quantity).toBe(2);
  });

  it('single-product listing uses the empty key', () => {
    const single = { products: [{ product_id: 1, sku: 'A', property_values: [], offerings: [{ offering_id: 2, quantity: 4, is_enabled: true, price: { amount: 100, divisor: 100 } }] }], quantity_on_property: [] };
    const payload = buildQuantityOnlyInventoryPayload(single, new Map([['', { quantity: 1 }]]));
    expect(payload.products[0].offerings[0].quantity).toBe(1);
  });

  it('rejects a payload whose structure differs from the GET', () => {
    const k = productVariantKey(GET.products[0]);
    const payload = buildQuantityOnlyInventoryPayload(GET, new Map([[k, { quantity: 1 }]]));
    const tampered = JSON.parse(JSON.stringify(payload));
    tampered.products[0].property_values[0].property_id = 513;
    expect(() => assertSameStructure(GET, tampered)).toThrow(StructureChangedError);
    const priced = JSON.parse(JSON.stringify(payload));
    priced.products[1].offerings[0].price = 19.99;
    expect(() => assertSameStructure(GET, priced)).toThrow(StructureChangedError);
    const onProp = JSON.parse(JSON.stringify(payload));
    onProp.quantity_on_property = [];
    expect(() => assertSameStructure(GET, onProp)).toThrow(StructureChangedError);
    const fewer = JSON.parse(JSON.stringify(payload));
    fewer.products.pop();
    expect(() => assertSameStructure(GET, fewer)).toThrow(StructureChangedError);
  });

  it('empty inventory is a structure error', () => {
    expect(() => buildQuantityOnlyInventoryPayload({ products: [] }, new Map())).toThrow(StructureChangedError);
  });
});

describe('quantity groups', () => {
  it('a change on one colour applies to every colour of that size (quantity_on_property=[Size])', () => {
    const k = productVariantKey(GET.products[0]);
    const expanded = expandChangesToQuantityGroups(GET, new Map([[k, { quantity: 1 }]]));
    expect(expanded.size).toBe(2);
    expect(expanded.get(productVariantKey(GET.products[1]))).toEqual({ quantity: 1 });
    expect(expanded.has(productVariantKey(GET.products[2]))).toBe(false);
  });

  it('conflicting targets in one group resolve to the minimum', () => {
    const a = productVariantKey(GET.products[0]);
    const b = productVariantKey(GET.products[1]);
    const expanded = expandChangesToQuantityGroups(GET, new Map([[a, { quantity: 4 }], [b, { quantity: 2 }]]));
    expect(expanded.get(a)).toEqual({ quantity: 2, isEnabled: undefined });
  });

  it("'*' covers the whole listing", () => {
    const shared = { ...GET, quantity_on_property: [] };
    const expanded = expandChangesToQuantityGroups(shared, new Map([['*', { quantity: 7 }]]));
    expect(expanded.size).toBe(4);
  });

  it('productsFromInventory reports quantity keys and enabled state', () => {
    const rows = productsFromInventory(GET);
    expect(rows).toHaveLength(4);
    expect(rows[0].quantityKey).toBe(rows[1].quantityKey);
    expect(rows[0].quantityKey).not.toBe(rows[2].quantityKey);
  });

  it('payloadAllZero', () => {
    expect(payloadAllZero({ products: [{ offerings: [{ quantity: 0, is_enabled: true }, { quantity: 3, is_enabled: false }] }] })).toBe(true);
    expect(payloadAllZero({ products: [{ offerings: [{ quantity: 1, is_enabled: true }] }] })).toBe(false);
  });
});
