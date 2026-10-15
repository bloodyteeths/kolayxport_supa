// BR-1c / BR-7 / BR-8 backend for the R3 Shop tracker: shared daily snapshot dedupe (day key + unique index),
// alert rule evaluation, the Etsy daily-budget stop, notification registry entries and the scheduler job.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store, p, gate, notifySpy } = vi.hoisted(() => ({
  store: { watches: [] as any[], snaps: [] as any[] },
  gate: { ok: true, reason: 'budget' as string | undefined },
  notifySpy: vi.fn(),
  p: {
    user: { findUnique: vi.fn() },
    shopifyShop: { count: vi.fn() },
  },
}));

function matches(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const f = v as any;
      if ('in' in f && !f.in.includes(row[k])) return false;
      if ('gte' in f && !(row[k] >= f.gte)) return false;
      if ('lt' in f && !(row[k] < f.lt)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
let seq = 0;
const watchDelegate = {
  findMany: async ({ where }: any) => store.watches.filter((w) => matches(w, where)),
  findFirst: async ({ where }: any) => store.watches.find((w) => matches(w, where)) ?? null,
  count: async ({ where }: any) => store.watches.filter((w) => matches(w, where)).length,
  create: async ({ data }: any) => { const row = { id: `watch${++seq}`, createdAt: new Date(), ...data }; store.watches.push(row); return row; },
  update: async ({ where, data }: any) => Object.assign(store.watches.find((w) => w.id === where.id), data),
};
/** Enforces the BR-1c unique key (type, marketplace, refId, day) like Postgres does (P2002). */
const snapDelegate = {
  findMany: async ({ where }: any) => store.snaps.filter((s) => matches(s, where)).sort((a, b) => a.takenAt - b.takenAt),
  findFirst: async ({ where }: any) => store.snaps.find((s) => matches(s, where)) ?? null,
  create: async ({ data }: any) => {
    if (!(data.day instanceof Date)) throw new Error('day missing');
    const dup = store.snaps.find((s) => s.type === data.type && s.marketplace === data.marketplace && s.refId === data.refId && s.day?.getTime() === data.day.getTime());
    if (dup) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const row = { id: `snap${++seq}`, ...data };
    store.snaps.push(row);
    return row;
  },
  deleteMany: async ({ where }: any) => { const n = store.snaps.length; store.snaps = store.snaps.filter((s) => !matches(s, where)); return { count: n - store.snaps.length }; },
};
const cache = new Map<string, unknown>();

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, {
    get(_t, key: string) {
      if (key === 'researchWatch') return watchDelegate;
      if (key === 'researchSnapshot') return snapDelegate;
      if (key === 'researchCache') {
        return {
          findUnique: async ({ where }: any) => cache.get(where.userId_cacheKey.cacheKey) ?? null,
          upsert: async ({ where, create }: any) => { cache.set(where.userId_cacheKey.cacheKey, { data: create.data, expiresAt: create.expiresAt }); return {}; },
        };
      }
      return (p as Record<string, unknown>)[key];
    },
  }),
}));
vi.mock('@/lib/notifications', () => ({ notify: (...a: unknown[]) => notifySpy(...a) }));
vi.mock('@/lib/etsy/rateBudget', async (orig) => {
  const real = await orig<typeof import('@/lib/etsy/rateBudget')>();
  return { ...real, canSpend: vi.fn(() => (gate.ok ? { ok: true } : { ok: false, reason: gate.reason, retryAfterMs: 60_000 })) };
});
vi.mock('@/lib/etsy/http', async (orig) => {
  const real = await orig<typeof import('@/lib/etsy/http')>();
  return { ...real, etsyFetch: (url: string, init?: RequestInit) => fetch(url, init) };
});

import {
  DAY_MS, evaluateShopAlerts, insertSnapshot, runResearchSnapshots, snapshotCallsFor, snapshotDay, researchSnapshotsJob,
  type AlertRules, type RatePair,
} from '@/lib/research/watchAdapter';
import { getTypeDef, typesInGroup, NOTIFICATION_GROUPS } from '@/lib/notificationCenter/registry';
import { REQUIRED_NOTIFICATION_PARAMS, hasRequiredParams } from '@/lib/notificationCenter/params';
import { allJobs } from '@/lib/scheduler/jobs';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

