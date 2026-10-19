// Referral spec §5 tests 5–9 (+21 Shopify): recordAcquisition sources and exclusions, the post-login claim endpoint,
// and that a failing attribution write never fails the email signup.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authUser: vi.fn(),
  acquisition: null as Record<string, unknown> | null,
  user: null as Record<string, unknown> | null,
  partner: null as Record<string, unknown> | null,
  created: [] as Record<string, unknown>[],
  createThrows: null as unknown,
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => h.authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userAcquisition: {
      findUnique: async () => h.acquisition,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (h.createThrows) throw h.createThrows;
        h.created.push(data);
        return data;
      },
    },
    user: { findUnique: async () => h.user },
    partner: { findFirst: async ({ where }: { where: { code: string; status: string } }) => (h.partner && h.partner.code === where.code && h.partner.status === where.status ? h.partner : null) },
  },
}));

import { recordAcquisition, resolveTouch } from '@/lib/partners/acquisition';
import { buildFtCookieValue } from '@/lib/partners/cookies';
import claim from '@/pages/api/user/acquisition/claim';

const NOW = Date.now();
const baseUser = (o: Record<string, unknown> = {}) => ({
  email: 'seller@example.com', role: 'user', billingProvider: null, subscriptionPlan: 'trial', shopifyShops: [], createdAt: new Date(NOW - 3_600_000), ...o,
});

beforeEach(() => {
  h.acquisition = null;
  h.user = baseUser();
  h.partner = { id: 'p1', code: 'ETSYILEGELIR', status: 'active', email: 'partner@example.com' };
  h.created = [];
  h.createThrows = null;
  h.authUser.mockReset().mockResolvedValue({ id: 'u1' });
});

describe('resolveTouch', () => {
  it('cookies win per field, body fills the gaps, firstSeenAt is the earliest touch', () => {
    const ft = buildFtCookieValue({ utm_source: 'facebook', landing: '/', at: 1_760_000_100 })!;
    const t = resolveTouch({
      cookies: { kx_ref: 'ETSYILEGELIR|1760000000', kx_ft: ft },
      body: { utm_source: 'google', ref: 'OTHER', at: 1_759_000_000_000 },
    });
    expect(t.refCode).toBe('ETSYILEGELIR');
    expect(t.ft?.utm_source).toBe('facebook');
    expect(t.firstSeenAt?.getTime()).toBe(1_760_000_000_000);
    const fromBody = resolveTouch({ body: { utm_source: 'google', ref: 'merisa10', at: 1_759_000_000_000 } });
    expect(fromBody.refCode).toBe('MERISA10');
    expect(fromBody.ft?.utm_source).toBe('google');
  });
});

describe('recordAcquisition', () => {
  it('5: active partner via the link cookie → partnerId set', async () => {
    const r = await recordAcquisition('u1', { cookies: { kx_ref: 'ETSYILEGELIR|1760000000' }, via: 'signup' });
    expect(r).toEqual({ status: 'created', partnerId: 'p1' });
    expect(h.created[0]).toMatchObject({ userId: 'u1', refCode: 'ETSYILEGELIR', partnerId: 'p1', via: 'signup' });
  });

  it('6: idempotent once a row exists', async () => {
    h.acquisition = { userId: 'u1' };
    expect(await recordAcquisition('u1', { cookies: { kx_ref: 'ETSYILEGELIR|1' }, via: 'claim' })).toEqual({ status: 'exists' });
    expect(h.created).toHaveLength(0);
  });

  it.each([
    ['the partner\'s own e-mail', { email: 'Partner@Example.com' }],
    ['an admin', { role: 'admin' }],
    ['a reviewer account', { email: 'play-review@kolayxport.com' }],
    ['a Shopify-connected account (21)', { billingProvider: 'shopify_free' }],
    ['an account with an active Shopify shop (21)', { shopifyShops: [{ id: 's1' }] }],
  ])('8/21: %s keeps refCode but gets no partner', async (_label, o) => {
    h.user = baseUser(o);
    const r = await recordAcquisition('u1', { cookies: { kx_ref: 'ETSYILEGELIR|1760000000' }, via: 'signup' });
    expect(r).toEqual({ status: 'created', partnerId: null });
    expect(h.created[0]).toMatchObject({ refCode: 'ETSYILEGELIR', partnerId: null });
  });

  it('9: unknown or paused codes keep refCode, no partner', async () => {
    h.partner = { id: 'p1', code: 'ETSYILEGELIR', status: 'paused', email: null };
    await recordAcquisition('u1', { cookies: { kx_ref: 'ETSYILEGELIR|1' }, via: 'signup' });
    await recordAcquisition('u2', { cookies: { kx_ref: 'NOBODY|1' }, via: 'signup' });
    expect(h.created.map((c) => [c.refCode, c.partnerId])).toEqual([['ETSYILEGELIR', null], ['NOBODY', null]]);
  });

  it('a lost create race reads as exists', async () => {
    h.createThrows = Object.assign(new Error('unique'), { code: 'P2002' });
    expect(await recordAcquisition('u1', { via: 'claim' })).toEqual({ status: 'exists' });
  });
});

function run(cookies: Record<string, string> = {}, body: unknown = {}) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(claim({ method: 'POST', headers: {}, cookies, body } as any, res)).then(() => res);
}

describe('POST /api/user/acquisition/claim', () => {
  it('6: new OAuth user → 201 created, cookies cleared; a second claim → exists', async () => {
    const res = await run({ kx_ref: 'ETSYILEGELIR|1760000000' }, { attribution: { utm_source: 'x' } });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ status: 'created' });
    expect(String(res.headers['Set-Cookie'])).toMatch(/kx_ref=; Path=\/; Max-Age=0/);
    expect(h.created[0]).toMatchObject({ via: 'claim', partnerId: 'p1' });
    h.acquisition = { userId: 'u1' };
    const again = await run({ kx_ref: 'ETSYILEGELIR|1760000000' });
    expect(again.body).toEqual({ status: 'exists' });
  });

  it('7: a user created 3 days ago → too_old, no row', async () => {
    h.user = baseUser({ createdAt: new Date(NOW - 3 * 86_400_000) });
    const res = await run({ kx_ref: 'ETSYILEGELIR|1' });
    expect(res.body).toEqual({ status: 'too_old' });
    expect(h.created).toHaveLength(0);
  });

  it('requires a session (no Bearer tokens)', async () => {
    h.authUser.mockResolvedValue(null);
    const res = await run();
    expect(res.statusCode).toBe(401);
    expect(h.authUser.mock.calls[0][2]).toEqual({ allowBearer: false });
  });
});
