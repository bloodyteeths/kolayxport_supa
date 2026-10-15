// lib/billing/billingState.ts — the two billing decision functions (pure, unit-tested):
//   billingView(e, now)            settings §9.3 state table (Plan card title, pill, lines, banner, actions,
//                                  invoices visibility) — test/billing/d-billingState.test.ts covers every row
//   pricingCta(viewer, plan)       settings §10.4 CTA by viewer (pricing page, Group E imports it)
//
// Shopify rule (settings §0.2, §11): `stripeUpsell === false` ⇒ no Stripe action, no plan names in upsell
// copy, no invoices, no pricing link. Unknown entitlement ⇒ no Stripe action either (safe direction).
import { subscriptionStatus } from '@/lib/ds/status/billing';
import type { SubscriptionStatusKey } from '@/lib/ds/status/vocabulary';
import { DECIDED_GRACE_DAYS } from './planLimits';
import { PLAN_LADDER, currencyCode, effectivePrice, nextPlanFor } from './price';
import type { Currency, Entitlement, Interval, MeterKey, PaidPlanKey, PlanKey, PortalFlow, PricedPlanKey } from './types';
import { isPaidPlan } from './types';

export const DAY_MS = 86_400_000;
/** A trial with this many days or fewer left shows its days line in warning-fg (§9.3). */
export const TRIAL_WARNING_DAYS = 3;
/** Share of a meter at which the "near limit" caption and the "Change plan" primary appear (§9.3, §9.4). */
export const NEAR_LIMIT = 0.8;
/** §10.4: Stripe requires `trial_end` ≥ 2 days away; the backend carries the trial when > 49h are left. */
export const TRIAL_CARRY_MS = 49 * 60 * 60 * 1000;

export const PRICING_HREF = '/fiyatlandirma';
export const BILLING_HREF = '/ayarlar?tab=billing';
export const CONTACT_HREF = '/iletisim';
export const ENTERPRISE_CONTACT_HREF = '/iletisim?subject=enterprise';

// ── Shared helpers ──────────────────────────────────────────────────────────────────────────────

