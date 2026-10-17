// In-memory stand-in for the Prisma calls lib/ext/researchQuota.ts makes:
// researchCache.findUnique/findMany/upsert, user.findUnique and the atomic counter
// `$queryRaw` (INSERT … ON CONFLICT DO UPDATE … RETURNING count). Tests mock '@/lib/prisma'
// with `fakePrisma` (plus whatever else the endpoint under test needs).

export interface Row { userId: string; cacheKey: string; data: any; expiresAt: Date }
export interface FakeUser { subscriptionPlan: string | null; subscriptionStatus: string | null; trialExpiresAt: Date | null }

const rows = new Map<string, Row>();
const users = new Map<string, FakeUser>();
const key = (u: string, c: string) => `${u}\u0000${c}`;
let queryRawCalls = 0;

export const fakePrisma = {
  researchCache: {
    findUnique: async ({ where }: any) => {
      const { userId, cacheKey } = where.userId_cacheKey;
      const r = rows.get(key(userId, cacheKey));
      return r ? { ...r } : null;
    },
    findMany: async ({ where }: any) =>
      [...rows.values()].filter((r) =>
        r.userId === where.userId &&
        (!where.cacheKey?.in || where.cacheKey.in.includes(r.cacheKey)) &&
        (!where.expiresAt?.gt || r.expiresAt > where.expiresAt.gt)),
    upsert: async ({ where, create, update }: any) => {
      const { userId, cacheKey } = where.userId_cacheKey;
      const existing = rows.get(key(userId, cacheKey));
      const next: Row = existing
        ? { ...existing, data: update.data, expiresAt: update.expiresAt }
        : { userId, cacheKey, data: create.data, expiresAt: create.expiresAt };
      rows.set(key(userId, cacheKey), next);
      return next;
    },
  },
  user: {
    findUnique: async ({ where }: any) => users.get(where.id) ?? null,
  },
  // Values in template order: id, userId, cacheKey, delta, expiresAt, now, …
  $queryRaw: async (_strings: TemplateStringsArray, ...values: any[]) => {
    queryRawCalls++;
    const [, userId, cacheKey, delta, expiresAt, now] = values as [string, string, string, number, Date, Date];
    const k = key(userId, cacheKey);
    const r = rows.get(k);
    let count: number;
    if (!r || r.expiresAt <= now) {
      count = delta;
      rows.set(k, { userId, cacheKey, data: { count }, expiresAt: r && r.expiresAt > now ? r.expiresAt : expiresAt });
    } else {
      count = (Number(r.data?.count) || 0) + delta;
      rows.set(k, { ...r, data: { ...(r.data || {}), count } });
    }
    return [{ count }];
  },
};

export const store = {
  rows,
  users,
  reset() {
    rows.clear();
    users.clear();
    queryRawCalls = 0;
  },
  setUser(id: string, plan: string | null, status: string | null = 'active', trialExpiresAt: Date | null = null) {
    users.set(id, { subscriptionPlan: plan, subscriptionStatus: status, trialExpiresAt });
  },
  setCount(userId: string, cacheKey: string, count: number, expiresAt = new Date(Date.now() + 86400000)) {
    rows.set(key(userId, cacheKey), { userId, cacheKey, data: { count }, expiresAt });
  },
  count(userId: string, cacheKey: string): number {
    return Number(rows.get(key(userId, cacheKey))?.data?.count ?? 0);
  },
  get(userId: string, cacheKey: string): Row | undefined {
    return rows.get(key(userId, cacheKey));
  },
  snapshot(): string {
    return JSON.stringify([...rows.entries()].sort());
  },
  get queryRawCalls() {
    return queryRawCalls;
  },
};

/** Minimal NextApiResponse capture. */
export function makeRes() {
  const headers: Record<string, string> = {};
  const state = { status: 0, body: null as any };
  const r: any = {
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; return r; },
    getHeader: (k: string) => headers[k.toLowerCase()],
    status: (c: number) => { state.status = c; return r; },
    json: (b: any) => { state.body = b; return r; },
    send: (b: any) => { state.body = b; return r; },
    end: () => r,
    headers,
    state,
  };
  return r;
}
