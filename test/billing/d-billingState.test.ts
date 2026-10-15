// settings §9.3 (every row of billingView) and §10.4 (pricingCta), incl. provider-unknown.
import { describe, expect, it } from 'vitest';
import { billingView, nearLimitMeter, pricingCta, pricingPrimaryPlan, signupHref } from '@/lib/billing/billingState';
import { F, NOW, ent, inDays } from './d-fixtures';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('billingView — §9.3 state table', () => {
  it('trial (> 3 days): Free trial · trial pill · ends line · choose plan; invoices only if any', () => {
    const v = billingView(F.trial(), NOW);
    expect(v.mode).toBe('stripe');
    expect(v.planName).toBe('trial');
    expect(v.pill).toBe('trial');
    expect(v.lines).toEqual([{ key: 'trialEnds', date: F.trial().trialEndsAt, days: 14, tone: 'neutral' }, { key: 'trialIncludes' }]);
    expect(v.banner).toBeNull();
    expect(v.primary).toEqual({ id: 'choosePlan', kind: 'href', href: '/fiyatlandirma?from=billing' });
    expect(v.secondary).toBeNull();
    expect(v.overflow).toEqual([]);
    expect(v.invoices).toBe('ifAny');
    expect(v.usageTitle).toBe('titleTrial');
  });

  it('trial (≤ 3 days): days line in warning', () => {
    const v = billingView(F.trialEnding(), NOW);
    expect(v.lines[0]).toMatchObject({ key: 'trialEnds', days: 2, tone: 'warning' });
  });

  it('grace: warning banner with the grace end, choose plan', () => {
    const v = billingView(F.grace(), NOW);
    expect(v.planName).toBe('trial');
    expect(v.pill).toBe('grace');
    expect(v.banner).toEqual({ tone: 'warning', key: 'grace', date: F.grace().graceEndsAt });
    expect(v.primary?.id).toBe('choosePlan');
    expect(v.invoices).toBe('ifAny');
  });

  it('grace without graceEndsAt: trial end + 3 days', () => {
    const v = billingView(ent({ ...F.grace(), graceEndsAt: null }), NOW);
    expect(v.banner?.date).toBe(new Date(new Date(inDays(-1)).getTime() + 3 * 86_400_000).toISOString());
  });

  it('expired: No plan · paused pill · danger banner · choose plan', () => {
    const v = billingView(F.expired(), NOW);
    expect(v.planName).toBe('none');
    expect(v.pill).toBe('expired');
    expect(v.lines).toEqual([{ key: 'expired' }]);
    expect(v.banner).toEqual({ tone: 'danger', key: 'expired', date: null });
    expect(v.primary?.id).toBe('choosePlan');
    expect(v.invoices).toBe('ifAny');
  });

  it('active: price line, next payment, Change plan secondary, ⋯ compare/manage/cancel', () => {
    const v = billingView(F.growth(), NOW);
    expect(v.planName).toBe('growth');
    expect(v.pill).toBe('active');
    expect(v.lines).toEqual([
      { key: 'price', interval: 'month', currency: 'TRY', amount: 4999, list: null },
      { key: 'nextPayment' },
    ]);
    expect(v.primary).toBeNull();
    expect(v.secondary).toEqual({ id: 'changePlan', kind: 'portal', flow: 'subscription_update' });
    expect(v.overflow).toEqual([
      { id: 'comparePlans', kind: 'href', href: '/fiyatlandirma?from=billing' },
      { id: 'manageInStripe', kind: 'portal', flow: null },
      { id: 'cancel', kind: 'portal', flow: 'subscription_cancel' },
    ]);
    expect(v.invoices).toBe('show');
    expect(v.paymentDetails).toBe(true);
    expect(v.nearLimit).toBeNull();
  });

  it('active founding member at 82% labels: discounted + struck price, founding line, Change plan becomes primary', () => {
    const v = billingView(F.growthFounding(), NOW);
    expect(v.lines).toEqual([
      { key: 'price', interval: 'month', currency: 'TRY', amount: 2999.4, list: 4999 },
      { key: 'founding' },
      { key: 'nextPayment' },
    ]);
    expect(v.nearLimit).toEqual({ meter: 'labels', percent: 82 });
    expect(v.primary?.id).toBe('changePlan');
    expect(v.secondary).toBeNull();
  });

  it('active + cancelAtPeriodEnd: canceling pill, cancels line, Keep my plan, ⋯ manage only', () => {
    const v = billingView(F.growthCanceling(), NOW);
    expect(v.pill).toBe('canceling');
    expect(v.lines).toEqual([{ key: 'canceling', date: F.growthCanceling().currentPeriodEnd, plan: 'growth' }]);
    expect(v.primary).toEqual({ id: 'keepPlan', kind: 'portal', flow: 'subscription_update' });
    expect(ids(v.overflow)).toEqual(['manageInStripe']);
  });

  it('past_due_grace: danger banner with the grace date, Update payment method, open invoice first; past-due wins over near-limit', () => {
    const v = billingView(ent({ ...F.pastDue(), meters: { labels: { used: 990, limit: 1000 } } }), NOW);
    expect(v.pill).toBe('past_due');
    expect(v.banner).toEqual({ tone: 'danger', key: 'pastDue', date: F.pastDue().graceEndsAt });
    expect(v.primary).toEqual({ id: 'updatePayment', kind: 'portal', flow: 'payment_method_update' });
    expect(ids(v.overflow)).toEqual(['manageInStripe']);
    expect(v.invoices).toBe('show');
    expect(v.invoicesOpenFirst).toBe(true);
  });

  it('past_due_grace without graceEndsAt (fallback mode): dateless banner, never a literal dash', () => {
    const v = billingView(ent({ ...F.pastDue(), graceEndsAt: null }), NOW);
    expect(v.banner).toEqual({ tone: 'danger', key: 'pastDueNoDate', date: null });
  });

  it('trial: mobile-only full-width Compare plans secondary (§9.2), no desktop secondary', () => {
    const v = billingView(F.trial(), NOW);
    expect(v.secondary).toBeNull();
    expect(v.mobileSecondary).toEqual({ id: 'comparePlans', kind: 'href', href: '/fiyatlandirma?from=billing' });
  });

  it('enterprise: managed line, ghost Contact us, no primary, invoices if any', () => {
    const v = billingView(F.enterprise(), NOW);
    expect(v.planName).toBe('enterprise');
    expect(v.pill).toBe('active');
    expect(v.lines).toEqual([{ key: 'enterprise' }]);
    expect(v.primary).toBeNull();
    expect(v.secondary).toEqual({ id: 'contactUs', kind: 'href', href: '/iletisim' });
    expect(v.overflow).toEqual([]);
    expect(v.invoices).toBe('ifAny');
    // The deliberate neutral exception: stripeUpsell false ⇒ no Stripe actions, but invoices if any (§9.3 row).
    expect(v.mode).toBe('neutral');
    expect(v.paymentDetails).toBe(false);
  });

  it('shopify_free: Shopify plan, no pill, one line, no actions, invoices never', () => {
    const v = billingView(F.shopify(), NOW);
    expect(v.mode).toBe('neutral');
    expect(v.planName).toBe('shopify_free');
    expect(v.pill).toBeNull();
    expect(v.lines).toEqual([{ key: 'shopify' }]);
    expect(v.primary).toBeNull();
    expect(v.secondary).toBeNull();
    expect(v.overflow).toEqual([]);
    expect(v.invoices).toBe('hide');
    expect(v.paymentDetails).toBe(false);
  });

  it('stripeUpsell false on any other plan is treated as neutral (the one check)', () => {
    const v = billingView(ent({ stripeUpsell: false }), NOW);
    expect(v.mode).toBe('neutral');
    expect(v.primary).toBeNull();
    expect(v.invoices).toBe('hide');
  });

  it('provider unknown: no Stripe actions, nothing rendered beyond the error', () => {
    for (const e of [null, undefined]) {
      const v = billingView(e, NOW);
      expect(v.mode).toBe('unknown');
      expect(v.primary).toBeNull();
      expect(v.secondary).toBeNull();
      expect(v.overflow).toEqual([]);
      expect(v.invoices).toBe('hide');
    }
  });

  it('nearLimitMeter ignores unlimited meters and picks the highest ratio', () => {
    expect(nearLimitMeter(F.shopify())).toEqual({ meter: 'connectedStores', percent: 100 });
    expect(nearLimitMeter(ent({ meters: { orders: { used: 1900, limit: 2000 }, labels: { used: 820, limit: 1000 } } }))).toEqual({ meter: 'orders', percent: 95 });
    expect(nearLimitMeter(ent({ meters: { orders: { used: 1e6, limit: null } } }))).toBeNull();
  });
});

