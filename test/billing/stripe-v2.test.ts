// Pricing v2 P3 on Stripe: subscription → plan + BillingModule sync (lib/billing/stripeV2.ts), the flag-gated v2
// checkout (modules as extra line items), and v2 plan invoices earning partner bounties.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePrisma, type FakePrisma } from '../partners/fakePrisma';

const h = vi.hoisted(() => ({
  db: null as unknown as FakePrisma,
  pricesList: vi.fn(),
  sessionCreate: vi.fn(),
  authUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: new Proxy({}, { get: (_t, k) => (h.db as any)[k] }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    prices: { list: (...a: unknown[]) => h.pricesList(...a), retrieve: async () => ({}) },
    checkout: { sessions: { create: (...a: unknown[]) => h.sessionCreate(...a) } },
    customers: { create: async () => ({ id: 'cus_new' }) },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => h.authUser(...a) }));

import { allV2LookupKeys, resetV2PriceCache, syncSubscriptionFromStripe, v2ItemFromMetadata } from '@/lib/billing/stripeV2';

const price = (id: string, meta: Record<string, string>, interval: 'month' | 'year', lookup?: string) => ({ id, metadata: { kx_v2: '1', ...meta }, recurring: { interval }, lookup_key: lookup ?? null });

const CATALOG = [
  price('price_aylik', { kx_plan: 'aylik' }, 'month', 'kx_v2_aylik_month_try'),
  price('price_buyume', { kx_plan: 'buyume_yil' }, 'year', 'kx_v2_buyume_yil_year_try'),
  price('price_fin_m', { kx_module: 'financials' }, 'month', 'kx_v2_financials_month_try'),
  price('price_store_m', { kx_module: 'extraStore' }, 'month', 'kx_v2_extrastore_month_try'),
  price('price_store_y', { kx_module: 'extraStore' }, 'year', 'kx_v2_extrastore_year_try'),
];

beforeEach(async () => {
  h.db = makeFakePrisma();
  resetV2PriceCache();
  h.pricesList.mockReset().mockImplementation(async ({ lookup_keys }: { lookup_keys: string[] }) => ({ data: CATALOG.filter((p) => lookup_keys.includes(p.lookup_key!)) }));
  h.sessionCreate.mockReset().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/x' });
  h.authUser.mockReset();
  await h.db.user.create({ data: { id: 'u1', email: 'u1@example.com', billingProvider: 'stripe', subscriptionPlan: 'trial', subscriptionStatus: 'trialing', stripeCustomerId: 'cus_1', trialExpiresAt: null, shopifyShops: [] } });
});
afterEach(() => { delete process.env.PRICING_V2; });

const sub = (status: string, items: Array<{ id: string; price: any; quantity?: number }>) => ({ status, items: { data: items.map((i) => ({ current_period_end: 1_800_000_000, quantity: 1, ...i })) } }) as any;

describe('lookup keys and metadata', () => {
  it('has 4 plans + 5 modules × 2 intervals', () => {
    const keys = allV2LookupKeys();
    expect(keys).toHaveLength(14);
    expect(keys).toContain('kx_v2_aylik_month_try');
    expect(keys).toContain('kx_v2_bulkphotostudio_year_try');
    expect(keys).not.toContain('kx_v2_kurumsal_year_try');
  });
  it('reads v2 metadata, ignores other prices', () => {
    expect(v2ItemFromMetadata({ kx_v2: '1', kx_plan: 'pro_yil' }, 'year')).toEqual({ kind: 'plan', key: 'pro_yil', interval: 'year' });
    expect(v2ItemFromMetadata({ kx_v2: '1', kx_module: 'arbitrage' }, 'month')).toEqual({ kind: 'module', key: 'arbitrage', interval: 'month' });
    expect(v2ItemFromMetadata({ kx_plan: 'pro_yil' }, 'year')).toBeNull();
    // Kurumsal activates from its (payment-link) price, yearly only; it stays out of the self-serve lookup keys.
    expect(v2ItemFromMetadata({ kx_v2: '1', kx_plan: 'kurumsal' }, 'year')).toEqual({ kind: 'plan', key: 'kurumsal', interval: 'year' });
    expect(v2ItemFromMetadata({ kx_v2: '1', kx_plan: 'kurumsal' }, 'month')).toBeNull();
  });
});

describe('syncSubscriptionFromStripe', () => {
  it('sets the v2 plan and creates Stripe module rows; removing an item cancels it; admin grants stay', async () => {
    await h.db.billingModule.create({ data: { userId: 'u1', module: 'arbitrage', quantity: 1, provider: 'admin', status: 'active' } });
    await syncSubscriptionFromStripe('u1', sub('active', [
      { id: 'si_plan', price: CATALOG[0] },
      { id: 'si_fin', price: CATALOG[2] },
      { id: 'si_store', price: CATALOG[3], quantity: 2 },
    ]));
    expect(h.db.user.rows[0]).toMatchObject({ subscriptionPlan: 'aylik', billingInterval: 'month', subscriptionStatus: 'active' });
    const mods = () => Object.fromEntries(h.db.billingModule.rows.map((r) => [r.module, [r.status, r.quantity, r.provider]]));
    expect(mods()).toEqual({ arbitrage: ['active', 1, 'admin'], financials: ['active', 1, 'stripe'], extraStore: ['active', 2, 'stripe'] });

    await syncSubscriptionFromStripe('u1', sub('active', [{ id: 'si_plan', price: CATALOG[0] }, { id: 'si_store', price: CATALOG[3], quantity: 3 }]));
    expect(mods()).toEqual({ arbitrage: ['active', 1, 'admin'], financials: ['canceled', 1, 'stripe'], extraStore: ['active', 3, 'stripe'] });
  });

  it('a canceled subscription cancels its Stripe modules and leaves the plan to the existing handler', async () => {
    await syncSubscriptionFromStripe('u1', sub('active', [{ id: 'si_plan', price: CATALOG[1] }, { id: 'si_store', price: CATALOG[4] }]));
    expect(h.db.user.rows[0].subscriptionPlan).toBe('buyume_yil');
    await syncSubscriptionFromStripe('u1', sub('canceled', [{ id: 'si_plan', price: CATALOG[1] }, { id: 'si_store', price: CATALOG[4] }]));
    expect(h.db.billingModule.rows[0].status).toBe('canceled');
    expect(h.db.user.rows[0].subscriptionPlan).toBe('buyume_yil');
  });

  it('maps today\'s ladder prices too (env ids)', async () => {
    process.env.PRICE_GROWTH_MONTH = 'price_growth_m';
    await syncSubscriptionFromStripe('u1', sub('trialing', [{ id: 'si_g', price: { id: 'price_growth_m', metadata: {}, recurring: { interval: 'month' } } }]));
    expect(h.db.user.rows[0]).toMatchObject({ subscriptionPlan: 'growth', billingInterval: 'month', subscriptionStatus: 'trialing' });
    delete process.env.PRICE_GROWTH_MONTH;
  });

  it('never touches a Shopify-installed account', async () => {
    h.db.user.rows[0].billingProvider = 'shopify_free';
    expect(await syncSubscriptionFromStripe('u1', sub('active', [{ id: 'si_plan', price: CATALOG[0] }, { id: 'si_fin', price: CATALOG[2] }]))).toBeNull();
    expect(h.db.billingModule.rows).toHaveLength(0);
    expect(h.db.user.rows[0].subscriptionPlan).toBe('trial');
  });
});

describe('bounty on a v2 plan invoice', () => {
  it('the Aylık plan line is a plan payment; a module-only invoice is not', async () => {
    const { planOfInvoice } = await import('@/lib/partners/stripeBounty');
    const line = (priceId: string, amount = 100) => ({ amount, pricing: { price_details: { price: priceId } } });
    expect(await planOfInvoice({ lines: { data: [line('price_fin_m'), line('price_aylik')] } } as any)).toEqual({ plan: 'aylik', interval: 'month' });
    expect(await planOfInvoice({ lines: { data: [line('price_fin_m'), line('price_store_m')] } } as any)).toBeNull();
  });
});

describe('checkout (v2 behind PRICING_V2)', () => {
  const run = async (body: Record<string, unknown>) => {
    const { default: handler } = await import('@/pages/api/stripe/create-checkout-session');
    const res: any = { statusCode: 0, body: undefined };
    res.setHeader = vi.fn();
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    res.end = () => res;
    await handler({ method: 'POST', headers: {}, cookies: {}, body } as any, res);
    return res;
  };
  beforeEach(() => { h.authUser.mockResolvedValue({ id: 'u1', email: 'u1@example.com' }); });

  it('flag off: a v2 plan key is rejected and no session is created', async () => {
    const res = await run({ plan: 'aylik', interval: 'month' });
    expect(res.statusCode).toBe(400);
    expect(h.sessionCreate).not.toHaveBeenCalled();
  });

  it('flag on: Aylık + modules become line items at the plan interval', async () => {
    process.env.PRICING_V2 = '1';
    const res = await run({ plan: 'aylik', interval: 'year', modules: { financials: 1, extraStore: 2 } });
    expect(res.statusCode).toBeLessThan(300);
    const args = h.sessionCreate.mock.calls[0][0];
    expect(args.line_items).toEqual([{ price: 'price_aylik', quantity: 1 }, { price: 'price_fin_m', quantity: 1 }, { price: 'price_store_m', quantity: 2 }]);
    expect(args.mode).toBe('subscription');
  });

  it('flag on: an unknown module is rejected', async () => {
    process.env.PRICING_V2 = '1';
    const res = await run({ plan: 'aylik', modules: { hacks: 1 } });
    expect(res.statusCode).toBe(400);
    expect(h.sessionCreate).not.toHaveBeenCalled();
  });

  it('flag on: a Shopify-installed account still gets 403', async () => {
    process.env.PRICING_V2 = '1';
    h.db.user.rows[0].billingProvider = 'shopify_free';
    const res = await run({ plan: 'aylik' });
    expect(res.statusCode).toBe(403);
    expect(h.sessionCreate).not.toHaveBeenCalled();
  });
});
