// useEntitlement normalizer + fallback derivation (settings §2.4), invoices normalizer (A1 tolerance),
// featureAccess matrix (pro-gating §2).
import { describe, expect, it } from 'vitest';
import { entitlementFromSettings, normalizeEntitlement } from '@/lib/billing/useEntitlement';
import { clampInvoiceLimit, invoicesKey, nextInvoiceCursor, normalizeInvoicesPage } from '@/lib/billing/useInvoices';
import { featureAccess, featureActionState } from '@/lib/billing/useFeatureAction';
import { isTabGated, previewImage, seePlansHref } from '@/lib/billing/featureMap';
import { normalizeBillingSummary } from '@/components/domain/billing/useBillingSummary';
import { checkoutConfirmed, stripCheckoutParam } from '@/components/domain/billing/CheckoutReturn';
import { sortInvoices } from '@/components/domain/billing/InvoicesCard';
import { F, NOW, ent, inDays } from './d-fixtures';

describe('normalizeEntitlement', () => {
  it('accepts the §2.2 body and rejects garbage', () => {
    const body = { ...F.growth(), stripeUpsell: true, currency: 'try' };
    const e = normalizeEntitlement(body)!;
    expect(e.plan).toBe('growth');
    expect(e.currency).toBe('TRY');
    expect(e.meters.labels).toEqual({ used: 400, limit: 1000 });
    expect(normalizeEntitlement(null)).toBeNull();
    expect(normalizeEntitlement({ plan: 'gold', state: 'active' })).toBeNull();
    expect(normalizeEntitlement([])).toBeNull();
  });

  it('stripeUpsell is true only for an explicit true (Shopify-safe)', () => {
    expect(normalizeEntitlement({ ...F.growth(), stripeUpsell: 'yes' })!.stripeUpsell).toBe(false);
    expect(normalizeEntitlement({ ...F.growth(), stripeUpsell: undefined })!.stripeUpsell).toBe(false);
  });

  it('missing features fall back to the plan table; unknown meters are dropped; unlimited stays null', () => {
    const e = normalizeEntitlement({ plan: 'pro', state: 'active', meters: { orders: { used: 3, limit: null }, bogus: { used: 1 } } })!;
    expect(e.features).toEqual({ arbitrage: true, financials: true, bulkPhotoStudio: true });
    expect(e.meters).toEqual({ orders: { used: 3, limit: null } });
    expect(e.period).toBeNull();
  });
});

describe('entitlementFromSettings (fallback mode)', () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    subscriptionPlan: 'trial', subscriptionStatus: 'trialing', billingInterval: null, billingProvider: null,
    trialExpiresAt: inDays(10), usageResetAt: null, orderSyncCount: 12, labelCount: 3,
    limits: { orderSync: 50, label: 10 }, period: 'trial', ...over,
  });

  it('app trial → trial with the enforced limits, two meters, Pro features on, upsell allowed', () => {
    const e = entitlementFromSettings(sub(), NOW)!;
    expect(e).toMatchObject({ plan: 'trial', state: 'trial', stripeUpsell: true, trialEndsAt: new Date(inDays(10)).toISOString() });
    expect(e.meters).toEqual({ orders: { used: 12, limit: 50 }, labels: { used: 3, limit: 10 } });
    expect(e.features.financials).toBe(true);
  });

  it('trial ended < 3 days ago → grace; later → expired with features off', () => {
    expect(entitlementFromSettings(sub({ trialExpiresAt: inDays(-1) }), NOW)!.state).toBe('grace');
    const ex = entitlementFromSettings(sub({ trialExpiresAt: inDays(-5) }), NOW)!;
    expect(ex.state).toBe('expired');
    expect(ex.features.financials).toBe(false);
  });

  it('shopify_free by provider or plan → neutral, unlimited meters', () => {
    for (const s of [sub({ billingProvider: 'shopify_free' }), sub({ subscriptionPlan: 'shopify_free', subscriptionStatus: 'active' })]) {
      const e = entitlementFromSettings(s, NOW)!;
      expect(e).toMatchObject({ plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false });
      expect(e.meters.orders?.limit).toBeNull();
    }
  });

  it('Stripe trialing / active on a paid plan → active (tiers D3); past_due → past_due_grace; canceled → expired', () => {
    expect(entitlementFromSettings(sub({ subscriptionPlan: 'growth', subscriptionStatus: 'trialing' }), NOW)!.state).toBe('active');
    const a = entitlementFromSettings(sub({ subscriptionPlan: 'starter', subscriptionStatus: 'active', billingInterval: 'year', usageResetAt: inDays(20), limits: { orderSync: 200, label: 100 } }), NOW)!;
    expect(a).toMatchObject({ plan: 'starter', state: 'active', interval: 'year', currentPeriodEnd: new Date(inDays(20)).toISOString() });
    expect(a.period?.end).toBe(new Date(inDays(20)).toISOString());
    expect(entitlementFromSettings(sub({ subscriptionPlan: 'growth', subscriptionStatus: 'past_due' }), NOW)!.state).toBe('past_due_grace');
    expect(entitlementFromSettings(sub({ subscriptionPlan: null, subscriptionStatus: 'canceled', trialExpiresAt: null }), NOW)!.state).toBe('expired');
  });

  it('enterprise → enterprise, no Stripe upsell', () => {
    expect(entitlementFromSettings(sub({ subscriptionPlan: 'enterprise', subscriptionStatus: 'active' }), NOW)).toMatchObject({ state: 'enterprise', stripeUpsell: false });
  });

  it('no subscription block → null (unknown)', () => {
    expect(entitlementFromSettings(null, NOW)).toBeNull();
  });
});

