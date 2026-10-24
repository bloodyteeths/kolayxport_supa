import { describe, expect, it } from 'vitest';
import { roundPrice, applyPriceOpsToInventory } from '@/lib/bulk/variationPriceOps';
import { computeNewPrice } from '@/components/domain/listings/bulk/ChangePriceModal';

describe('rounding never goes against the change', () => {
  it('3c case: −10% on $29 with .99 → $25.99, not $26.99', () => {
    expect(computeNewPrice(29, 'decPct', 10, '99')).toBe(25.99);
    expect(computeNewPrice(29, 'decAmt', 3, '99')).toBe(25.99);
  });
  it('raises round up', () => {
    expect(computeNewPrice(29, 'incPct', 10, '99')).toBe(31.99);
    expect(computeNewPrice(29, 'incPct', 10, '00')).toBe(32);
  });
  it('.00 on a cut rounds down', () => {
    expect(computeNewPrice(29, 'decPct', 10, '00')).toBe(26);
    expect(computeNewPrice(25.5, 'decAmt', 0.2, '00')).toBe(25);
  });
  it('already on .99 stays there; set keeps the old behaviour', () => {
    expect(roundPrice(25.99, '99', 29)).toBe(25.99);
    expect(computeNewPrice(10, 'set', 25, '99')).toBe(25.99);
    expect(roundPrice(26.1, 'none', 29)).toBe(26.1);
  });
  it('every cut is at least the asked size on a range of prices', () => {
    for (let p = 5; p <= 200; p += 0.37) {
      const next = computeNewPrice(p, 'decPct', 10, '99')!;
      expect(next).toBeLessThanOrEqual(Math.round(p * 0.9 * 100) / 100 + 1e-9);
    }
  });
  it('variation path uses the same rule', () => {
    const inv = { products: ['S', 'M'].map((s) => ({ property_values: [{ property_id: 1, property_name: 'Size', values: [s] }], offerings: [{ price: { amount: 2900, divisor: 100 }, quantity: 1 }] })) };
    const out = applyPriceOpsToInventory(inv, [{ op: 'decrease_pct', amount: 10 }], { round: '99' })!;
    expect((out.products as any[]).map((p) => p.offerings[0].price.amount)).toEqual([2599, 2599]);
  });
});
