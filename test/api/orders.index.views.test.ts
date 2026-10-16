import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRaw = vi.fn();
const findUser = vi.fn();
const findShops = vi.fn();
const findOrder = vi.fn();
const findSyncOp = vi.fn();
vi.mock('../../lib/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => queryRaw(...a),
    user: { findUnique: (...a: any[]) => findUser(...a) },
    etsyShop: { findMany: (...a: any[]) => findShops(...a) },
    order: { findFirst: (...a: any[]) => findOrder(...a) },
    syncOperation: { findFirst: (...a: any[]) => findSyncOp(...a) },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));

import handler, { clearViewCountsCache, partitionStatusValues, MAX_ORDERS_PAGE_SIZE } from '../../pages/api/orders/index';
import manualHandler, { DUPLICATE_ORDER_NUMBER } from '../../pages/api/orders/manual';
import { VIEW_COUNT_QUERIES, VIEW_COUNTS_FINGERPRINT_SQL, TO_SHIP_SQL, PROBLEMS_SQL, EFFECTIVE_SHIP_BY_SQL } from '../../lib/orders/views';

function res() {
  const r: any = { statusCode: 0, body: undefined, setHeader: vi.fn() };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
const run = (query: Record<string, any>) => { const r = res(); return handler({ method: 'GET', query } as any, r).then(() => r); };

const mainQuery = () => {
  const call = queryRaw.mock.calls.find((c) => String(c[0]).includes('LIMIT $'))!;
  return { sql: String(call[0]), params: call.slice(1) };
};

let fingerprint: string | null = 'fp1';
const ORDER_ROW = { id: 'o1', marketplace: 'Etsy', orderNumber: '1', status: 'paid', rawData: {}, shippingAddress: {} };

beforeEach(() => {
  clearViewCountsCache();
  queryRaw.mockReset();
  findUser.mockReset();
  findShops.mockReset();
  findSyncOp.mockReset();
  findSyncOp.mockResolvedValue(null);
  fingerprint = 'fp1';
  queryRaw.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s === VIEW_COUNTS_FINGERPRINT_SQL) return [{ fp: fingerprint }];
    // Four parallel count queries (one per view).
    if (s === VIEW_COUNT_QUERIES.to_ship) return [{ n: BigInt(12) }];
    if (s === VIEW_COUNT_QUERIES.overdue) return [{ n: '3' }];
    if (s === VIEW_COUNT_QUERIES.label_created) return [{ n: 4 }];
    if (s === VIEW_COUNT_QUERIES.problems) return [{ n: 1 }];
    if (s.includes('COUNT(*) as total')) return [{ total: '1' }];
    if (s.includes('LIMIT $')) return [ORDER_ROW];
    if (s.includes('FROM "OrderItem" oi')) return [{ id: 'i1', orderId: 'o1', productName: 'P', labelJobStatus: 'failed', labelJobCreatedAt: new Date('2026-10-14T10:00:00Z'), labelJobError: 'Bad postal' }];
    return [];
  });
  findUser.mockResolvedValue({ lastSyncedAt: new Date('2026-10-15T10:00:00Z') });
  findShops.mockResolvedValue([{ shopName: 'BelleCoutureGifts' }, { shopName: null }]);
});

