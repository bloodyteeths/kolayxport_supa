// Stock-managed quantities in the listings grid (M5) and BulkGrid (M7) via the batch hook (BR-11):
// which rows are marked, the read-only reasons, and the stock modal's row view.
import { describe, expect, it } from 'vitest';
import type { ListingRow } from '@/lib/listings/types';
import type { StockManagedResponse } from '@/components/stock/useStockManaged';
import { editReadOnlyReason, isStockManaged, type ListingCellContext, type ListingsT } from '@/components/domain/listings/columns';
import { stockManagedIdsOf, stockSyncApplies, withStockManaged } from '@/components/domain/listings/stockManaged';
import { planStockChanges } from '@/components/domain/listings/bulk/ChangeStockModal';
import { etsyBulkConfig } from '@/components/domain/bulk/config';
import { cellReadOnlyReason, type FieldRuleContext } from '@/components/domain/bulk/config/fields';

const t = ((key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key)) as unknown as ListingsT;

function row(over: Partial<ListingRow> = {}): ListingRow {
  return {
    id: '100',
    title: 'Box',
    metaLine: [],
    thumbUrl: null,
    price: { amount: 10, currency: 'USD' },
    qty: 5,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: null, used: 0, total: 0, fails: [] },
    updatedAt: null,
    createdAt: null,
    extra: {},
    externalUrl: null,
    sync: null,
    ...over,
  } as ListingRow;
}

const managed: StockManagedResponse = { managed: true, live: true, variants: [{ variantKey: '', canonical: 4, stockItemId: 's1', sku: 'A' }] };
const unmanaged: StockManagedResponse = { managed: false, live: true, variants: [] };

describe('stockManagedIdsOf', () => {
  const byListing = new Map<string, StockManagedResponse>([
    ['100', managed],
    ['200', unmanaged],
  ]);
  it('marks managed rows only when stock sync is live', () => {
    const rows = [row({ id: '100' }), row({ id: '200' }), row({ id: '300' })];
    expect([...stockManagedIdsOf(rows, { live: true, byListing })]).toEqual(['100']);
  });
  it('live=false (dry run) or no answer marks nothing', () => {
    expect(stockManagedIdsOf([row()], { live: false, byListing }).size).toBe(0);
    expect(stockManagedIdsOf([row()], { live: true, byListing: new Map() }).size).toBe(0);
  });
  it('matches leading-zero ids in the normalised form and keeps the row id', () => {
    expect([...stockManagedIdsOf([row({ id: '0100' })], { live: true, byListing })]).toEqual(['0100']);
  });
  it('only Etsy quantities can be stock-managed', () => {
    expect(stockSyncApplies('etsy')).toBe(true);
    expect(stockSyncApplies('ebay')).toBe(false);
    expect(stockSyncApplies('shopify')).toBe(false);
  });
});

describe('listings grid qty cell', () => {
  const ctx = {
    config: { marketplace: 'etsy', inlineEdit: { price: true, qty: true } },
    sendingIds: new Set<string>(),
    removalKind: 'delete',
    stockManagedIds: new Set(['100']),
  } as unknown as Pick<ListingCellContext, 'config' | 'sendingIds' | 'removalKind' | 'stockManagedIds'>;

  it('managed qty is read-only with the stock sync reason; price stays editable', () => {
    expect(editReadOnlyReason(row(), 'qty', t, ctx)).toBe('listings.cell.stockManaged');
    expect(editReadOnlyReason(row(), 'price', t, ctx)).toBeNull();
    expect(isStockManaged(row(), ctx)).toBe(true);
  });
  it('a send in progress still wins; unmanaged rows are unchanged', () => {
    expect(editReadOnlyReason(row(), 'qty', t, { ...ctx, sendingIds: new Set(['100']) })).toMatch(/^listings\.cell\.sending/);
    expect(editReadOnlyReason(row({ id: '200' }), 'qty', t, ctx)).toBeNull();
    expect(editReadOnlyReason(row(), 'qty', t, { ...ctx, stockManagedIds: undefined })).toBeNull();
  });
});

describe('Change stock modal rows', () => {
  it('managed rows become qty read-only and are skipped by the plan', () => {
    const ids = new Set(['100']);
    const rows = [row({ id: '100' }), row({ id: '200' })].map((r) => withStockManaged(r, ids));
    expect(rows[0].editable).toEqual({ price: true, qty: false, reason: 'stock_managed' });
    expect(rows[1]).toEqual(row({ id: '200' }));
    const plan = planStockChanges(rows, (r) => r.qty, 'set', 9);
    expect(plan.skipped).toBe(1);
    expect(plan.patches).toEqual([{ id: '200', patch: { qty: 9 } }]);
  });
  it('keeps an existing price reason (variations)', () => {
    const r = row({ editable: { price: false, qty: true, reason: 'variations' } });
    expect(withStockManaged(r, new Set(['100'])).editable).toEqual({ price: false, qty: false, reason: 'variations' });
  });
});

describe('BulkGrid qty cell', () => {
  const ctx = (over: Partial<FieldRuleContext> = {}): FieldRuleContext => ({
    config: etsyBulkConfig,
    t,
    formatMoney: (a, c) => `${c} ${a}`,
    sendingIds: new Set(),
    ...over,
  });
  it('managed qty is read-only (edit, paste and fill skip it); price is not', () => {
    const c = ctx({ stockManagedIds: new Set(['100']) });
    expect(cellReadOnlyReason(row({ qty: 7 }), 'qty', c)).toBe('listings.cell.stockManaged');
    expect(cellReadOnlyReason(row(), 'price', c)).toBeNull();
    expect(cellReadOnlyReason(row({ id: '200' }), 'qty', c)).toBeNull();
    expect(cellReadOnlyReason(row(), 'qty', ctx())).toBeNull();
  });
});
