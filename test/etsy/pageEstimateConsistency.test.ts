import { describe, it, expect, beforeEach } from 'vitest';
import { applyPageEstimates, __rememberPageEstimateForTest, __clearPageEstimates } from '@/lib/etsy/listingStats';

const card = (id: string, monthly: number, price = 29.99) => ({
  listingId: id, shopId: 's1', price, currency: 'USD', favorites: 1, quantity: 1,
  sales: { kind: 'estimated', confidence: 'medium', monthlySales: monthly, monthlySalesUpperBound: null, monthlyRevenue: monthly * price, inputs: {} },
}) as any;

describe('search card uses the listing page estimate (same number in both places)', () => {
  beforeEach(() => __clearPageEstimates());

  it('overrides a cached card value with the listing-page estimate', () => {
    __rememberPageEstimateForTest('4533279250', { kind: 'estimated', confidence: 'medium', monthlySales: 25.6, monthlySalesUpperBound: null, inputs: { recentListingReviews: 13 } });
    const out = applyPageEstimates({ '4533279250': card('4533279250', 35.2), '1': card('1', 18) })!;
    expect(out['4533279250'].sales.monthlySales).toBe(25.6);
    expect(out['4533279250'].sales.inputs.source).toBe('listing_page');
    expect(out['1'].sales.monthlySales).toBe(18);
  });

  it('ignores estimates older than 24 hours', () => {
    __rememberPageEstimateForTest('9', { kind: 'estimated', confidence: 'low', monthlySales: 5, monthlySalesUpperBound: null, inputs: {} });
    const out = applyPageEstimates({ '9': card('9', 7) }, Date.now() + 25 * 3600_000)!;
    expect(out['9'].sales.monthlySales).toBe(7);
  });
});

import { rememberListingResult } from '@/lib/etsy/listingStats';
describe('cached listing-page answers still feed the search cards', () => {
  beforeEach(() => __clearPageEstimates());
  it('records the estimate from a listing result body', () => {
    rememberListingResult({ listingId: '42', sales: { kind: 'estimated', confidence: 'medium', monthlySales: 25.6, monthlySalesUpperBound: null, inputs: {} } });
    const out = applyPageEstimates({ '42': card('42', 35) })!;
    expect(out['42'].sales.monthlySales).toBe(25.6);
  });
});
