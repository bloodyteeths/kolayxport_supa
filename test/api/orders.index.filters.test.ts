import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRaw = vi.fn();
vi.mock('../../lib/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => queryRaw(...a) } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));

import handler, { queryValues, expandStatusFilter } from '../../pages/api/orders/index';

function run(query: Record<string, any>) {
  const res: any = { statusCode: 0, body: undefined, setHeader: vi.fn() };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return handler({ method: 'GET', query } as any, res).then(() => res);
}

/** SQL + params of the main orders query (first call). */
function mainQuery() {
  const [sql, ...params] = queryRaw.mock.calls[0];
  return { sql: String(sql), params };
}

beforeEach(() => {
  queryRaw.mockReset();
  queryRaw.mockImplementation(async (sql: string) => (String(sql).includes('COUNT(*)') ? [{ total: '0' }] : []));
});

describe('queryValues / expandStatusFilter', () => {
  it('handles repeated, single and comma-joined values', () => {
    expect(queryValues(['Etsy', 'Trendyol'])).toEqual(['Etsy', 'Trendyol']);
    expect(queryValues('Shop, Inc')).toEqual(['Shop, Inc']);
    expect(queryValues('a,b', true)).toEqual(['a', 'b']);
    expect(queryValues(undefined)).toEqual([]);
  });

  it('needs-label group is lowercase and includes live variants but not unpaid states', () => {
    const s = expandStatusFilter(['onaylandi']);
    expect(s).toEqual(expect.arrayContaining(['paid', 'pending', 'awaiting_shipment', 'awaiting_fulfillment', 'unshipped']));
    expect(s).not.toContain('awaiting_payment');
    expect(s).not.toContain('pending_payment');
    expect(expandStatusFilter(['Delivered'])).toEqual(['delivered', 'completed']);
    expect(expandStatusFilter(['SHIPPED'])).toEqual(['shipped']);
  });
});

describe('/api/orders filters', () => {
  it('matches multiple marketplaces sent as repeated params', async () => {
    const res = await run({ marketplace: ['Etsy', 'Trendyol'], context: 'labelsPage' });
    expect(res.statusCode).toBe(200);
    const { sql, params } = mainQuery();
    expect(sql).toMatch(/o\."marketplace" IN \(\$2, \$3\)/);
    expect(params).toEqual(expect.arrayContaining(['Etsy', 'Trendyol']));
  });

  it('status filter is case-insensitive and the unpaid exclusion stays', async () => {
    await run({ status: 'onaylandi' });
    const { sql, params } = mainQuery();
    expect(sql).toContain(`LOWER(o."status") NOT IN ('awaiting_payment', 'pending_payment')`);
    expect(sql).toMatch(/LOWER\(o\."status"\) IN \(/);
    expect(params).toContain('pending');
  });

  it('senkron page keeps exact customStatus matching with comma-joined statuses', async () => {
    await run({ status: 'inProduction,shipped', context: 'senkronPage' });
    const { sql, params } = mainQuery();
    expect(sql).toContain('sod."customStatus" IN ($2, $3)');
    expect(params.slice(0, 3)).toEqual(['u1', 'inProduction', 'shipped']);
  });

  it('count query receives the same filter params as the main query', async () => {
    await run({ marketplace: ['A', 'B'], status: 'iptal' });
    const main = queryRaw.mock.calls[0];
    const count = queryRaw.mock.calls.find(c => String(c[0]).includes('COUNT(*)'))!;
    expect(count.slice(1)).toEqual(main.slice(1, main.length - 2));
  });

  it('ignores a malformed startDate instead of 500ing', async () => {
    const res = await run({ startDate: 'garbage' });
    expect(res.statusCode).toBe(200);
    expect(mainQuery().sql).not.toContain('>= $');
  });
});
