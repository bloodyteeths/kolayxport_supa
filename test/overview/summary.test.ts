import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ mocks */

const queryRaw = vi.fn();
const p = {
  user: { findUnique: vi.fn() },
  shopifyShop: { count: vi.fn() },
  etsyShop: { findMany: vi.fn() },
  etsyListing: { findUnique: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  etsyListingDraft: { groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  ebayListingDraft: { groupBy: vi.fn(), findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  order: { findFirst: vi.fn() },
  shipperProfile: { findUnique: vi.fn() },
  shipment: { findFirst: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({
  default: new Proxy(
    {},
    {
      get: (_t, k) => (k === '$queryRawUnsafe' ? (...a: unknown[]) => queryRaw(...a) : (p as Record<string, unknown>)[k as string]),
    },
  ),
}));
const authUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
const logError = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { error: (...a: unknown[]) => logError(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const recover = vi.fn();
vi.mock('@/lib/etsy/draftService', () => ({ recoverStaleSyncingDrafts: (...a: unknown[]) => recover(...a) }));
const rates = vi.fn();
vi.mock('@/lib/fx', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getExchangeRates: () => rates() };
});
// The billing track has not exported getUsageSnapshot yet: the summary must fall back.
vi.mock('@/lib/middleware/withUsageLimiter', () => ({ withUsageLimiter: vi.fn() }));
const healthCols = vi.fn();
vi.mock('@/lib/listings/refreshHealth', () => ({ healthColumnTables: (...a: unknown[]) => healthCols(...a) }));

import handler from '@/pages/api/overview/summary';
import {
  computeKpis,
  computeSeries,
  createSummaryContext,
  dayWindows,
  getEbayDraftBucket,
  getOverviewSummary,
  getTopSellersSection,
  parseOverviewCurrency,
  parseOverviewTz,
  sanitizeErrorMessage,
  usageSnapshotFromUser,
  COUNTED_ORDER_SQL,
  COUNTED_ORDERS_SQL,
  LABELS_FAILED_SQL,
  TRACKING_FAILED_SQL,
  TO_SHIP_SUMMARY_SQL,
} from '@/lib/overview/summary';
import { FAILED_LABEL_SQL, LISTED_ORDER_SQL, NORMALIZED_STATUS_SQL, TO_SHIP_SQL, TRACKING_PUSH_FAILED_SQL } from '@/lib/orders/views';
import { SECTION_KEYS } from '@/lib/overview/types';

/* --------------------------------------------------------------- helpers */

const NOW = new Date('2026-10-15T12:00:00Z');
const tag = (sql: unknown) => String(sql).match(/\/\* overview:(\w+) \*\//)?.[1] ?? 'unknown';

type RawHandler = (args: unknown[]) => unknown;
function rawBy(map: Record<string, RawHandler | unknown>) {
  queryRaw.mockImplementation(async (sql: string, ...args: unknown[]) => {
    const h = map[tag(sql)];
    if (typeof h === 'function') return (h as RawHandler)(args);
    return h ?? [];
  });
}

function happyDefaults() {
  healthCols.mockResolvedValue(new Set(['EtsyListing']));
  p.user.findUnique.mockResolvedValue({
    lastSyncedAt: new Date('2026-10-15T11:00:00Z'),
    subscriptionPlan: 'starter', subscriptionStatus: 'active', billingProvider: 'stripe',
    trialExpiresAt: null, usageResetAt: new Date('2026-11-01T00:00:00Z'), orderSyncCount: 170, labelCount: 3,
  });
  p.shopifyShop.count.mockResolvedValue(0);
  p.etsyShop.findMany.mockResolvedValue([{ shopId: '111', shopName: 'BelleCoutureGifts', isActive: true }]);
  p.etsyListing.findUnique.mockResolvedValue({ title: 'Cached &amp; title', thumbnailUrl75x75: 'https://i.etsystatic.com/t.jpg' });
  p.etsyListing.count.mockResolvedValue(0);
  p.etsyListing.findFirst.mockResolvedValue(null);
  p.etsyListing.findMany.mockResolvedValue([]);
  p.etsyListingDraft.groupBy.mockResolvedValue([{ status: 'draft', _count: { _all: 2 } }]);
  p.etsyListingDraft.findFirst.mockResolvedValue(null);
  p.ebayListingDraft.groupBy.mockResolvedValue([]);
  p.ebayListingDraft.findFirst.mockResolvedValue(null);
  p.ebayListingDraft.count.mockResolvedValue(0);
  p.etsyListingDraft.findMany.mockResolvedValue([]);
  p.ebayListingDraft.findMany.mockResolvedValue([]);
  p.order.findFirst.mockImplementation(async ({ where }: any) => (where.labelStatus ? null : { id: 'o1' }));
  p.shipperProfile.findUnique.mockResolvedValue({ shipperStreet1: 'Street 1', shipperCity: 'İstanbul' });
  p.shipment.findFirst.mockResolvedValue(null);
  rates.mockResolvedValue({ rates: { TRY: 1, USD: 30, EUR: 33 }, stale: false, asOf: NOW.getTime() - 60_000 });
  recover.mockResolvedValue(0);
  rawBy({
    toShip: [{ count: 5n, overdue: 2n, dueToday: 1n, withoutShipBy: 1n, oldestOrderedAt: new Date('2026-10-01T00:00:00Z') }],
    toShipFirst: [{ id: 'o9', orderNumber: '3456', marketplace: 'BelleCoutureGifts', shipBy: new Date('2026-10-14T00:00:00Z'), itemName: 'One&#39;s box', image: '/placeholder.png' }],
    labels: [],
    trackingFailed: [{ count: 0n }],
    trackingNotSent: [],
    counted: [],
    topSellers: [],
  });
}

function call(method = 'GET', query: Record<string, string> = {}) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method, headers: {}, query } as any, res)).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  happyDefaults();
});

