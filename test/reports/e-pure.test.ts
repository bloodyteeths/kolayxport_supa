// M9 Group E — pure helpers of Reports › Payouts and Reports › Transactions (finance-analytics §2.3, §3, §4.8, §6.2).
import { describe, expect, it } from 'vitest';
import fixture from '@/__tests__/fixtures/reports/transactions.json';
import {
  parseTxPage, typeOptionsFromSummary, typeFilterParam, transactionsUrl, transactionsCsvUrl, parseTypeParam,
  RAW_TYPE_PREFIX,
} from '@/lib/reports/useTransactions';
import {
  payoutBuckets, payoutRows, financeTabView, effectiveConnected, isFinanceGated, ledgerRowCount, currencySymbol,
} from '@/components/domain/reports/payouts/PayoutsReport';
import { buildTypeOptions, amountTone, isTxNeverSynced } from '@/components/domain/reports/transactions/TransactionsReport';
import { normalizeFinanceDashboard } from '@/lib/reports/useFinanceReport';

describe('parseTxPage', () => {
  it('turns Decimal strings into numbers, keeps the API category, 1-based page', () => {
    const p = parseTxPage(fixture.settlements);
    expect(p.total).toBe(1284);
    expect(p.page).toBe(1);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ id: 'tx1', amount: 49, commission: 6.37, category: 'revenue', rawType: 'Sale', currency: 'USD', orderNumber: '3891204455' });
    expect(p.rows[1]).toMatchObject({ amount: -0.2, commission: null, category: 'commission', productName: null });
    expect(p.syncCursor?.updatedAt).toBe('2026-10-15T07:42:00.000Z');
  });

  it('classifies with the shared rule when the API sends no category (pre group B)', () => {
    const p = parseTxPage({ transactions: [{ id: 'a', transactionType: 'Komisyon Faturası', amount: '-10' }, { id: 'b', transactionType: 'Disbursement', amount: '-5' }] });
    expect(p.rows.map((r) => r.category)).toEqual(['commission_invoice', 'disbursement']);
  });

  it('never crashes on an unknown shape; never-synced = null cursor', () => {
    expect(parseTxPage(null)).toMatchObject({ rows: [], total: 0, syncCursor: null });
    expect(parseTxPage(fixture.settlementsEmptyNever).syncCursor).toBeNull();
  });
});

describe('type filter', () => {
  it('options per category with summed counts, largest first; zero counts dropped', () => {
    expect(typeOptionsFromSummary(fixture.dashboard.transactionTypeSummary)).toEqual([
      { value: 'commission', count: 611 },
      { value: 'revenue', count: 603 },
      { value: 'passthrough', count: 66 },
      { value: 'disbursement', count: 4 },
    ]);
  });

  it('accepts the normalised array and classifies items without a category', () => {
    const opts = typeOptionsFromSummary([
      { type: 'Satış', count: 3, category: null },
      { type: 'Sale', count: 2, category: 'revenue' },
      { type: 'x', count: 0, category: 'other' },
    ]);
    expect(opts).toEqual([{ value: 'revenue', count: 5 }]);
  });

  it('keeps the URL value as an option even when it has no rows', () => {
    const opts = buildTypeOptions([{ type: 'Sale', count: 2, category: 'revenue' }], 'adspend', (c) => `L:${c}`);
    expect(opts).toEqual([
      { value: 'revenue', label: 'L:revenue', count: 2 },
      { value: 'adspend', label: 'L:adspend', count: 0 },
    ]);
  });

  it('maps the filter value to the API param', () => {
    expect(typeFilterParam(null)).toEqual({});
    expect(typeFilterParam('revenue')).toEqual({ category: 'revenue' });
    expect(typeFilterParam(`${RAW_TYPE_PREFIX}Satış`)).toEqual({ transactionType: 'Satış' });
    expect(typeFilterParam('bogus')).toEqual({});
    expect(parseTypeParam('all')).toBeNull();
    expect(parseTypeParam(' fees ')).toBe('fees');
  });
});

describe('settlements URLs', () => {
  const base = { mp: 'etsy' as const, from: '2026-09-01', to: '2026-09-30', tz: 'Europe/Istanbul', type: 'disbursement' };
  it('list: seller-zone days + tz, 0-based page, category', () => {
    const u = new URL(transactionsUrl({ ...base, page: 3, size: 100 }), 'https://x');
    expect(u.pathname).toBe('/api/finance/settlements');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      marketplace: 'etsy', from: '2026-09-01', to: '2026-09-30', tz: 'Europe/Istanbul', page: '2', size: '100', category: 'disbursement',
    });
  });
  it('csv: format=csv, no paging (every row in range, §6.2)', () => {
    const u = new URL(transactionsCsvUrl({ ...base, type: null }), 'https://x');
    expect(u.searchParams.get('format')).toBe('csv');
    expect(u.searchParams.has('page')).toBe(false);
    expect(u.searchParams.has('category')).toBe(false);
  });
});

