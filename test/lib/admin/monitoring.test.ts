import { describe, it, expect, vi, beforeEach } from 'vitest';

const HOUR_MS = 60 * 60 * 1000;

const syncLogFindMany = vi.fn(async () => []);
const syncLogCount = vi.fn(async () => 0);
const syncLogGroupBy = vi.fn(async () => []);
const userGroupBy = vi.fn(async () => []);
const userCount = vi.fn(async () => 0);
const orderCount = vi.fn(async () => 0);
const shipmentCount = vi.fn(async () => 0);
const labelJobCount = vi.fn(async () => 0);
const labelJobGroupBy = vi.fn(async () => []);
const trackingSubCount = vi.fn(async () => 0);
const etsyCount = vi.fn(async () => 0);
const wixCount = vi.fn(async () => 0);
const shopifyCount = vi.fn(async () => 0);
const etsyFindMany = vi.fn(async () => []);
const wixFindMany = vi.fn(async () => []);
const shopifyFindMany = vi.fn(async () => []);
const syncOpGroupBy = vi.fn(async () => []);
const webhookFindMany = vi.fn(async () => []);
const cronLockFindMany = vi.fn(async () => []);
const queryRaw = vi.fn(async () => [{ '1': 1 }]);

vi.mock('@/lib/prisma', () => ({
  default: {
    syncLog: {
      findMany: (...a: any[]) => syncLogFindMany(...a),
      count: (...a: any[]) => syncLogCount(...a),
      groupBy: (...a: any[]) => syncLogGroupBy(...a),
    },
    user: {
      groupBy: (...a: any[]) => userGroupBy(...a),
      count: (...a: any[]) => userCount(...a),
    },
    order: { count: (...a: any[]) => orderCount(...a) },
    shipment: { count: (...a: any[]) => shipmentCount(...a) },
    labelJob: {
      count: (...a: any[]) => labelJobCount(...a),
      groupBy: (...a: any[]) => labelJobGroupBy(...a),
    },
    trackingSubmission: { count: (...a: any[]) => trackingSubCount(...a) },
    etsyShop: {
      count: (...a: any[]) => etsyCount(...a),
      findMany: (...a: any[]) => etsyFindMany(...a),
    },
    wixSite: {
      count: (...a: any[]) => wixCount(...a),
      findMany: (...a: any[]) => wixFindMany(...a),
    },
    shopifyShop: {
      count: (...a: any[]) => shopifyCount(...a),
      findMany: (...a: any[]) => shopifyFindMany(...a),
    },
    syncOperation: { groupBy: (...a: any[]) => syncOpGroupBy(...a) },
    webhookEvent: { findMany: (...a: any[]) => webhookFindMany(...a) },
    cronLock: { findMany: (...a: any[]) => cronLockFindMany(...a) },
    $queryRaw: (...a: any[]) => queryRaw(...a),
  },
}));

import {
  getCronHealth,
  getSecurityEvents,
  getRecentErrors,
  paging,
  getOverview,
  buildNeedsAttentionQueue,
} from '@/lib/admin/monitoring';

beforeEach(() => {
  [
    syncLogFindMany,
    syncLogCount,
    syncLogGroupBy,
    userGroupBy,
    userCount,
    orderCount,
    shipmentCount,
    labelJobCount,
    labelJobGroupBy,
    trackingSubCount,
    etsyCount,
    wixCount,
    shopifyCount,
    etsyFindMany,
    wixFindMany,
    shopifyFindMany,
    syncOpGroupBy,
    webhookFindMany,
    cronLockFindMany,
    queryRaw,
  ].forEach(m => m.mockReset());
  syncLogFindMany.mockResolvedValue([]);
  syncLogCount.mockResolvedValue(0);
  syncLogGroupBy.mockResolvedValue([]);
  userGroupBy.mockResolvedValue([]);
  userCount.mockResolvedValue(0);
  orderCount.mockResolvedValue(0);
  shipmentCount.mockResolvedValue(0);
  labelJobCount.mockResolvedValue(0);
  labelJobGroupBy.mockResolvedValue([]);
  trackingSubCount.mockResolvedValue(0);
  etsyCount.mockResolvedValue(0);
  wixCount.mockResolvedValue(0);
  shopifyCount.mockResolvedValue(0);
  etsyFindMany.mockResolvedValue([]);
  wixFindMany.mockResolvedValue([]);
  shopifyFindMany.mockResolvedValue([]);
  syncOpGroupBy.mockResolvedValue([]);
  webhookFindMany.mockResolvedValue([]);
  cronLockFindMany.mockResolvedValue([]);
  queryRaw.mockResolvedValue([{ '1': 1 }]);
});

