import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest } from 'next';

vi.mock('@/lib/prisma', async () => ({ default: (await import('./fakeResearchStore')).fakePrisma }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { store, makeRes } from './fakeResearchStore';
import {
  withResearchQuota, sendResearchOutcome, istanbulDay, quotaKey, budgetKey, sharedCacheKey, limitBody,
  RESEARCH_TTL, SHARED_USER_ID, GLOBAL_USER_ID, UPGRADE_URL, SIGNUP_URL, PAGE_VIEW_MAX_FETCHES, captureHandler,
  isExtensionRequest,
} from '@/lib/ext/researchQuota';
import { EXT_RESEARCH_DAILY_LOOKUPS, getExtResearchDailyLimit } from '@/lib/billing/planLimits';

const U = 'user_1';
// 2026-10-18 12:00 Istanbul (UTC+3)
const NOON = new Date('2026-10-18T09:00:00.000Z');
const DAY = '2026-10-18';

function req(headers: Record<string, string> = {}): NextApiRequest {
  return { headers, query: {}, body: {} } as unknown as NextApiRequest;
}

const ok = (body: any = { items: [1, 2, 3] }) => vi.fn(async () => ({ status: 200, body }));

function run(fetcher: any, over: Partial<Parameters<typeof withResearchQuota>[0]> = {}) {
  return withResearchQuota(
    {
      req: req(),
      userId: U,
      marketplace: 'ebay',
      cacheKey: sharedCacheKey('ebay', 'product_database', 'EBAY_US', 'Turkish  Towel'),
      ttl: RESEARCH_TTL.search,
      apiCallsEstimate: 21,
      now: NOON,
      ...over,
    },
    fetcher,
  );
}

beforeEach(() => {
  store.reset();
  store.setUser(U, 'starter');
  delete process.env.KX_BUDGET_EBAY_DAILY;
});
afterEach(() => {
  delete process.env.KX_BUDGET_EBAY_DAILY;
});

describe('shared cross-user cache', () => {
  it('a shared-cache hit calls no marketplace API and charges no lookup', async () => {
    const key = sharedCacheKey('ebay', 'product_database', 'EBAY_US', 'turkish towel');
    store.rows.set(`${SHARED_USER_ID}\u0000${key}`, { userId: SHARED_USER_ID, cacheKey: key, data: { items: ['cached'] }, expiresAt: new Date(NOON.getTime() + 3600e3) });
    const fetcher = ok();
    const out = await run(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'ok', status: 200, source: 'shared_cache', body: { items: ['cached'] }, quota: { used: 0, limit: 150 } });
    expect(store.count(U, quotaKey(DAY))).toBe(0);
    expect(store.count(GLOBAL_USER_ID, budgetKey('ebay', DAY))).toBe(0);
  });

  it('a miss is charged once, stored for everyone, and the next user hits it for free', async () => {
    const f1 = ok({ items: ['live'] });
    const out1 = await run(f1);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(out1).toMatchObject({ kind: 'ok', source: 'live', quota: { used: 1, limit: 150 } });
    expect(store.count(U, quotaKey(DAY))).toBe(1);
    expect(store.count(GLOBAL_USER_ID, budgetKey('ebay', DAY))).toBe(21);

    const key = sharedCacheKey('ebay', 'product_database', 'EBAY_US', 'turkish towel');
    const row = store.get(SHARED_USER_ID, key)!;
    expect(row.data).toEqual({ items: ['live'] });
    expect(row.expiresAt.getTime() - NOON.getTime()).toBe(6 * 3600e3); // searches: 6 h

    store.setUser('user_2', 'growth');
    const f2 = ok();
    const out2 = await run(f2, { userId: 'user_2' });
    expect(f2).not.toHaveBeenCalled();
    expect(out2).toMatchObject({ source: 'shared_cache', body: { items: ['live'] } });
    expect(store.count('user_2', quotaKey(DAY))).toBe(0);
  });

  it('expired shared rows are misses; detail TTL is 24 h', async () => {
    const key = sharedCacheKey('ebay', 'item', 'EBAY_US', '123');
    store.rows.set(`${SHARED_USER_ID}\u0000${key}`, { userId: SHARED_USER_ID, cacheKey: key, data: { old: true }, expiresAt: new Date(NOON.getTime() - 1) });
    const f = ok({ fresh: true });
    await run(f, { cacheKey: key, ttl: RESEARCH_TTL.detail, apiCallsEstimate: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(store.get(SHARED_USER_ID, key)!.expiresAt.getTime() - NOON.getTime()).toBe(24 * 3600e3);
  });

  it('keys include marketplace, action, site and the normalised query', () => {
    expect(sharedCacheKey('ebay', 'product_database', 'EBAY_US', '  Turkish   TOWEL ')).toBe('ext:v1:ebay:product_database:ebay_us:turkish towel');
    expect(sharedCacheKey('ebay', 'product_database', 'EBAY_DE', 'turkish towel')).not.toBe(sharedCacheKey('ebay', 'product_database', 'EBAY_US', 'turkish towel'));
    expect(sharedCacheKey('etsy', 'search', 'etsy.com', 'havlu çarşaf')).toMatch(/^ext:v1:etsy:search:etsy\.com:h[0-9a-f]{40}$/);
  });

  it('error / non-2xx bodies and cacheKey=null are never shared', async () => {
    await run(vi.fn(async () => ({ status: 404, body: { error: 'nope' } })));
    await run(ok(), { cacheKey: null });
    expect([...store.rows.keys()].filter((k) => k.startsWith(SHARED_USER_ID))).toEqual([]);
  });
});

describe('per-plan daily lookups', () => {
  it('EXT_RESEARCH_DAILY_LOOKUPS has the founder numbers', () => {
    expect(EXT_RESEARCH_DAILY_LOOKUPS).toEqual({
      trial: 50, starter: 150, growth: 500, pro: 1500, enterprise: 5000, shopify_free: 50,
      // Pricing v2 keys follow the matching ladder step.
      aylik: 150, baslangic_yil: 150, buyume_yil: 500, pro_yil: 1500, kurumsal: 5000,
    });
  });

  it('resolves the plan the same way as the usage limiter', () => {
    const future = new Date(NOON.getTime() + 5 * 86400e3);
    const past = new Date(NOON.getTime() - 30 * 86400e3);
    expect(getExtResearchDailyLimit('starter', 'active', null, NOON).limit).toBe(150);
    expect(getExtResearchDailyLimit('growth', 'past_due', null, NOON).limit).toBe(500);
    expect(getExtResearchDailyLimit('pro', 'trialing', null, NOON).limit).toBe(1500);
    expect(getExtResearchDailyLimit('enterprise', 'active', null, NOON).limit).toBe(5000);
    expect(getExtResearchDailyLimit('shopify_free', null, null, NOON).limit).toBe(50);
    expect(getExtResearchDailyLimit(null, 'trialing', future, NOON)).toMatchObject({ plan: 'trial', limit: 50 });
    expect(getExtResearchDailyLimit('trial', 'trialing', past, NOON)).toMatchObject({ plan: null, limit: 0 });
    expect(getExtResearchDailyLimit('starter', 'canceled', null, NOON).limit).toBe(0);
    expect(getExtResearchDailyLimit('bogus', 'active', null, NOON).limit).toBe(0);
  });

  it.each([
    ['trial', 'trialing', 50],
    ['starter', 'active', 150],
    ['growth', 'active', 500],
    ['pro', 'active', 1500],
    ['enterprise', 'active', 5000],
    ['shopify_free', 'active', 500], // SHOPIFY_FREE_RESEARCH_DAILY overrides the plan table
  ])('%s: lookup #%s is the last allowed one', async (plan, status, limit) => {
    store.setUser(U, plan as string, status as string, new Date(NOON.getTime() + 86400e3));
    store.setCount(U, quotaKey(DAY), (limit as number) - 1);
    const f1 = ok();
    const allowed = await run(f1, { cacheKey: null });
    expect(f1).toHaveBeenCalledTimes(1);
    expect(allowed).toMatchObject({ kind: 'ok', quota: { used: limit, limit } });

    const f2 = ok();
    const refused = await run(f2, { cacheKey: null });
    expect(f2).not.toHaveBeenCalled();
    expect(refused).toMatchObject({ kind: 'limited', status: 429, body: { reason: 'user_daily', used: limit, limit } });
    expect(store.count(U, quotaKey(DAY))).toBe(limit); // the refused attempt was rolled back
  });

  it('an account without a usable plan gets the upgrade card (limit 0)', async () => {
    store.setUser(U, 'starter', 'canceled');
    const out = await run(ok(), { cacheKey: null });
    expect(out).toMatchObject({ kind: 'limited', body: { reason: 'user_daily', limit: 0, used: 0 } });
  });

  it('Shopify-connected accounts: 500/day and never an upgrade link (App Store 1.2.1)', async () => {
    store.setUser(U, 'shopify_free', 'active');
    store.setCount(U, quotaKey(DAY), 500);
    const out = await run(ok(), { cacheKey: null });
    expect(out).toMatchObject({ kind: 'limited', body: { reason: 'user_daily', limit: 500, upgradeUrl: null } });
  });

  it('several calls of one page view count as one lookup (X-KX-Page-View)', async () => {
    const r = req({ 'x-kx-page-view': 'pvabcdef123456' });
    for (let i = 0; i < 3; i++) await run(ok(), { req: r, cacheKey: null });
    expect(store.count(U, quotaKey(DAY))).toBe(1);
    // A reused id is charged again after PAGE_VIEW_MAX_FETCHES misses.
    for (let i = 3; i < PAGE_VIEW_MAX_FETCHES + 1; i++) await run(ok(), { req: r, cacheKey: null });
    expect(store.count(U, quotaKey(DAY))).toBe(2);
  });

  it('a page view refused at the limit does not leave later calls free', async () => {
    store.setCount(U, quotaKey(DAY), 150);
    const r = req({ 'x-kx-page-view': 'pvzzzzzzzzzz01' });
    expect((await run(ok(), { req: r, cacheKey: null })).kind).toBe('limited');
    expect((await run(ok(), { req: r, cacheKey: null })).kind).toBe('limited');
  });

  it('refunds the lookup when the call never reached the marketplace or failed', async () => {
    await run(vi.fn(async () => ({ status: 400, body: { error: 'q required' } })), { cacheKey: null });
    expect(store.count(U, quotaKey(DAY))).toBe(0);
    expect(store.count(GLOBAL_USER_ID, budgetKey('ebay', DAY))).toBe(0);

    await run(vi.fn(async () => ({ status: 500, body: { error: 'eBay down' } })), { cacheKey: null });
    expect(store.count(U, quotaKey(DAY))).toBe(0);
    expect(store.count(GLOBAL_USER_ID, budgetKey('ebay', DAY))).toBe(21); // the marketplace was still called

    await expect(run(vi.fn(async () => { throw new Error('boom'); }), { cacheKey: null })).rejects.toThrow('boom');
    expect(store.count(U, quotaKey(DAY))).toBe(0);
  });

  it('signed-out callers get signed_out unless the endpoint grants an anonymous allowance', async () => {
    const refused = await run(ok(), { userId: null, cacheKey: null });
    expect(refused).toMatchObject({ kind: 'limited', body: { reason: 'signed_out', upgradeUrl: SIGNUP_URL } });
    const f = ok();
    const allowed = await run(f, { userId: null, cacheKey: null, allowAnonymous: () => true });
    expect(f).toHaveBeenCalled();
    expect(allowed).toMatchObject({ kind: 'ok', quota: null });
  });
});

describe('Istanbul day reset', () => {
  it('the day flips at 00:00 Europe/Istanbul (21:00 UTC)', () => {
    expect(istanbulDay(new Date('2026-10-18T20:59:59.999Z'))).toEqual({ day: '2026-10-18', resetAt: new Date('2026-10-18T21:00:00.000Z') });
    expect(istanbulDay(new Date('2026-10-18T21:00:00.000Z'))).toEqual({ day: '2026-10-19', resetAt: new Date('2026-10-19T21:00:00.000Z') });
    expect(istanbulDay(new Date('2026-12-31T22:30:00.000Z')).day).toBe('2027-01-01');
  });

  it('a user at the limit at 23:59 Istanbul can research again at 00:00', async () => {
    const before = new Date('2026-10-18T20:59:00.000Z');
    const after = new Date('2026-10-18T21:00:01.000Z');
    store.setCount(U, quotaKey('2026-10-18'), 150, new Date('2026-10-20T21:00:00.000Z'));
    const refused = await run(ok(), { now: before, cacheKey: null });
    expect(refused).toMatchObject({ kind: 'limited', body: { reason: 'user_daily', resetAt: '2026-10-18T21:00:00.000Z' } });
    const allowed = await run(ok(), { now: after, cacheKey: null });
    expect(allowed).toMatchObject({ kind: 'ok', quota: { used: 1, limit: 150, resetAt: '2026-10-19T21:00:00.000Z' } });
    expect(store.count(U, quotaKey('2026-10-19'))).toBe(1);
  });
});

describe('global per-marketplace brake', () => {
  it('at 80% of the daily budget only shared-cache data is served', async () => {
    store.setCount(GLOBAL_USER_ID, budgetKey('ebay', DAY), 4000); // 80% of 5000
    const f = ok();
    const out = await run(f);
    expect(f).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'limited', status: 429, body: { reason: 'global_brake' } });
    expect(store.count(U, quotaKey(DAY))).toBe(0);

    const key = sharedCacheKey('ebay', 'product_database', 'EBAY_US', 'turkish towel');
    store.rows.set(`${SHARED_USER_ID}\u0000${key}`, { userId: SHARED_USER_ID, cacheKey: key, data: { cached: 1 }, expiresAt: new Date(NOON.getTime() + 60e3) });
    expect(await run(ok())).toMatchObject({ kind: 'ok', source: 'shared_cache', body: { cached: 1 } });
  });

  it('below 80% misses go through; budgets come from env', async () => {
    store.setCount(GLOBAL_USER_ID, budgetKey('ebay', DAY), 3999);
    expect((await run(ok(), { cacheKey: null })).kind).toBe('ok');

    process.env.KX_BUDGET_EBAY_DAILY = '100';
    store.setCount(GLOBAL_USER_ID, budgetKey('ebay', DAY), 80);
    expect(await run(ok(), { cacheKey: null })).toMatchObject({ kind: 'limited', body: { reason: 'global_brake' } });
  });

  it('budgets are per marketplace', async () => {
    store.setCount(GLOBAL_USER_ID, budgetKey('ebay', DAY), 4999);
    expect((await run(ok(), { marketplace: 'etsy', cacheKey: null, apiCallsEstimate: 1 })).kind).toBe('ok');
    expect(store.count(GLOBAL_USER_ID, budgetKey('etsy', DAY))).toBe(1);
  });
});

describe('429 payload', () => {
  it('has exactly the agreed shape', async () => {
    store.setCount(U, quotaKey(DAY), 150);
    const out = await run(ok(), { cacheKey: null });
    expect(out.kind).toBe('limited');
    const res = makeRes();
    sendResearchOutcome(res, out);
    expect(res.state.status).toBe(429);
    expect(res.state.body).toEqual({
      error: 'research_limit',
      reason: 'user_daily',
      limit: 150,
      used: 150,
      resetAt: '2026-10-18T21:00:00.000Z',
      upgradeUrl: 'https://kolayxport.com/plan',
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('signed-out payload points to sign-up; others to /plan', () => {
    const at = new Date('2026-10-18T21:00:00.000Z');
    expect(limitBody('signed_out', 0, 0, at).upgradeUrl).toBe('https://kolayxport.com/login?utm_source=extension&utm_medium=limit');
    expect(limitBody('global_brake', 3, 150, at).upgradeUrl).toBe(UPGRADE_URL);
    expect(Object.keys(limitBody('global_brake', 3, 150, at)).sort()).toEqual(['error', 'limit', 'reason', 'resetAt', 'upgradeUrl', 'used']);
  });

  it('successful responses expose used/limit as `quota`', async () => {
    const out = await run(ok({ items: [] }), { cacheKey: null });
    const res = makeRes();
    sendResearchOutcome(res, out, { plan: 'starter' });
    expect(res.state.body).toEqual({ items: [], plan: 'starter', quota: { used: 1, limit: 150, resetAt: '2026-10-18T21:00:00.000Z' } });
  });
});

describe('helpers', () => {
  it('isExtensionRequest reads X-KX-Client: ext/<version>', () => {
    expect(isExtensionRequest(req({ 'x-kx-client': 'ext/9.7.1' }))).toBe(true);
    expect(isExtensionRequest(req({ 'x-kx-client': 'web' }))).toBe(false);
    expect(isExtensionRequest(req())).toBe(false);
  });

  it('captureHandler returns status + body and forwards headers', async () => {
    const res = makeRes();
    const out = await captureHandler(async (_q, r) => { r.setHeader('X-Test', '1'); return r.status(201).json({ a: 1 }); }, req(), res);
    expect(out).toEqual({ status: 201, body: { a: 1 } });
    expect(res.headers['x-test']).toBe('1');
    expect(res.state.status).toBe(0); // nothing was sent on the real response
  });
});
