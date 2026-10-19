// Referral spec §5 test 5 (the email signup still returns 201 when the attribution write throws, and passes the
// cookies + body through) and test 18 (report counts per partner, unattributed by source, CSV without e-mails).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));

vi.mock('@/lib/partners/acquisition', () => ({
  recordAcquisition: async (...a: unknown[]) => {
    h.calls.push(a);
    if (h.fail) throw new Error('db down');
    return { status: 'created', partnerId: 'p1' };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/middleware/rateLimit', () => ({ rateLimit: () => () => true }));
vi.mock('@/lib/auth/tokens', () => ({ issueToken: async () => 'tok' }));
vi.mock('@/lib/auth/email', () => ({ sendEmail: async () => ({ sent: true }), verificationEmailBody: () => ({ subject: 's', textBody: 't', htmlBody: 'h' }), maskEmail: (e: string) => e }));
vi.mock('@/lib/admin/events', () => ({ logAuthEvent: vi.fn() }));
vi.mock('@/lib/tracking/server', () => ({ contextFromRequest: () => ({}), sendServerEvent: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'hash' } }));
vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: async () => null, create: async ({ data }: { data: { id: string } }) => ({ id: data.id }) } },
}));

import signup from '@/pages/api/auth/signup';
import { buildReport, reportToCsv, type ReportUser } from '@/lib/partners/report';

function run(body: Record<string, unknown>, cookies: Record<string, string> = {}) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(signup({ method: 'POST', headers: {}, cookies, body } as any, res)).then(() => res);
}

const BODY = { email: 'New.Seller@example.com', password: 'Str0ng!Passw0rd#2026', name: 'Ayşe', attribution: { utm_source: 'facebook', ref: 'ETSYILEGELIR' } };

describe('email signup + attribution (test 5)', () => {
  beforeEach(() => { h.calls = []; h.fail = false; });

  it('records the acquisition with cookies and the localStorage copy', async () => {
    const res = await run(BODY, { kx_ref: 'ETSYILEGELIR|1760000000' });
    expect(res.statusCode).toBe(201);
    const [, input] = h.calls[0];
    expect(input).toMatchObject({ via: 'signup', cookies: { kx_ref: 'ETSYILEGELIR|1760000000' }, body: BODY.attribution });
  });

  it('still returns 201 when the attribution write throws', async () => {
    h.fail = true;
    const res = await run(BODY);
    expect(h.calls).toHaveLength(1);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true });
  });
});

describe('partner report (test 18)', () => {
  const u = (o: Partial<ReportUser>): ReportUser => ({
    userId: Math.random().toString(36), partnerId: null, refCode: null, utmSource: null, signedUpAt: new Date('2026-11-03'),
    subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingProvider: null, activation: null, ...o,
  });
  const partners = [
    { id: 'p1', code: 'ETSYILEGELIR', name: 'Etsy ile Gelir', status: 'active' },
    { id: 'p2', code: 'MERISA10', name: 'Merisa', status: 'paused' },
  ];
  const users = [
    u({ partnerId: 'p1', refCode: 'ETSYILEGELIR', activation: 'store' }),
    u({ partnerId: 'p1', refCode: 'ETSYILEGELIR', activation: 'proxy', subscriptionPlan: 'growth', subscriptionStatus: 'active', billingProvider: 'stripe' }),
    u({ partnerId: 'p1', refCode: 'ETSYILEGELIR' }),
    u({ refCode: 'ETSYILEGELIR' }), // excluded (own e-mail / Shopify): not counted for the partner
    u({ utmSource: 'google', activation: 'store' }),
    u({ utmSource: 'google' }),
    u({}),
  ];
  const money = [
    { partnerId: 'p1', currency: 'try', status: 'pending', netMinor: 149_900, commissionMinor: 44_970 },
    { partnerId: 'p1', currency: 'try', status: 'void', netMinor: 99_000, commissionMinor: 29_700 },
  ];

  it('counts per partner, splits activation sources and groups the rest by source', () => {
    const r = buildReport('2026-11', partners, users, money);
    const p1 = r.partners.find((p) => p.code === 'ETSYILEGELIR')!;
    expect(p1).toMatchObject({ signups: 3, activated: 2, activatedStore: 1, activatedProxy: 1, trialing: 2, paying: 1 });
    expect(p1.netRevenue).toEqual({ try: 149_900 });
    expect(p1.commissionPending).toEqual({ try: 44_970 });
    expect(r.partners.find((p) => p.code === 'MERISA10')).toMatchObject({ signups: 0, status: 'paused' });
    expect(r.unattributed).toEqual([
      { utmSource: 'google', signups: 2, activated: 1, paying: 0 },
      { utmSource: 'ref:ETSYILEGELIR', signups: 1, activated: 0, paying: 0 },
      { utmSource: '(direct)', signups: 1, activated: 0, paying: 0 },
    ]);
    expect(r.totals).toEqual({ signups: 7, activated: 3, paying: 1 });
  });

  it('CSV has counts and money, the activation footnote, and no e-mails or user ids', () => {
    const csv = reportToCsv(buildReport('2026-11', partners, users, money));
    expect(csv).toContain('ETSYILEGELIR,Etsy ile Gelir,active,3,2,1,1,2,1,1499.00 TRY,449.70 TRY,,');
    expect(csv).toMatch(/# Activated:/);
    expect(csv).not.toMatch(/@/);
    for (const x of users) expect(csv).not.toContain(x.userId);
  });
});