describe('/api/orders A1–A4', () => {
  it('view adds the server clause from lib/orders/views', async () => {
    await run({ view: 'to_ship' });
    expect(mainQuery().sql).toContain(TO_SHIP_SQL);
    queryRaw.mockClear();
    await run({ view: 'problems' });
    expect(mainQuery().sql).toContain(PROBLEMS_SQL);
  });

  it('unknown view is ignored (legacy behavior)', async () => {
    await run({ view: 'nope' });
    expect(mainQuery().sql).not.toContain(TO_SHIP_SQL);
  });

  it('include=counts returns counts from one cached query; lastPulledAt and etsyShopNames on new-UI calls', async () => {
    const r = await run({ view: 'to_ship', include: 'counts' });
    expect(r.statusCode).toBe(200);
    expect(r.body.counts).toEqual({ to_ship: 12, overdue: 3, label_created: 4, problems: 1 });
    expect(r.body.lastPulledAt).toBe('2026-10-15T10:00:00.000Z');
    expect(r.body.etsyShopNames).toEqual(['BelleCoutureGifts']);
    const countCalls = () => queryRaw.mock.calls.filter((c) => c[0] === VIEW_COUNT_QUERIES.to_ship);
    expect(countCalls()).toHaveLength(1);
    expect(countCalls()[0].slice(1)).toEqual(['u1']);
    await run({ view: 'overdue', include: 'counts' });
    expect(countCalls()).toHaveLength(1); // cached while the fingerprint is unchanged
  });

  it('a pull / label / live event changes the fingerprint and the next call recounts', async () => {
    const countCalls = () => queryRaw.mock.calls.filter((c) => c[0] === VIEW_COUNT_QUERIES.to_ship);
    await run({ view: 'to_ship', include: 'counts' });
    fingerprint = 'fp2';
    await run({ view: 'to_ship', include: 'counts' });
    expect(countCalls()).toHaveLength(2);
    expect(queryRaw.mock.calls.filter((c) => c[0] === VIEW_COUNTS_FINGERPRINT_SQL)[0].slice(1)).toEqual(['u1']);
  });

  it('no fingerprint (query failed) means no caching', async () => {
    fingerprint = null;
    const countCalls = () => queryRaw.mock.calls.filter((c) => c[0] === VIEW_COUNT_QUERIES.to_ship);
    await run({ view: 'to_ship', include: 'counts' });
    await run({ view: 'to_ship', include: 'counts' });
    expect(countCalls()).toHaveLength(2);
  });

  it('lastPulledAt is the newest of User.lastSyncedAt and the last completed order SyncOperation', async () => {
    findSyncOp.mockResolvedValue({ updatedAt: new Date('2026-10-15T11:30:00Z') });
    const r = await run({ view: 'to_ship' });
    expect(r.body.lastPulledAt).toBe('2026-10-15T11:30:00.000Z');
    expect(findSyncOp.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1', status: 'completed', type: { not: 'product' } }, orderBy: { updatedAt: 'desc' } });
    findUser.mockResolvedValue({ lastSyncedAt: null });
    findSyncOp.mockResolvedValue(null);
    expect((await run({ view: 'to_ship' })).body.lastPulledAt).toBeNull();
  });

  it('legacy calls keep the old response shape', async () => {
    const r = await run({ labelFilter: 'unlabeled', context: 'labelsPage' });
    expect(Object.keys(r.body).sort()).toEqual(['orders', 'page', 'pageSize', 'total']);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('a failing counts/lastPulled lookup never 500s', async () => {
    findUser.mockRejectedValue(new Error('db'));
    queryRaw.mockImplementation(async (sql: string) => {
      if (sql === VIEW_COUNT_QUERIES.to_ship) throw new Error('timeout');
      if (String(sql).includes('COUNT(*) as total')) return [{ total: '0' }];
      return [];
    });
    const r = await run({ view: 'all', include: 'counts' });
    expect(r.statusCode).toBe(200);
    expect(r.body.counts).toBeUndefined();
    expect(r.body.lastPulledAt).toBeNull();
  });

  it('ids=<id> filters by id with an array param (A3), counted in the total query too', async () => {
    await run({ ids: 'o1,o2' });
    const { sql, params } = mainQuery();
    expect(sql).toContain('o.id = ANY($2::text[])');
    expect(params[1]).toEqual(['o1', 'o2']);
    const count = queryRaw.mock.calls.find((c) => String(c[0]).includes('COUNT(*) as total'))!;
    expect(count.slice(1)).toEqual(['u1', ['o1', 'o2']]);
  });

  it('limit is capped at 250', async () => {
    const r = await run({ limit: '5000' });
    expect(r.body.pageSize).toBe(MAX_ORDERS_PAGE_SIZE);
    const { params } = mainQuery();
    expect(params.slice(-2)).toEqual([250, 0]);
  });

  it('normalized status keys become clauses; legacy values still bind params; both OR together', async () => {
    await run({ status: ['shipped', 'onaylandi'] });
    const { sql, params } = mainQuery();
    expect(sql.replace(/\s+/g, ' ')).toMatch(/AND \(\(.*'kargolandi'.*\) OR LOWER\(o\."status"\) IN \(/);
    expect(params).toContain('paid');
    expect(partitionStatusValues(['to_ship', 'Delivered', 'iptal'])).toEqual({ keys: ['to_ship'], legacy: ['Delivered', 'iptal'] });
  });

  it('with a view, shipBy sorts by the effective ship-by, unknown last', async () => {
    await run({ view: 'to_ship', sortBy: 'shipBy', sort: 'asc' });
    expect(mainQuery().sql).toContain(`ORDER BY (${EFFECTIVE_SHIP_BY_SQL}) ASC NULLS LAST`);
    queryRaw.mockClear();
    await run({ sortBy: 'shipBy', sort: 'asc' });
    expect(mainQuery().sql).toContain('CASE WHEN');
  });

  it('A2: label jobs carry createdAt and errorMessage', async () => {
    const r = await run({ view: 'all' });
    const itemSql = queryRaw.mock.calls.find((c) => String(c[0]).includes('FROM "OrderItem" oi'))![0];
    expect(itemSql).toContain('lj."createdAt" as "labelJobCreatedAt"');
    expect(itemSql).toContain('lj."errorMessage" as "labelJobError"');
    expect(r.body.orders[0].line_items[0].labelJobs[0]).toEqual({
      status: 'failed', trackingNumber: undefined, carrier: undefined, pdfUrl: undefined,
      createdAt: '2026-10-14T10:00:00.000Z', errorMessage: 'Bad postal',
    });
  });
});

describe('/api/orders/manual A8', () => {
  it('duplicate order number → 400 with code', async () => {
    findOrder.mockResolvedValue({ id: 'x' });
    const r = res();
    await manualHandler(
      { method: 'POST', body: { customerName: 'A', orderNumber: 'IG-1', street1: 's', city: 'c', postal: 'p', items: [{ productName: 'x', quantity: 1, unitPrice: 1, weight: 1 }] } } as any,
      r,
    );
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'Bu sipariş numarası zaten mevcut', code: DUPLICATE_ORDER_NUMBER });
  });
});