describe('payouts', () => {
  const d = [
    { date: '2026-09-02', amount: 2400 },
    { date: '2026-09-09', amount: -2280 },
    { date: '2026-08-30', amount: 999 }, // outside the range
  ];
  it('daily buckets are ascending and zero-filled (B1)', () => {
    const b = payoutBuckets(d, '2026-09-01', '2026-09-10', 'day');
    expect(b).toHaveLength(10);
    expect(b[0]).toEqual({ start: '2026-09-01', amount: 0 });
    expect(b[1]).toEqual({ start: '2026-09-02', amount: 2400 });
    expect(b[8]).toEqual({ start: '2026-09-09', amount: 2280 });
    expect(b.map((x) => x.start)).toEqual([...b.map((x) => x.start)].sort());
  });
  it('weekly buckets start on Monday; monthly on the 1st; hourly reads as daily', () => {
    const w = payoutBuckets(d, '2026-09-01', '2026-09-30', 'week');
    expect(w[0]).toEqual({ start: '2026-08-31', amount: 2400 }); // Tue 1 Sep sits in the week of Mon 31 Aug
    expect(w[1]).toEqual({ start: '2026-09-07', amount: 2280 });
    expect(w.at(-1)?.start).toBe('2026-09-28');
    const m = payoutBuckets(d, '2026-07-15', '2026-09-30', 'month');
    expect(m).toEqual([
      { start: '2026-07-01', amount: 0 },
      { start: '2026-08-01', amount: 999 },
      { start: '2026-09-01', amount: 4680 },
    ]);
    expect(payoutBuckets(d, '2026-09-02', '2026-09-02', 'hour')).toEqual([{ start: '2026-09-02', amount: 2400 }]);
  });
  it('table rows are newest first with positive amounts', () => {
    expect(payoutRows(d).map((r) => [r.date, r.amount])).toEqual([['2026-09-09', 2280], ['2026-09-02', 2400], ['2026-08-30', 999]]);
  });
  it('ledger row count sums the type summary (new-transactions toast)', () => {
    expect(ledgerRowCount(normalizeFinanceDashboard(fixture.dashboard, 'etsy'))).toBe(1284);
    expect(ledgerRowCount(undefined)).toBeNull();
  });
  it('currency symbol is the narrow symbol', () => {
    expect(currencySymbol('USD', 'en-US')).toBe('$');
    expect(currencySymbol('TRY', 'tr-TR')).toBe('₺');
    expect(currencySymbol('XXX1', 'en-US')).toBe('XXX1');
  });
});

describe('view state (§3)', () => {
  const v = (o: Partial<Parameters<typeof financeTabView>[0]>) =>
    financeTabView({ gated: false, supported: true, connected: true, async: 'ready', hasData: true, neverSynced: false, ...o });
  it('precedence: gated → not supported → unknown → connect → loading/slow/error → never → ready', () => {
    expect(v({ gated: true, supported: false })).toBe('gated');
    expect(v({ supported: false, connected: undefined })).toBe('notSupported');
    expect(v({ connected: undefined })).toBe('unknown');
    expect(v({ connected: false })).toBe('connect');
    expect(v({ hasData: false, async: 'loading' })).toBe('loading');
    expect(v({ hasData: false, async: 'slow' })).toBe('slow');
    expect(v({ hasData: false, async: 'error' })).toBe('error');
    expect(v({ neverSynced: true })).toBe('never');
    expect(v({ async: 'stale' })).toBe('ready');
  });
  it('gated while the entitlement loads or the feature is locked/paused/neutral', () => {
    expect(['loading', 'locked', 'paused', 'neutral'].every(isFinanceGated)).toBe(true);
    expect(['allowed', 'trial', 'unknown'].some(isFinanceGated)).toBe(false);
  });
  it('a failed connections endpoint renders the report (the API decides), never an endless skeleton', () => {
    expect(effectiveConnected(undefined, { connections: null, error: new Error('x') })).toBe(true);
    expect(effectiveConnected(undefined, { connections: null })).toBeUndefined();
    expect(effectiveConnected(false, { connections: {} })).toBe(false);
  });
  it('transactions: never synced only without cursor, rows and filter', () => {
    const empty = parseTxPage(fixture.settlementsEmptyNever);
    expect(isTxNeverSynced(empty, null)).toBe(true);
    expect(isTxNeverSynced(empty, 'revenue')).toBe(false);
    expect(isTxNeverSynced(parseTxPage(fixture.settlements), null)).toBe(false);
    expect(isTxNeverSynced(undefined, null)).toBe(false);
  });
  it('amount tone: text only, success / danger / neutral', () => {
    expect([amountTone(49), amountTone(-0.2), amountTone(0)]).toEqual(['success', 'danger', 'neutral']);
  });
});