describe('pricingCta — §10.4', () => {
  const base = { interval: 'month' as const, currency: 'TRY' as const, now: NOW };

  it('anonymous: Start free trial → signup with plan/interval/currency; enterprise → Talk to us', () => {
    expect(pricingCta({ ...base, signedIn: false }, 'growth')).toEqual({ kind: 'signup', href: signupHref('growth', 'month', 'TRY') });
    expect(signupHref('growth', 'year', 'USD')).toBe('/login?mode=signup&callbackUrl=%2Fapp&plan=growth&interval=year&currency=usd');
    expect(pricingCta({ ...base, signedIn: false }, 'enterprise')).toEqual({ kind: 'contact', href: '/iletisim?subject=enterprise' });
  });

  it('signed in, entitlement loading: skeleton (no CTA painted)', () => {
    expect(pricingCta({ ...base, signedIn: true }, 'growth')).toEqual({ kind: 'loading' });
    expect(pricingCta({ ...base, signedIn: true }, 'enterprise')).toEqual({ kind: 'loading' });
  });

  it('trial / grace / expired: checkout; trial with > 49h left carries the trial end', () => {
    expect(pricingCta({ ...base, signedIn: true, entitlement: F.trial() }, 'growth'))
      .toEqual({ kind: 'checkout', plan: 'growth', interval: 'month', currency: 'TRY', chargeFrom: F.trial().trialEndsAt });
    expect(pricingCta({ ...base, signedIn: true, entitlement: ent({ ...F.trial(), trialEndsAt: inDays(1) }) }, 'pro'))
      .toMatchObject({ kind: 'checkout', chargeFrom: null });
    expect(pricingCta({ ...base, signedIn: true, entitlement: F.grace() }, 'starter')).toMatchObject({ kind: 'checkout', chargeFrom: null });
    expect(pricingCta({ ...base, signedIn: true, entitlement: F.expired() }, 'starter')).toMatchObject({ kind: 'checkout', plan: 'starter' });
  });

  it('a locked billing currency wins over the toggle', () => {
    expect(pricingCta({ ...base, currency: 'USD', signedIn: true, entitlement: ent({ ...F.expired(), currency: 'TRY' }) }, 'growth'))
      .toMatchObject({ kind: 'checkout', currency: 'TRY' });
  });

  it('active: current plan (same plan + interval) or switch via the portal', () => {
    expect(pricingCta({ ...base, signedIn: true, entitlement: F.growth() }, 'growth')).toEqual({ kind: 'current' });
    expect(pricingCta({ ...base, interval: 'year', signedIn: true, entitlement: F.growth() }, 'growth')).toEqual({ kind: 'switch', flow: 'subscription_update' });
    expect(pricingCta({ ...base, signedIn: true, entitlement: F.growth() }, 'pro')).toEqual({ kind: 'switch', flow: 'subscription_update' });
  });

  it('past due: every paid plan disabled ("Update payment first")', () => {
    expect(pricingCta({ ...base, signedIn: true, entitlement: F.pastDue() }, 'pro')).toEqual({ kind: 'disabled', reason: 'pastDue' });
  });

  it('stripeUpsell false: redirect to Billing before paint (every card)', () => {
    for (const p of ['starter', 'growth', 'pro', 'enterprise'] as const) {
      expect(pricingCta({ ...base, signedIn: true, entitlement: F.shopify() }, p)).toEqual({ kind: 'redirect', href: '/ayarlar?tab=billing' });
    }
  });

  it('enterprise viewer with stripeUpsell true: Talk to us on every card, never "Couldn\'t check your account"', () => {
    const e = { ...F.enterprise(), stripeUpsell: true };
    for (const p of ['starter', 'growth', 'pro', 'enterprise'] as const) {
      expect(pricingCta({ ...base, signedIn: true, entitlement: e }, p)).toEqual({ kind: 'contact', href: '/iletisim?subject=enterprise' });
    }
  });

  it('provider unknown: disabled with reason, never anonymous CTAs', () => {
    expect(pricingCta({ ...base, signedIn: true, entitlementError: true }, 'growth')).toEqual({ kind: 'disabled', reason: 'unknown' });
  });

  it('single primary: Growth, or the next plan up for an active user', () => {
    expect(pricingPrimaryPlan({ signedIn: false })).toBe('growth');
    expect(pricingPrimaryPlan({ signedIn: true, entitlement: F.trial() })).toBe('growth');
    expect(pricingPrimaryPlan({ signedIn: true, entitlement: ent({ plan: 'starter' }) })).toBe('growth');
    expect(pricingPrimaryPlan({ signedIn: true, entitlement: F.growth() })).toBe('pro');
    expect(pricingPrimaryPlan({ signedIn: true, entitlement: F.pro() })).toBe('enterprise');
  });
});
