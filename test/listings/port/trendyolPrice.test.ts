// Trendyol "Change price" moves the list price with the sale price (legacy TrendyolBulkOpsBar) and never leaves the
// sale price above the list price.
import { describe, expect, it } from 'vitest';
import { computeNewListPrice, planPriceChanges } from '@/components/domain/listings/bulk/ChangePriceModal';
import { displayListPrice } from '@/components/domain/listings/columns';
import { mergeOverlay } from '@/components/domain/listings/useStagedChanges';
import type { ListingRow } from '@/lib/listings/types';

function row(id: string, sale: number, list: number | null, sync: ListingRow['sync'] = null): ListingRow {
  return {
    id,
    title: id,
    metaLine: [],
    thumbUrl: null,
    price: { amount: sale, currency: 'TRY' },
    qty: 5,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: null, fails: [] } as unknown as ListingRow['health'],
    updatedAt: null,
    createdAt: null,
    extra: { listPrice: list },
    externalUrl: null,
    sync,
  };
}

describe('computeNewListPrice', () => {
  it('applies the same formula, floored at the new sale price', () => {
    expect(computeNewListPrice(200, 165, 'incPct', 10, 'none')).toBe(220);
    expect(computeNewListPrice(200, 135, 'decPct', 10, 'none')).toBe(180);
    expect(computeNewListPrice(100, 130, 'incAmt', 20, 'none')).toBe(130); // 120 < new sale 130
    expect(computeNewListPrice(200, 150, 'set', 150, 'none')).toBeNull(); // set keeps the list price
    expect(computeNewListPrice(200, 250, 'set', 250, 'none')).toBe(250);
    expect(computeNewListPrice(null, 100, 'incPct', 10, 'none')).toBeNull();
  });
});

describe('planPriceChanges with list price', () => {
  it('stages both prices and reports them for the preview', () => {
    const rows = [row('A', 150, 200), row('B', 100, null)];
    const plan = planPriceChanges(rows, (r) => r.price?.amount ?? null, 'incPct', 10, 'none', undefined, (r) => displayListPrice(r, new Map()));
    expect(plan.patches).toEqual([
      { id: 'A', patch: { price: 165, listPrice: 220 }, from: 150, to: 165, listFrom: 200, listTo: 220 },
      { id: 'B', patch: { price: 110 }, from: 100, to: 110 },
    ]);
  });

  it('without currentListPrice (other marketplaces) only the price is staged', () => {
    const plan = planPriceChanges([row('A', 150, 200)], (r) => r.price?.amount ?? null, 'incPct', 10, 'none');
    expect(plan.patches[0].patch).toEqual({ price: 165 });
  });

  it('a list price below the current sale price is raised even when the sale price stays', () => {
    const plan = planPriceChanges([row('A', 150, 140)], (r) => r.price?.amount ?? null, 'set', 150, 'none', undefined, (r) => displayListPrice(r, new Map()));
    expect(plan.patches).toEqual([{ id: 'A', patch: { price: 150, listPrice: 150 }, from: 150, to: 150, listFrom: 140, listTo: 150 }]);
  });
});

describe('list price overlay', () => {
  it('draft and optimistic overlays win over the live list price', () => {
    const r = row('A', 150, 200, {
      draftId: 'd', status: 'pending', changedFields: ['listPrice'], draft: { listPrice: 210 }, queuedDelete: false, scheduledSendAt: null, syncedAt: null,
    });
    expect(displayListPrice(r, new Map())).toBe(210);
    expect(displayListPrice(r, new Map([['A', { listPrice: 230 }]]))).toBe(230);
    expect(displayListPrice(row('B', 1, null), new Map())).toBeNull();
    expect(mergeOverlay({ price: 1 }, { listPrice: 5 })).toEqual({ price: 1, listPrice: 5 });
  });
});
