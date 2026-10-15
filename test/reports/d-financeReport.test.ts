// M9 Group D: Profit data layer (lib/reports/useFinanceReport.ts) — response normalisation (group B shape and the
// legacy shape), KPI maths (B10 "tile = P&L line"), P&L lines, the §4.1 primary, the §3 view precedence, staleness,
// the dashboard query (local days + tz, B13) and the CSV blocks.
import { describe, expect, it } from 'vitest';
import fixture from '../../__tests__/fixtures/reports/finance-dashboard.json';
import {
  costsOf, financeDashboardUrl, financeKpis, isFinanceKey, isFinanceRangeEmpty, isFinanceStale, isNeverSynced,
  ledgerRowCount, netSalesOf, normalizeFinanceDashboard, ownDashboard, reconcileCoverage, profitCsvBlocks, profitPrimary, profitStatement, profitView, relDelta, syncWindow,
  type FinanceDashboard,
} from '@/lib/reports/useFinanceReport';

const d = (): FinanceDashboard => normalizeFinanceDashboard(JSON.parse(JSON.stringify(fixture)), 'etsy');

describe('normalizeFinanceDashboard', () => {
  it('reads the group B shape', () => {
    const x = d();
    expect(x.summary.currency).toBe('USD');
    expect(x.previousSummary?.grossRevenue).toBe(13500);
    expect(x.lastSyncedAt).toBe('2026-10-15T07:00:00.000Z');
    expect(x.costCoverage).toEqual({ products: 32, productsWithCost: 18, productsWithoutCost: 14, unitsWithoutCost: 210 });
    expect(x.cogsExcluded).toEqual([{ currency: 'GBP', products: 2 }]);
    expect(x.cogsUnverified).toEqual([]);
    expect(x.ledgerConverted).toEqual([]);
    expect(x.ledgerExcluded).toEqual([]);
    expect(x.transactionTypeSummary.find((t) => t.type === 'EtsyFee')).toEqual({ type: 'EtsyFee', total: -2104.22, count: 611, category: 'commission' });
  });

  it('reads the currency notes (unverified TRY costs, converted / left-out ledger rows) and drops empty ones', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.cogsUnverified = [{ currency: 'TRY', products: 3 }, { currency: '', products: 1 }];
    raw.ledgerConverted = [{ currency: 'CAD', rows: 4 }];
    raw.ledgerExcluded = [{ currency: 'MXN', rows: 0 }, { currency: 'BRL', rows: 2 }];
    const x = normalizeFinanceDashboard(raw, 'amazon');
    expect(x.cogsUnverified).toEqual([{ currency: 'TRY', products: 3 }]);
    expect(x.ledgerConverted).toEqual([{ currency: 'CAD', rows: 4 }]);
    expect(x.ledgerExcluded).toEqual([{ currency: 'BRL', rows: 2 }]);
  });

  it('unit cost 0 with no COGS reads as "no cost saved"; a real cost stays', () => {
    const rows = d().productBreakdown;
    expect(rows.find((r) => r.barcode === 'NN-G')?.unitCost).toBeNull();
    expect(rows.find((r) => r.barcode === 'BB-01')?.unitCost).toBe(11.5);
    expect(rows.find((r) => r.sku === 'SKU-ONLY')?.key).toBe('SKU-ONLY');
    expect(rows.find((r) => r.barcode === 'WKB-1')?.margin).toBeCloseTo(-64 / 480);
  });

  it('keeps the comparison window the server used (previous.from/to), e.g. Oct 1–15 is compared with Sep 16–30', () => {
    expect(d().previousWindow).toEqual({ from: '2026-08-02', to: '2026-08-31' }); // Sep 1–30 → Aug 2–31, not Aug 1–31
    const raw = {
      summary: {}, from: '2026-10-01', to: '2026-10-15', previousSummary: { grossRevenue: 5 },
      previous: { startDate: '2026-09-15T21:00:00.000Z', endDate: '2026-09-30T20:59:59.999Z', from: '2026-09-16', to: '2026-09-30' },
    };
    expect(normalizeFinanceDashboard(raw, 'etsy').previousWindow).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    // Not reported (legacy) or malformed → null (the client window is the fallback).
    expect(normalizeFinanceDashboard({ summary: {}, previousSummary: {} }, 'etsy').previousWindow).toBeNull();
    expect(normalizeFinanceDashboard({ summary: {}, previousSummary: {}, previous: { from: '2026-09-30', to: '2026-09-16' } }, 'etsy').previousWindow).toBeNull();
  });

  it('coverage agrees with the rows: a saved cost of 0 shows "Add cost" and counts as missing', () => {
    const rows = d().productBreakdown;
    // Rows agree with the server (1 of 3 missing): unchanged counts, units at least the missing rows' units.
    const cov = reconcileCoverage({ products: 3, productsWithCost: 2, productsWithoutCost: 1, unitsWithoutCost: 6 }, rows.slice(0, 3));
    // Server says 2 of 3 covered, but two sold rows show "Add cost" (one has a saved cost of 0) → 1 of 3.
    const two = reconcileCoverage({ products: 3, productsWithCost: 2, productsWithoutCost: 1, unitsWithoutCost: 6 }, [...rows.slice(0, 3), rows[3]]);
    expect(two).toEqual({ products: 3, productsWithCost: 1, productsWithoutCost: 2, unitsWithoutCost: 70 });
    expect(cov).toEqual({ products: 3, productsWithCost: 2, productsWithoutCost: 1, unitsWithoutCost: 64 });
  });

  it('sorts buckets ascending (B1) and derives net sales per bucket', () => {
    const raw = { summary: {}, timeSeries: [{ period: '2026-09-03', revenue: 10, returns: 1 }, { period: '2026-09-01', revenue: 5 }] };
    const x = normalizeFinanceDashboard(raw, 'etsy');
    expect(x.timeSeries.map((p) => p.period)).toEqual(['2026-09-01', '2026-09-03']);
    expect(x.timeSeries[1].netSales).toBe(9);
  });

  it('tolerates the legacy shape: no currency, no cursor field, no coverage', () => {
    const legacy = {
      summary: { grossRevenue: 100, balanceCurrency: null },
      productBreakdown: [{ barcode: 'A', productName: 'A', revenue: 50, unitCost: 2, cogs: 4 }, { barcode: 'B', productName: 'B', revenue: 50, unitCost: 0, cogs: 0 }],
      transactionTypeSummary: { Satış: { count: 2, total: 100 } },
    };
    const tr = normalizeFinanceDashboard(legacy, 'trendyol');
    expect(tr.summary.currency).toBe('TRY');
    expect(tr.lastSyncedAt).toBeUndefined();
    expect(tr.costCoverage).toMatchObject({ products: 2, productsWithCost: 1, productsWithoutCost: 1 });
    expect(normalizeFinanceDashboard(legacy, 'etsy').summary.currency).toBe('USD');
  });
});

