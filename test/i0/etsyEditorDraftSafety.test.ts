import { describe, expect, it } from 'vitest';
import { stampLoadedQuantities } from '@/components/etsy/VariationEditor';

const product = (color: string, qty: number, extra: Record<string, unknown> = {}) => ({
  product_id: 1,
  sku: '',
  offerings: [{ offering_id: 1, quantity: qty, is_enabled: true, price: { amount: 1000, divisor: 100, currency_code: 'USD' } }],
  property_values: [{ property_id: 200, property_name: 'Color', values: [color] }],
  ...extra,
});

describe('stampLoadedQuantities (W1 kx_loaded_quantity)', () => {
  it('stamps the live Etsy quantity when there is no pending draft', () => {
    const live = { products: [product('Red', 3), product('Blue', 0)] };
    const out = stampLoadedQuantities([product('Red', 7), product('Blue', 0)], {
      liveInventory: live,
      pendingDraft: null,
      originalProducts: [product('Red', 3), product('Blue', 0)],
    });
    expect(out.map((p) => p.kx_loaded_quantity)).toEqual([3, 0]);
  });

  it('carries an earlier staged marker over unchanged', () => {
    const out = stampLoadedQuantities([product('Red', 9)], {
      liveInventory: { products: [product('Red', 1)] },
      pendingDraft: { inventoryPatch: { products: [product('Red', 7, { kx_loaded_quantity: 3 })] } },
      originalProducts: [product('Red', 7)],
    });
    expect(out[0].kx_loaded_quantity).toBe(3);
  });

  it('legacy pending draft: stamps only variants edited in this session', () => {
    const out = stampLoadedQuantities([product('Red', 5), product('Blue', 2)], {
      liveInventory: { products: [product('Red', 1), product('Blue', 1)] },
      pendingDraft: { inventoryPatch: { products: [product('Red', 4), product('Blue', 2)] } },
      originalProducts: [product('Red', 4), product('Blue', 2)],
    });
    expect(out[0].kx_loaded_quantity).toBe(4);
    expect(out[1].kx_loaded_quantity).toBeUndefined();
  });

  it('matches by variant values case-insensitively, not product_id', () => {
    const out = stampLoadedQuantities([product('red ', 2)], {
      liveInventory: { products: [{ ...product('Red', 6), product_id: 999 }] },
      pendingDraft: null,
      originalProducts: [],
    });
    expect(out[0].kx_loaded_quantity).toBe(6);
  });
});
// overlayFieldPatch moved to components/domain/listing-editor/adapters/etsy.ts (overlayEtsyFieldPatch), covered by
// test/listingEditor/a-etsyAdapter.test.ts.
