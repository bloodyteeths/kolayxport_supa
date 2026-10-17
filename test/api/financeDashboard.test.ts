/**
 * M9 group B — finance API (finance-analytics §6.2, B2/B8/B10/B11/B12).
 * Covers lib/finance/periods.ts, lib/finance/classifyTransaction.ts,
 * GET /api/finance/dashboard and GET /api/finance/settlements (category + format=csv).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
const db: { txs: Row[]; orders: Row[]; costs: Row[]; cursor: Row | null; shops: Row[] } = {
  txs: [],
  orders: [],
  costs: [],
  cursor: null,
  shops: [],
};
const orderWheres: any[] = [];

function inRange(d: Date, r: { gte?: Date; lte?: Date } | undefined) {
  if (!r) return true;
  return (!r.gte || d >= r.gte) && (!r.lte || d <= r.lte);
}
function txMatch(t: Row, where: any) {
  if (where.userId && t.userId !== where.userId) return false;
  if (where.marketplace && t.marketplace !== where.marketplace) return false;
  if (!inRange(t.transactionDate, where.transactionDate)) return false;
  const tt = where.transactionType;
  if (typeof tt === 'string' && t.transactionType !== tt) return false;
  if (tt && typeof tt === 'object' && Array.isArray(tt.in) && !tt.in.includes(t.transactionType)) return false;
  return true;
}

const authUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/finance/financialAutoSync', () => ({ refreshFinancialsIfStale: vi.fn(async () => undefined) }));
const featureLocked = { value: false };
vi.mock('@/lib/billing/requireFeature', () => ({
  requireFeature: async (_userId: string, feature: string) => {
    if (featureLocked.value) {
      const err: any = new Error('locked');
      err.name = 'FeatureLockedError';
      err.body = () => ({ error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature, neutral: false });
      throw err;
    }
  },
  isFeatureLockedError: (err: any) => err?.name === 'FeatureLockedError',
}));
vi.mock('@/lib/fx', async (orig) => {
  const actual: any = await orig();
  // TRY per unit: 1 USD = 40 TRY, 1 GBP = 50 TRY. No EUR / CAD rate on purpose (exclusion paths).
  return { ...actual, getExchangeRates: vi.fn(async () => ({ rates: { TRY: 1, USD: 40, GBP: 50 }, stale: false, asOf: 1 })) };
});
vi.mock('@/lib/prisma', () => {
  const financialTransaction = {
    findMany: vi.fn(async (args: any) => {
      let rows = db.txs.filter((t) => txMatch(t, args.where || {}));
      const ob = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
      if (ob?.transactionDate === 'desc') rows = [...rows].sort((a, b) => b.transactionDate - a.transactionDate || (a.id < b.id ? 1 : -1));
      else rows = [...rows].sort((a, b) => a.transactionDate - b.transactionDate);
      if (args.cursor) {
        const i = rows.findIndex((r) => r.id === args.cursor.id);
        rows = rows.slice(i + (args.skip || 0));
      } else if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows;
    }),
    count: vi.fn(async (args: any) => db.txs.filter((t) => txMatch(t, args.where || {})).length),
    groupBy: vi.fn(async (args: any) => {
      const types = new Set(db.txs.filter((t) => txMatch(t, args.where || {})).map((t) => t.transactionType));
      return [...types].map((transactionType) => ({ transactionType }));
    }),
  };
  return {
    default: {
      financialTransaction,
      order: {
        findMany: vi.fn(async (args: any) => {
          orderWheres.push(args.where);
          const range = args.where.AND[0].OR[0].uiOrderDate;
          // Marketplace filter intentionally ignored: the handler must post-filter with canonicalStore.
          return db.orders.filter((o) => inRange(o.uiOrderDate ?? o.createdAt, range));
        }),
      },
      productCost: { findMany: vi.fn(async () => db.costs) },
      financialSyncCursor: { findUnique: vi.fn(async () => db.cursor) },
      etsyShop: { findMany: vi.fn(async () => db.shops) },
    },
  };
});

import {
  addDays,
  bucketKey,
  bucketKeys,
  daysInclusive,
  mondayOf,
  parseDateKey,
  parseTz,
  previousKeys,
  windowFromKeys,
  zonedMidnight,
} from '@/lib/finance/periods';
import { classifyTransactionType, rawTypesForCategory, isTransactionCategory } from '@/lib/finance/classifyTransaction';
import dashboardHandler, { pickDashboardCurrency } from '@/pages/api/finance/dashboard';
import settlementsHandler, { csvCell, csvDecimal } from '@/pages/api/finance/settlements';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string>, chunks: [] as string[], ended: false };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.write = (s: string) => { res.chunks.push(s); return true; };
  res.end = () => { res.ended = true; return res; };
  return res;
}
async function call(handler: any, query: Record<string, string>, method = 'GET') {
  const res = mockRes();
  await handler({ method, headers: {}, query, body: {} } as any, res);
  return res;
}

const IST = 'Europe/Istanbul';

describe('lib/finance/periods', () => {
  it('an Istanbul order at 00:30 on 1 Oct is in the 1 Oct bucket and in "This month" (B2/B13)', () => {
    const at = new Date('2026-09-30T21:30:00Z');
    expect(bucketKey(at, 'day', IST)).toBe('2026-10-01');
    expect(bucketKey(at, 'month', IST)).toBe('2026-10');
    expect(bucketKey(at, 'hour', IST)).toBe('2026-10-01T00');
    const w = windowFromKeys('2026-10-01', '2026-10-31', IST)!;
    expect(w.start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-31T20:59:59.999Z');
    expect(at >= w.start && at <= w.end).toBe(true);
  });

  it('zero-fills ascending buckets, Monday weeks, months', () => {
    const w = windowFromKeys('2026-10-01', '2026-10-05', IST)!;
    expect(bucketKeys(w.start, w.end, 'day', IST)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    // 1 Oct 2026 is a Thursday → week of Mon 28 Sep; 5 Oct is a Monday.
    expect(bucketKeys(w.start, w.end, 'week', IST)).toEqual(['2026-09-28', '2026-10-05']);
    expect(mondayOf('2026-10-04')).toBe('2026-09-28');
    const y = windowFromKeys('2026-01-15', '2026-03-02', IST)!;
    expect(bucketKeys(y.start, y.end, 'month', IST)).toEqual(['2026-01', '2026-02', '2026-03']);
    const d = windowFromKeys('2026-10-01', '2026-10-01', IST)!;
    const hours = bucketKeys(d.start, d.end, 'hour', IST)!;
    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe('2026-10-01T00');
    expect(hours[23]).toBe('2026-10-01T23');
  });

  it('handles a DST day (America/New_York, 1 Nov 2026 has 25 hours → 24 distinct keys)', () => {
    const tz = 'America/New_York';
    const w = windowFromKeys('2026-11-01', '2026-11-01', tz)!;
    expect(w.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
    expect(bucketKeys(w.start, w.end, 'hour', tz)).toHaveLength(24);
    expect(zonedMidnight('2026-03-08', tz).toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('previous window has the same day count; caps buckets; validates input', () => {
    expect(previousKeys('2026-10-01', '2026-10-31')).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(previousKeys('2026-10-15', '2026-10-15')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(daysInclusive('2026-02-01', '2026-03-01')).toBe(29);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(windowFromKeys('2026-10-05', '2026-10-01', IST)).toBeNull();
    const big = windowFromKeys('2020-01-01', '2026-01-01', IST)!;
    expect(bucketKeys(big.start, big.end, 'hour', IST)).toBeNull();
    expect(parseTz('Not/AZone')).toBe(IST);
    expect(parseTz('UTC')).toBe('UTC');
  });
});

describe('lib/finance/classifyTransaction', () => {
  it('keeps the moved rules', () => {
    expect(classifyTransactionType('Satış')).toBe('revenue');
    expect(classifyTransactionType('Komisyon Faturası')).toBe('commission_invoice');
    expect(classifyTransactionType('İndirim İptal')).toBe('discount');
    expect(classifyTransactionType('EtsyFee')).toBe('commission');
    expect(classifyTransactionType('Disbursement')).toBe('disbursement');
    expect(classifyTransactionType('SalesTax')).toBe('passthrough');
    expect(classifyTransactionType('Offsite Ads')).toBe('adspend');
    expect(classifyTransactionType('AmazonOther')).toBe('fees');
    expect(classifyTransactionType('E-ticaret Stopajı')).toBe('fees');
    expect(classifyTransactionType('')).toBe('other');
  });
  it('rawTypesForCategory / isTransactionCategory', () => {
    expect(rawTypesForCategory(['Sale', 'Refund', 'Satış', 'EtsyFee'], 'revenue')).toEqual(['Sale', 'Satış']);
    expect(isTransactionCategory('return')).toBe(true);
    expect(isTransactionCategory('nope')).toBe(false);
  });
});

describe('pickDashboardCurrency (B12)', () => {
  it('trendyol → TRY, cursor → balance currency, else most frequent ledger currency', () => {
    expect(pickDashboardCurrency('trendyol', 'USD', ['USD'])).toBe('TRY');
    expect(pickDashboardCurrency('etsy', 'eur', ['USD'])).toBe('EUR');
    expect(pickDashboardCurrency('ebay', null, ['USD', 'GBP', 'GBP'])).toBe('GBP');
    expect(pickDashboardCurrency('amazon', null, [])).toBe('USD');
  });
});

let seq = 0;
const tx = (o: Partial<Row>): Row => ({
  id: `t${++seq}`,
  userId: 'u1',
  marketplace: 'etsy',
  orderNumber: null,
  barcode: null,
  productName: null,
  quantity: 1,
  commission: null,
  shippingAmount: null,
  currency: 'USD',
  ...o,
  transactionDate: new Date(o.transactionDate as any),
});

function seedEtsy() {
  seq = 0;
  db.txs = [
    // 00:30 Istanbul on 1 Oct
    tx({ transactionType: 'Sale', transactionDate: '2026-09-30T21:30:00Z', amount: 100, commission: 6.5, barcode: 'L1', productName: 'Box', quantity: 2, orderNumber: 'O1' }),
    tx({ transactionType: 'EtsyFee', transactionDate: '2026-10-02T10:00:00Z', amount: -3.25 }),
    tx({ transactionType: 'Offsite Ads', transactionDate: '2026-10-02T11:00:00Z', amount: -5 }),
    tx({ transactionType: 'Sale', transactionDate: '2026-10-02T12:00:00Z', amount: 10 }),
    tx({ transactionType: 'Refund', transactionDate: '2026-10-03T08:00:00Z', amount: -40, barcode: 'L1', quantity: 1, orderNumber: 'O1' }),
    tx({ transactionType: 'Disbursement', transactionDate: '2026-10-03T09:00:00Z', amount: -50 }),
    tx({ transactionType: 'Sale', transactionDate: '2026-10-03T10:00:00Z', amount: 20, barcode: 'L2', productName: 'Ring, "gold"' }),
    // previous window (28–30 Sep)
    tx({ transactionType: 'Sale', transactionDate: '2026-09-29T12:00:00Z', amount: 30, barcode: 'L1', quantity: 1 }),
  ];
  db.costs = [
    { barcode: 'L1', sku: 'SKU-1', costAmount: 4, shippingCost: 0.8, costCurrency: 'GBP' }, // → $5 + $1
    { barcode: 'L2', sku: null, costAmount: 10, shippingCost: null, costCurrency: 'EUR' }, // no EUR rate → excluded
  ];
  db.orders = [
    { id: 'a', marketplace: 'BelleCoutureGifts', status: 'paid', totalPrice: 100, manualShippingCost: 80, manualShippingCostCurrency: 'TRY', uiOrderDate: new Date('2026-10-01T05:00:00Z'), createdAt: new Date('2026-10-01T05:00:00Z') },
    { id: 'b', marketplace: 'Amazon', status: 'paid', totalPrice: 999, manualShippingCost: null, manualShippingCostCurrency: null, uiOrderDate: new Date('2026-10-02T05:00:00Z'), createdAt: new Date('2026-10-02T05:00:00Z') },
    { id: 'c', marketplace: 'Etsy', status: 'cancelled', totalPrice: 40, manualShippingCost: null, manualShippingCostCurrency: null, uiOrderDate: null, createdAt: new Date('2026-10-02T05:00:00Z') },
  ];
  db.cursor = { currentBalance: 12.5, balanceCurrency: 'USD', heldFunds: null, updatedAt: new Date('2026-10-03T12:00:00Z') };
  db.shops = [{ shopName: 'BelleCoutureGifts' }];
}

describe('GET /api/finance/dashboard', () => {
  beforeEach(() => {
    authUser.mockResolvedValue({ id: 'u1' });
    orderWheres.length = 0;
    seedEtsy();
  });

  it('answers 402 featureLocked when the plan has no financials (Pro feature, server-side)', async () => {
    featureLocked.value = true;
    try {
      const res = await call(dashboardHandler, { marketplace: 'etsy', from: '2026-10-01', to: '2026-10-03', tz: IST, granularity: 'day' });
      expect(res.statusCode).toBe(402);
      expect(res.body).toMatchObject({ reason: 'featureLocked', feature: 'financials' });
    } finally {
      featureLocked.value = false;
    }
  });

  it('builds the §6.2 shape: currency, lastSyncedAt, converted COGS, coverage, buckets = summary (B10/B11/B12)', async () => {
    const res = await call(dashboardHandler, { marketplace: 'etsy', from: '2026-10-01', to: '2026-10-03', tz: IST, granularity: 'day', compare: 'previous' });
    expect(res.statusCode).toBe(200);
    const b = res.body;
    expect(b.from).toBe('2026-10-01');
    expect(b.tz).toBe(IST);
    expect(b.granularity).toBe('day');
    expect(b.lastSyncedAt).toBe('2026-10-03T12:00:00.000Z');

    const s = b.summary;
    expect(s.currency).toBe('USD');
    expect(s.grossRevenue).toBe(130);
    expect(s.commissions).toBe(9.75);
    expect(s.shipping).toBe(2); // ₺80 manual label cost → $2
    expect(s.returns).toBe(40);
    expect(s.adSpend).toBe(5);
    expect(s.cogs).toBe(6); // 2 × $6 − 1 × $6 (return)
    expect(s.netProfit).toBe(67.25);
    expect(s.margin).toBe(51.73);
    expect(s.orderCount).toBe(3);
    expect(s.returnCount).toBe(1);
    expect(s.banked).toBe(50);
    expect(s.currentBalance).toBe(12.5);
    // Shop-name order counted as Etsy, "Amazon" row dropped, cancelled Etsy order counted as refunded.
    expect(s.totalOrderCount).toBe(1);
    expect(s.totalOrderRevenue).toBe(100);
    expect(s.pendingCancellationCount).toBe(0);
    expect(JSON.stringify(orderWheres[0].OR)).toContain('BelleCoutureGifts');

    expect(b.timeSeries.map((p: any) => p.period)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(b.timeSeries[0]).toMatchObject({ revenue: 100, commissions: 6.5, shipping: 2, cogs: 12, netProfit: 79.5 });
    expect(b.timeSeries[1]).toMatchObject({ revenue: 10, adSpend: 5, discounts: 0, otherFees: 0, netProfit: 1.75 });
    const bucketSum = b.timeSeries.reduce((a: number, p: any) => a + Math.round(p.netProfit * 100), 0) / 100;
    expect(bucketSum).toBe(s.netProfit);

    expect(b.costCoverage).toEqual({ products: 2, productsWithCost: 1, unitsWithoutCost: 2 });
    expect(b.cogsExcluded).toEqual([{ currency: 'EUR', products: 1 }]);
    expect(b.cogsUnverified).toEqual([]);
    expect(b.ledgerConverted).toEqual([]);
    expect(b.ledgerExcluded).toEqual([]);
    const l1 = b.productBreakdown.find((p: any) => p.barcode === 'L1');
    expect(l1).toMatchObject({ sku: 'SKU-1', unitCost: 5, quantity: 2, returnedQuantity: 1, cogs: 6 });
    expect(b.transactionTypeSummary.Refund).toMatchObject({ count: 1, total: -40, category: 'return' });
    expect(b.disbursements).toEqual([{ date: '2026-10-03', amount: 50 }]);

    expect(b.previous).toMatchObject({ from: '2026-09-28', to: '2026-09-30' });
    expect(b.previousSummary).toMatchObject({ currency: 'USD', grossRevenue: 30, cogs: 6, netProfit: 24 });
    expect(b.previousSummary).not.toHaveProperty('banked');
    expect(b.previousSummary).not.toHaveProperty('currentBalance');
  });

  it('keeps the legacy call working (startDate/endDate, groupBy, no compare)', async () => {
    const res = await call(dashboardHandler, { marketplace: 'etsy', startDate: '2026-09-01', endDate: '2026-10-31', groupBy: 'month' });
    expect(res.statusCode).toBe(200);
    expect(res.body.groupBy).toBe('month');
    expect(res.body.timeSeries.map((p: any) => p.period)).toEqual(['2026-09', '2026-10']);
    expect(res.body.previousSummary).toBeUndefined();
    expect(res.body.summary.grossRevenue).toBe(160);
  });

  it('a TRY cost on a non-Trendyol tab is not trusted: used as is (legacy) and counted, never shrunk 40x', async () => {
    // Legacy bulk import saved every row as TRY whatever the tab (B15); the amount was typed in dollars.
    db.costs = [{ barcode: 'L1', sku: 'SKU-1', costAmount: 5, shippingCost: 1, costCurrency: 'TRY' }];
    const res = await call(dashboardHandler, { marketplace: 'etsy', from: '2026-10-01', to: '2026-10-03', tz: IST, granularity: 'day' });
    expect(res.body.summary.cogs).toBe(6); // 2 × $6 − 1 × $6, not 2 × $0.15 − …
    expect(res.body.cogsUnverified).toEqual([{ currency: 'TRY', products: 1 }]);
    expect(res.body.cogsExcluded).toEqual([]);
  });

  it('TRY costs on the Trendyol tab are the dashboard currency (no conversion, not unverified)', async () => {
    db.txs = [tx({ marketplace: 'trendyol', transactionType: 'Satış', transactionDate: '2026-10-02T09:00:00Z', amount: 500, barcode: 'B1', currency: 'TRY' })];
    db.costs = [{ barcode: 'B1', sku: null, costAmount: 200, shippingCost: null, costCurrency: 'TRY' }];
    db.cursor = null;
    const res = await call(dashboardHandler, { marketplace: 'trendyol', from: '2026-10-01', to: '2026-10-03', tz: IST, granularity: 'day' });
    expect(res.body.summary.currency).toBe('TRY');
    expect(res.body.summary.cogs).toBe(200);
    expect(res.body.cogsUnverified).toEqual([]);
  });

  it('never sums ledger rows across currencies: converts with a rate (≈), leaves out and counts without one', async () => {
    db.txs.push(
      tx({ transactionType: 'Sale', transactionDate: '2026-10-02T13:00:00Z', amount: 400, currency: 'TRY' }), // → $10
      tx({ transactionType: 'Sale', transactionDate: '2026-10-02T14:00:00Z', amount: 1000, currency: 'CAD' }), // no rate
      tx({ transactionType: 'Sale', transactionDate: '2026-10-02T15:00:00Z', amount: 999, currency: 'CAD' }),
    );
    const res = await call(dashboardHandler, { marketplace: 'etsy', from: '2026-10-01', to: '2026-10-03', tz: IST, granularity: 'day' });
    const b = res.body;
    expect(b.summary.currency).toBe('USD');
    expect(b.summary.grossRevenue).toBe(140); // 130 + $10, CAD left out
    expect(b.ledgerConverted).toEqual([{ currency: 'TRY', rows: 1 }]);
    expect(b.ledgerExcluded).toEqual([{ currency: 'CAD', rows: 2 }]);
    expect(b.transactionTypeSummary.Sale.total).toBe(140);
    const bucketRevenue = b.timeSeries.reduce((a: number, p: any) => a + p.revenue, 0);
    expect(bucketRevenue).toBe(140);
  });

  it('an Etsy shop whose name contains "amazon" stays out of the Amazon tab (B8)', async () => {
    db.shops = [{ shopName: 'AmazonGrace Studio' }];
    db.txs = [];
    db.cursor = null;
    db.orders = [
      { id: 'e', marketplace: 'AmazonGrace Studio', status: 'paid', totalPrice: 70, manualShippingCost: null, manualShippingCostCurrency: null, uiOrderDate: new Date('2026-10-02T05:00:00Z'), createdAt: new Date('2026-10-02T05:00:00Z') },
      { id: 'f', marketplace: 'Amazon', status: 'paid', totalPrice: 30, manualShippingCost: null, manualShippingCostCurrency: null, uiOrderDate: new Date('2026-10-02T05:00:00Z'), createdAt: new Date('2026-10-02T05:00:00Z') },
    ];
    const res = await call(dashboardHandler, { marketplace: 'amazon', from: '2026-10-01', to: '2026-10-03', tz: IST, granularity: 'day' });
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.totalOrderCount).toBe(1);
    expect(res.body.summary.totalOrderRevenue).toBe(30);
  });

  it('rejects bad params', async () => {
    expect((await call(dashboardHandler, { from: '2026-10-05', to: '2026-10-01' })).statusCode).toBe(400);
    expect((await call(dashboardHandler, { from: '2026-10-05' })).statusCode).toBe(400);
    expect((await call(dashboardHandler, { groupBy: 'year' })).statusCode).toBe(400);
    expect((await call(dashboardHandler, { from: '2016-01-01', to: '2026-01-01', granularity: 'hour' })).statusCode).toBe(400);
    expect((await call(dashboardHandler, {}, 'POST')).statusCode).toBe(405);
    authUser.mockResolvedValueOnce(null);
    expect((await call(dashboardHandler, {})).statusCode).toBe(401);
  });
});

describe('GET /api/finance/settlements', () => {
  beforeEach(() => {
    authUser.mockResolvedValue({ id: 'u1' });
    seedEtsy();
  });

  it('adds category to rows and filters by category (every raw type of it)', async () => {
    db.txs.push(tx({ transactionType: 'Satış', transactionDate: '2026-10-02T09:00:00Z', amount: 1 }));
    const res = await call(settlementsHandler, { marketplace: 'etsy', from: '2026-10-01', to: '2026-10-03', tz: IST, category: 'revenue' });
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(4);
    expect(new Set(res.body.transactions.map((t: any) => t.transactionType))).toEqual(new Set(['Sale', 'Satış']));
    expect(res.body.transactions.every((t: any) => t.category === 'revenue')).toBe(true);

    const all = await call(settlementsHandler, { marketplace: 'etsy' });
    expect(all.body.transactions.find((t: any) => t.transactionType === 'Disbursement').category).toBe('disbursement');
    expect((await call(settlementsHandler, { marketplace: 'etsy', category: 'bogus' })).statusCode).toBe(400);
  });

  it('format=csv streams every row with a BOM, fixed columns, escaping and local dates', async () => {
    const res = await call(settlementsHandler, { marketplace: 'etsy', from: '2026-10-01', to: '2026-10-03', tz: IST, format: 'csv' });
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain('kolayxport-transactions-etsy-2026-10-01_2026-10-03.csv');
    expect(res.headers['x-total-count']).toBe('7');
    expect(res.headers['x-truncated']).toBe('false');
    const text = res.chunks.join('');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('date,category,type,product,order,barcode,quantity,amount,commission,currency');
    expect(lines).toHaveLength(8);
    expect(lines).toContain('2026-10-03,revenue,Sale,"Ring, ""gold""",,L2,1,20.00,,USD');
    expect(lines[lines.length - 1]).toBe('2026-10-01,revenue,Sale,Box,O1,L1,2,100.00,6.50,USD');
  });

  it('format=csv aborts the stream (never a JSON reply, never a clean end) when a later chunk fails', async () => {
    const prismaMod: any = (await import('@/lib/prisma')).default;
    prismaMod.financialTransaction.findMany.mockRejectedValueOnce(new Error('connection dropped'));
    const res = mockRes();
    let destroyed: Error | null = null;
    res.destroy = (e: Error) => { destroyed = e; };
    res.json = () => { throw new Error('ERR_HTTP_HEADERS_SENT'); };
    res.headersSent = true;
    await settlementsHandler({ method: 'GET', headers: {}, query: { marketplace: 'etsy', format: 'csv' }, body: {} } as any, res);
    expect(destroyed).toBeInstanceOf(Error);
    expect(res.ended).toBe(false);
    expect(res.chunks.join('').charCodeAt(0)).toBe(0xfeff);
  });

  it('csvCell guards formula-like text cells only', () => {
    expect(csvCell('=SUM(A1)', true)).toBe("'=SUM(A1)");
    expect(csvCell('-40.00')).toBe('-40.00');
    expect(csvCell(null)).toBe('');
    expect(csvDecimal(-40)).toBe('-40.00');
    expect(csvDecimal(1234.5)).toBe('1234.50');
    expect(csvDecimal(-0.001)).toBe('0.00');
  });
});
