// lib/ds/status/billing.ts — settings §9.3/§14 subscription + invoice domains, overview §3.2 queue keys
// (`near_limit`, `trial_ending`; CRITIQUE C7). Inputs are structural so this file does not depend on
// lib/billing/types.ts (billing track); `Entitlement` from there satisfies `SubscriptionInput`.

import { normalizeRaw, type InvoiceStatusKey, type SubscriptionStatusKey } from './vocabulary';

export type BillingStateInput = 'trial' | 'grace' | 'active' | 'past_due_grace' | 'expired' | 'shopify_free' | 'enterprise';

export interface SubscriptionInput {
  state: BillingStateInput | string;
  plan?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  trialEndsAt?: string | Date | null;
  meters?: Record<string, { used: number; limit: number | null }> | null;
}

/** Plan card pill (settings §9.3). `shopify_free` has no pill → null. */
export function subscriptionStatus(e: SubscriptionInput | null | undefined): SubscriptionStatusKey | null {
  if (!e) return null;
  switch (e.state) {
    case 'trial':
      return 'trial';
    case 'grace':
      return 'grace';
    case 'active':
      return e.cancelAtPeriodEnd ? 'canceling' : 'active';
    case 'enterprise':
      return 'active';
    case 'past_due_grace':
      return 'past_due';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}

/** A meter at or above this share of its limit is "near limit" (settings §9.3, shell-nav UsageMeter). */
export const NEAR_LIMIT_RATIO = 0.8;
/** Overview queue row 11: trial ends within this many days. */
export const TRIAL_ENDING_DAYS = 5;

/**
 * Overview queue alert: `trial_ending` (trial ends ≤ 5 days; wins, it pauses everything) or `near_limit`
 * (any metered limit ≥ 80%). Null for shopify_free (no billing wording, settings §0.1), expired/past-due
 * (those use `subscriptionStatus`), and when nothing applies.
 */
export function subscriptionAlert(
  e: SubscriptionInput | null | undefined,
  now: Date = new Date(),
  opts: { trialEndingDays?: number } = {},
): Extract<SubscriptionStatusKey, 'near_limit' | 'trial_ending'> | null {
  if (!e || e.state === 'shopify_free' || e.plan === 'shopify_free') return null;
  if (e.state !== 'trial' && e.state !== 'active' && e.state !== 'grace') return null;
  if (e.state === 'trial' && e.trialEndsAt) {
    const end = new Date(e.trialEndsAt).getTime();
    const days = opts.trialEndingDays ?? TRIAL_ENDING_DAYS;
    if (Number.isFinite(end) && end > now.getTime() && end - now.getTime() <= days * 86_400_000) return 'trial_ending';
  }
  for (const m of Object.values(e.meters ?? {})) {
    if (m && m.limit != null && m.limit > 0 && m.used / m.limit >= NEAR_LIMIT_RATIO) return 'near_limit';
  }
  return null;
}

/** Stripe invoice status → pill. `draft` and unknown → null (not shown). */
export function invoiceStatus(raw: string | null | undefined): InvoiceStatusKey | null {
  switch (normalizeRaw(raw)) {
    case 'paid':
      return 'paid';
    case 'open':
      return 'open';
    case 'void':
    case 'voided':
      return 'void';
    case 'uncollectible':
      return 'uncollectible';
    default:
      return null;
  }
}
