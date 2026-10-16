import { describe, expect, it } from 'vitest';
import { quickCostItems, quickCostRows } from '@/components/domain/reports/profit/QuickCostsPanel';
import type { FinanceProductRow } from '@/lib/reports/useFinanceReport';

const row = (p: Partial<FinanceProductRow>): FinanceProductRow => ({
  key: p.key ?? 'k', barcode: null, sku: null, productName: 'P', revenue: 0, quantity: 0, returnedQuantity: 0,
  commissions: 0, shipping: 0, cogs: 0, unitCost: null, netProfit: 0, margin: null, ...p,
});

describe('quick costs', () => {
  const rows = [
    row({ key: 'a', sku: 'A', quantity: 2 }),
    row({ key: 'b', barcode: 'B', quantity: 9 }),
    row({ key: 'c', sku: 'C', quantity: 5, unitCost: 3 }),
    row({ key: 'd', quantity: 50 }), // no code: cannot be matched, never listed
  ];
  it('missing first by best sellers, focus row first, uncoded rows left out', () => {
    expect(quickCostRows(rows, 'missing').map((r) => r.key)).toEqual(['b', 'a']);
    expect(quickCostRows(rows, 'all', 'a').map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });
  it('saves only new or changed costs, in the report currency, keyed by barcode or SKU', () => {
    const items = quickCostItems(rows, { a: 4, b: null, c: 3 }, 'USD');
    expect(items).toEqual([{ productName: 'P', barcode: 'A', costAmount: 4, costCurrency: 'USD', shippingCost: null, notes: null }]);
  });
});
