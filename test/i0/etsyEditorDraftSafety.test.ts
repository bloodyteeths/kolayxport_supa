import { describe, expect, it } from 'vitest';
import { stampLoadedQuantities } from '@/components/etsy/VariationEditor';
import { overlayFieldPatch } from '@/components/etsy/ListingEditorDrawer';

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

describe('overlayFieldPatch (server draft fieldPatch on open)', () => {
  const base = {
    title: 'Etsy title',
    description: 'd',
    tags: ['a'],
    materials: [],
    price: '10.00',
    quantity: 1,
    who_made: 'i_did',
    when_made: 'made_to_order',
    is_supply: false,
    shop_section_id: '' as const,
    shipping_profile_id: '' as const,
    return_policy_id: '' as const,
    processing_min: '' as const,
    processing_max: '' as const,
    readiness_state_id: '' as const,
    item_weight: '' as const,
    item_weight_unit: 'g',
    item_length: '' as const,
    item_width: '' as const,
    item_height: '' as const,
    item_dimensions_unit: 'cm',
  };

  it('applies editor keys and keeps unknown keys as extras', () => {
    const { next, extra, applied } = overlayFieldPatch(base as any, {
      title: 'Staged title',
      tags: ['x', 'y'],
      taxonomy_id: 1234,
      description: null,
    });
    expect(next.title).toBe('Staged title');
    expect(next.tags).toEqual(['x', 'y']);
    expect(next.description).toBe('d');
    expect(extra).toEqual({ taxonomy_id: 1234 });
    expect(applied).toBe(2);
    expect(base.tags).toEqual(['a']);
  });

  it('formats a numeric staged price like the editor input', () => {
    const { next } = overlayFieldPatch(base as any, { price: 12.5 });
    expect(next.price).toBe('12.50');
  });

  it('ignores a missing or malformed patch', () => {
    expect(overlayFieldPatch(base as any, null).applied).toBe(0);
    expect(overlayFieldPatch(base as any, [] as any).applied).toBe(0);
  });
});
