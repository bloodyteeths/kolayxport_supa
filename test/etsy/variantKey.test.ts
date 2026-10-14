import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  etsyQuantityKey,
  etsyVariantKeys,
  pairsFromEtsyProduct,
  sha1Hex,
  NO_VARIATION_KEY,
  SHARED_QUANTITY_KEY,
} from '@/lib/etsy/variantKey';

const nodeSha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

describe('sha1Hex', () => {
  it('matches node:crypto for ASCII, unicode, astral and long inputs', () => {
    for (const s of ['', 'abc', '200:1|513:2', 'İpek şal ğüöç', '😀 emoji', 'x'.repeat(1000), 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)]) {
      expect(sha1Hex(s)).toBe(nodeSha1(s));
    }
  });
});

describe('etsyVariantKeys', () => {
  it("returns '' for no pairs", () => {
    expect(etsyVariantKeys([])).toEqual({ variantKey: NO_VARIATION_KEY, variantValueKey: NO_VARIATION_KEY });
    expect(etsyVariantKeys(null as any)).toEqual({ variantKey: '', variantValueKey: '' });
  });

  it('is sha1 of sorted pid:vid pairs', () => {
    const k = etsyVariantKeys([
      { propertyId: 513, valueId: 22, value: 'Red' },
      { propertyId: 200, valueId: 7, value: 'Small' },
    ]);
    expect(k.variantKey).toBe(nodeSha1('200:7|513:22'));
    expect(k.variantValueKey).toBe(nodeSha1('200:SMALL|513:RED'));
  });

  it('is independent of pair order', () => {
    const a = etsyVariantKeys([
      { propertyId: 1, valueId: 10, value: 'A' },
      { propertyId: 2, valueId: 20, value: 'B' },
    ]);
    const b = etsyVariantKeys([
      { propertyId: 2, valueId: 20, value: 'B' },
      { propertyId: 1, valueId: 10, value: 'A' },
    ]);
    expect(a).toEqual(b);
  });

  it('falls back to the value string when value id is missing', () => {
    const k = etsyVariantKeys([{ propertyId: 513, valueId: null, value: '  ipek   şal ' }]);
    expect(k.variantKey).toBe(nodeSha1('513:v=IPEK ŞAL'));
  });

  it('variantValueKey survives value-id churn; variantKey does not', () => {
    const a = etsyVariantKeys([{ propertyId: 513, valueId: 1, value: 'Kırmızı' }]);
    const b = etsyVariantKeys([{ propertyId: 513, valueId: 999, value: 'KIRMIZI' }]);
    expect(a.variantKey).not.toBe(b.variantKey);
    expect(a.variantValueKey).toBe(b.variantValueKey);
  });

  it('treats Turkish İ/ı and zero-width chars consistently in values', () => {
    const a = etsyVariantKeys([{ propertyId: 1, value: 'İpek' }]);
    const b = etsyVariantKeys([{ propertyId: 1, value: 'ipek​' }]);
    expect(a).toEqual(b);
  });
});

describe('etsyQuantityKey', () => {
  const pairs = [
    { propertyId: 100, valueId: 1, value: 'S' },
    { propertyId: 200, valueId: 5, value: 'Red' },
  ];

  it("'' without variations, '*' for shared quantity", () => {
    expect(etsyQuantityKey([], [100])).toBe('');
    expect(etsyQuantityKey(pairs, [])).toBe(SHARED_QUANTITY_KEY);
    expect(etsyQuantityKey(pairs, null)).toBe('*');
    expect(etsyQuantityKey(pairs, [999])).toBe('*');
  });

  it('keys only on quantity properties', () => {
    expect(etsyQuantityKey(pairs, [100, 200])).toBe(etsyVariantKeys(pairs).variantKey);
    expect(etsyQuantityKey(pairs, [100])).toBe(etsyVariantKeys([pairs[0]]).variantKey);
    const blue = [pairs[0], { propertyId: 200, valueId: 6, value: 'Blue' }];
    expect(etsyQuantityKey(blue, [100])).toBe(etsyQuantityKey(pairs, [100]));
  });
});

describe('pairsFromEtsyProduct', () => {
  it('reads property_values', () => {
    const product = {
      product_id: 1,
      property_values: [
        { property_id: 200, value_ids: [7], values: ['Small'] },
        { property_id: 513, value_ids: [], values: ['Custom'] },
      ],
    };
    expect(pairsFromEtsyProduct(product)).toEqual([
      { propertyId: 200, valueId: 7, value: 'Small' },
      { propertyId: 513, valueId: null, value: 'Custom' },
    ]);
    expect(pairsFromEtsyProduct({})).toEqual([]);
  });
});