describe('KPIs and P&L', () => {
  it('net profit tile = P&L net line = summary (B10); fees and costs share of net sales', () => {
    const x = d();
    const k = financeKpis(x.summary, x.previousSummary);
    const lines = profitStatement(x.summary);
    expect(k.netProfit).toBe(8308.18);
    expect(lines.at(-1)).toMatchObject({ key: 'net', amount: 8308.18 });
    const sum = lines.slice(0, -1).reduce((a, l) => a + l.amount, 0);
    expect(sum).toBeCloseTo(8308.18, 2);
    expect(k.netSales).toBeCloseTo(14212.3, 2);
    expect(k.costs).toBeCloseTo(5904.12, 2);
    expect(k.costsShare).toBeCloseTo(5904.12 / 14212.3, 4);
    expect(netSalesOf(x.summary)).toBeCloseTo(14212.3, 2);
    expect(costsOf(x.summary)).toBeCloseTo(5904.12, 2);
  });

  it('cost lines are negative, shares are of gross sales, gross is 100 %', () => {
    const lines = profitStatement(d().summary);
    expect(lines[0]).toMatchObject({ key: 'gross', share: 1 });
    const fees = lines.find((l) => l.key === 'fees');
    expect(fees?.amount).toBe(-2104.22);
    expect(fees?.share).toBeCloseTo(2104.22 / 14820.4);
    expect(lines.find((l) => l.key === 'discounts')?.amount).toBe(0);
  });

  it('deltas: relative, null without a baseline (B4), margin in points', () => {
    const x = d();
    const k = financeKpis(x.summary, x.previousSummary);
    expect(k.deltas.netProfit).toBeCloseTo((8308.18 - 7470) / 7470);
    expect(k.deltas.marginPts).toBe(-2.1);
    expect(financeKpis(x.summary, null).deltas).toEqual({ netSales: null, costs: null, netProfit: null, marginPts: null });
    expect(relDelta(5, 0)).toBeNull();
  });
});