describe('invoices', () => {
  it('pre-A1 body: paid only, trimmed to the limit, no hasMore', () => {
    const list = Array.from({ length: 8 }, (_, i) => ({
      id: `in_${i}`, date: '2026-10-01T00:00:00.000Z', amount: 2999.4, currency: 'try', status: 'paid',
      hostedInvoiceUrl: 'https://x', invoicePdf: 'https://p', description: 'Subscription',
      period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
    }));
    const page = normalizeInvoicesPage({ invoices: list }, 5);
    expect(page.invoices).toHaveLength(5);
    expect(page.hasMore).toBe(false);
    expect(page.invoices[0]).toMatchObject({ id: 'in_0', currency: 'TRY', number: null, plan: null, periodStart: '2026-10-01T00:00:00.000Z' });
  });

  it('A1 body: number, plan, interval, hasMore; drafts never shown', () => {
    const page = normalizeInvoicesPage({
      hasMore: true,
      invoices: [
        { id: 'in_1', number: 'KX-0012', date: '2026-10-01', amount: 10, currency: 'TRY', status: 'open', plan: 'growth', interval: 'month' },
        { id: 'in_2', date: '2026-09-01', amount: 10, currency: 'TRY', status: 'draft' },
        { id: 'bad' },
      ],
    }, 20);
    expect(page.hasMore).toBe(true);
    expect(page.invoices).toHaveLength(1);
    expect(page.invoices[0]).toMatchObject({ number: 'KX-0012', plan: 'growth', interval: 'month', status: 'open' });
  });

  it('next page cursor: server scan cursor first, then last row, else stop', () => {
    expect(nextInvoiceCursor(normalizeInvoicesPage({ invoices: [], hasMore: true, nextCursor: 'in_z' }, 20))).toBe('in_z');
    expect(nextInvoiceCursor(normalizeInvoicesPage({ invoices: [{ id: 'in_1', date: '2026-10-01', status: 'paid' }], hasMore: true }, 20))).toBe('in_1');
    expect(nextInvoiceCursor(normalizeInvoicesPage({ invoices: [], hasMore: true }, 20))).toBeNull();
    expect(nextInvoiceCursor(normalizeInvoicesPage({ invoices: [], hasMore: false, nextCursor: 'in_z' }, 20))).toBeNull();
    expect(nextInvoiceCursor(null)).toBeNull();
  });

  it('keys and limits', () => {
    expect(clampInvoiceLimit(1)).toBe(5);
    expect(clampInvoiceLimit(500)).toBe(100);
    expect(invoicesKey(5)).toBe('/api/stripe/billing-history?limit=5');
    expect(invoicesKey(20, 'in_9')).toBe('/api/stripe/billing-history?limit=20&starting_after=in_9');
  });

  it('past due: open invoices first (stable)', () => {
    const mk = (id: string, status: string) => ({ id, status }) as never;
    expect(sortInvoices([mk('a', 'paid'), mk('b', 'open'), mk('c', 'paid')], true).map((i: { id: string }) => i.id)).toEqual(['b', 'a', 'c']);
    expect(sortInvoices([mk('a', 'paid'), mk('b', 'open')], false).map((i: { id: string }) => i.id)).toEqual(['a', 'b']);
  });
});

