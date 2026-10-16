import { describe, expect, it } from 'vitest';
import { trendyolVariantLabel } from '@/lib/listings/adapters/trendyol';

describe('trendyolVariantLabel', () => {
  it('size · variant colour (the Renk with a value id wins over free-text Renk)', () => {
    expect(trendyolVariantLabel([
      { attributeName: 'Renk', attributeValue: 'Kırmızı Kolsuz' },
      { attributeName: 'Renk', attributeValue: 'Kırmızı', attributeValueId: 7002 },
      { attributeName: 'Beden', attributeValue: '3-4 Yaş', attributeValueId: 1 },
      { attributeName: 'Boy', attributeValue: 'Mini' },
    ])).toBe('3-4 Yaş · Kırmızı');
  });
  it('null for no usable attributes', () => {
    expect(trendyolVariantLabel(null)).toBeNull();
    expect(trendyolVariantLabel([{ attributeName: 'Boy', attributeValue: 'Mini' }])).toBeNull();
  });
});