describe('primary, view and freshness', () => {
  it('primary: Add product costs while costs are missing, else Export CSV; none while never synced', () => {
    const x = d();
    expect(profitPrimary(x)).toBe('addCosts');
    expect(profitPrimary({ ...x, costCoverage: { ...x.costCoverage, productsWithoutCost: 0 } })).toBe('export');
    const never = normalizeFinanceDashboard({ summary: {}, lastSyncedAt: null }, 'etsy');
    expect(isNeverSynced(never)).toBe(true);
    expect(profitPrimary(never)).toBeNull();
  });

  it('never synced needs an explicit null cursor; an unknown cursor is just an empty range', () => {
    const unknown = normalizeFinanceDashboard({ summary: {} }, 'etsy');
    expect(isNeverSynced(unknown)).toBe(false);
    expect(isFinanceRangeEmpty(unknown)).toBe(true);
    const zeroFilled = normalizeFinanceDashboard({ summary: {}, lastSyncedAt: '2026-10-01T00:00:00Z', timeSeries: [{ period: '2026-09-01' }] }, 'etsy');
    expect(isFinanceRangeEmpty(zeroFilled)).toBe(true);
    expect(isNeverSynced(zeroFilled)).toBe(false);
  });

  it('view precedence', () => {
    const base = { gated: false, supported: true, connected: true as boolean | undefined, async: 'ready' as const, data: d() };
    expect(profitView({ ...base, gated: true })).toBe('gated');
    expect(profitView({ ...base, accessLoading: true })).toBe('unknown');
    expect(profitView({ ...base, supported: false })).toBe('notSupported');
    expect(profitView({ ...base, connected: false })).toBe('connect');
    expect(profitView({ ...base, connected: undefined })).toBe('unknown');
    expect(profitView({ ...base, async: 'error', data: undefined })).toBe('error');
    expect(profitView({ ...base, async: 'loading', data: undefined })).toBe('loading');
    expect(profitView({ ...base, async: 'slow', data: undefined })).toBe('slow');
    expect(profitView({ ...base, data: normalizeFinanceDashboard({ summary: {}, lastSyncedAt: null }, 'etsy') })).toBe('never');
    expect(profitView({ ...base, data: normalizeFinanceDashboard({ summary: {}, lastSyncedAt: '2026-10-01T00:00:00Z' }, 'etsy') })).toBe('empty');
    expect(profitView(base)).toBe('ready');
    expect(profitView({ ...base, async: 'stale' })).toBe('ready');
  });

  it('a previous response for another marketplace is not this marketplace\'s data', () => {
    const etsy = d();
    expect(ownDashboard(etsy, 'etsy')).toBe(etsy);
    expect(ownDashboard(etsy, 'trendyol')).toBeUndefined();
    expect(ownDashboard(undefined, 'etsy')).toBeUndefined();
    // With no own data the view is a skeleton (never Etsy numbers under the Trendyol meta, never 'stale').
    const base = { gated: false, supported: true, connected: true as boolean | undefined };
    expect(profitView({ ...base, async: 'loading', data: ownDashboard(etsy, 'trendyol') })).toBe('loading');
    expect(profitView({ ...base, async: 'error', data: ownDashboard(etsy, 'trendyol') })).toBe('error');
  });

  it('ledgerRowCount sums the per-type counts (the "N new" toast delta)', () => {
    expect(ledgerRowCount(undefined)).toBeNull();
    const x = d();
    expect(ledgerRowCount(x)).toBe(x.transactionTypeSummary.reduce((n, t) => n + t.count, 0));
  });

  it('stale after 12h', () => {
    const now = new Date('2026-10-15T20:00:00Z');
    expect(isFinanceStale('2026-10-15T07:00:00Z', now)).toBe(true);
    expect(isFinanceStale('2026-10-15T09:00:00Z', now)).toBe(false);
    expect(isFinanceStale(null, now)).toBe(false);
  });
});

describe('requests', () => {
  it('dashboard query sends local days + tz + compare (never toISOString days)', () => {
    const url = new URL(financeDashboardUrl({ mp: 'etsy', from: '2026-09-01', to: '2026-09-30', tz: 'Europe/Istanbul' }), 'http://x');
    expect(url.pathname).toBe('/api/finance/dashboard');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      marketplace: 'etsy', from: '2026-09-01', to: '2026-09-30', tz: 'Europe/Istanbul', granularity: 'day', compare: 'previous',
    });
    expect(isFinanceKey(url.pathname + url.search)).toBe(true);
    expect(isFinanceKey('/api/finance/settlements?page=0')).toBe(true);
    expect(isFinanceKey('/api/analytics')).toBe(false);
  });

  it('sync window covers every timezone of the local days, capped at now', () => {
    const w = syncWindow('2026-09-01', '2026-09-30', new Date('2026-12-01T00:00:00Z'));
    expect(w.startDate).toBe(Date.UTC(2026, 7, 31));
    expect(w.endDate).toBe(Date.UTC(2026, 9, 2) - 1);
    const capped = syncWindow('2026-10-01', '2026-10-15', new Date('2026-10-15T09:00:00Z'));
    expect(capped.endDate).toBe(Date.parse('2026-10-15T09:00:00Z'));
  });
});

describe('profitCsvBlocks', () => {
  it('P&L lines and product rows with raw numbers and a currency column', () => {
    const blocks = profitCsvBlocks(d(), {
      statementTitle: 'Profit and loss', productsTitle: 'Profit by product', line: 'Line', amount: 'Amount', share: 'Share',
      currency: 'Currency', product: 'Product', code: 'Barcode or SKU', sold: 'Sold', returned: 'Returned', revenue: 'Revenue',
      fees: 'Fees', shipping: 'Shipping', unitCost: 'Unit cost', profit: 'Profit', margin: 'Margin', lineLabel: (k) => k,
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].rows[0]).toEqual(['gross', 14820.4, 1, 'USD']);
    expect(blocks[0].rows.at(-1)).toEqual(['net', 8308.18, 8308.18 / 14820.4, 'USD']);
    const nn = blocks[1].rows.find((r) => r[0] === 'Name Necklace Gold');
    expect(nn?.[7]).toBeNull();
    expect(nn?.at(-1)).toBe('USD');
  });
});
