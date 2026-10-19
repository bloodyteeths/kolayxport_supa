// Referral spec §5 Stage B: B11 (netting, never negative), B14 (dry run: no writes, no Stripe call), B15 (no bank
// details → skipped), manual CSV fallback + mark paid; B16–B18 partner dashboard (own rows only, masked, no e-mails;
// non-partner 404; Shopify-connected partner hidden).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePrisma, type FakePrisma } from './fakePrisma';

const h = vi.hoisted(() => ({ db: null as unknown as FakePrisma, authUser: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: new Proxy({}, { get: (_t, k) => (h.db as any)[k] }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => h.authUser(...a) }));

import { groupPayable, markManualPayoutPaid, runPayouts } from '@/lib/partners/payouts';
import { maskName, referralStatus } from '@/lib/partners/dashboard';
import dashboardHandler from '@/pages/api/partner/dashboard';
import meHandler from '@/pages/api/partner/me';

const NOW = new Date('2026-12-15T09:00:00Z');
const DAY = 86_400_000;

async function partner(id: string, extra: Record<string, unknown> = {}) {
  return h.db.partner.create({ data: { id, code: id.toUpperCase(), name: `Partner ${id}`, type: 'fb_admin', status: 'active', email: `${id}@partner.test`, tierThreshold: 10, userId: null, stripeRecipientId: null, ...extra } });
}
async function bounty(partnerId: string, amount: number, extra: Record<string, unknown> = {}) {
  return h.db.partnerCommission.create({ data: { partnerId, userId: 'u', stripeObjectId: `in_${Math.random()}`, kind: 'bounty_year', currency: 'try', commissionMinor: amount, status: 'pending', payableAt: new Date(NOW.getTime() - DAY), payoutId: null, ...extra } });
}

beforeEach(() => {
  h.db = makeFakePrisma();
  h.authUser.mockReset();
  h.fetch.mockReset();
  vi.stubGlobal('fetch', h.fetch);
  delete process.env.STRIPE_PAYOUTS_KEY;
  delete process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT;
});

describe('payout run', () => {
  it('B14: a dry run writes nothing and calls no API, even with Stripe configured', async () => {
    process.env.STRIPE_PAYOUTS_KEY = 'rk_test_x';
    process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT = 'fa_test';
    await partner('p1', { stripeRecipientId: 'acct_1' });
    await bounty('p1', 1_000_00);
    const before = JSON.stringify(h.db.partnerCommission.rows);
    const r = await runPayouts({ period: '2026-12', now: NOW });
    expect(r.dryRun).toBe(true);
    expect(r.lines).toHaveLength(1);
    expect(h.fetch.mock.calls.filter(([url]) => String(url).includes('outbound_payments'))).toHaveLength(0);
    expect(JSON.stringify(h.db.partnerCommission.rows)).toBe(before);
    expect(h.db.partnerPayout.rows).toHaveLength(0);
  });

  it('B11: reversals net against bounties; a non-positive sum is carried, never sent', () => {
    const partners = new Map([['p1', { code: 'P1', name: 'P1', ready: true }], ['p2', { code: 'P2', name: 'P2', ready: true }]]);
    const lines = groupPayable([
      { id: 'a', partnerId: 'p1', currency: 'try', commissionMinor: 500_00 },
      { id: 'b', partnerId: 'p1', currency: 'try', commissionMinor: -200_00 },
      { id: 'c', partnerId: 'p2', currency: 'try', commissionMinor: -300_00 },
    ], partners, true);
    expect(lines.find((l) => l.partnerId === 'p1')).toMatchObject({ amountMinor: 300_00, skip: null, rowIds: ['a', 'b'] });
    expect(lines.find((l) => l.partnerId === 'p2')).toMatchObject({ amountMinor: -300_00, skip: 'non_positive' });
  });

  it('B15: Stripe mode skips partners without active bank details', async () => {
    process.env.STRIPE_PAYOUTS_KEY = 'rk_test_x';
    process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT = 'fa_test';
    await partner('p1');
    await partner('p2', { stripeRecipientId: 'acct_2' });
    await bounty('p1', 100_00);
    await bounty('p2', 200_00);
    h.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).includes('/v2/core/accounts/acct_2')) return new Response(JSON.stringify({ configuration: { recipient: { capabilities: { bank_accounts: { local: { status: 'active' } } } } } }), { status: 200 });
      if (String(url).endsWith('/outbound_payments')) {
        expect(JSON.parse(String(init.body))).toMatchObject({ amount: { value: 200_00, currency: 'try' }, to: { recipient: 'acct_2' }, from: { financial_account: 'fa_test' } });
        return new Response(JSON.stringify({ id: 'obp_1', status: 'processing' }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const r = await runPayouts({ period: '2026-12', confirm: true, now: NOW });
    expect(r.lines.find((l) => l.partnerId === 'p1')!.skip).toBe('missing_bank_details');
    expect(r.results).toEqual([expect.objectContaining({ partnerId: 'p2', status: 'sent' })]);
    expect(h.db.partnerCommission.rows.find((b) => b.partnerId === 'p2')!.status).toBe('paid');
    expect(h.db.partnerCommission.rows.find((b) => b.partnerId === 'p1')!.status).toBe('payable');
    expect(h.db.partnerPayout.rows[0]).toMatchObject({ provider: 'stripe_global', externalId: 'obp_1', status: 'sent' });
  });

  it('a Stripe failure keeps the bounties payable and records the error', async () => {
    process.env.STRIPE_PAYOUTS_KEY = 'rk_test_x';
    process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT = 'fa_test';
    await partner('p1', { stripeRecipientId: 'acct_1' });
    await bounty('p1', 100_00);
    h.fetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/v2/core/accounts/')) return new Response(JSON.stringify({ configuration: { recipient: { capabilities: { bank_accounts: { wire: { status: 'active' } } } } } }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'insufficient funds' } }), { status: 400 });
    });
    const r = await runPayouts({ confirm: true, now: NOW });
    expect(r.results![0]).toMatchObject({ status: 'failed', error: 'insufficient funds' });
    expect(h.db.partnerCommission.rows[0].status).toBe('payable');
    expect(h.db.partnerPayout.rows[0]).toMatchObject({ status: 'failed', error: 'insufficient funds' });
  });

  it('manual fallback: confirm creates payouts + CSV, admin marks paid with a reference; nothing is paid twice', async () => {
    await partner('p1');
    await bounty('p1', 150_000, { kind: 'bounty_month' });
    await bounty('p1', 50_000, { payableAt: new Date(NOW.getTime() + 5 * DAY) }); // still on hold
    const r = await runPayouts({ period: '2026-12', confirm: true, now: NOW });
    expect(r.provider).toBe('manual');
    expect(r.csv).toContain('2026-12,P1,Partner p1,TRY,1500.00,1,to_pay');
    const payoutId = r.results![0].payoutId;
    expect(await markManualPayoutPaid(payoutId, 'EFT-123')).toBe('paid');
    expect(h.db.partnerCommission.rows.map((b) => b.status)).toEqual(['paid', 'pending']);
    const again = await runPayouts({ confirm: true, now: NOW });
    expect(again.lines).toHaveLength(0);
  });
});