const NOW = Date.parse('2026-10-15T06:00:00Z');
const day = (n: number) => new Date(NOW - n * DAY_MS);
const shopMetrics = (sold: number) => ({
  v: 1, kind: 'etsyShop', shopId: '77', name: 'W', url: null, iconUrl: null, createdAt: null, transactionSoldCount: sold,
  reviewCount: null, reviewAverage: null, activeCount: 3, currency: 'USD', listingsN: 3, listingsComplete: true, new7d: 0,
  oldestFetchedCreatedAt: null, price: null,
});
const listing = (id: number, createdMs: number) => ({
  listing_id: id, title: `Box ${id}`, price: { amount: 4500, divisor: 100, currency_code: 'USD' }, num_favorers: 1,
  tags: [], shop_id: 77, url: null, original_creation_timestamp: Math.floor(createdMs / 1000),
});
const fetchSpy = vi.fn();
const watch = (id: string, userId: string, alertRules: Partial<AlertRules>) => ({
  id, userId, type: 'etsyShop', marketplace: 'etsy', refId: '77', label: `L-${id}`, isActive: true, createdAt: day(20),
  alertRules: { newListing: true, priceDropPct: null, salesSpikeX: null, ...alertRules },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  seq = 0;
  store.watches = [];
  store.snaps = [];
  cache.clear();
  gate.ok = true;
  gate.reason = 'budget';
  p.user.findUnique.mockResolvedValue({ subscriptionPlan: 'starter', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null });
  p.shopifyShop.count.mockResolvedValue(0);
  fetchSpy.mockImplementation(async (url: string) => {
    const u = String(url);
    if (/\/shops\/77\/listings\/active/.test(u)) return new Response(JSON.stringify({ results: [listing(1, NOW - DAY_MS / 2), listing(2, NOW - 30 * DAY_MS)] }), { status: 200 });
    if (/\/shops\/77$/.test(u)) return new Response(JSON.stringify({ shop_id: 77, shop_name: 'W', transaction_sold_count: 1000, listing_active_count: 2, currency_code: 'USD' }), { status: 200 });
    return new Response('nf', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('BR-1c snapshot day key + dedupe', () => {
  it('day = UTC midnight of takenAt (late-evening Istanbul time stays on the UTC day)', () => {
    expect(snapshotDay(new Date('2026-10-15T23:59:59.999Z')).toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(snapshotDay('2026-10-16T00:00:00.000Z').toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('a second reading of the same subject on the same UTC day is a no-op; another day or subject is not', async () => {
    const base = { type: 'etsyShop' as const, marketplace: 'etsy', refId: '77', metrics: shopMetrics(1) as any };
    expect(await insertSnapshot({ ...base, takenAt: new Date('2026-10-15T06:00:00Z') })).toBe(true);
    expect(await insertSnapshot({ ...base, takenAt: new Date('2026-10-15T18:00:00Z') })).toBe(false);
    expect(await insertSnapshot({ ...base, takenAt: new Date('2026-10-16T00:10:00Z') })).toBe(true);
    expect(await insertSnapshot({ ...base, refId: '88', takenAt: new Date('2026-10-15T06:00:00Z') })).toBe(true);
    expect(store.snaps).toHaveLength(3);
  });

  it('cron: one shared reading for a shop watched by several users; a racing reading is not stored twice', async () => {
    store.watches.push(watch('wa000001', 'user-1', {}), watch('wa000002', 'user-2', {}));
    store.snaps.push({ id: 'prev', type: 'etsyShop', marketplace: 'etsy', refId: '77', day: snapshotDay(day(1)), takenAt: day(1), metrics: shopMetrics(990) });
    const s = await runResearchSnapshots();
    expect(s.shops).toEqual({ due: 1, taken: 1, failed: 0, alreadyToday: 0 });
    expect(store.snaps.filter((r) => r.refId === '77')).toHaveLength(2);
    expect(fetchSpy.mock.calls.filter(([u]) => /\/shops\/77$/.test(String(u)))).toHaveLength(1);

    // A first reading on add landed between the "reading today?" check and the insert: no second row, no alerts.
    notifySpy.mockClear();
    const today = store.snaps.find((r) => r.id !== 'prev')!;
    store.snaps = store.snaps.filter((r) => r !== today);
    const realFindFirst = snapDelegate.findFirst;
    snapDelegate.findFirst = async (args: any) => {
      const r = await realFindFirst(args);
      if (args?.where?.takenAt && !store.snaps.includes(today)) store.snaps.push(today); // the race
      return args?.where?.takenAt ? null : r;
    };
    try {
      const again = await runResearchSnapshots();
      expect(again.shops).toMatchObject({ taken: 0, alreadyToday: 1, failed: 0 });
      expect(store.snaps.filter((r) => r.refId === '77')).toHaveLength(2);
      expect(notifySpy).not.toHaveBeenCalled();
    } finally {
      snapDelegate.findFirst = realFindFirst;
    }
  });
});

describe('BR-7 alert evaluation + emission', () => {
  const flat = (n: number, rate: number, lastRate: number): RatePair[] => Array.from({ length: n }, (_, i) => ({
    end: NOW - (n - 1 - i) * DAY_MS, days: 1, delta: i === n - 1 ? lastRate : rate, rate: i === n - 1 ? lastRate : rate, flagged: false,
  }));
  const ok = (v: number) => ({ value: v, kind: 'measured' as const, guard: { ok: true } });
  const na = { value: null, kind: 'measured' as const, guard: { ok: false, reasonKey: 'x' } };

  it('new listings: only when the switch is on and there is a previous reading', () => {
    const rules: AlertRules = { newListing: true, priceDropPct: null, salesSpikeX: null };
    expect(evaluateShopAlerts(rules, { newSincePrev: 3, priceChange: na, pairs: [] })).toEqual([
      { type: 'researchShopNewListings', params: { count: 3 }, severity: 'info' },
    ]);
    expect(evaluateShopAlerts(rules, { newSincePrev: null, priceChange: na, pairs: [] })).toEqual([]);
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: na, pairs: [] })).toEqual([]);
    expect(evaluateShopAlerts({ ...rules, newListing: false }, { newSincePrev: 3, priceChange: na, pairs: [] })).toEqual([]);
  });

  it('price drop: at or past the threshold, guarded value only, not again once crossed', () => {
    const rules: AlertRules = { newListing: false, priceDropPct: 10, salesSpikeX: null };
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: ok(-0.12), pairs: [] })).toEqual([
      { type: 'researchShopPriceDrop', params: { pct: 12 }, severity: 'info' },
    ]);
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: ok(-0.05), pairs: [] })).toEqual([]);
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: na, pairs: [] })).toEqual([]);
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: ok(-0.2), prevPriceChange: ok(-0.15), pairs: [] })).toEqual([]);
    expect(evaluateShopAlerts({ ...rules, priceDropPct: null }, { newSincePrev: 0, priceChange: ok(-0.5), pairs: [] })).toEqual([]);
  });

  it('sales spike: needs ≥ 7 earlier rates and last ≥ X × their median', () => {
    const rules: AlertRules = { newListing: false, priceDropPct: null, salesSpikeX: 2 };
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: na, pairs: flat(8, 10, 25) })).toEqual([
      { type: 'researchShopSalesSpike', params: { sales: 25, ratio: 2.5 }, severity: 'info' },
    ]);
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: na, pairs: flat(8, 10, 15) })).toEqual([]);
    expect(evaluateShopAlerts(rules, { newSincePrev: 0, priceChange: na, pairs: flat(5, 10, 50) })).toEqual([]);
    expect(evaluateShopAlerts({ ...rules, salesSpikeX: null }, { newSincePrev: 0, priceChange: na, pairs: flat(8, 10, 50) })).toEqual([]);
  });

  it('cron raises the registered type per watcher rules with the params the registry requires', async () => {
    store.watches.push(watch('wa000001', 'user-1', { newListing: true }), watch('wa000002', 'user-2', { newListing: false }));
    store.snaps.push({ id: 'prev', type: 'etsyShop', marketplace: 'etsy', refId: '77', day: snapshotDay(day(1)), takenAt: day(1), metrics: shopMetrics(990) });
    const s = await runResearchSnapshots();
    expect(s.alerts).toEqual({ sent: 1, suppressed: 0 });
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [userId, input] = notifySpy.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(input).toMatchObject({ type: 'researchShopNewListings', titleKey: 'types.researchShopNewListings', dedupeKey: 'research:researchShopNewListings:wa000001:2026-10-15' });
    expect(hasRequiredParams(input.type, input.params)).toBe(true);
  });
});

