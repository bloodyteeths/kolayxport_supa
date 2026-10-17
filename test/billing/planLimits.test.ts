import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks for the real middleware (parity run) ---------------------------
let dbUser: any = null;
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: async () => (dbUser ? { ...dbUser } : null),
      update: async () => ({}),
    },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notifications', () => ({
  notify: vi.fn(async () => {}),
  resolveByPrefix: vi.fn(async () => {}),
  invalidateResolveMemo: vi.fn(),
  notificationKeys: { usage: (a: string, b: string) => `usage:${a}:${b}` },
  NOTIFICATION_LINKS: { pricing: '/fiyatlandirma' },
}));

import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';
import {
  getPlanLimits,
  checkPlanLimit,
  DECIDED_PLAN_LIMITS,
  ENFORCED_PLAN_LIMITS,
  ENFORCED_TRIAL_LIMITS,
  getDecidedPlanLimits,
  ENFORCEMENT_GAP,
  type LimitKind,
} from '@/lib/billing/planLimits';

const NOW = Date.now();
const FUTURE = new Date(NOW + 5 * 86400_000);
const PAST = new Date(NOW - 5 * 86400_000);

async function runMiddleware(kind: LimitKind) {
  let called = false;
  const handler = async (_req: any, res: any) => {
    called = true;
    return res.status(200).json({ ok: true });
  };
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  await withUsageLimiter(handler, kind)({ method: 'POST', headers: {} } as any, res);
  return { called, res };
}

describe('getPlanLimits — enforced numbers', () => {
  it('trial 50/10, starter 200/100, growth 2000/500, enterprise and shopify_free unlimited', () => {
    expect(getPlanLimits('starter', 'trialing', FUTURE).limits).toEqual({ orderSync: 50, label: 10 });
    expect(getPlanLimits('starter', 'trialing', FUTURE).period).toBe('trial');
    expect(getPlanLimits('starter', 'active', null).limits).toEqual({ orderSync: 200, label: 100 });
    expect(getPlanLimits('growth', 'active', null).limits).toEqual({ orderSync: 2000, label: 500 });
    expect(getPlanLimits('growth', 'active', null).period).toBe('month');
    expect(getPlanLimits('enterprise', 'active', null).limits).toEqual({ orderSync: null, label: null });
    expect(getPlanLimits('shopify_free', null, null)).toMatchObject({ state: 'shopify_free', limits: { orderSync: null, label: null }, period: null });
  });

  it('blocked states expose 0 limits, never null (null means unlimited)', () => {
    expect(getPlanLimits('starter', 'canceled', null)).toMatchObject({ state: 'noSubscription', limits: { orderSync: 0, label: 0 }, period: null });
    expect(getPlanLimits(null, 'trialing', PAST)).toMatchObject({ state: 'noSubscription' });
    expect(getPlanLimits('pro', 'active', null)).toMatchObject({ state: 'invalidPlan', limits: { orderSync: 0, label: 0 } });
  });

  it('serialises to JSON without Infinity', () => {
    for (const p of Object.keys(ENFORCED_PLAN_LIMITS)) {
      const json = JSON.stringify(getPlanLimits(p, 'active', null));
      expect(json).not.toContain('Infinity');
      expect(JSON.parse(json).limits).toEqual(getPlanLimits(p, 'active', null).limits);
    }
  });

  it('enforced tables match the middleware source literally', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(require.resolve('../../lib/middleware/withUsageLimiter.ts'), 'utf8');
    expect(src).toMatch(/starter: \{ orderSyncLimit: 200, labelLimit: 100 \}/);
    expect(src).toMatch(/growth: \{ orderSyncLimit: 2000, labelLimit: 500 \}/);
    expect(src).toMatch(/enterprise: \{ orderSyncLimit: Infinity, labelLimit: Infinity \}/);
    expect(src).toMatch(/shopify_free: \{ orderSyncLimit: Infinity, labelLimit: Infinity \}/);
    expect(src).toMatch(/trialLimits = \{ orderSync: 50, label: 10 \}/);
    expect(ENFORCED_TRIAL_LIMITS).toEqual({ orderSync: 50, label: 10 });
  });
});