function call(handler: (req: any, res: any) => unknown) {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method: 'GET', headers: {}, query: {} }, res)).then(() => res);
}

describe('partner dashboard (B16–B18)', () => {
  beforeEach(async () => {
    await h.db.user.create({ data: { id: 'partnerA', email: 'a@partner.test', name: 'Ortak A', role: 'user', billingProvider: null, shopifyShops: [] } });
    await h.db.user.create({ data: { id: 'partnerB', email: 'b@partner.test', name: 'Ortak B', role: 'user', billingProvider: null, shopifyShops: [] } });
    await partner('pa', { userId: 'partnerA' });
    await partner('pb', { userId: 'partnerB' });
    const created = new Date('2026-11-01T00:00:00Z');
    for (const [id, name, p] of [['c1', 'Ayşe Nur Yılmaz', 'pa'], ['c2', 'Mehmet Demir', 'pa'], ['c3', 'Zeynep Kaya', 'pb']] as const) {
      await h.db.user.create({ data: { id, email: `${id}@secret-customer.test`, name, createdAt: created, subscriptionPlan: 'growth', subscriptionStatus: 'active', billingInterval: 'year', role: 'user', shopifyShops: [] } });
      await h.db.userAcquisition.create({ data: { userId: id, partnerId: p, capturedAt: created } });
    }
    await h.db.partnerPaymentEvent.create({ data: { userId: 'c1', objectId: 'in_c1', interval: 'year' } });
    await h.db.partnerCommission.create({ data: { partnerId: 'pa', userId: 'c1', stripeObjectId: 'in_c1', kind: 'bounty_year', currency: 'try', commissionMinor: 1_374_750, status: 'pending', payableAt: new Date(Date.now() + 10 * DAY) } });
    await h.db.etsyShop.create({ data: { userId: 'c2', createdAt: new Date('2026-11-03T00:00:00Z') } });
  });

  it('B16: partner A sees only their referrals, masked, with no e-mails or ids in the JSON', async () => {
    h.authUser.mockResolvedValue({ id: 'partnerA' });
    const res = await call(dashboardHandler);
    expect(res.statusCode).toBe(200);
    expect(res.body.referrals.map((r: any) => r.name).sort()).toEqual(['A*** Y', 'M*** D']);
    const ayse = res.body.referrals.find((r: any) => r.name === 'A*** Y');
    expect(ayse).toMatchObject({ status: 'odedi', bounty: { amountMinor: 1_374_750, status: 'pending' } });
    expect(res.body.referrals.find((r: any) => r.name === 'M*** D').status).toBe('aktif');
    expect(res.body.totals).toMatchObject({ signups: 2, activated: 1, paying: 1, pending: { try: 1_374_750 } });
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/secret-customer|@/);
    expect(json).not.toMatch(/Zeynep|Ayşe|Yılmaz|"c1"|"c2"/);
  });

  it('B17: a non-partner gets 404 and no nav row', async () => {
    await h.db.user.create({ data: { id: 'seller', email: 's@x.test', role: 'user', shopifyShops: [] } });
    h.authUser.mockResolvedValue({ id: 'seller' });
    expect((await call(dashboardHandler)).statusCode).toBe(404);
    expect((await call(meHandler)).body).toEqual({ isPartner: false });
    h.authUser.mockResolvedValue({ id: 'partnerA' });
    expect((await call(meHandler)).body).toEqual({ isPartner: true });
  });

  it('B18: a Shopify-connected partner account sees nothing', async () => {
    h.db.user.rows.find((u) => u.id === 'partnerA')!.billingProvider = 'shopify';
    h.authUser.mockResolvedValue({ id: 'partnerA' });
    expect((await call(dashboardHandler)).statusCode).toBe(404);
    expect((await call(meHandler)).body).toEqual({ isPartner: false });
  });
});

describe('masking and status', () => {
  it('masks names to initials', () => {
    expect(maskName('Ayşe Nur Yılmaz')).toBe('A*** Y');
    expect(maskName('ismail')).toBe('İ***');
    expect(maskName('')).toBe('***');
    expect(maskName(null)).toBe('***');
  });
  it('maps status deneme → aktif → ödedi, iptal wins', () => {
    expect(referralStatus({ subscriptionStatus: 'trialing', paid: false, activated: false })).toBe('deneme');
    expect(referralStatus({ subscriptionStatus: 'trialing', paid: false, activated: true })).toBe('aktif');
    expect(referralStatus({ subscriptionStatus: 'active', paid: true, activated: true })).toBe('odedi');
    expect(referralStatus({ subscriptionStatus: 'canceled', paid: true, activated: true })).toBe('iptal');
  });
});
