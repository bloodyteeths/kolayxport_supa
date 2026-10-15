// BR-11: batch form of GET /api/stock/etsy-managed (?ids=…) — id parsing, the 500 cap, ownership, one map back.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeListingIds, parseManagedIdsParam, ETSY_MANAGED_MAX_IDS } from '@/lib/stock/managedIds';

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  shops: ['555'],
  cache: [] as Array<{ etsyShopId: string; etsyListingId: bigint }>,
  many: vi.fn(),
}));
vi.mock('@/lib/stock/api', () => ({
  stockAuth: async () => h.userId,
  fail: (res: any, status: number, code: string) => res.status(status).json({ error: code }),
  serverError: (res: any) => res.status(500).json({ error: 'internal_error' }),
  qstr: (v: unknown) => (Array.isArray(v) ? (v[0] !== undefined ? String(v[0]) : undefined) : v == null ? undefined : String(v)),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    etsyShop: {
      findFirst: async (a: any) => (h.shops.includes(a.where.shopId) ? { shopId: a.where.shopId } : null),
      findMany: async () => h.shops.map((shopId) => ({ shopId })),
    },
    etsyListing: { findMany: async () => h.cache },
  },
}));
vi.mock('@/lib/stock/etsyDraftHook', () => ({
  etsyManagedVariants: vi.fn(),
  etsyManagedVariantsMany: (...a: unknown[]) => h.many(...a),
}));

import handler from '../../pages/api/stock/etsy-managed';

function res() {
  const r: any = { statusCode: 0, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = () => undefined;
  return r;
}
const get = async (query: Record<string, unknown>) => {
  const r = res();
  await handler({ method: 'GET', query, headers: {} } as any, r);
  return r;
};

beforeEach(() => {
  h.userId = 'u1';
  h.shops = ['555'];
  h.cache = [];
  h.many.mockReset();
  h.many.mockImplementation(async (_u: string, m: Map<string, string | null>) => ({
    live: true,
    listings: Object.fromEntries([...m.keys()].map((id) => [id, { managed: false, live: true, variants: [] }])),
  }));
});

describe('parseManagedIdsParam / normalizeListingIds', () => {
  it('accepts comma lists and repeated params, dedupes and sorts numerically', () => {
    expect(parseManagedIdsParam('30,4,100,4')).toEqual({ ok: true, ids: ['4', '30', '100'] });
    expect(parseManagedIdsParam(['2,1', '3'])).toEqual({ ok: true, ids: ['1', '2', '3'] });
    expect(parseManagedIdsParam(' 5 , 6 ')).toEqual({ ok: true, ids: ['5', '6'] });
  });
  it('rejects empty, non-numeric and too many ids', () => {
    expect(parseManagedIdsParam('')).toEqual({ ok: false, code: 'invalid_listing' });
    expect(parseManagedIdsParam(undefined)).toEqual({ ok: false, code: 'invalid_listing' });
    expect(parseManagedIdsParam('1,abc')).toEqual({ ok: false, code: 'invalid_listing' });
    const tooMany = Array.from({ length: ETSY_MANAGED_MAX_IDS + 1 }, (_, i) => i + 1).join(',');
    expect(parseManagedIdsParam(tooMany)).toEqual({ ok: false, code: 'too_many_ids' });
    expect(parseManagedIdsParam(Array.from({ length: ETSY_MANAGED_MAX_IDS }, (_, i) => i + 1).join(',')).ok).toBe(true);
  });
  it('builds the same key for the same ids in any order / type', () => {
    expect(normalizeListingIds([BigInt(20), '3', 3, null, undefined, 'x']).join(',')).toBe('3,20');
    expect(normalizeListingIds(['20', BigInt(3)]).join(',')).toBe('3,20');
  });
});

describe('GET /api/stock/etsy-managed?ids=', () => {
  it('400 on bad ids', async () => {
    expect((await get({ ids: '1,x' })).body).toEqual({ error: 'invalid_listing' });
    expect((await get({ ids: Array.from({ length: 501 }, (_, i) => i + 1).join(',') })).statusCode).toBe(400);
    expect(h.many).not.toHaveBeenCalled();
  });
  it('404 for a shop that is not the user’s', async () => {
    const r = await get({ ids: '1,2', shopId: '999' });
    expect(r.statusCode).toBe(404);
    expect(h.many).not.toHaveBeenCalled();
  });
  it('with shopId: every id maps to that shop; one call, map back', async () => {
    const r = await get({ ids: '2,1', shopId: '555' });
    expect(r.statusCode).toBe(200);
    expect(h.many).toHaveBeenCalledTimes(1);
    expect([...h.many.mock.calls[0][1].entries()]).toEqual([['1', '555'], ['2', '555']]);
    expect(Object.keys(r.body.listings)).toEqual(['1', '2']);
  });
  it('without shopId: resolves owned shops from the listing cache; unknown ids stay unmanaged', async () => {
    h.cache = [{ etsyShopId: '555', etsyListingId: BigInt(7) }];
    const r = await get({ ids: '7,8' });
    expect(r.statusCode).toBe(200);
    expect([...h.many.mock.calls[0][1].entries()]).toEqual([['7', '555'], ['8', null]]);
  });
  it('the single-listing form is unchanged (400 without listingId)', async () => {
    expect((await get({})).body).toEqual({ error: 'invalid_listing' });
  });
});
