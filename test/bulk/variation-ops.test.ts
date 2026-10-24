import { describe, expect, it } from 'vitest';
import { applySkuEdit, applyVariationEdits, buildVariationEdits } from '@/lib/bulk/variationOps';

const prod = (color: string, size: string, sku: string, cents: number, qty: number) => ({
  sku,
  property_values: [
    { property_id: 200, property_name: 'Color', values: [color] },
    { property_id: 100, property_name: 'Size', values: [size] },
  ],
  offerings: [{ price: { amount: cents, divisor: 100, currency_code: 'USD' }, quantity: qty, is_enabled: true }],
});
const inv = () => ({
  products: [prod('Red', 'S', 'DRS', 2000, 5), prod('Red', 'M', 'DRS', 2000, 5), prod('Blue', 'S', 'DRS', 2000, 5)],
  price_on_property: [], quantity_on_property: [], sku_on_property: [],
});

describe('applyVariationEdits', () => {
  it('price +10% on Red only → only Red changes, price_on_property set because prices now vary', () => {
    const r = applyVariationEdits(inv(), { price: { ops: [{ op: 'increase_pct', amount: 10 }] } }, { match: { property: 'color', value: 'red' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cents = (r.inventory.products as any[]).map((p) => p.offerings[0].price.amount);
    expect(cents).toEqual([2200, 2200, 2000]);
    expect(r.changed).toBe(2);
    expect(r.inventory.price_on_property).toEqual([200, 100]);
    expect(r.inventory.quantity_on_property).toEqual([]); // untouched and still uniform
  });
  it('quantity set 0..999 clamp; uniform values keep *_on_property empty', () => {
    const r = applyVariationEdits(inv(), { quantity: [{ op: 'set', amount: 5000 }] });
    expect(r.ok && (r.inventory.products as any[]).every((p) => p.offerings[0].quantity === 999)).toBe(true);
    expect(r.ok && r.inventory.quantity_on_property).toEqual([]);
  });
  it('SKU template per variation sets sku_on_property', () => {
    const r = applyVariationEdits(inv(), { sku: { mode: 'template', value: '{sku}-{Color}-{Size}' } });
    expect(r.ok && (r.inventory.products as any[]).map((p) => p.sku)).toEqual(['DRS-Red-S', 'DRS-Red-M', 'DRS-Blue-S']);
    expect(r.ok && r.inventory.sku_on_property).toEqual([200, 100]);
  });
  it('refuses SKUs over 32 chars, single-product inventories and empty matches', () => {
    expect(applyVariationEdits(inv(), { sku: { mode: 'suffix', value: '-'.repeat(40) } })).toEqual({ ok: false, reason: 'skuTooLong' });
    expect(applyVariationEdits({ products: [{ sku: 'A', property_values: [], offerings: [{ quantity: 1 }] }] }, { quantity: [{ op: 'set', amount: 2 }] })).toEqual({ ok: false, reason: 'single' });
    expect(applyVariationEdits(inv(), { quantity: [{ op: 'set', amount: 2 }] }, { match: { property: 'Color', value: 'Green' } })).toEqual({ ok: false, reason: 'noMatch' });
    expect(applyVariationEdits(inv(), {})).toEqual({ ok: false, reason: 'nothing' });
  });
  it('widens an existing *_on_property when the edit makes values vary by another property', () => {
    const base = { ...inv(), price_on_property: [100] };
    const r = applyVariationEdits(base, { price: { ops: [{ op: 'set', amount: 30 }] } }, { match: { property: 'Color', value: 'Red' } });
    expect(r.ok && r.inventory.price_on_property).toEqual([100, 200]);
  });
  it('keeps an *_on_property the seller already had', () => {
    const base = { ...inv(), price_on_property: [200] };
    const r = applyVariationEdits(base, { price: { ops: [{ op: 'set', amount: 25 }] } });
    expect(r.ok && r.inventory.price_on_property).toEqual([200]);
  });
});

describe('applySkuEdit', () => {
  const p = prod('Red', 'S', 'X', 100, 1);
  it('modes', () => {
    expect(applySkuEdit('X', { mode: 'set', value: 'NEW' }, p, 0)).toBe('NEW');
    expect(applySkuEdit('X', { mode: 'prefix', value: 'KX-' }, p, 0)).toBe('KX-X');
    expect(applySkuEdit('X', { mode: 'suffix', value: '-2026' }, p, 0)).toBe('X-2026');
    expect(applySkuEdit('AB-AB', { mode: 'replace', find: 'AB', with: 'C' }, p, 0)).toBe('C-C');
    expect(applySkuEdit('X', { mode: 'template', value: '{sku}_{n}' }, p, 2)).toBe('X_3');
  });
});

describe('buildVariationEdits', () => {
  it('prefers the open draft inventory and reports skipped listings with a reason', async () => {
    const deps = {
      fetchInventory: async (_s: string, id: string) => (id === 'bad' ? null : inv()),
      fetchDrafts: async (_s: string, id: string) => (id === 'drafted' ? [{ status: 'draft', inventoryPatch: { ...inv(), products: inv().products.map((p) => ({ ...p, sku: 'DRAFT' })) } }] : []),
    };
    const r = await buildVariationEdits('shop', ['a', 'drafted', 'bad'], { sku: { mode: 'suffix', value: '-1' } }, {}, deps);
    expect(r.patches.map((p) => [p.id, (p.inventory.products as any[])[0].sku])).toEqual(expect.arrayContaining([['a', 'DRS-1'], ['drafted', 'DRAFT-1']]));
    expect(r.skipped).toEqual([{ id: 'bad', reason: 'unreadable' }]);
  });
});

describe('live-source quantity marker and listings without variations', () => {
  it('stamps kx_loaded_quantity from the live source so untouched stock stays fresh at send', () => {
    const r = applyVariationEdits(inv(), { sku: { mode: 'suffix', value: '-X' } }, { stampLoaded: true });
    expect(r.ok && (r.inventory.products as any[]).map((p) => p.kx_loaded_quantity)).toEqual([5, 5, 5]);
    const q = applyVariationEdits(inv(), { quantity: [{ op: 'set', amount: 9 }] }, { stampLoaded: true });
    // Quantity edited: marker (5) differs from the new 9, so the sync writes 9.
    expect(q.ok && (q.inventory.products as any[])[0]).toMatchObject({ kx_loaded_quantity: 5, offerings: [{ quantity: 9 }] });
    expect(applyVariationEdits(inv(), { sku: { mode: 'suffix', value: '-X' } }).ok && (applyVariationEdits(inv(), { sku: { mode: 'suffix', value: '-X' } }) as any).inventory.products[0].kx_loaded_quantity).toBeUndefined();
  });
  it('a listing without variations: SKU only, no *_on_property', () => {
    const single = { products: [{ sku: 'OLD', property_values: [], offerings: [{ quantity: 3, price: { amount: 1000, divisor: 100 } }] }] };
    const r = applyVariationEdits(single, { sku: { mode: 'set', value: 'NEW-1' } });
    expect(r.ok && (r.inventory.products as any[])[0].sku).toBe('NEW-1');
    expect(r.ok && r.inventory.sku_on_property).toEqual([]);
    expect(applyVariationEdits(single, { quantity: [{ op: 'set', amount: 1 }] })).toEqual({ ok: false, reason: 'single' });
  });
  it('buildVariationEdits stamps only for the live inventory, never for an open draft', async () => {
    const deps = {
      fetchInventory: async () => inv(),
      fetchDrafts: async (_s: string, id: string) => (id === 'drafted' ? [{ status: 'draft', inventoryPatch: inv() }] : []),
    };
    const r = await buildVariationEdits('shop', ['live', 'drafted'], { sku: { mode: 'suffix', value: '-1' } }, {}, deps);
    const by = Object.fromEntries(r.patches.map((p) => [p.id, (p.inventory.products as any[])[0].kx_loaded_quantity]));
    expect(by).toEqual({ live: 5, drafted: undefined });
  });
});

import { optionValuesOf, propertyNamesOf } from '@/lib/bulk/variationOps';

describe('price per option', () => {
  const sized = () => ({
    products: ['S', 'M', 'L'].flatMap((size) => ['Red', 'Blue'].map((color) => ({
      sku: '', property_values: [{ property_id: 100, property_name: 'Size', values: [size] }, { property_id: 200, property_name: 'Color', values: [color] }],
      offerings: [{ price: { amount: 2000, divisor: 100, currency_code: 'USD' }, quantity: 3, is_enabled: true }],
    }))),
    price_on_property: [], quantity_on_property: [], sku_on_property: [],
  });
  it('sets each size its own price; untouched sizes keep theirs; price_on_property covers the varying properties', () => {
    const r = applyVariationEdits(sized(), { priceByOption: { property: 'size', prices: [{ value: 'm', price: 25 }, { value: 'L', price: 30 }] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bySize = (r.inventory.products as any[]).map((p) => `${p.property_values[0].values[0]}=${p.offerings[0].price.amount}`);
    expect(bySize).toEqual(['S=2000', 'S=2000', 'M=2500', 'M=2500', 'L=3000', 'L=3000']);
    expect(r.changed).toBe(4);
    expect(r.inventory.price_on_property).toEqual([100, 200]);
    expect((r.inventory.products as any[])[2].offerings[0].quantity).toBe(3);
  });
  it('no matching option → noMatch; listing without variations → single', () => {
    expect(applyVariationEdits(sized(), { priceByOption: { property: 'Size', prices: [{ value: 'XXL', price: 40 }] } })).toEqual({ ok: false, reason: 'noMatch' });
    expect(applyVariationEdits({ products: [{ sku: '', property_values: [], offerings: [{ quantity: 1 }] }] }, { priceByOption: { property: 'Size', prices: [{ value: 'S', price: 5 }] } })).toEqual({ ok: false, reason: 'single' });
  });
  it('lists properties and option values from the selected inventories', () => {
    expect(propertyNamesOf([sized()])).toEqual(['Size', 'Color']);
    expect(optionValuesOf([sized(), sized()], 'size')).toEqual(['S', 'M', 'L']);
  });
});
