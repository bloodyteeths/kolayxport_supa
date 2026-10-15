// @vitest-environment jsdom
// Settings › Plan & billing (group D): state rendering, fallback, unknown provider, portal flows, and the
// §11 Shopify gating assertions (no /fiyatlandirma, no "Stripe", no currency symbol, no Stripe calls).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { BillingPanel } from '@/components/domain/billing/BillingPanel';
import { PlanCard } from '@/components/domain/billing/PlanCard';
import { UsageCard } from '@/components/domain/billing/UsageCard';
import { IncludedCard } from '@/components/domain/billing/IncludedCard';
import { billingView } from '@/lib/billing/billingState';
import { F, NOW } from './d-fixtures';
import { calledPaths, mockFetch, renderD } from './d-harness';

const h = vi.hoisted(() => ({
  router: {
    pathname: '/ayarlar',
    asPath: '/ayarlar?tab=billing',
    isReady: true,
    query: { tab: 'billing' } as Record<string, string>,
    events: { on: () => undefined, off: () => undefined, emit: () => undefined },
    push: vi.fn(() => Promise.resolve(true)),
    replace: vi.fn(() => Promise.resolve(true)),
    prefetch: vi.fn(() => Promise.resolve()),
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('@/components/ds/feedback', async (orig) => ({ ...(await orig<object>()), useToast: () => h.toast }));

const INVOICES = {
  hasMore: false,
  invoices: [
    { id: 'in_2', number: 'KX-0012', date: '2026-10-01T00:00:00Z', amount: 2999.4, currency: 'TRY', status: 'paid', plan: 'growth', interval: 'month',
      period: { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z' }, hostedInvoiceUrl: 'https://inv/2', invoicePdf: 'https://pdf/2' },
  ],
};
const SUMMARY = { paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 }, upcoming: { amount: 2999.4, currency: 'TRY', date: '2026-11-01T00:00:00Z' } };

beforeEach(() => {
  h.router.query = { tab: 'billing' };
  h.router.push.mockClear();
  h.router.replace.mockClear();
  Object.values(h.toast).forEach((f) => f.mockClear());
});
afterEach(cleanup);

function stripeRoutes(entitlement: unknown) {
  return {
    '/api/billing/entitlement': { body: entitlement },
    '/api/stripe/billing-history': { body: INVOICES },
    '/api/stripe/billing-summary': { body: SUMMARY },
    '/api/stripe/create-portal-session': { body: { url: 'https://billing.stripe.test/session' } },
  };
}

describe('BillingPanel — Stripe states', () => {
  it('active founding Growth: price + struck list price, founding line, next payment, payment method, invoices, near-limit primary', async () => {
    mockFetch(stripeRoutes(F.growthFounding()));
    renderD(<BillingPanel />, 'en');
    expect(await screen.findByText('Growth')).toBeTruthy();
    expect(screen.getByText('Founding member · 40% off for life')).toBeTruthy();
    expect(screen.getByTestId('plan-line-price').textContent).toContain('₺2,999.40 / month');
    expect(screen.getByTestId('plan-line-list-price').textContent).toBe('₺4,999');
    expect(await screen.findByTestId('plan-line-nextPayment')).toBeTruthy();
    expect(screen.getByTestId('billing-payment-method').textContent).toContain('Visa •••• 4242 · expires 08/28');
    expect(await screen.findByText('KX-0012')).toBeTruthy();
    // 82 % labels → near-limit caption with the next plan, and Change plan is the primary
    expect(screen.getByTestId('usage-near-labels').textContent).toContain('82% of your labels are used. Pro includes 3,000 a month.');
    expect(screen.getByTestId('action-changePlan')).toBeTruthy();
  });

  it('Change plan opens the portal on subscription_update', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    const fetchMock = mockFetch(stripeRoutes(F.growth()));
    renderD(<BillingPanel />, 'en');
    fireEvent.click(await screen.findByTestId('action-changePlan'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.test/session'));
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('create-portal-session'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ flow: 'subscription_update' });
  });

  it('portal 403 → "managed elsewhere" toast, never raw server text', async () => {
    mockFetch({ ...stripeRoutes(F.growth()), '/api/stripe/create-portal-session': { status: 403, body: { error: 'Shopify-installed accounts use the free Shopify tier.' } } });
    renderD(<BillingPanel />, 'en');
    fireEvent.click(await screen.findByTestId('action-changePlan'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Billing is managed elsewhere for this account.', expect.anything()));
  });

  it('trial: Free trial, Choose a plan → pricing, usage this trial, no invoices card when the list is empty', async () => {
    mockFetch({ ...stripeRoutes(F.trial()), '/api/stripe/billing-history': { body: { invoices: [], hasMore: false } } });
    renderD(<BillingPanel />, 'tr');
    expect(await screen.findByText('Ücretsiz deneme')).toBeTruthy();
    expect(screen.getByText('Deneme süresindeki kullanım')).toBeTruthy();
    const choose = screen.getByTestId('action-choosePlan');
    expect(choose.getAttribute('href')).toBe('/fiyatlandirma?from=billing');
    await waitFor(() => expect(screen.queryByTestId('billing-invoices-card')).toBeNull());
  });

  it('past due: danger banner, Update payment method primary', async () => {
    mockFetch(stripeRoutes(F.pastDue()));
    renderD(<BillingPanel />, 'en');
    expect(await screen.findByText(/Your last payment failed/)).toBeTruthy();
    expect(screen.getByTestId('action-updatePayment')).toBeTruthy();
  });

  it('fallback (entitlement 404): derived from /api/user/settings, Order imports + Labels and the "soon" caption', async () => {
    mockFetch({
      '/api/billing/entitlement': { status: 404 },
      '/api/user/settings': { body: { subscription: { subscriptionPlan: 'growth', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe', trialExpiresAt: null, usageResetAt: '2026-11-01T00:00:00Z', orderSyncCount: 120, labelCount: 40, limits: { orderSync: 2000, label: 500 }, period: 'month' } } },
      '/api/stripe/billing-history': { body: INVOICES },
      '/api/stripe/billing-summary': { status: 404 },
    });
    renderD(<BillingPanel />, 'en');
    expect(await screen.findByText('Order imports')).toBeTruthy();
    expect(screen.getByText('Labels')).toBeTruthy();
    expect(screen.getByText('Detailed usage will appear here soon.')).toBeTruthy();
    expect(screen.queryByTestId('usage-meter-connectedStores')).toBeNull();
    // A3 failed → payment method row hidden silently, card still there
    expect(screen.queryByTestId('billing-payment-method')).toBeNull();
    expect(screen.getByTestId('billing-plan-card')).toBeTruthy();
  });

  it('provider unknown (entitlement and settings fail): ErrorState, no Stripe action, no Stripe call', async () => {
    const fetchMock = mockFetch({ '/api/billing/entitlement': { status: 500 }, '/api/user/settings': { status: 500 } });
    renderD(<BillingPanel />, 'en');
    expect(await screen.findByText("Couldn't load your plan")).toBeTruthy();
    const html = document.body.innerHTML;
    expect(html).not.toContain('/fiyatlandirma');
    expect(html).not.toContain('Stripe');
    expect(calledPaths(fetchMock).some((p) => /billing-history|billing-summary|create-portal|create-checkout/.test(p))).toBe(false);
  });
});

describe('§11 Shopify gating (shopify_free / stripeUpsell false)', () => {
  const forbidden = (html: string) => {
    expect(html).not.toContain('/fiyatlandirma');
    expect(html).not.toMatch(/Stripe/);
    expect(html).not.toMatch(/[₺$]/);
    expect(html).not.toMatch(/>Pro</);
  };

  it.each(['en', 'tr'] as const)('BillingPanel (%s): Shopify plan line, no Stripe surface, no Stripe request', async (locale) => {
    const fetchMock = mockFetch(stripeRoutes(F.shopify()));
    renderD(<BillingPanel />, locale);
    expect(await screen.findByText(locale === 'en' ? 'Shopify plan' : 'Shopify planı')).toBeTruthy();
    expect(screen.getByText(locale === 'en' ? 'Plan' : 'Plan')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('billing-usage-card')).toBeTruthy());
    forbidden(document.body.innerHTML);
    expect(screen.queryByTestId('billing-invoices-card')).toBeNull();
    expect(screen.queryByTestId('billing-plan-more')).toBeNull();
    expect(calledPaths(fetchMock).some((p) => /billing-history|billing-summary|create-portal|create-checkout/.test(p))).toBe(false);
  });

  it('PlanCard / UsageCard / IncludedCard each render no upsell for shopify_free', () => {
    const e = F.shopify();
    mockFetch({});
    const view = billingView(e, NOW);
    renderD(
      <div>
        <PlanCard view={view} state="ready" actions={{}} />
        <UsageCard entitlement={e} state="ready" now={NOW} />
        <IncludedCard entitlement={e} />
      </div>,
      'en',
    );
    forbidden(document.body.innerHTML);
    // facts only: near-limit wording without a plan name or link
    expect(document.body.textContent).toContain('Not included');
    expect(screen.queryByTestId('included-see-pro')).toBeNull();
  });
});

describe('BillingPanel — review fixes', () => {
  it('enterprise: "Plan & billing" heading (not the Shopify "Plan"), no Stripe actions', async () => {
    mockFetch(stripeRoutes(F.enterprise()));
    renderD(<BillingPanel />, 'en');
    expect(await screen.findByText('Plan & billing')).toBeTruthy();
    expect(screen.getByText('Enterprise')).toBeTruthy();
    expect(screen.queryByTestId('billing-plan-more')).toBeNull();
  });

  it('mobile trial PlanCard: full-width Compare plans secondary in the card', () => {
    const view = billingView(F.trial(), NOW);
    mockFetch({});
    renderD(
      <PlanCard
        view={view}
        state="ready"
        primaryInCard={false}
        actions={{ mobileSecondary: { id: 'comparePlans', label: 'Compare plans', href: '/fiyatlandirma?from=billing' } }}
      />,
      'en',
    );
    expect(screen.getByTestId('billing-plan-mobile-secondary').getAttribute('href')).toBe('/fiyatlandirma?from=billing');
  });

  it('past due without a grace date: dateless banner, no literal dash', () => {
    const view = billingView({ ...F.pastDue(), graceEndsAt: null }, NOW);
    mockFetch({});
    renderD(<PlanCard view={view} state="ready" actions={{}} />, 'en');
    expect(screen.getByText('Your last payment failed. Update your card to keep importing orders.')).toBeTruthy();
  });

  it('labels at limit: "New labels are paused until {date}."', () => {
    const e = { ...F.growth(), meters: { labels: { used: 1000, limit: 1000 } } };
    mockFetch({});
    renderD(<UsageCard entitlement={e} state="ready" now={NOW} />, 'en');
    expect(document.body.textContent).toContain('Limit reached. New labels are paused until');
  });
});
