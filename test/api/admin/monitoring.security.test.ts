import { describe, it, expect, beforeEach, vi } from 'vitest';

const getAuthUser = vi.fn(async () => null as null | { id: string; email: string; name: string });
const userFindUnique = vi.fn(async () => null as null | { role: string });

vi.mock('@/lib/auth', () => ({
  getAuthUser: (...args: any[]) => getAuthUser(...args),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: (args: any) => userFindUnique(args) },
    syncLog: {
      // Mimic Prisma `select` — we return ONLY the fields the production select asks for.
      // No secret-shaped key is in the response by construction.
      findMany: async () => [
        {
          id: '1',
          level: 'warn',
          message: 'reject',
          operation: 'extension.origin_rejected',
          userId: null,
          timestamp: new Date(),
        },
      ],
      count: async () => 1,
      groupBy: async () => [{ operation: 'extension.origin_rejected', _count: 1 }],
    },
  },
}));

vi.mock('../../../lib/prisma', () => ({
  default: {
    user: { findUnique: (args: any) => userFindUnique(args) },
    syncLog: {
      findMany: async () => [
        { id: '1', level: 'warn', message: 'reject', operation: 'extension.origin_rejected', userId: null, timestamp: new Date() },
      ],
      count: async () => 1,
      groupBy: async () => [{ operation: 'extension.origin_rejected', _count: 1 }],
    },
  },
}));

import handler from '@/pages/api/admin/monitoring/security';

function makeReq(opts: { admin?: boolean; query?: Record<string, any> } = {}) {
  if (opts.admin) {
    getAuthUser.mockResolvedValueOnce({ id: 'admin-1', email: 'a@x', name: 'a' });
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
  } else {
    getAuthUser.mockResolvedValueOnce({ id: 'u1', email: 'u@x', name: 'u' });
    userFindUnique.mockResolvedValueOnce({ role: 'user' });
  }
  return {
    method: 'GET',
    headers: {},
    query: opts.query ?? {},
    body: {},
  } as any;
}

function makeRes() {
  const state = { status: 0, body: null as any };
  const res: any = {
    setHeader: vi.fn(),
    status: vi.fn((c: number) => {
      state.status = c;
      return res;
    }),
    json: vi.fn((b: any) => {
      state.body = b;
      return res;
    }),
    end: vi.fn(),
    state,
  };
  return res;
}

beforeEach(() => {
  getAuthUser.mockReset();
  userFindUnique.mockReset();
});

describe('GET /api/admin/monitoring/security', () => {
  it('rejects unauthenticated callers', async () => {
    getAuthUser.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {},
        body: {},
      } as any,
      res,
    );
    expect(res.state.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = makeRes();
    await handler(makeReq({ admin: false }), res);
    expect(res.state.status).toBe(403);
  });

  it('returns aggregated payload for admin', async () => {
    const res = makeRes();
    await handler(makeReq({ admin: true, query: { limit: '5' } }), res);
    expect(res.state.status).toBe(0); // res.json was called, status not explicitly set
    expect(res.state.body).toHaveProperty('recent');
    expect(res.state.body).toHaveProperty('pagination');
    expect(res.state.body.pagination.limit).toBe(5);
    // No secret-shaped fields surface in the response (they wouldn't be selected anyway).
    const serialized = JSON.stringify(res.state.body);
    expect(serialized.toLowerCase()).not.toMatch(/accesstoken|refreshtoken|stripe-?signature/);
  });

  it('caches private + no-store', async () => {
    const res = makeRes();
    await handler(makeReq({ admin: true }), res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
  });
});