/* ----------------------------------------------------------------- tests */

describe('time zones', () => {
  it('Istanbul at 23:30 local is still today; 00:30 is tomorrow', () => {
    const late = dayWindows(new Date('2026-10-15T20:30:00Z'), 'Europe/Istanbul'); // 23:30 +03
    expect(late.seriesKeys[13]).toBe('2026-10-15');
    expect(late.todayStart.toISOString()).toBe('2026-10-14T21:00:00.000Z');
    expect(late.todayEnd.toISOString()).toBe('2026-10-15T21:00:00.000Z');
    const after = dayWindows(new Date('2026-10-15T21:30:00Z'), 'Europe/Istanbul'); // 00:30 +03 next day
    expect(after.seriesKeys[13]).toBe('2026-10-16');
  });

  it('UTC at 23:30 is still today', () => {
    const w = dayWindows(new Date('2026-10-15T23:30:00Z'), 'UTC');
    expect(w.seriesKeys[13]).toBe('2026-10-15');
    expect(w.todayStart.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(w.seriesKeys).toHaveLength(14);
    expect(w.previousKeys).toHaveLength(14);
    expect(w.previousKeys[13]).toBe('2026-10-01');
    expect(w.windowStart.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('DST: New York local midnight across the November change', () => {
    const w = dayWindows(new Date('2026-11-02T12:00:00Z'), 'America/New_York');
    expect(w.todayStart.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // EST
    expect(w.windowStart.toISOString()).toBe('2026-10-06T04:00:00.000Z'); // EDT
  });

  it('parses tz and currency with fallbacks', () => {
    expect(parseOverviewTz('UTC')).toBe('UTC');
    expect(parseOverviewTz('America/New_York')).toBe('America/New_York');
    expect(parseOverviewTz('Mars/Olympus')).toBe('Europe/Istanbul');
    expect(parseOverviewTz(undefined)).toBe('Europe/Istanbul');
    expect(parseOverviewCurrency('usd')).toBe('USD');
    expect(parseOverviewCurrency('EUR')).toBe('TRY');
    expect(parseOverviewCurrency(undefined, 'en')).toBe('USD');
    expect(parseOverviewCurrency(undefined, 'tr')).toBe('TRY');
    expect(parseOverviewCurrency(undefined, 'de')).toBe('TRY');
  });

  it('counted orders leave out normalized cancelled / refunded statuses (İptal Edildi, cancelled_by_buyer)', () => {
    expect(COUNTED_ORDER_SQL).toContain(NORMALIZED_STATUS_SQL);
    for (const v of ['iptal_edildi', 'iptal', 'cancelled_by_buyer', 'cancelled_by_seller', 'fully_refunded', 'iade_edildi', 'cancelled', 'refunded']) {
      expect(COUNTED_ORDER_SQL).toContain(`'${v}'`);
    }
  });

  it('tracking failed counts orders with the shared newest-submission rule, not cancelled', () => {
    expect(TRACKING_FAILED_SQL).toContain(TRACKING_PUSH_FAILED_SQL);
    expect(TRACKING_FAILED_SQL).toMatch(/FROM "Order" o\s/);
    expect(TRACKING_FAILED_SQL).toContain(`o."cancelledAt" IS NULL`);
    expect(TRACKING_FAILED_SQL).not.toMatch(/FROM "TrackingSubmission" ts JOIN/);
  });

  it('the counted query groups by the double AT TIME ZONE and gets the tz + local window', async () => {
    expect(COUNTED_ORDERS_SQL).toContain(`(ts AT TIME ZONE 'UTC') AT TIME ZONE $4`);
    const ctx = createSummaryContext({ userId: 'u1', tz: 'Europe/Istanbul', currency: 'TRY', now: new Date('2026-10-15T20:30:00Z') });
    await ctx.counted();
    const call0 = queryRaw.mock.calls.find((c) => tag(c[0]) === 'counted')!;
    expect(call0[1]).toBe('u1');
    expect(call0[2]).toBe('2026-09-17T21:00:00.000Z'); // local midnight 28 days back
    expect(call0[3]).toBe('2026-10-15T20:30:00.000Z');
    expect(call0[4]).toBe('Europe/Istanbul');
    expect(call0[5]).toBe('2026-10-08T20:30:00.000Z');
    expect(call0[6]).toBe('2026-10-01T20:30:00.000Z');
  });

  it('dueToday ends at the end of the local day', async () => {
    await getOverviewSummary({ userId: 'u1', tz: 'Europe/Istanbul', currency: 'TRY', now: new Date('2026-10-15T20:30:00Z') });
    const c = queryRaw.mock.calls.find((x) => tag(x[0]) === 'toShip')!;
    expect(c[2]).toBe('2026-10-15T21:00:00.000Z');
    expect(TO_SHIP_SUMMARY_SQL).toContain(TO_SHIP_SQL);
  });
});

describe('series', () => {
  it('zero-fills 14 local days and sums the 14 before', () => {
    const w = dayWindows(NOW, 'UTC');
    const s = computeSeries(
      [
        { kind: 'day', key: '2026-10-15', currency: null, orders: 3n, amount: null },
        { kind: 'day', key: '2026-10-02', currency: null, orders: 2n, amount: null },
        { kind: 'day', key: '2026-10-01', currency: null, orders: 4n, amount: null }, // previous window
        { kind: 'day', key: '2026-09-18', currency: null, orders: 1n, amount: null }, // previous window, first day
        { kind: 'rev', key: 'cur', currency: 'TRY', orders: 9n, amount: 100 }, // ignored
      ],
      w,
    );
    expect(s.days).toHaveLength(14);
    expect(s.days[0]).toEqual({ date: '2026-10-02', orders: 2 });
    expect(s.days[13]).toEqual({ date: '2026-10-15', orders: 3 });
    expect(s.days.filter((d) => d.orders === 0)).toHaveLength(12);
    expect(s.previousTotal).toBe(5);
  });
});

describe('revenue', () => {
  const fx = { rates: { TRY: 1, USD: 30 }, stale: false, asOf: Date.parse('2026-10-15T11:00:00Z') };

  it('excludes unconverted currencies from BOTH periods and names them', () => {
    const k = computeKpis(
      [
        { kind: 'rev', key: 'cur', currency: 'TRY', orders: 2n, amount: 100 },
        { kind: 'rev', key: 'prev', currency: 'TL', orders: 1n, amount: 50 },
        { kind: 'rev', key: 'cur', currency: 'USD', orders: 1n, amount: 10 },
        { kind: 'rev', key: 'prev', currency: 'USD', orders: 1n, amount: 20 },
        { kind: 'rev', key: 'cur', currency: 'XYZ', orders: 3n, amount: 999 },
        { kind: 'rev', key: 'prev', currency: 'XYZ', orders: 5n, amount: 999 },
      ],
      'TRY',
      fx,
    );
    expect(k.revenue7d.value).toBe(400);
    expect(k.revenue7d.previous).toBe(650);
    expect(k.revenue7d.unconverted).toEqual([{ currency: 'XYZ', orders: 3 }]);
    expect(k.revenue7d.approx).toBe(true);
    expect(k.revenue7d.ratesAsOf).toBe('2026-10-15T11:00:00.000Z');
    expect(k.orders7d).toEqual({ value: 6, previous: 7 });
  });

  it('USD base divides by the USD rate; base-only sales are not approximate', () => {
    const k = computeKpis([{ kind: 'rev', key: 'cur', currency: 'TRY', orders: 1n, amount: 300 }], 'USD', fx);
    expect(k.revenue7d.value).toBe(10);
    expect(k.revenue7d.approx).toBe(true);
    const only = computeKpis([{ kind: 'rev', key: 'cur', currency: 'USD', orders: 1n, amount: 12 }], 'USD', fx);
    expect(only.revenue7d.approx).toBe(false);
    expect(only.revenue7d.value).toBe(12);
  });

  it('no rates at all: value null, perCurrency carries the totals', () => {
    const k = computeKpis(
      [
        { kind: 'rev', key: 'cur', currency: 'TRY', orders: 1n, amount: 100 },
        { kind: 'rev', key: 'cur', currency: 'USD', orders: 1n, amount: 10 },
      ],
      'TRY',
      { rates: {}, stale: true, asOf: null },
    );
    expect(k.revenue7d.value).toBeNull();
    expect(k.revenue7d.previous).toBeNull();
    expect(k.revenue7d.ratesStale).toBe(true);
    expect(k.revenue7d.perCurrency).toEqual([{ currency: 'TRY', value: 100 }, { currency: 'USD', value: 10 }]);
  });
});

describe('drafts', () => {
  it('eBay syncing rows older than 10 min are reported as failed (read-only)', async () => {
    p.ebayListingDraft.groupBy.mockResolvedValue([
      { status: 'syncing', _count: { _all: 3 } },
      { status: 'failed', _count: { _all: 1 } },
      { status: 'draft', _count: { _all: 4 } },
    ]);
    p.ebayListingDraft.count.mockResolvedValue(2);
    p.ebayListingDraft.findFirst.mockImplementation(async ({ where }: any) =>
      where.OR
        ? { id: 'd1', sku: 'SKU-1', listingId: null, inventoryPatch: {}, baseSnapshotInventory: { product: { title: 'Base title', imageUrls: ['https://i.ebayimg.com/a.jpg'] } }, lastSyncError: 'eBay said no: {"errors":[1]}' }
        : null,
    );
    const ctx = createSummaryContext({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    const b = await getEbayDraftBucket(ctx);
    expect(b).toMatchObject({ draft: 4, syncing: 1, failed: 3, conflict: 0, firstConflict: null });
    expect(b.firstFailed).toEqual({ draftId: 'd1', listingId: 'SKU-1', title: 'Base title', thumb: 'https://i.ebayimg.com/a.jpg', error: 'eBay said no' });
    const countArgs = p.ebayListingDraft.count.mock.calls[0][0];
    expect(countArgs.where.updatedAt.lt.toISOString()).toBe('2026-10-15T11:50:00.000Z');
  });

  it('eBay drafts of legacy listings (`legacy-<itemId>`) are counted like any other (sent via Trading API since 2026-10-17)', async () => {
    p.ebayListingDraft.groupBy.mockResolvedValue([
      { status: 'draft', _count: { _all: 3 } },
      { status: 'failed', _count: { _all: 1 } },
    ]);
    const staged = { inventoryPatch: { product: { title: 'x' } }, offerPatch: {}, variationPatch: null, queuedActions: [], _count: { media: 0 }, scheduledSendAt: null };
    p.ebayListingDraft.findMany.mockResolvedValue([
      { ...staged, status: 'draft', sku: 'SKU-1' },
      { ...staged, status: 'draft', sku: 'legacy-198020866463' },
      { ...staged, status: 'draft', sku: 'legacy-197105625421' },
      { ...staged, status: 'failed', sku: 'legacy-197008549496' },
    ]);
    const ctx = createSummaryContext({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    const b = await getEbayDraftBucket(ctx);
    expect(b).toMatchObject({ draft: 3, failed: 1 });
    for (const [args] of p.ebayListingDraft.findFirst.mock.calls as any[]) {
      expect(args.where.NOT).toBeUndefined();
    }
    expect(p.ebayListingDraft.findMany.mock.calls[0][0].select).toMatchObject({ sku: true });
  });

  it('Etsy recovers stale syncing drafts first; fieldPatch.title wins over the cache', async () => {
    p.etsyListingDraft.findFirst.mockImplementation(async ({ where }: any) =>
      where.status === 'conflict'
        ? { id: 'e1', etsyShopId: '111', etsyListingId: 4242424242n, fieldPatch: { title: 'New &quot;title&quot;' }, lastSyncError: null }
        : null,
    );
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(recover).toHaveBeenCalledWith('u1');
    expect(s.drafts!.etsy.draft).toBe(2);
    expect(s.drafts!.etsy.firstConflict).toEqual({
      draftId: 'e1', listingId: '4242424242', title: 'New "title"', thumb: 'https://i.etsystatic.com/t.jpg', error: null,
    });
  });
});

describe('channels', () => {
  it('maps Etsy shop names, marketplaces and unknown stores', async () => {
    rawBy({
      topSellers: [
        { key: 'sku-1', name: 'Wooden &amp; box', sku: 'SKU-1', units: 7n, orders: 5n, image: '', marketplace: 'BelleCoutureGifts' },
        { key: 'sku-2', name: null, sku: 'SKU-2', units: 3n, orders: 3n, image: 'https://x/y.jpg', marketplace: 'Amazon Channel' },
        { key: 'plate', name: 'Plate', sku: null, units: 1n, orders: 1n, image: null, marketplace: 'n11' },
        { key: 'veeqo', name: 'Thing', sku: null, units: 1n, orders: 1n, image: null, marketplace: 'Veeqo' },
      ],
    });
    const ctx = createSummaryContext({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    const t = await getTopSellersSection(ctx);
    expect(t.items.map((i) => i.channel)).toEqual(['etsy', 'amazon', 'other', 'other']);
    expect(t.items[0]).toMatchObject({ name: 'Wooden & box', image: null, units: 7, orders: 5 });
    expect(t.items[1].name).toBe('SKU-2');
  });

  it('firstOverdue: shop-name order is etsy, entities decoded, placeholder dropped', async () => {
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(s.toShip).toEqual({
      count: 5, overdue: 2, dueToday: 1, withoutShipBy: 1, oldestOrderedAt: '2026-10-01T00:00:00.000Z',
      firstOverdue: { id: 'o9', orderNumber: '3456', channel: 'etsy', itemName: "One's box", image: null, shipBy: '2026-10-14T00:00:00.000Z' },
    });
  });
});

describe('labels and tracking', () => {
  it('failed labels use the /api/orders failed filter base and a clean error', async () => {
    expect(LABELS_FAILED_SQL).toContain(`${LISTED_ORDER_SQL} AND ${FAILED_LABEL_SQL}`);
    rawBy({
      ...{ toShip: [{ count: 0n, overdue: 0n, dueToday: 0n, withoutShipBy: 0n, oldestOrderedAt: null }] },
      labels: [{ id: 'o2', orderNumber: '77', marketplace: 'Etsy', shipBy: null, itemName: 'Mug', image: 'https://a/b.jpg', error: 'UPS 120500: Address invalid {"response":{"errors":[]}}', total: 4n }],
      trackingFailed: [{ count: 1n }],
      trackingNotSent: [{ id: 'o3', total: 2n }],
      orderRef: [{ id: 'o3', orderNumber: '88', marketplace: 'etsy', shipBy: null, itemName: null, image: null }],
    });
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(s.labels).toEqual({
      failed: 4,
      first: { id: 'o2', orderNumber: '77', channel: 'etsy', itemName: 'Mug', image: 'https://a/b.jpg', shipBy: null, error: 'UPS 120500: Address invalid' },
    });
    expect(s.tracking).toEqual({ notSent: 2, failed: 1, first: { id: 'o3', orderNumber: '88', channel: 'etsy', itemName: null, image: null, shipBy: null } });
    const ns = queryRaw.mock.calls.find((c) => tag(c[0]) === 'trackingNotSent')!;
    expect(ns[2]).toEqual(['bellecouturegifts']);
    expect(ns[3]).toBe('2026-10-15T11:30:00.000Z');
    expect(ns[4]).toBe('2026-10-15T10:00:00.000Z');
    expect(ns[5]).toBe('2026-10-01T12:00:00.000Z');
  });

  it('sanitizeErrorMessage cuts JSON and long text', () => {
    expect(sanitizeErrorMessage('{"a":1}')).toBeNull();
    expect(sanitizeErrorMessage('Failed: [object]')).toBe('Failed');
    expect(sanitizeErrorMessage('x'.repeat(300))!.length).toBe(140);
    expect(sanitizeErrorMessage(null)).toBeNull();
  });
});

describe('usage', () => {
  it('fallback snapshot: expired reset reads 0 used, trial limits, near-limit', () => {
    const trial = usageSnapshotFromUser(
      { subscriptionPlan: null, subscriptionStatus: 'trialing', billingProvider: null, trialExpiresAt: new Date('2026-10-20T00:00:00Z'), usageResetAt: new Date('2026-11-01T00:00:00Z'), orderSyncCount: 140, labelCount: 2 },
      { activeShopifyShops: 0 },
      NOW,
    );
    expect(trial).toMatchObject({ orderSync: { used: 140, limit: 150 }, label: { used: 2, limit: 30 }, nearLimit: true, blocked: null, trialEndsAt: '2026-10-20T00:00:00.000Z' });
    const expired = usageSnapshotFromUser(
      { subscriptionPlan: 'starter', subscriptionStatus: 'active', billingProvider: 'stripe', trialExpiresAt: null, usageResetAt: new Date('2026-10-01T00:00:00Z'), orderSyncCount: 999, labelCount: 999 },
      { activeShopifyShops: 0 },
      NOW,
    );
    expect(expired).toMatchObject({ orderSync: { used: 0, limit: 500 }, label: { used: 0, limit: 250 }, blocked: null, resetsAt: null });
  });

  it('blocked reasons, unlimited as null, hideBilling for Shopify', () => {
    const base = { trialExpiresAt: null, usageResetAt: new Date('2026-11-01T00:00:00Z'), orderSyncCount: 500, labelCount: 0 };
    expect(usageSnapshotFromUser({ ...base, subscriptionPlan: 'starter', subscriptionStatus: 'active', billingProvider: 'stripe' }, { activeShopifyShops: 0 }, NOW).blocked).toBe('planLimit');
    expect(usageSnapshotFromUser({ ...base, subscriptionPlan: null, subscriptionStatus: 'canceled', billingProvider: 'stripe' }, { activeShopifyShops: 0 }, NOW).blocked).toBe('noSubscription');
    expect(usageSnapshotFromUser({ ...base, subscriptionPlan: 'bogus', subscriptionStatus: 'active', billingProvider: 'stripe' }, { activeShopifyShops: 0 }, NOW).blocked).toBe('invalidPlan');
    const shop = usageSnapshotFromUser({ ...base, subscriptionPlan: 'shopify_free', subscriptionStatus: null, billingProvider: 'shopify' }, { activeShopifyShops: 1 }, NOW);
    expect(shop).toMatchObject({ hideBilling: true, blocked: null, orderSync: { limit: null }, label: { limit: null }, nearLimit: false });
  });

  it('summary.usage comes from the fallback while getUsageSnapshot is not exported', async () => {
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(s.usage).toMatchObject({ plan: 'starter', orderSync: { used: 170, limit: 500 }, nearLimit: false, hideBilling: false });
  });
});

describe('partial failures', () => {
  it('one throwing section → null + errors[], others intact, error logged with requestId', async () => {
    p.etsyListingDraft.groupBy.mockRejectedValue(new Error('boom'));
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW, requestId: 'req-1' });
    expect(s.errors).toEqual(['drafts']);
    expect(s.drafts).toBeNull();
    expect(s.toShip?.count).toBe(5);
    expect(s.setup).toEqual({ hasOrders: true, senderComplete: true, hasLabel: false });
    expect(s.ordersLastSyncedAt).toBe('2026-10-15T11:00:00.000Z');
    expect(logError).toHaveBeenCalledWith('[overview] section drafts failed', expect.any(Error), expect.objectContaining({ requestId: 'req-1', section: 'drafts' }));
  });

  it('a shared loader failure fails only its sections, in SECTION_KEYS order', async () => {
    rawBy({ toShip: [{ count: 0n }], counted: () => { throw new Error('db'); } });
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(s.errors).toEqual(['kpis', 'series']);
    const idx = s.errors.map((e) => SECTION_KEYS.indexOf(e));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('listingHealth over the cap → null + error; no active listings → zeros', async () => {
    p.etsyListing.count.mockResolvedValueOnce(5001);
    const capped = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(capped.listingHealth).toBeNull();
    expect(capped.errors).toContain('listingHealth');
    const ok = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(ok.listingHealth).toEqual({ etsy: { needsWork: 0, scored: 0, worst: null } });
  });

  it('listingHealth scores unscored rows and keeps the worst', async () => {
    p.etsyListing.count.mockImplementation(async ({ where }: any) => (where.healthScore?.lt ? 1 : where.healthScore ? 2 : 3));
    p.etsyListing.findFirst.mockResolvedValue({ etsyListingId: 1n, title: 'Stored', thumbnailUrl75x75: null, healthScore: 40 });
    p.etsyListing.findMany.mockResolvedValue([
      { etsyListingId: 2n, thumbnailUrl75x75: null, title: 'x', description: '', tags: [], materials: [], priceAmount: 0, priceDivisor: 100, imageCount: 0, hasVideo: false, shippingProfileId: null, processingMin: null, itemWeight: null },
    ]);
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    const h = s.listingHealth!.etsy;
    expect(h.scored).toBe(3);
    expect(h.needsWork).toBe(2);
    expect(h.worst!.listingId).toBe('2');
    expect(h.worst!.score).toBeLessThan(40);
    const unscoredWhere = p.etsyListing.findMany.mock.calls.at(-1)![0].where;
    expect(unscoredWhere).toMatchObject({ healthScore: null, healthChecksTotal: 0 });
  });

  it('listingHealth without the BR-1a columns scores every active row and never queries healthScore', async () => {
    healthCols.mockResolvedValue(new Set());
    p.etsyListing.count.mockResolvedValue(1);
    p.etsyListing.findMany.mockResolvedValue([
      { etsyListingId: 2n, thumbnailUrl75x75: null, title: 'x', description: '', tags: [], materials: [], priceAmount: 0, priceDivisor: 100, imageCount: 0, hasVideo: false, shippingProfileId: null, processingMin: null, itemWeight: null },
    ]);
    const s = await getOverviewSummary({ userId: 'u1', tz: 'UTC', currency: 'TRY', now: NOW });
    expect(s.errors).not.toContain('listingHealth');
    expect(s.listingHealth!.etsy.scored).toBe(1);
    expect(s.listingHealth!.etsy.worst!.listingId).toBe('2');
    expect(p.etsyListing.findFirst).not.toHaveBeenCalled();
    for (const [arg] of [...p.etsyListing.count.mock.calls, ...p.etsyListing.findMany.mock.calls]) {
      expect(JSON.stringify(arg.where)).not.toContain('healthScore');
    }
  });
});

describe('route', () => {
  it('401 without a user', async () => {
    authUser.mockResolvedValue(null);
    const res = await call();
    expect(res.statusCode).toBe(401);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('405 for non-GET', async () => {
    const res = await call('POST');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(authUser).not.toHaveBeenCalled();
  });

  it('200 with tz/currency parsed and a requestId', async () => {
    authUser.mockResolvedValue({ id: 'u1' });
    const res = await call('GET', { tz: 'Not/AZone', currency: 'USD' });
    expect(res.statusCode).toBe(200);
    expect(res.body.tz).toBe('Europe/Istanbul');
    expect(res.body.currency).toBe('USD');
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.errors).toEqual([]);
  });

  it('a failing section is still a 200', async () => {
    authUser.mockResolvedValue({ id: 'u1' });
    p.shipperProfile.findUnique.mockRejectedValue(new Error('x'));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toEqual(['setup']);
  });
});
