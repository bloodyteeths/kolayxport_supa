// lib/billing/types.ts — settings §2.2 billing contract (pure types, client-safe).
//
// `EntitlementResponse` is the exact body the billing backend track returns from
// `GET /api/billing/entitlement` (tiers.md, settings §2.2, incl. the A5 `cancelAtPeriodEnd` addition).
// `Entitlement` is what `useEntitlement()` hands to the UI: the same fields, normalized, with two
// tolerances so the fallback mode (derived from `/api/user/settings`, §2.4) fits the same type:
//   - `meters` is partial: the fallback only knows `orders` and `labels`;
//   - `period` may be null: no reset date is known (e.g. an expired trial).
import type { PlanKey } from './planLimits';

export type { PlanKey } from './planLimits';

export type BillingState = 'trial' | 'grace' | 'active' | 'past_due_grace' | 'expired' | 'shopify_free' | 'enterprise';
export type MeterKey = 'orders' | 'labels' | 'connectedStores' | 'aiCredits';
export type Feature = 'arbitrage' | 'financials' | 'bulkPhotoStudio';
export type PaidPlanKey = 'starter' | 'growth' | 'pro';
/** Plans shown on the pricing page (Enterprise has no list price). */
export type PricedPlanKey = PaidPlanKey | 'enterprise';
export type Interval = 'month' | 'year';
/** Entitlement currency (Stripe `billingCurrency`, upper case). `price.ts` also accepts 'try' | 'usd'. */
export type Currency = 'TRY' | 'USD';

export const BILLING_STATES: readonly BillingState[] = ['trial', 'grace', 'active', 'past_due_grace', 'expired', 'shopify_free', 'enterprise'];
export const METER_KEYS: readonly MeterKey[] = ['orders', 'labels', 'connectedStores', 'aiCredits'];
export const FEATURES: readonly Feature[] = ['arbitrage', 'financials', 'bulkPhotoStudio'];
export const PAID_PLANS: readonly PaidPlanKey[] = ['starter', 'growth', 'pro'];
export const PLAN_KEYS: readonly PlanKey[] = ['trial', 'starter', 'growth', 'pro', 'enterprise', 'shopify_free'];

export interface MeterUsage {
  used: number;
  /** null = unlimited. */
  limit: number | null;
}

/** Wire shape of `GET /api/billing/entitlement` (settings §2.2). */
export interface EntitlementResponse {
  plan: PlanKey;
  state: BillingState;
  /** false ⇒ render no Stripe / pricing / upgrade surface at all (Shopify App Store rule 1.2.1). */
  stripeUpsell: boolean;
  interval: Interval | null;
  currency: Currency | null;
  foundingMember: boolean;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  period: { start: string; end: string };
  meters: Record<MeterKey, MeterUsage>;
  features: Record<Feature, boolean>;
}

/** What the UI reads (see the file comment for the two tolerances). */
export interface Entitlement extends Omit<EntitlementResponse, 'meters' | 'period'> {
  meters: Partial<Record<MeterKey, MeterUsage>>;
  period: { start: string; end: string } | null;
}

/** `GET /api/stripe/billing-summary` (settings §2.3 A3). */
export interface BillingSummary {
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  upcoming: { amount: number; currency: string; date: string } | null;
}

export type InvoiceStatus = 'paid' | 'open' | 'void' | 'uncollectible';

/** One invoice row, normalized from `GET /api/stripe/billing-history` (old shape and A1 shape). */
export interface Invoice {
  id: string;
  /** Stripe invoice number ("KX-0012"); null on the pre-A1 response. */
  number: string | null;
  date: string;
  /** Major units. */
  amount: number;
  currency: string;
  /** Raw Stripe status (mapped to a pill with `invoiceStatus()`). */
  status: string;
  plan: PlanKey | null;
  interval: Interval | null;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface InvoicesPage {
  invoices: Invoice[];
  hasMore: boolean;
  /** Last Stripe id the server scanned (drafts included); null on the pre-A1 body. */
  nextCursor: string | null;
}

/** `create-portal-session` body `{ flow }` (settings §2.3 A2). Omitted = the portal home. */
export type PortalFlow = 'payment_method_update' | 'subscription_update' | 'subscription_cancel';

/** `GET /api/billing/founding-spots` (settings §2.2). */
export interface FoundingSpots {
  active: boolean;
  total: number;
  remaining: number;
  percentOff: number;
}

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === 'string' && (PLAN_KEYS as readonly string[]).includes(v);
}

export function isPaidPlan(v: unknown): v is PaidPlanKey {
  return typeof v === 'string' && (PAID_PLANS as readonly string[]).includes(v);
}

export function isBillingState(v: unknown): v is BillingState {
  return typeof v === 'string' && (BILLING_STATES as readonly string[]).includes(v);
}
