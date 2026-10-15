import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRaw = vi.fn();
vi.mock('../../lib/prisma', () => ({ default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));

import handler, * as ordersRoute from '../../pages/api/orders/index';
import { buildFilterSql } from '../../pages/api/orders/export';
import {
  FAILED_LABEL_SQL,
  FAILED_LABEL_WINDOW_DAYS,
  HAS_LABEL_SQL,
  LABELED_SQL,
  LISTED_ORDER_SQL,
  STATUS_FILTER_GROUPS,
  UNLABELED_SQL,
  expandStatusFilter,
  isFailedLabelOrder,
  type OrderViewFacts,
} from '../../lib/orders/views';

const NOW = new Date('2026-10-15T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function run(query: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: undefined, setHeader: vi.fn() };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return handler({ method: 'GET', query } as any, res).then(() => res);
}

beforeEach(() => {
  queryRaw.mockReset();
  queryRaw.mockImplementation(async (sql: string) => (String(sql).includes('COUNT(*)') ? [{ total: '0' }] : []));
});

describe('status groups moved to lib/orders/views.ts', () => {
  it('the orders route re-exports the same objects', () => {
    expect(ordersRoute.STATUS_FILTER_GROUPS).toBe(STATUS_FILTER_GROUPS);
    expect(ordersRoute.expandStatusFilter).toBe(expandStatusFilter);
  });

  it('live group excludes unpaid states; unknown values pass through lowercased', () => {
    expect(STATUS_FILTER_GROUPS.onaylandi).not.toContain('awaiting_payment');
    expect(STATUS_FILTER_GROUPS.onaylandi).not.toContain('pending_payment');
    expect(expandStatusFilter(['IPTAL', ' Foo ', ''])).toEqual([...STATUS_FILTER_GROUPS.iptal, 'foo']);
  });
});

describe('LABELED_SQL / FAILED_LABEL_SQL', () => {
  it('LABELED_SQL is the has-label rule and UNLABELED_SQL its negation', () => {
    expect(LABELED_SQL).toBe(HAS_LABEL_SQL);
    expect(UNLABELED_SQL).toBe(`NOT ${LABELED_SQL}`);
  });

  it('failed = unlabeled AND a failed LabelJob updated within the window', () => {
    expect(FAILED_LABEL_SQL.startsWith(`(${UNLABELED_SQL} AND EXISTS (`)).toBe(true);
    expect(FAILED_LABEL_SQL).toContain(`LOWER(flj.status) = 'failed'`);
    expect(FAILED_LABEL_SQL).toContain(`flj."updatedAt" >= NOW() - INTERVAL '${FAILED_LABEL_WINDOW_DAYS} days'`);
    expect(FAILED_LABEL_WINDOW_DAYS).toBe(14);
    // Balanced parentheses: it is composed into larger WHERE clauses.
    const open = (FAILED_LABEL_SQL.match(/\(/g) ?? []).length;
    const close = (FAILED_LABEL_SQL.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
    // The dead order-level value is not the rule any more.
    expect(FAILED_LABEL_SQL).not.toContain(`o."labelStatus" = 'failed'`);
  });

  it('/api/orders?labelStatus=failed uses exactly the shared clause on the listed base (parity with Overview)', async () => {
    const res = await run({ labelStatus: 'failed' });
    expect(res.statusCode).toBe(200);
    const sql = String(queryRaw.mock.calls[0][0]);
    expect(sql).toContain(`AND ${FAILED_LABEL_SQL}`);
    expect(sql).not.toMatch(/AND o\."labelStatus" = 'failed'/);
    expect(sql).toContain(`LOWER(o."status") NOT IN ('awaiting_payment', 'pending_payment')`);
    // The base clause of the route is LISTED_ORDER_SQL, so `userId AND LISTED AND FAILED` counts the same rows.
    expect(LISTED_ORDER_SQL).toBe(`LOWER(o."status") NOT IN ('awaiting_payment', 'pending_payment')`);
    const count = queryRaw.mock.calls.find((c) => String(c[0]).includes('COUNT(*)'));
    expect(String(count?.[0])).toContain(FAILED_LABEL_SQL);
  });
});

describe('isFailedLabelOrder (pure twin of FAILED_LABEL_SQL)', () => {
  const base = (over: Partial<OrderViewFacts> = {}): OrderViewFacts => ({ status: 'paid', marketplace: 'Etsy', ...over });
  const job = (status: string, updatedAt: Date | null, createdAt: Date | null = updatedAt) => ({ status, updatedAt, createdAt });

  it('counts an unlabeled order with a recent failed job', () => {
    expect(isFailedLabelOrder(base({ items: [{ labelJobs: [job('failed', daysAgo(1))] }] }), NOW)).toBe(true);
    expect(isFailedLabelOrder(base({ items: [{ labelJobs: [job('FAILED', daysAgo(13.9))] }] }), NOW)).toBe(true);
  });

  it('ignores failures older than 14 days', () => {
    expect(isFailedLabelOrder(base({ items: [{ labelJobs: [job('failed', daysAgo(15))] }] }), NOW)).toBe(false);
  });

  it('a label made after the failure clears it (still-unlabeled rule)', () => {
    const row = base({ items: [{ labelJobs: [job('failed', daysAgo(2)), job('created', daysAgo(1))] }] });
    expect(isFailedLabelOrder(row, NOW)).toBe(false);
    expect(isFailedLabelOrder(base({ trackingNumber: '1Z', items: [{ labelJobs: [job('failed', daysAgo(1))] }] }), NOW)).toBe(false);
  });

  it('a voided label with a recent failure counts as failed', () => {
    const row = base({ labelStatus: 'voided', trackingNumber: '1Z', items: [{ labelJobs: [job('failed', daysAgo(1))] }] });
    expect(isFailedLabelOrder(row, NOW)).toBe(true);
  });

  it('order-level labelStatus=failed alone is not a failure (nothing writes it)', () => {
    expect(isFailedLabelOrder(base({ labelStatus: 'failed' }), NOW)).toBe(false);
  });

  it('falls back to createdAt when updatedAt is missing; no date → not counted', () => {
    expect(isFailedLabelOrder(base({ items: [{ labelJobs: [job('failed', null, daysAgo(3))] }] }), NOW)).toBe(true);
    expect(isFailedLabelOrder(base({ items: [{ labelJobs: [job('failed', null, null)] }] }), NOW)).toBe(false);
  });

  it('/api/orders/export?labelStatus=failed uses the same clause as the list (export parity)', () => {
    const { where } = buildFilterSql('u1', { labelStatus: 'failed' });
    expect(where).toContain(`AND ${FAILED_LABEL_SQL}`);
    expect(where).not.toMatch(/AND o\."labelStatus" = 'failed'/);
  });
});
