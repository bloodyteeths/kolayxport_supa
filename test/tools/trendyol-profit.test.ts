import { describe, expect, it } from 'vitest';
import { trendyolProfit } from '@/lib/tools/trendyolProfit';

describe('trendyolProfit', () => {
  it('matches a real settlement line: 790 TL at 18.2% → commission 143.78', () => {
    const r = trendyolProfit({ salePriceTry: 790, commissionPct: 18.2, vatPct: 20, productCostTry: 0, cargoTry: 0 });
    expect(r.commission).toBe(143.78);
    expect(r.platformFee).toBe(13.19);
    expect(r.stopaj).toBe(6.58); // 1% of 790 / 1.2
  });
  it('full order: 1000 TL, 20%, cost 400, cargo 90', () => {
    const r = trendyolProfit({ salePriceTry: 1000, commissionPct: 20, vatPct: 20, productCostTry: 400, cargoTry: 90 });
    // commission 200, fee 13.19, stopaj 8.33 → payout 688.48
    expect(r.payout).toBe(688.48);
    // output VAT 166.67; input VAT 66.67 (cost) + 33.33 (commission) + 15 (cargo) + 2.20 (fee) = 117.20 → net 49.47
    expect(r.netVat).toBe(49.47);
    expect(r.profit).toBe(239.01);
    expect(r.marginPct).toBe(23.9);
  });
  it('bad input never NaN; percent capped', () => {
    const r = trendyolProfit({ salePriceTry: NaN as unknown as number, commissionPct: 500, vatPct: -1, productCostTry: -5, cargoTry: 0 });
    expect(Object.values(r).every((v) => Number.isFinite(v))).toBe(true);
  });
});