describe('BR-8 budget stop', () => {
  it('stops before fetching when the Reconcile daily gate refuses; nothing stored, no alerts', async () => {
    store.watches.push(watch('wa000001', 'user-1', {}));
    gate.ok = false;
    const s = await runResearchSnapshots();
    expect(s.budgetStopped).toBe(true);
    expect(s.shops).toMatchObject({ due: 1, taken: 0, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.snaps).toHaveLength(0);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('a non-budget refusal (per-second wait) does not end the run', async () => {
    store.watches.push(watch('wa000001', 'user-1', {}));
    gate.ok = false;
    gate.reason = 'rate_limited';
    const s = await runResearchSnapshots();
    expect(s.budgetStopped).toBe(false);
    expect(s.shops.taken).toBe(1);
  });

  it('call estimate: shop + ⌈active/100⌉ pages, capped at 5 pages', () => {
    expect(snapshotCallsFor(3)).toBe(2);
    expect(snapshotCallsFor(250)).toBe(4);
    expect(snapshotCallsFor(9000)).toBe(6);
    expect(snapshotCallsFor(null)).toBe(6);
  });
});

describe('registrations', () => {
  it('scheduler runs research-snapshots daily at 06:00 UTC (once per bucket)', () => {
    const job = allJobs.find((j) => j.name === 'research-snapshots');
    expect(job).toMatchObject({ dailyAtUtc: '06:00', maxAttemptsPerBucket: 1 });
    expect(researchSnapshotsJob.dailyAtUtc).toBe('06:00');
  });

  it('research alert types: research group, badge, params, strings in both locales', () => {
    expect(NOTIFICATION_GROUPS).toContain('research');
    const types = ['researchShopNewListings', 'researchShopPriceDrop', 'researchShopSalesSpike'];
    expect(typesInGroup('research')).toEqual(types);
    for (const t of types) {
      expect(getTypeDef(t)).toMatchObject({ group: 'research', severity: 'info', badge: true });
      expect(REQUIRED_NOTIFICATION_PARAMS[t]).toContain('shop');
      for (const m of [en, tr] as any[]) {
        expect(typeof m.notifications.types[t]).toBe('string');
        expect(typeof m.notificationCenter.typeLabels[t]).toBe('string');
      }
    }
    expect((tr as any).notificationCenter.groups.research).toBe('Araştırma');
    expect((en as any).notificationCenter.groups.research).toBe('Research');
  });
});
