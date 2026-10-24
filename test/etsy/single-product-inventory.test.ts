import { describe, expect, it } from 'vitest';
import { isSingleProductInventory } from '@/lib/etsy/inventoryMerge';

describe('isSingleProductInventory', () => {
  it('one live product without variation values', () => {
    expect(isSingleProductInventory({ products: [{ property_values: [] }] })).toBe(true);
    expect(isSingleProductInventory({ products: [{}, { is_deleted: true }] })).toBe(true);
  });
  it('variations or several products are not single', () => {
    expect(isSingleProductInventory({ products: [{ property_values: [{ property_id: 1, values: ['A'] }] }] })).toBe(false);
    expect(isSingleProductInventory({ products: [{}, {}] })).toBe(false);
    expect(isSingleProductInventory(null)).toBe(false);
  });
});

import { applyPlainFieldsToInventory } from '@/lib/etsy/inventoryMerge';

describe('applyPlainFieldsToInventory (whole-inventory PUT keeps everything but the edited fields)', () => {
  const staged = {
    products: [
      {
        sku: 'NEW-SKU-1',
        property_values: [],
        kx_loaded_quantity: 3,
        offerings: [{ offering_id: 9, price: { amount: 1000, divisor: 100 }, quantity: 3, is_enabled: true, readiness_state_id: 777 }],
      },
      { sku: 'GONE', is_deleted: true, offerings: [] },
    ],
    price_on_property: [], quantity_on_property: [], sku_on_property: [],
  };
  it('price + quantity change; sku, readiness_state_id, is_enabled, *_on_property and the marker survive', () => {
    const out = applyPlainFieldsToInventory(staged, { price: '12,50', quantity: 8 });
    expect(out.products).toHaveLength(1);
    expect(out.products[0]).toMatchObject({ sku: 'NEW-SKU-1', kx_loaded_quantity: 3 });
    expect(out.products[0].offerings[0]).toEqual({ offering_id: 9, price: 12.5, quantity: 8, is_enabled: true, readiness_state_id: 777 });
    expect(out).toMatchObject({ price_on_property: [], quantity_on_property: [], sku_on_property: [] });
  });
  it('only quantity: the price object is untouched', () => {
    const out = applyPlainFieldsToInventory(staged, { quantity: 1 });
    expect(out.products[0].offerings[0].price).toEqual({ amount: 1000, divisor: 100 });
  });
  it('an explicit processing profile replaces readiness_state_id; none keeps it', () => {
    expect(applyPlainFieldsToInventory(staged, { readinessStateId: 555 }).products[0].offerings[0].readiness_state_id).toBe(555);
    expect(applyPlainFieldsToInventory(staged, { readinessStateId: null }).products[0].offerings[0].readiness_state_id).toBe(777);
  });
});
