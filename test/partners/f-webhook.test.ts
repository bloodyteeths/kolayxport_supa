// Referral spec §5 B13: a throwing bounty hook never breaks billing — the renewal still resets usage, the webhook
// answers 200. Plus §2.4: checkout with a partner promo code attributes the customer (first touch wins), and
// charge.refunded reaches the refund hook.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  subRetrieve: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  bountyInvoice: vi.fn(),
  bountyRefund: vi.fn(),
  promo: vi.fn(),
}));

vi.mock('micro', () => ({ buffer: vi.fn(async () => Buffer.from('{}')) }));
const m = vi.hoisted(() => ({
  stripe: (hh: any) => ({ stripe: { webhooks: { constructEvent: (...a: unknown[]) => hh.constructEvent(...a) }, subscriptions: { retrieve: (...a: unknown[]) => hh.subRetrieve(...a) } } }),
  prisma: (hh: any) => ({
    default: {
      user: { findUnique: (...a: unknown[]) => hh.userFind(...a), update: (...a: unknown[]) => hh.userUpdate(...a) },
      webhookEvent: { findUnique: async () => null, create: async () => ({}), upsert: async () => ({}), update: async () => ({}) },
    },
  }),
}));
vi.mock('@/lib/stripe', () => m.stripe(h));
vi.mock('../../lib/stripe', () => m.stripe(h));
vi.mock('@/lib/prisma', () => m.prisma(h));
vi.mock('../../lib/prisma', () => m.prisma(h));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/admin/events', () => ({ logBillingEvent: vi.fn(), logSecurityEvent: vi.fn() }));
vi.mock('@/lib/tracking/server', () => ({ contextFromMetadata: () => ({}), sendServerEvent: vi.fn() }));
vi.mock('@/lib/partners/stripeBounty', () => ({
  bountyFromStripeInvoice: (...a: unknown[]) => h.bountyInvoice(...a),
  bountyFromStripeRefund: (...a: unknown[]) => h.bountyRefund(...a),
  attributePromoCheckout: (...a: unknown[]) => h.promo(...a),
}));

import handler from '@/pages/api/stripe/webhook';

beforeAll(() => { process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'; });

function run() {
  const res: any = { statusCode: 0 };
  res.setHeader = vi.fn();
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = () => res;
  res.send = () => res;
  res.end = () => res;
  return Promise.resolve(handler({ method: 'POST', headers: { 'stripe-signature': 'sig' } } as any, res)).then(() => res);
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.userFind.mockResolvedValue({ id: 'u1', stripeCustomerId: 'cus_1' });
  h.userUpdate.mockResolvedValue({});
  h.subRetrieve.mockResolvedValue({ customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_x', recurring: { interval: 'year' }, unit_amount: 100 } }] } });
});

describe('Stripe webhook partner hooks', () => {
  it('B13: a throwing bounty hook leaves billing intact and returns 200', async () => {
    h.constructEvent.mockReturnValue({ id: 'evt_1', type: 'invoice.payment_succeeded', data: { object: { id: 'in_1', customer: 'cus_1', billing_reason: 'subscription_cycle', subscription: 'sub_1', amount_paid: 100 } } });
    h.bountyInvoice.mockImplementation(() => { throw new Error('bounty bug'); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(h.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderSyncCount: 0, subscriptionStatus: 'active' }) }));
    expect(h.bountyInvoice).toHaveBeenCalledWith(expect.objectContaining({ id: 'in_1' }), 'u1');
  });

  it('every paid invoice of a known customer reaches the bounty hook (first payment too)', async () => {
    h.constructEvent.mockReturnValue({ id: 'evt_2', type: 'invoice.payment_succeeded', data: { object: { id: 'in_2', customer: 'cus_1', billing_reason: 'subscription_create', amount_paid: 100 } } });
    h.bountyInvoice.mockResolvedValue({ status: 'recorded' });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(h.bountyInvoice).toHaveBeenCalledTimes(1);
  });

  it('charge.refunded reaches the refund hook; a throw still answers 200', async () => {
    h.constructEvent.mockReturnValue({ id: 'evt_3', type: 'charge.refunded', data: { object: { id: 'ch_1', amount: 100, amount_refunded: 100 } } });
    h.bountyRefund.mockImplementation(() => { throw new Error('boom'); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(h.bountyRefund).toHaveBeenCalledWith(expect.objectContaining({ id: 'ch_1' }));
  });

  it('§2.4: a subscription checkout runs promo-code attribution after the billing update', async () => {
    h.constructEvent.mockReturnValue({ id: 'evt_4', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', amount_total: 100, discounts: [{ promotion_code: 'promo_1' }] } } });
    h.promo.mockImplementation(() => { throw new Error('promo bug'); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(h.userUpdate).toHaveBeenCalled();
    expect(h.promo).toHaveBeenCalledWith(expect.objectContaining({ id: 'cs_1' }), 'u1');
  });
});