describe('paging.clampLimit', () => {
  it('uses default when missing or invalid', () => {
    expect(paging.clampLimit(undefined)).toBe(50);
    expect(paging.clampLimit('abc')).toBe(50);
    expect(paging.clampLimit('-5')).toBe(50);
  });
  it('caps at 200', () => {
    expect(paging.clampLimit('1000')).toBe(200);
    expect(paging.clampLimit('100')).toBe(100);
  });
});

describe('getCronHealth — stale flag logic', () => {
  it('flags sync-orders as stale when older than 30 minutes', async () => {
    cronLockFindMany.mockResolvedValueOnce([
      {
        jobName: 'sync-orders',
        bucket: '2026-05-31T11:00',
        createdAt: new Date(Date.now() - 45 * 60 * 1000),
      },
    ]);
    const out = await getCronHealth();
    const syncOrders = out.jobs.find(j => j.jobName === 'sync-orders');
    expect(syncOrders?.stale).toBe(true);
  });

  it('does NOT flag sync-orders as stale when last run was 5 minutes ago', async () => {
    cronLockFindMany.mockResolvedValueOnce([
      {
        jobName: 'sync-orders',
        bucket: '2026-05-31T12:00',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    ]);
    const out = await getCronHealth();
    const syncOrders = out.jobs.find(j => j.jobName === 'sync-orders');
    expect(syncOrders?.stale).toBe(false);
  });

  it('reports stale for reset-usage when older than 26h', async () => {
    cronLockFindMany.mockResolvedValueOnce([
      {
        jobName: 'reset-usage',
        bucket: '2026-05-30',
        createdAt: new Date(Date.now() - 30 * HOUR_MS),
      },
    ]);
    const out = await getCronHealth();
    const reset = out.jobs.find(j => j.jobName === 'reset-usage');
    expect(reset?.stale).toBe(true);
  });

  it('reports never-run jobs as stale', async () => {
    cronLockFindMany.mockResolvedValueOnce([]);
    const out = await getCronHealth();
    expect(out.jobs.every(j => j.stale)).toBe(true);
  });
});

describe('getSecurityEvents', () => {
  it('returns pagination metadata and respects clamped limit', async () => {
    syncLogFindMany.mockResolvedValueOnce([
      { id: '1', level: 'warn', message: 'reject', operation: 'extension.origin_rejected', userId: null, timestamp: new Date() },
    ]);
    syncLogCount.mockResolvedValueOnce(42); // total
    syncLogCount.mockResolvedValueOnce(7); // last24h
    syncLogGroupBy.mockResolvedValueOnce([
      { operation: 'extension.origin_rejected', _count: 4 },
    ]);

    const out = await getSecurityEvents({ limit: '500' as any });
    expect(out.pagination.limit).toBe(200); // clamped
    expect(out.pagination.total).toBe(42);
    expect(out.last24h.total).toBe(7);
    expect(out.last24h.byOperation[0]).toEqual({ operation: 'extension.origin_rejected', count: 4 });
  });
});

describe('getRecentErrors', () => {
  it('filters by category when provided', async () => {
    await getRecentErrors({ category: 'billing' });
    const findManyArgs = syncLogFindMany.mock.calls[0][0];
    expect(findManyArgs.where.category).toBe('billing');
    expect(findManyArgs.where.level).toEqual({ in: ['warn', 'error'] });
  });
});

describe('getOverview & needs-attention', () => {
  it('shows green when nothing is wrong', async () => {
    cronLockFindMany.mockResolvedValueOnce([
      { jobName: 'sync-orders', bucket: 'b', createdAt: new Date() },
      { jobName: 'reset-usage', bucket: 'b', createdAt: new Date() },
      { jobName: 'track-ranks', bucket: 'b', createdAt: new Date() },
    ]);
    const out = await buildNeedsAttentionQueue();
    expect(out.items.length).toBe(0);
  });

  it('overview returns system + totals + queue', async () => {
    queryRaw.mockResolvedValueOnce([{ '1': 1 }]);
    cronLockFindMany.mockResolvedValueOnce([
      { jobName: 'sync-orders', bucket: 'b', createdAt: new Date() },
      { jobName: 'reset-usage', bucket: 'b', createdAt: new Date() },
      { jobName: 'track-ranks', bucket: 'b', createdAt: new Date() },
    ]);
    userCount.mockResolvedValueOnce(10).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    orderCount.mockResolvedValueOnce(123);
    shipmentCount.mockResolvedValueOnce(45);
    const out = await getOverview();
    expect(out.system.db).toBe('ok');
    expect(out.totals).toEqual({ users: 10, orders: 123, shipments: 45 });
    expect(out.growth).toEqual({ newUsers7d: 2, newUsers30d: 3 });
    expect(Array.isArray(out.needsAttention.items)).toBe(true);
  });
});