describe('middleware parity: withUsageLimiter decisions == getPlanLimits + checkPlanLimit', () => {
  beforeEach(() => { dbUser = null; });

  const plans = [null, 'trial', 'starter', 'growth', 'pro', 'enterprise', 'shopify_free', 'bogus'];
  const statuses = [null, 'trialing', 'active', 'canceled', 'past_due', 'incomplete'];
  const trialDates = [null, PAST, FUTURE];
  const counts = [0, 9, 10, 49, 50, 99, 100, 199, 200, 499, 500, 1999, 2000, 1_000_000];
  const kinds: LimitKind[] = ['orderSync', 'label'];

  const cases: Array<[string | null, string | null, Date | null, LimitKind, number]> = [];
  for (const p of plans) for (const s of statuses) for (const t of trialDates) for (const k of kinds) for (const c of counts) cases.push([p, s, t, k, c]);

  it(`agrees on all ${cases.length} combinations`, async () => {
    const mismatches: string[] = [];
    for (const [plan, status, trial, kind, used] of cases) {
      dbUser = {
        id: 'u1',
        subscriptionPlan: plan,
        subscriptionStatus: status,
        trialExpiresAt: trial,
        orderSyncCount: kind === 'orderSync' ? used : 0,
        labelCount: kind === 'label' ? used : 0,
        usageResetAt: new Date(NOW + 20 * 86400_000), // no reset during the check
      };
      const { called, res } = await runMiddleware(kind);
      const decision = getPlanLimits(plan, status, trial);
      const expected = checkPlanLimit(decision, kind, used);
      const label = JSON.stringify({ plan, status, trial: trial && (trial < new Date() ? 'past' : 'future'), kind, used });
      if (called !== expected.allowed) {
        mismatches.push(`${label}: middleware allowed=${called}, planLimits allowed=${expected.allowed}`);
        continue;
      }
      if (!called) {
        const b = res.body;
        const want = {
          error: 'Payment Required',
          limitType: kind,
          reason: expected.reason,
          ...(expected.used !== undefined ? { used: expected.used } : {}),
          ...(expected.limit !== undefined ? { limit: expected.limit } : {}),
          ...(decision.plan ? { plan: decision.plan } : {}),
        };
        const got = { ...b };
        delete got.details;
        if (JSON.stringify(sortKeys(got)) !== JSON.stringify(sortKeys(want))) {
          mismatches.push(`${label}: body ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

function sortKeys(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

describe('decided tiers (design/launch/tiers.md §1)', () => {
  it('has Trial, Starter, Growth, Pro, Enterprise and shopify_free with the decided limits', () => {
    expect(Object.keys(DECIDED_PLAN_LIMITS).sort()).toEqual(['enterprise', 'growth', 'pro', 'shopify_free', 'starter', 'trial']);
    expect(DECIDED_PLAN_LIMITS.trial.limits).toEqual({ orders: 150, labels: 30, connectedStores: 3, aiCredits: 200 });
    expect(DECIDED_PLAN_LIMITS.starter.limits).toEqual({ orders: 500, labels: 250, connectedStores: 2, aiCredits: 300 });
    expect(DECIDED_PLAN_LIMITS.growth.limits).toEqual({ orders: 2000, labels: 1000, connectedStores: 5, aiCredits: 1500 });
    expect(DECIDED_PLAN_LIMITS.pro.limits).toEqual({ orders: 6000, labels: 3000, connectedStores: 10, aiCredits: 3000 });
    expect(DECIDED_PLAN_LIMITS.enterprise.limits).toEqual({ orders: null, labels: null, connectedStores: null, aiCredits: 10000 });
    expect(DECIDED_PLAN_LIMITS.shopify_free.limits).toEqual({ orders: null, labels: null, connectedStores: 1, aiCredits: 100 });
  });

  it('never upsells Stripe to shopify_free or enterprise (rule 1.2.1)', () => {
    expect(DECIDED_PLAN_LIMITS.shopify_free.stripeUpsell).toBe(false);
    expect(DECIDED_PLAN_LIMITS.enterprise.stripeUpsell).toBe(false);
  });

  it('getDecidedPlanLimits ignores unknown keys and prototype names', () => {
    expect(getDecidedPlanLimits('pro')?.limits.orders).toBe(6000);
    expect(getDecidedPlanLimits('bogus')).toBeUndefined();
    expect(getDecidedPlanLimits('toString')).toBeUndefined();
    expect(getDecidedPlanLimits(null)).toBeUndefined();
  });

  it('the documented gap matches the two tables (pins it until the billing track closes it)', () => {
    expect(ENFORCEMENT_GAP.length).toBeGreaterThan(0);
    // Every plan listed with a label gap really differs.
    for (const g of ENFORCEMENT_GAP.filter((x) => x.meter === 'label→labels')) {
      const enforced = g.plan === 'trial' ? ENFORCED_TRIAL_LIMITS.label : (ENFORCED_PLAN_LIMITS as any)[g.plan].label;
      expect(enforced).not.toBe(DECIDED_PLAN_LIMITS[g.plan].limits.labels);
    }
    expect('pro' in ENFORCED_PLAN_LIMITS).toBe(false);
  });
});
