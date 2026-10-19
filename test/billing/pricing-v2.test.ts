// Pricing v2 P1 (docs/gtm/pricing-v2.md §3–4): plan keys, yearly buckets, module entitlements, the "cheaper
// package" rule, the flag-gated catalog — and the Shopify App Store guard: a shopify_free account never gets a
// price / plan / upgrade surface, with PRICING_V2 on or off.
import { afterEach, describe, expect, it } from 'vitest';
import { DECIDED_PLAN_LIMITS, ENFORCED_PLAN_LIMITS, getPlanLimits, isYearlyPlan } from '@/lib/billing/planLimits';
import { PLAN_FEATURES } from '@/lib/billing/featureMap';
import { entitlementFromSettings } from '@/lib/billing/entitlementCore';
import { billingView, isNeutralBilling } from '@/lib/billing/billingState';
import { summarizeModules } from '@/lib/billing/modules';
import { cheaperPackage, pricingV2Enabled, withKdv } from '@/lib/billing/pricingV2';
import { storeLimitModel } from '@/components/domain/settings/connections/connectionView';
import catalog from '@/pages/api/billing/v2-catalog';

const NOW = new Date('2026-11-10T12:00:00Z');
const FUTURE = '2027-06-01T00:00:00.000Z';

afterEach(() => { delete process.env.PRICING_V2; });

describe('plan limits', () => {
  it('yearly packages use yearly buckets, Aylık a monthly one', () => {
    expect(getPlanLimits('buyume_yil', 'active', null, NOW)).toMatchObject({ state: 'active', period: 'year', limits: { orderSync: 24000, label: 12000 } });
    expect(getPlanLimits('aylik', 'active', null, NOW)).toMatchObject({ state: 'active', period: 'month', limits: { orderSync: 500, label: 250 } });
    expect(getPlanLimits('kurumsal', 'active', null, NOW)).toMatchObject({ period: 'year', limits: { orderSync: null, label: null } });
    expect(isYearlyPlan('pro_yil')).toBe(true);
    expect(isYearlyPlan('pro')).toBe(false);
  });

  it('+orders modules add 500 a month on Aylık and 6.000 a year on a yearly package; labels unchanged', () => {
    expect(getPlanLimits('aylik', 'active', null, NOW, { extraOrders: 2 }).limits).toEqual({ orderSync: 1500, label: 250 });
    expect(getPlanLimits('baslangic_yil', 'active', null, NOW, { extraOrders: 1 }).limits).toEqual({ orderSync: 12000, label: 3000 });
    // Not active → modules never unlock anything.
    expect(getPlanLimits('aylik', 'canceled', null, NOW, { extraOrders: 5 }).limits).toEqual({ orderSync: 0, label: 0 });
  });

  it('the legacy ladder and shopify_free are unchanged', () => {
    expect(ENFORCED_PLAN_LIMITS.starter).toEqual({ orderSync: 500, label: 250 });
    expect(getPlanLimits('growth', 'active', null, NOW).period).toBe('month');
    expect(DECIDED_PLAN_LIMITS.shopify_free).toEqual({ limits: { orders: null, labels: null, connectedStores: 3, aiCredits: 300 }, stripeUpsell: false });
    expect(PLAN_FEATURES.shopify_free).toEqual({ arbitrage: true, financials: true, bulkPhotoStudio: true });
    expect(getPlanLimits('shopify_free', 'active', null, NOW, { extraOrders: 3 })).toMatchObject({ state: 'shopify_free', limits: { orderSync: null, label: null } });
  });

  it('features: Pro-only features are off below Pro yıllık', () => {
    expect(PLAN_FEATURES.buyume_yil.financials).toBe(false);
    expect(PLAN_FEATURES.pro_yil).toEqual({ arbitrage: true, financials: true, bulkPhotoStudio: true });
  });
});

describe('modules', () => {
  it('counts active rows only; ended / canceled rows add nothing', () => {
    const m = summarizeModules([
      { module: 'financials', quantity: 1, status: 'active', currentPeriodEnd: null },
      { module: 'arbitrage', quantity: 1, status: 'canceled', currentPeriodEnd: null },
      { module: 'bulkPhotoStudio', quantity: 1, status: 'active', currentPeriodEnd: '2026-11-01T00:00:00Z' },
      { module: 'extraStore', quantity: 2, status: 'active', currentPeriodEnd: FUTURE },
      { module: 'extraOrders', quantity: 3, status: 'active', currentPeriodEnd: null },
    ], NOW);
    expect(m).toEqual({ features: ['financials'], extraStores: 2, extraOrders: 3 });
  });
});

