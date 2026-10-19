// Referral spec §5 Stage B: B1–B12, B19 — bounty rules through the provider-agnostic entry points, plus the Stripe
// adapter (net of KDV from basil total_taxes, plan line detection: modules / credit packs earn nothing).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePrisma, type FakePrisma } from './fakePrisma';

const h = vi.hoisted(() => ({ db: null as unknown as FakePrisma }));
vi.mock('@/lib/prisma', () => ({ default: new Proxy({}, { get: (_t, k) => (h.db as any)[k] }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/stripe', () => ({ stripe: { invoicePayments: { list: vi.fn() }, checkout: { sessions: { retrieve: vi.fn() } } } }));

import { decideBounty, netOfTax, onPaymentRefunded, onPaymentSucceeded, promoteDueBounties } from '@/lib/partners/bounty';
import { bountyFromStripeInvoice } from '@/lib/partners/stripeBounty';

const DAY = 86_400_000;
const T0 = new Date('2026-11-01T10:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

async function seed(opts: { userId?: string; partnerId?: string; billingProvider?: string | null } = {}) {
  const partnerId = opts.partnerId ?? 'p1';
  if (!(await h.db.partner.findUnique({ where: { id: partnerId } }))) {
    await h.db.partner.create({ data: { id: partnerId, code: partnerId.toUpperCase() + 'CODE', name: 'Partner', type: 'fb_admin', status: 'active', email: 'partner@example.com', tierThreshold: 10, userId: null } });
  }
  const userId = opts.userId ?? 'u1';
  await h.db.user.create({ data: { id: userId, email: `${userId}@example.com`, role: 'user', billingProvider: opts.billingProvider ?? 'stripe', subscriptionPlan: 'trial', shopifyShops: [] } });
  await h.db.userAcquisition.create({ data: { userId, partnerId, refCode: 'P1CODE' } });
  return { userId, partnerId };
}

const year = (userId: string, objectId: string, paidAt: Date, gross = 6_598_800, tax: number | null = 1_099_800) =>
  onPaymentSucceeded({ userId, provider: 'stripe', objectId, paidAt, currency: 'try', grossMinor: gross, taxMinor: tax, planKey: 'buyume_yil', interval: 'year' });
const month = (userId: string, objectId: string, paidAt: Date, gross = 179_880, tax: number | null = 29_980) =>
  onPaymentSucceeded({ userId, provider: 'stripe', objectId, paidAt, currency: 'try', grossMinor: gross, taxMinor: tax, planKey: 'aylik', interval: 'month' });
const bounties = () => h.db.partnerCommission.rows;

beforeEach(() => { h.db = makeFakePrisma(); });

describe('netOfTax', () => {
  it('uses the provider tax, else splits a TRY "+KDV" price at 20%, else keeps the gross', () => {
    expect(netOfTax(6_598_800, 1_099_800, 'try')).toEqual({ netMinor: 5_499_000, estimated: false });
    expect(netOfTax(120_000, null, 'try')).toEqual({ netMinor: 100_000, estimated: true });
    expect(netOfTax(5_000, null, 'usd')).toEqual({ netMinor: 5_000, estimated: false });
  });
});

describe('bounty rules (B1–B12)', () => {
  it('B1: first Büyüme yearly payment → bounty_year 25% of net, payable after 30 days', async () => {
    const { userId } = await seed();
    const r = await year(userId, 'in_1', T0);
    expect(r).toMatchObject({ status: 'recorded', kind: 'bounty_year' });
    expect(bounties()[0]).toMatchObject({ kind: 'bounty_year', netMinor: 5_499_000, commissionMinor: 1_374_750, status: 'pending', provider: 'stripe' });
    expect(bounties()[0].payableAt.getTime()).toBe(at(30).getTime());
  });

  it('B2: a replayed event creates nothing new', async () => {
    const { userId } = await seed();
    await year(userId, 'in_1', T0);
    expect(await year(userId, 'in_1', T0)).toEqual({ status: 'duplicate' });
    expect(bounties()).toHaveLength(1);
    expect(h.db.partnerPaymentEvent.rows).toHaveLength(1);
  });

  it('B3: the 11th paying referral earns 30%', async () => {
    for (let i = 0; i < 10; i++) {
      const { userId } = await seed({ userId: `old${i}` });
      await year(userId, `in_old${i}`, at(-100 + i));
    }
    const { userId } = await seed({ userId: 'u11' });
    await year(userId, 'in_11', T0);
    const b = bounties().find((x) => x.userId === 'u11')!;
    expect(Number(b.rate)).toBe(0.3);
    expect(b.commissionMinor).toBe(Math.round(5_499_000 * 0.3));
  });

  it('B4/B5: Aylık first payment earns nothing; the 2nd earns ₺1.500', async () => {
    const { userId } = await seed();
    expect(await month(userId, 'in_m1', T0)).toMatchObject({ kind: null, reason: 'first monthly payment' });
    expect(bounties()).toHaveLength(0);
    expect(await month(userId, 'in_m2', at(30))).toMatchObject({ kind: 'bounty_month' });
    expect(bounties()[0]).toMatchObject({ kind: 'bounty_month', commissionMinor: 150_000, currency: 'try' });
    expect(await month(userId, 'in_m3', at(60))).toMatchObject({ kind: null, reason: 'monthly renewal' });
    expect(bounties()).toHaveLength(1);
  });

  it('B6: Aylık → yearly 40 days after the first payment pays the difference', async () => {
    const { userId } = await seed();
    await month(userId, 'in_m1', T0);
    await month(userId, 'in_m2', at(30));
    expect(await year(userId, 'in_y', at(40))).toMatchObject({ kind: 'bounty_upgrade' });
    const up = bounties().find((b) => b.kind === 'bounty_upgrade')!;
    expect(up.commissionMinor).toBe(1_374_750 - 150_000);
  });

  it('B7: the same switch 120 days after the first payment earns nothing', async () => {
    const { userId } = await seed();
    await month(userId, 'in_m1', T0);
    await month(userId, 'in_m2', at(30));
    expect(await year(userId, 'in_y', at(120))).toMatchObject({ kind: null });
    expect(bounties().map((b) => b.kind)).toEqual(['bounty_month']);
  });

  it('B8: a yearly renewal one year later earns nothing', async () => {
    const { userId } = await seed();
    await year(userId, 'in_y1', T0);
    expect(await year(userId, 'in_y2', at(365))).toMatchObject({ kind: null, reason: 'yearly renewal' });
    expect(bounties()).toHaveLength(1);
  });

  it('B9: module or AI credit pack invoices earn nothing (no plan line)', async () => {
    const { userId } = await seed();
    const invoice = { id: 'in_mod', amount_paid: 49_900, currency: 'try', created: T0.getTime() / 1000, lines: { data: [{ amount: 49_900, pricing: { price_details: { price: 'price_module_x' } } }] } } as any;
    expect(await bountyFromStripeInvoice(invoice, userId)).toEqual({ status: 'skipped', reason: 'not a plan payment' });
    expect(h.db.partnerPaymentEvent.rows).toHaveLength(0);
  });

  it('B10: a full refund 10 days after the yearly payment voids the bounty', async () => {
    const { userId } = await seed();
    await year(userId, 'in_1', T0);
    expect(await onPaymentRefunded({ provider: 'stripe', objectId: 'in_1', refundedMinor: 6_598_800, totalMinor: 6_598_800 })).toEqual({ status: 'voided', commissionMinor: 0 });
    expect(bounties()[0]).toMatchObject({ status: 'void', commissionMinor: 0 });
  });

  it('a partial refund before payout reduces the bounty proportionally', async () => {
    const { userId } = await seed();
    await year(userId, 'in_1', T0);
    await onPaymentRefunded({ provider: 'stripe', objectId: 'in_1', refundedMinor: 3_299_400, totalMinor: 6_598_800 });
    expect(bounties()[0].commissionMinor).toBe(Math.round(1_374_750 / 2));
  });

  it('B11: a refund after payout writes one negative reversal (replays add nothing)', async () => {
    const { userId } = await seed();
    await year(userId, 'in_1', T0);
    bounties()[0].status = 'paid';
    const refund = { provider: 'stripe' as const, objectId: 'in_1', refundedMinor: 6_598_800, totalMinor: 6_598_800 };
    expect(await onPaymentRefunded(refund)).toMatchObject({ status: 'reversed' });
    expect(await onPaymentRefunded(refund)).toMatchObject({ status: 'unchanged' });
    const rev = bounties().filter((b) => b.kind === 'reversal');
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ commissionMinor: -1_374_750, status: 'payable' });
  });

  it('B12: an iyzico / PayTR yearly payment goes through the same entry point', async () => {
    const { userId } = await seed();
    await onPaymentSucceeded({ userId, provider: 'iyzico', objectId: 'iyz_123', paidAt: T0, currency: 'try', grossMinor: 6_598_800, taxMinor: 1_099_800, planKey: 'buyume_yil', interval: 'year' });
    expect(bounties()[0]).toMatchObject({ kind: 'bounty_year', provider: 'iyzico', commissionMinor: 1_374_750 });
  });

  it('B19: a Shopify-billed referred customer earns nothing', async () => {
    const { userId } = await seed({ billingProvider: 'shopify' });
    expect(await year(userId, 'in_1', T0)).toEqual({ status: 'skipped', reason: 'not a partner referral' });
    expect(bounties()).toHaveLength(0);
  });

  it('unattributed customers and terminated partners earn nothing', async () => {
    await h.db.user.create({ data: { id: 'organic', email: 'o@example.com', role: 'user', billingProvider: 'stripe', shopifyShops: [] } });
    expect(await year('organic', 'in_o', T0)).toMatchObject({ status: 'skipped' });
    const { userId } = await seed();
    (await h.db.partner.rows.find((p) => p.id === 'p1'))!.status = 'terminated';
    expect(await year(userId, 'in_1', T0)).toMatchObject({ status: 'skipped' });
  });

  it('hold: pending → payable only after 30 days', async () => {
    const { userId } = await seed();
    await year(userId, 'in_1', T0);
    expect(await promoteDueBounties(at(29))).toBe(0);
    expect(await promoteDueBounties(at(30))).toBe(1);
    expect(bounties()[0].status).toBe('payable');
  });
});

describe('Stripe adapter', () => {
  it('reads basil total_taxes and the plan line (proration credit lines ignored)', async () => {
    process.env.PRICE_GROWTH_YEAR = 'price_growth_year';
    const { userId } = await seed();
    const invoice = {
      id: 'in_s1', amount_paid: 6_598_800, currency: 'try', created: T0.getTime() / 1000, status_transitions: { paid_at: T0.getTime() / 1000 },
      total_taxes: [{ amount: 1_099_800 }],
      lines: { data: [{ amount: -10_000, pricing: { price_details: { price: 'price_old' } } }, { amount: 6_608_800, pricing: { price_details: { price: 'price_growth_year' } } }] },
    } as any;
    expect(await bountyFromStripeInvoice(invoice, userId)).toMatchObject({ status: 'recorded', kind: 'bounty_year' });
    expect(bounties()[0]).toMatchObject({ netMinor: 5_499_000, commissionMinor: 1_374_750 });
    delete process.env.PRICE_GROWTH_YEAR;
  });

  it('zero-amount (trial start) invoices are skipped', async () => {
    const { userId } = await seed();
    expect(await bountyFromStripeInvoice({ id: 'in_0', amount_paid: 0 } as any, userId)).toEqual({ status: 'skipped', reason: 'nothing paid' });
  });
});

describe('decideBounty edge cases', () => {
  const base = { paidAt: T0, netMinor: 1_000_000, currency: 'try', prior: [], earnedMonthBounty: null, alreadyHasYearOrUpgrade: false, payingReferralsBefore: 0, tierThreshold: 10 };
  it('upgrade difference never goes negative', () => {
    const d = decideBounty({ ...base, interval: 'year', netMinor: 100_000, prior: [{ interval: 'month', paidAt: at(-40) }], earnedMonthBounty: { amountMinor: 150_000, currency: 'try' } });
    expect(d.kind).toBeNull();
  });
  it('upgrade without a monthly bounty yet earns the full yearly amount as bounty_upgrade', () => {
    const d = decideBounty({ ...base, interval: 'year', prior: [{ interval: 'month', paidAt: at(-10) }] });
    expect(d).toMatchObject({ kind: 'bounty_upgrade', amountMinor: 250_000 });
  });
});

describe('§2.4 promo code on the paid invoice', () => {
  it('attributes an organic customer to the promo partner, then the bounty follows; a link partner is kept', async () => {
    const { attributePromoInvoice } = await import('@/lib/partners/stripeBounty');
    await h.db.partner.create({ data: { id: 'pp', code: 'PROMO10', name: 'Promo', type: 'youtube', status: 'active', email: 'promo@partner.test', tierThreshold: 10, stripePromotionCode: 'promo_1', userId: null } });
    await h.db.user.create({ data: { id: 'organic', email: 'organic@example.com', role: 'user', billingProvider: 'stripe', subscriptionPlan: 'trial', shopifyShops: [] } });
    await h.db.userAcquisition.create({ data: { userId: 'organic', partnerId: null, refCode: null } });
    const invoice = { id: 'in_p', discounts: [{ id: 'di_1', promotion_code: 'promo_1' }] } as any;
    expect(await attributePromoInvoice(invoice, 'organic')).toBe('attributed');
    expect(h.db.userAcquisition.rows.find((r) => r.userId === 'organic')).toMatchObject({ partnerId: 'pp', refCode: 'PROMO10' });
    expect(await year('organic', 'in_p', T0)).toMatchObject({ kind: 'bounty_year' });

    const { userId } = await seed();
    expect(await attributePromoInvoice(invoice, userId)).toBe('kept');
    expect(h.db.userAcquisition.rows.find((r) => r.userId === userId)!.partnerId).toBe('p1');
  });
});
