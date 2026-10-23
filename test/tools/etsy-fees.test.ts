import { describe, expect, it } from 'vitest';
import { etsyFees } from '@/lib/tools/etsyFees';

describe('etsyFees (Türkiye bank account)', () => {
  it('a $40 item + $10 shipping, no VAT ID, no ads', () => {
    const r = etsyFees({ itemUsd: 40, shippingUsd: 10, usdTry: 35 });
    // listing 0.20; transaction 6.5% of 50 = 3.25; processing 6.5% of 50 + 14/35 = 3.25 + 0.40 = 3.65;
    // regulatory 1.67% of 50 = 0.835; subtotal 7.935; KDV 20% = 1.587; total 9.522
    expect(r.fees).toEqual({ listing: 0.2, transaction: 3.25, processing: 3.65, regulatory: 0.84, offsiteAds: 0, vat: 1.59 });
    expect(r.totalFeesUsd).toBe(9.52);
    expect(r.netUsd).toBe(40.48);
    expect(r.netTry).toBe(1416.73); // from the unrounded net (40.478 × 35)
    expect(r.profitTry).toBeNull();
  });
  it('VAT ID removes KDV; offsite ads 15% capped at $100', () => {
    expect(etsyFees({ itemUsd: 40, shippingUsd: 10, usdTry: 35, hasVatId: true }).fees.vat).toBe(0);
    expect(etsyFees({ itemUsd: 2000, shippingUsd: 0, usdTry: 35, offsiteAdsRate: 0.15 }).fees.offsiteAds).toBe(100);
  });
  it('processing fee also applies to buyer sales tax', () => {
    const a = etsyFees({ itemUsd: 40, shippingUsd: 10, usdTry: 35 }).fees.processing;
    const b = etsyFees({ itemUsd: 40, shippingUsd: 10, usdTry: 35, buyerTaxUsd: 4 }).fees.processing;
    expect(b - a).toBeCloseTo(0.26, 2);
  });
  it('profit and margin with TRY costs; bad input never NaN', () => {
    const r = etsyFees({ itemUsd: 40, shippingUsd: 10, usdTry: 35, productCostTry: 500, shippingCostTry: 400 });
    expect(r.profitTry).toBe(516.73);
    expect(r.marginPct).toBe(29.5);
    const z = etsyFees({ itemUsd: NaN as unknown as number, shippingUsd: -5, usdTry: 0 });
    expect(Number.isFinite(z.netUsd)).toBe(true);
  });
});