describe('entitlement', () => {
  it('a yearly v2 account is active, yearly period, modules add features', () => {
    const e = entitlementFromSettings({
      subscriptionPlan: 'buyume_yil', subscriptionStatus: 'active', billingInterval: 'year', billingProvider: 'stripe',
      usageResetAt: '2027-11-01T00:00:00.000Z', orderSyncCount: 10, labelCount: 2,
      modules: { features: ['financials'], extraStores: 1, extraOrders: 0 },
    }, NOW)!;
    expect(e).toMatchObject({ plan: 'buyume_yil', state: 'active', stripeUpsell: true });
    expect(e.features).toEqual({ financials: true, arbitrage: false, bulkPhotoStudio: false });
    expect(e.period).toEqual({ start: '2026-11-01T00:00:00.000Z', end: '2027-11-01T00:00:00.000Z' });
    expect(e.modules).toEqual({ features: ['financials'], extraStores: 1, extraOrders: 0 });
    expect(billingView(e, NOW).planName).toBe('buyume_yil');
  });

  it('kurumsal behaves like enterprise (no upsell, unlimited meters)', () => {
    const e = entitlementFromSettings({ subscriptionPlan: 'kurumsal', subscriptionStatus: 'active', billingProvider: 'stripe' }, NOW)!;
    expect(e).toMatchObject({ plan: 'kurumsal', state: 'enterprise', stripeUpsell: false });
    expect(e.meters.orders?.limit).toBeNull();
    expect(billingView(e, NOW).planName).toBe('kurumsal');
  });

  it('an expired v2 account gets no module features', () => {
    const e = entitlementFromSettings({ subscriptionPlan: 'aylik', subscriptionStatus: 'canceled', modules: { features: ['financials', 'arbitrage'] } }, NOW)!;
    expect(e.state).toBe('expired');
    expect(Object.values(e.features).some(Boolean)).toBe(false);
  });

  it('Shopify guard: a shopify_free account with PRICING_V2 on sees no price, plan or upgrade surface', () => {
    process.env.PRICING_V2 = '1';
    expect(pricingV2Enabled()).toBe(true);
    const e = entitlementFromSettings({
      subscriptionPlan: 'buyume_yil', subscriptionStatus: 'active', billingProvider: 'shopify_free',
      modules: { features: ['financials'], extraStores: 4, extraOrders: 2 },
    }, NOW)!;
    expect(e).toMatchObject({ plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false });
    expect(e.modules).toBeUndefined();
    expect(isNeutralBilling(e)).toBe(true);
    const view = billingView(e, NOW);
    expect(view.mode).toBe('neutral');
    expect(view.primary).toBeNull();
    expect(view.secondary).toBeNull();
    expect(view.lines.some((l) => l.key === 'price')).toBe(false);
    expect(e.meters.orders?.limit).toBeNull();
    expect(storeLimitModel({ stripeUpsell: e.stripeUpsell, plan: e.plan, extraStores: 4 })).toEqual({ neutral: true });
  });
});

describe('store limit ladder', () => {
  it('v2 accounts move up the yearly packages, with extra-store modules counted', () => {
    expect(storeLimitModel({ stripeUpsell: true, plan: 'aylik' })).toMatchObject({ neutral: false, limit: 2, nextPlan: 'baslangic_yil', nextLimit: 3 });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'aylik', extraStores: 2 })).toMatchObject({ limit: 4, nextPlan: 'buyume_yil' });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'pro_yil' })).toEqual({ neutral: true });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'starter' })).toMatchObject({ nextPlan: 'growth' });
  });
});

describe('cheaper package rule', () => {
  it('Aylık alone (₺35.988 a year) → Başlangıç yıllık is cheaper and covers it', () => {
    expect(cheaperPackage('aylik', {})).toEqual({ plan: 'baslangic_yil', savingTry: 2999 * 12 - 29990 });
  });
  it('only suggests a package that covers the stores, orders and Pro features bought', () => {
    // 2 extra stores (4 total): Başlangıç (3) cannot cover it, Büyüme costs more → nothing.
    expect(cheaperPackage('aylik', { extraStore: 2 })).toBeNull();
    // Büyüme + all three feature modules (₺82.690) is still below Pro yıllık → nothing.
    expect(cheaperPackage('buyume_yil', { financials: 1, arbitrage: 1, bulkPhotoStudio: 1 })).toBeNull();
    // Başlangıç + feature modules + 6 extra stores → Pro yıllık is cheaper.
    expect(cheaperPackage('baslangic_yil', { financials: 1, arbitrage: 1, bulkPhotoStudio: 1, extraStore: 7 })).toMatchObject({ plan: 'pro_yil' });
  });
  it('KDV total', () => {
    expect(withKdv(54990)).toBe(65988);
  });
});

describe('catalog API is flag-gated', () => {
  const call = () => {
    const res: any = { statusCode: 0, body: undefined, headers: {} };
    res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    catalog({ method: 'GET' } as any, res);
    return res;
  };
  it('404 while PRICING_V2 is off', () => {
    expect(call().statusCode).toBe(404);
  });
  it('plans, limits and module prices when on', () => {
    process.env.PRICING_V2 = '1';
    const res = call();
    expect(res.statusCode).toBe(200);
    expect(res.body.plans.map((p: any) => p.key)).toEqual(['aylik', 'baslangic_yil', 'buyume_yil', 'pro_yil', 'kurumsal']);
    expect(res.body.plans.find((p: any) => p.key === 'buyume_yil')).toMatchObject({ priceTry: 54990, maxInstallments: 1, limits: { connectedStores: 6 } });
    expect(res.body.modules.financials).toEqual({ month: 990, year: 9900 });
    expect(res.body.plans.every((p: any) => p.maxInstallments === 1)).toBe(true);
    expect(res.body.pricesExcludeKdv).toBe(false);
  });
});