function ms(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Whole days until `iso` (ceil, never negative); null without a date. */
export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  const t = ms(iso);
  if (t === null) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

/** true when the account must never see Stripe / pricing surfaces (the one check, §0.2). */
export function isNeutralBilling(e: Pick<Entitlement, 'stripeUpsell' | 'plan' | 'state'> | null | undefined): boolean {
  if (!e) return true;
  return e.stripeUpsell !== true || e.plan === 'shopify_free' || e.state === 'shopify_free';
}

/** Highest meter at or above 80 % of its limit (unlimited meters never count). */
export function nearLimitMeter(e: Pick<Entitlement, 'meters'> | null | undefined): { meter: MeterKey; percent: number } | null {
  let best: { meter: MeterKey; percent: number; ratio: number } | null = null;
  for (const [meter, m] of Object.entries(e?.meters ?? {}) as [MeterKey, { used: number; limit: number | null } | undefined][]) {
    if (!m || m.limit === null || !(m.limit > 0)) continue;
    const ratio = m.used / m.limit;
    if (ratio >= NEAR_LIMIT && (!best || ratio > best.ratio)) best = { meter, percent: Math.round(ratio * 100), ratio };
  }
  return best ? { meter: best.meter, percent: best.percent } : null;
}

// ── billingView (§9.3) ──────────────────────────────────────────────────────────────────────────

export type BillingActionId =
  | 'choosePlan' | 'comparePlans' | 'changePlan' | 'keepPlan' | 'updatePayment' | 'manageInStripe' | 'cancel' | 'contactUs';

export type BillingAction =
  | { id: BillingActionId; kind: 'href'; href: string }
  /** `flow: null` = the Stripe portal home. */
  | { id: BillingActionId; kind: 'portal'; flow: PortalFlow | null };

export type BillingLine =
  | { key: 'trialEnds'; date: string; days: number; tone: 'neutral' | 'warning' }
  | { key: 'trialIncludes' }
  | { key: 'price'; interval: Interval; currency: Currency; amount: number; list: number | null }
  | { key: 'founding' }
  /** Rendered only when `billing-summary.upcoming` loads (A3; hidden silently on failure). */
  | { key: 'nextPayment' }
  | { key: 'canceling'; date: string | null; plan: PlanKey }
  | { key: 'expired' }
  | { key: 'enterprise' }
  | { key: 'shopify' };

export interface BillingBanner {
  tone: 'warning' | 'danger';
  /** `pastDueNoDate` when the grace end is unknown (fallback mode has no `graceEndsAt`). */
  key: 'grace' | 'expired' | 'pastDue' | 'pastDueNoDate';
  date: string | null;
}

export interface BillingView {
  /**
   * `stripe` = Stripe surfaces allowed; `neutral` = stripeUpsell false (Shopify); `unknown` = no entitlement.
   * Enterprise is the one deliberate neutral exception (§9.3 enterprise row beats §9.6): no Stripe actions,
   * but `invoices: 'ifAny'` (manually issued Stripe invoices) and `planName: 'enterprise'` (heading "Plan & billing").
   */
  mode: 'stripe' | 'neutral' | 'unknown';
  /** `billing.planName.<key>`. */
  planName: PlanKey | 'none';
  pill: SubscriptionStatusKey | null;
  lines: BillingLine[];
  /** At most one banner in the Plan card (past-due wins). */
  banner: BillingBanner | null;
  /** The view's one primary (desktop: in the card, right; mobile: StickyActionBar). */
  primary: BillingAction | null;
  /** One secondary next to the primary (desktop) — "Change plan" or "Contact us". */
  secondary: BillingAction | null;
  /** Mobile only (§9.2): a full-width secondary inside the Plan card while the primary sits in the
   *  StickyActionBar. Desktop ignores it (the §9.3 table has no secondary for these rows). */
  mobileSecondary: BillingAction | null;
  /** ⋯ menu; danger actions last. */
  overflow: BillingAction[];
  /** Invoices card: always, only when the list is non-empty, or never. */
  invoices: 'show' | 'ifAny' | 'hide';
  /** past_due: sort the open invoice first, its inline action is "Pay now". */
  invoicesOpenFirst: boolean;
  /** Payment method / billing details / next payment rows (A3). */
  paymentDetails: boolean;
  nearLimit: { meter: MeterKey; percent: number } | null;
  /** `billing.usage.<key>`. */
  usageTitle: 'title' | 'titleTrial';
}

const href = (id: BillingActionId, to: string): BillingAction => ({ id, kind: 'href', href: to });
const portal = (id: BillingActionId, flow: PortalFlow | null): BillingAction => ({ id, kind: 'portal', flow });

export const CHOOSE_PLAN_HREF = `${PRICING_HREF}?from=billing`;

function emptyView(mode: BillingView['mode']): BillingView {
  return {
    mode, planName: 'none', pill: null, lines: [], banner: null, primary: null, secondary: null, mobileSecondary: null, overflow: [],
    invoices: 'hide', invoicesOpenFirst: false, paymentDetails: false, nearLimit: null, usageTitle: 'title',
  };
}

function priceLine(e: Entitlement): BillingLine | null {
  if (!e.interval || !isPaidPlan(e.plan)) return null;
  const currency = currencyCode(e.currency);
  if (!currency) return null;
  const p = effectivePrice(e.plan, e.interval, currency, e.foundingMember);
  return p ? { key: 'price', interval: e.interval, currency, amount: p.amount, list: p.list } : null;
}

function paidLines(e: Entitlement): BillingLine[] {
  const out: BillingLine[] = [];
  const price = priceLine(e);
  if (price) out.push(price);
  if (e.foundingMember) out.push({ key: 'founding' });
  return out;
}

function graceEnd(e: Entitlement): string | null {
  if (e.graceEndsAt) return e.graceEndsAt;
  const t = ms(e.trialEndsAt);
  return t === null ? null : new Date(t + DECIDED_GRACE_DAYS * DAY_MS).toISOString();
}

/** Pure §9.3 decision table. `e` null/undefined = provider unknown (load error): no Stripe actions. */
export function billingView(e: Entitlement | null | undefined, now: Date = new Date()): BillingView {
  if (!e) return emptyView('unknown');

  if (e.state === 'enterprise' || e.plan === 'enterprise') {
    return {
      ...emptyView(e.stripeUpsell ? 'stripe' : 'neutral'),
      planName: 'enterprise',
      pill: 'active',
      lines: [{ key: 'enterprise' }],
      secondary: href('contactUs', CONTACT_HREF),
      invoices: 'ifAny',
    };
  }

  if (isNeutralBilling(e)) {
    return { ...emptyView('neutral'), planName: 'shopify_free', lines: [{ key: 'shopify' }] };
  }

  const base = emptyView('stripe');
  const nearLimit = nearLimitMeter(e);
  const pill = subscriptionStatus(e);

  switch (e.state) {
    case 'trial': {
      const days = daysUntil(e.trialEndsAt, now);
      const lines: BillingLine[] = [];
      if (e.trialEndsAt && days !== null) {
        lines.push({ key: 'trialEnds', date: e.trialEndsAt, days, tone: days <= TRIAL_WARNING_DAYS ? 'warning' : 'neutral' });
      }
      lines.push({ key: 'trialIncludes' });
      return {
        ...base, planName: 'trial', pill, lines, primary: href('choosePlan', CHOOSE_PLAN_HREF),
        mobileSecondary: href('comparePlans', CHOOSE_PLAN_HREF),
        invoices: 'ifAny', nearLimit, usageTitle: 'titleTrial',
      };
    }
    case 'grace':
      return {
        ...base, planName: 'trial', pill,
        banner: { tone: 'warning', key: 'grace', date: graceEnd(e) },
        primary: href('choosePlan', CHOOSE_PLAN_HREF), invoices: 'ifAny', nearLimit, usageTitle: 'titleTrial',
      };
    case 'expired':
      return {
        ...base, planName: 'none', pill, lines: [{ key: 'expired' }],
        banner: { tone: 'danger', key: 'expired', date: null },
        primary: href('choosePlan', CHOOSE_PLAN_HREF), invoices: 'ifAny', nearLimit,
      };
    case 'past_due_grace':
      return {
        ...base, planName: isPaidPlan(e.plan) ? e.plan : 'none', pill, lines: paidLines(e),
        banner: e.graceEndsAt
          ? { tone: 'danger', key: 'pastDue', date: e.graceEndsAt }
          : { tone: 'danger', key: 'pastDueNoDate', date: null },
        primary: portal('updatePayment', 'payment_method_update'),
        overflow: [portal('manageInStripe', null)],
        invoices: 'show', invoicesOpenFirst: true, paymentDetails: true, nearLimit,
      };
    case 'active': {
      const planName = isPaidPlan(e.plan) ? e.plan : 'none';
      if (e.cancelAtPeriodEnd) {
        return {
          ...base, planName, pill,
          lines: [{ key: 'canceling', date: e.currentPeriodEnd, plan: e.plan }],
          primary: portal('keepPlan', 'subscription_update'),
          overflow: [portal('manageInStripe', null)],
          invoices: 'show', paymentDetails: true, nearLimit,
        };
      }
      const changePlan = portal('changePlan', 'subscription_update');
      return {
        ...base, planName, pill,
        lines: [...paidLines(e), { key: 'nextPayment' }],
        primary: nearLimit ? changePlan : null,
        secondary: nearLimit ? null : changePlan,
        overflow: [href('comparePlans', CHOOSE_PLAN_HREF), portal('manageInStripe', null), portal('cancel', 'subscription_cancel')],
        invoices: 'show', paymentDetails: true, nearLimit,
      };
    }
    default:
      return emptyView('unknown');
  }
}

// ── pricingCta (§10.4) ──────────────────────────────────────────────────────────────────────────

export interface PricingViewer {
  /** A NextAuth session exists on the client. */
  signedIn: boolean;
  /** `useEntitlement().data` (undefined while loading). */
  entitlement?: Entitlement | null;
  /** The entitlement (and its fallback) failed: provider unknown. */
  entitlementError?: boolean;
  interval: Interval;
  currency: Currency;
  now?: Date;
}

export type PricingCta =
  /** Signed in, entitlement not resolved: render a button skeleton (no price, no CTA painted). */
  | { kind: 'loading' }
  /** stripeUpsell false: the page is not rendered, `router.replace(href)` before paint (§10.5). */
  | { kind: 'redirect'; href: string }
  /** "Start free trial" → signup (no checkout). */
  | { kind: 'signup'; href: string }
  /** "Choose {Plan}" → POST create-checkout-session. `chargeFrom` = trial end when the trial carries (> 49h). */
  | { kind: 'checkout'; plan: PaidPlanKey; interval: Interval; currency: Currency; chargeFrom: string | null }
  /** "Current plan", disabled with reason "You're on this plan". */
  | { kind: 'current' }
  /** "Switch to {Plan}" → portal `subscription_update`. */
  | { kind: 'switch'; flow: 'subscription_update' }
  /** Disabled: past-due ("Update payment first") or provider unknown ("Couldn't check your account…"). */
  | { kind: 'disabled'; reason: 'pastDue' | 'unknown' }
  /** Enterprise: "Talk to us". */
  | { kind: 'contact'; href: string };

export function signupHref(plan: PaidPlanKey, interval: Interval, currency: Currency): string {
  const q = new URLSearchParams({ mode: 'signup', callbackUrl: '/app', plan, interval, currency: currency.toLowerCase() });
  return `/login?${q.toString()}`;
}

/** Pure §10.4 decision for one plan card. */
export function pricingCta(viewer: PricingViewer, plan: PricedPlanKey): PricingCta {
  const now = viewer.now ?? new Date();
  const e = viewer.entitlement;
  if (viewer.signedIn) {
    if (e && isNeutralBilling(e)) return { kind: 'redirect', href: BILLING_HREF };
    if (!e && !viewer.entitlementError) return { kind: 'loading' };
  }
  if (plan === 'enterprise') return { kind: 'contact', href: ENTERPRISE_CONTACT_HREF };
  if (!viewer.signedIn) return { kind: 'signup', href: signupHref(plan, viewer.interval, viewer.currency) };
  if (!e) return { kind: 'disabled', reason: 'unknown' };

  switch (e.state) {
    case 'past_due_grace':
      return { kind: 'disabled', reason: 'pastDue' };
    case 'active': {
      if (e.plan === plan && (!e.interval || e.interval === viewer.interval)) return { kind: 'current' };
      return { kind: 'switch', flow: 'subscription_update' };
    }
    case 'trial':
    case 'grace':
    case 'expired': {
      const end = ms(e.trialEndsAt);
      const carries = e.state === 'trial' && end !== null && end - now.getTime() > TRIAL_CARRY_MS;
      // A locked billing currency wins over the toggle (Stripe customers are single-currency).
      const currency = currencyCode(e.currency) ?? viewer.currency;
      return { kind: 'checkout', plan, interval: viewer.interval, currency, chargeFrom: carries ? e.trialEndsAt : null };
    }
    case 'enterprise':
      // A known, healthy Enterprise account: plan changes go through the account manager, never checkout.
      return { kind: 'contact', href: ENTERPRISE_CONTACT_HREF };
    default:
      return { kind: 'disabled', reason: 'unknown' };
  }
}

/**
 * The plan whose button is the page's single primary (P1): Growth (recommended), or for a signed-in active
 * user the next plan up from the current one (Pro → Enterprise).
 */
export function pricingPrimaryPlan(viewer: Pick<PricingViewer, 'signedIn' | 'entitlement'>): PricedPlanKey {
  const e = viewer.entitlement;
  if (viewer.signedIn && e && e.state === 'active' && isPaidPlan(e.plan)) {
    const i = PLAN_LADDER.indexOf(e.plan);
    return PLAN_LADDER[Math.min(i + 1, PLAN_LADDER.length - 1)];
  }
  return 'growth';
}

/** Near-limit upsell target (§9.4): the next plan up for the meter, never for neutral accounts. */
export function upsellPlanFor(e: Entitlement | null | undefined, meter: MeterKey): PaidPlanKey | 'enterprise' | null {
  if (!e || isNeutralBilling(e)) return null;
  return nextPlanFor(meter, e.plan);
}
