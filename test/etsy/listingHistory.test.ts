import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { buildSnapshot, contentHash } from '@/lib/etsy/listingNormalize';
import { buildRestorePlan, decideCapture, draftBatchKey } from '@/lib/etsy/listingHistory';

const listing = (o: Record<string, any> = {}) => ({
  title: 'Box',
  description: 'd',
  tags: ['a'],
  materials: [],
  price: { amount: 1000, divisor: 100, currency_code: 'USD' },
  state: 'active',
  who_made: 'i_did',
  when_made: 'made_to_order',
  is_supply: false,
  taxonomy_id: 1,
  ...o,
});
const imgs = (ids: number[], alt: Record<number, string> = {}) => ids.map((id, i) => ({ listing_image_id: id, rank: i + 1, alt_text: alt[id] ?? null }));
const inv = (enabled = true) => ({ products: [{ product_id: 1, sku: 'S', property_values: [], offerings: [{ offering_id: 2, quantity: 3, is_enabled: enabled, price: { amount: 1000, divisor: 100 } }] }] });

describe('decideCapture', () => {
  it('skips unchanged hashes', () => {
    const s = buildSnapshot(listing(), imgs([1]), inv(), null);
    const h = contentHash(s);
    expect(decideCapture({ prevHash: h, nextHash: h, prevSnapshot: s, nextSnapshot: s, attribution: 'external', isNewListing: false })).toEqual({ capture: false, reason: 'unchanged' });
  });

  it('first sighting of an existing listing is a silent baseline; a new live listing is "created"', () => {
    const s = buildSnapshot(listing(), imgs([1]), inv(), null);
    const base = decideCapture({ prevHash: null, nextHash: contentHash(s), prevSnapshot: null, nextSnapshot: s, attribution: 'unknown', isNewListing: false });
    expect(base).toMatchObject({ capture: true, baseline: true, changedKeys: [] });
    const created = decideCapture({ prevHash: null, nextHash: contentHash(s), prevSnapshot: null, nextSnapshot: s, attribution: 'external', isNewListing: true });
    expect(created).toMatchObject({ capture: true, baseline: false, changedKeys: ['created'] });
  });

  it('a stock-attributed change is versioned only for isEnabled/state', () => {
    const a = buildSnapshot(listing(), imgs([1]), inv(), null);
    const priceOnly = buildSnapshot(listing({ title: 'Box 2' }), imgs([1]), inv(), null);
    expect(decideCapture({ prevHash: contentHash(a), nextHash: contentHash(priceOnly), prevSnapshot: a, nextSnapshot: priceOnly, attribution: 'kolayxport_stock', isNewListing: false }).capture).toBe(false);
    const disabled = buildSnapshot(listing(), imgs([1]), inv(false), null);
    expect(decideCapture({ prevHash: contentHash(a), nextHash: contentHash(disabled), prevSnapshot: a, nextSnapshot: disabled, attribution: 'kolayxport_stock', isNewListing: false }).capture).toBe(true);
  });

  it('an external title edit yields changedKeys [title]', () => {
    const a = buildSnapshot(listing(), imgs([1]), inv(), null);
    const b = buildSnapshot(listing({ title: 'Better title' }), imgs([1]), inv(), null);
    const d = decideCapture({ prevHash: contentHash(a), nextHash: contentHash(b), prevSnapshot: a, nextSnapshot: b, attribution: 'external', isNewListing: false });
    expect(d).toMatchObject({ capture: true, changedKeys: ['title'] });
  });
});

describe('draftBatchKey', () => {
  it('buckets by 15 minutes per shop', () => {
    expect(draftBatchKey('s', new Date('2026-10-15T10:01:00Z'))).toBe(draftBatchKey('s', new Date('2026-10-15T10:14:59Z')));
    expect(draftBatchKey('s', new Date('2026-10-15T10:01:00Z'))).not.toBe(draftBatchKey('s', new Date('2026-10-15T10:15:00Z')));
  });
});

describe('buildRestorePlan', () => {
  it('stages changed fields and image reorder/alt for images still present; reports the rest', () => {
    const target = buildSnapshot(listing({ title: 'Old title', tags: ['a', 'b'] }), imgs([1, 2, 3], { 2: 'two' }), inv(), null);
    const current = buildSnapshot(listing({ state: 'inactive' }), imgs([2, 1, 4]), inv(false), null);
    const plan = buildRestorePlan(target, current);
    expect(plan.fields).toEqual({ title: 'Old title', tags: ['a', 'b'] });
    expect(plan.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'reorder', etsyMediaId: '1', rank: 1 }),
        expect.objectContaining({ operation: 'reorder', etsyMediaId: '2', rank: 2, altText: 'two' }),
      ]),
    );
    const reasons = plan.unrestorable.map((u) => u.reason).sort();
    expect(reasons).toEqual(['images_deleted', 'inventory', 'state']);
  });

  it('price is restorable only without variations', () => {
    const target = buildSnapshot(listing({ price: { amount: 1500, divisor: 100 } }), null, inv(), null);
    const current = buildSnapshot(listing(), null, inv(), null);
    expect(buildRestorePlan(target, current).fields.price).toBe(15);
  });
});