describe('billing summary + checkout return helpers', () => {
  it('normalizeBillingSummary', () => {
    expect(normalizeBillingSummary({ paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 }, upcoming: { amount: 2999.4, currency: 'try', date: '2026-11-01' } }))
      .toEqual({ paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 }, upcoming: { amount: 2999.4, currency: 'TRY', date: '2026-11-01' } });
    expect(normalizeBillingSummary({ error: 'x' })).toEqual({ paymentMethod: null, upcoming: null });
  });

  it('checkoutConfirmed / stripCheckoutParam', () => {
    expect(checkoutConfirmed(F.growth())).toBe(true);
    expect(checkoutConfirmed(F.trial())).toBe(false);
    expect(checkoutConfirmed(undefined)).toBe(false);
    expect(stripCheckoutParam({ tab: 'billing', checkout: 'success', x: undefined })).toEqual({ tab: 'billing' });
  });
});

describe('featureAccess — pro-gating §2 matrix', () => {
  const access = (e: Parameters<typeof featureAccess>[1]['entitlement'], extra: Partial<Parameters<typeof featureAccess>[1]> = {}) =>
    featureAccess('financials', { entitlement: e, ...extra });

  it('trial → trial (tag + works); pro / enterprise → allowed; starter/growth → locked', () => {
    expect(access(F.trial())).toBe('trial');
    expect(access(F.pro())).toBe('allowed');
    expect(access(F.enterprise())).toBe('allowed');
    expect(access(F.growth())).toBe('locked');
    expect(access(ent({ plan: 'starter' }))).toBe('locked');
  });

  it('expired / grace without the feature → paused', () => {
    expect(access(F.expired())).toBe('paused');
    expect(access(ent({ ...F.grace(), features: { arbitrage: false, financials: false, bulkPhotoStudio: false } }))).toBe('paused');
  });

  it('shopify_free → neutral (entry not rendered)', () => {
    expect(access(F.shopify())).toBe('neutral');
  });

  it('unknown: loading → loading, error → unknown (render, server decides)', () => {
    expect(access(undefined, { loading: true })).toBe('loading');
    expect(access(undefined)).toBe('unknown');
  });

  it('a server 402 featureLocked wins; neutral when the server says so or the provider is unknown', () => {
    expect(access(F.pro(), { serverLock: {} })).toBe('locked');
    expect(access(F.pro(), { serverLock: { neutral: true } })).toBe('neutral');
    expect(access(undefined, { serverLock: {} })).toBe('neutral');
    expect(access(F.shopify(), { serverLock: {} })).toBe('neutral');
    expect(access(F.expired(), { serverLock: {} })).toBe('paused');
  });

  it('featureActionState: visibility and tags', () => {
    expect(featureActionState('trial', inDays(3))).toMatchObject({ visible: true, tag: true, locked: false });
    expect(featureActionState('trial', inDays(3)).trialEndsAt?.toISOString()).toBe(new Date(inDays(3)).toISOString());
    expect(featureActionState('locked', null)).toMatchObject({ visible: true, tag: true, locked: true, trialEndsAt: null });
    expect(featureActionState('allowed', null)).toMatchObject({ visible: true, tag: false, locked: false });
    expect(featureActionState('unknown', null)).toMatchObject({ visible: true, tag: false, locked: false });
    expect(featureActionState('neutral', null)).toMatchObject({ visible: false, tag: false });
  });

  it('featureMap helpers', () => {
    expect(isTabGated('sales')).toBeNull();
    expect(isTabGated('profit')).toBe('financials');
    expect(isTabGated('transactions')).toBe('financials');
    expect(isTabGated(undefined)).toBeNull();
    expect(seePlansHref('bulkPhotoStudio')).toBe('/fiyatlandirma?plan=pro&from=bulkPhotoStudio');
    expect(previewImage('financials', 'tr')).toEqual({ src: '/previews/profit-tr.png', srcSet: '/previews/profit-tr.png 1x, /previews/profit-tr@2x.png 2x' });
  });
});
