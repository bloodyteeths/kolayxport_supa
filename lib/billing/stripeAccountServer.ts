// lib/billing/stripeAccountServer.ts — server-only helpers shared by the Stripe billing routes that
// settings Group F owns (settings-billing-pricing §2.3 A1–A3): `billing-history`, `create-portal-session`,
// `billing-summary`. No UI imports this file.
//
// `planFromPriceId` here is a stand-in for the tiers-plan `lib/billing/plans.ts#planFromPriceId`
// (tiers.md §1). It reads the same env names (`PRICE_{PLAN}_{INTERVAL}`, the `_LEGACY` ids and the
// per-currency fallback `_TRY`/`_USD`), so swapping the import later changes nothing for callers.
import type Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';

export type StripePaidPlan = 'starter' | 'growth' | 'pro';
export type StripeInterval = 'month' | 'year';

const PRICE_ENV: Record<StripePaidPlan, Record<StripeInterval, string>> = {
  starter: { month: 'PRICE_STARTER_MONTH', year: 'PRICE_STARTER_YEAR' },
  growth: { month: 'PRICE_GROWTH_MONTH', year: 'PRICE_GROWTH_YEAR' },
  pro: { month: 'PRICE_PRO_MONTH', year: 'PRICE_PRO_YEAR' },
};
const ENV_SUFFIXES = ['', '_LEGACY', '_TRY', '_USD'] as const;

/** Stripe Price id → plan + interval (env-configured ids incl. legacy). null when unknown. */
export function planFromPriceId(id: string | null | undefined): { plan: StripePaidPlan; interval: StripeInterval } | null {
  if (!id) return null;
  for (const plan of Object.keys(PRICE_ENV) as StripePaidPlan[]) {
    for (const interval of ['month', 'year'] as const) {
      for (const suffix of ENV_SUFFIXES) {
        const v = process.env[`${PRICE_ENV[plan][interval]}${suffix}`];
        if (v && v === id) return { plan, interval };
      }
    }
  }
  return null;
}

/** Price id of an invoice line on the basil API (`pricing.price_details.price`), with pre-basil fallbacks. */
export function priceIdOfLine(line: Stripe.InvoiceLineItem | undefined | null): string | null {
  if (!line) return null;
  const fromPricing = line.pricing?.price_details?.price;
  if (typeof fromPricing === 'string' && fromPricing) return fromPricing;
  const legacy = line as unknown as { price?: { id?: unknown } | string | null; plan?: { id?: unknown } | null };
  if (typeof legacy.price === 'string' && legacy.price) return legacy.price;
  if (legacy.price && typeof legacy.price === 'object' && typeof legacy.price.id === 'string') return legacy.price.id;
  if (legacy.plan && typeof legacy.plan.id === 'string') return legacy.plan.id;
  return null;
}

const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

/** Stripe minor units → major units (cents-exact). */
export function toMajor(amount: number | null | undefined, currency: string | null | undefined): number {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  if (currency && ZERO_DECIMAL.has(currency.toLowerCase())) return n;
  return Math.round(n) / 100;
}

/** Unix seconds → ISO string (null-safe). */
export function isoFromUnix(sec: number | null | undefined): string | null {
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

export interface StripeAccount {
  customerId: string | null;
  /**
   * The account is on the free Shopify tier (App Store rule 1.2.1): no Stripe surface at all.
   * Read from the User row only (`billingProvider` / `subscriptionPlan`), deliberately NOT from
   * "has an active ShopifyShop": a merchant who pays through Stripe and later connects a Shopify
   * store from Settings must still be able to update their card or cancel (tiers.md D16 option b).
   */
  shopifyFree: boolean;
}

export async function loadStripeAccount(userId: string): Promise<StripeAccount | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, billingProvider: true, subscriptionPlan: true },
  });
  if (!user) return null;
  return {
    customerId: user.stripeCustomerId || null,
    shopifyFree: user.billingProvider === 'shopify_free' || user.subscriptionPlan === 'shopify_free',
  };
}

/** Lower = preferred. Subscriptions not listed here (canceled, incomplete_expired) are ignored. */
const SUBSCRIPTION_RANK: Partial<Record<Stripe.Subscription.Status, number>> = {
  active: 0,
  trialing: 0,
  past_due: 1,
  unpaid: 2,
  paused: 3,
  incomplete: 4,
};

/** Pure: the subscription the account is billed on (best status, newest first). */
export function pickCurrentSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  let best: Stripe.Subscription | null = null;
  for (const s of subs) {
    const rank = SUBSCRIPTION_RANK[s.status];
    if (rank === undefined) continue;
    const bestRank = best ? (SUBSCRIPTION_RANK[best.status] as number) : Infinity;
    if (rank < bestRank || (rank === bestRank && best && s.created > best.created)) best = s;
  }
  return best;
}

/** The customer's current subscription (no `User.stripeSubscriptionId` column exists, so it is listed). */
export async function findCurrentSubscription(customerId: string, expand?: string[]): Promise<Stripe.Subscription | null> {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10, ...(expand ? { expand } : {}) });
  return pickCurrentSubscription(list.data);
}

/** Base URL for Stripe return links: configured app URL first, then the request origin. */
export function appBaseUrl(originHeader: string | string[] | undefined): string {
  const configured = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const base = configured || origin || 'https://kolayxport.com';
  return base.replace(/\/+$/, '');
}

/* ------------------------------------------------------------ A1 billing-history */

export const INVOICE_DEFAULT_LIMIT = 20;
export const INVOICE_MIN_LIMIT = 5;
export const INVOICE_MAX_LIMIT = 100;
/** Statuses listed to the user (Stripe `draft` is never shown). */
export const LISTED_INVOICE_STATUSES: ReadonlySet<string> = new Set(['paid', 'open', 'void', 'uncollectible']);

/** `?limit=` → 5..100, default 20 (non-numeric → default). */
export function parseInvoiceLimit(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return INVOICE_DEFAULT_LIMIT;
  return Math.min(INVOICE_MAX_LIMIT, Math.max(INVOICE_MIN_LIMIT, n));
}

/** `?starting_after=` → invoice id, undefined when absent, `false` when malformed. */
export function parseInvoiceCursor(raw: unknown): string | undefined | false {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === '') return undefined;
  return typeof v === 'string' && /^in_[A-Za-z0-9]+$/.test(v) ? v : false;
}

export interface InvoiceDto {
  id: string;
  number: string | null;
  date: string;
  amount: number;
  currency: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  plan: StripePaidPlan | null;
  interval: StripeInterval | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  /** Stripe's line text; kept for the legacy /faturalar page only. */
  description: string;
  period: { start: string | null; end: string | null };
}

/** Pure: Stripe invoice → wire row. Paid shows `amount_paid`, every other status `amount_due`. */
export function formatInvoice(invoice: Stripe.Invoice): InvoiceDto {
  const line = invoice.lines?.data?.[0];
  const planInfo = planFromPriceId(priceIdOfLine(line));
  const amount = invoice.status === 'paid' ? invoice.amount_paid : invoice.amount_due;
  return {
    id: invoice.id as string,
    number: invoice.number ?? null,
    date: isoFromUnix(invoice.created) ?? new Date(0).toISOString(),
    amount: toMajor(amount, invoice.currency),
    currency: (invoice.currency || '').toUpperCase(),
    status: invoice.status as InvoiceDto['status'],
    plan: planInfo?.plan ?? null,
    interval: planInfo?.interval ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
    description: line?.description || 'Subscription',
    period: { start: isoFromUnix(line?.period?.start), end: isoFromUnix(line?.period?.end) },
  };
}

/* ------------------------------------------------------- A2 create-portal-session */

export type PortalFlowType = 'payment_method_update' | 'subscription_update' | 'subscription_cancel';
export const PORTAL_FLOWS: readonly PortalFlowType[] = ['payment_method_update', 'subscription_update', 'subscription_cancel'];

/** Body `{ flow? }` → flow, null (portal home), or `false` (invalid value). Accepts a JSON string body. */
export function parsePortalFlow(body: unknown): PortalFlowType | null | false {
  let b: unknown = body;
  if (typeof b === 'string') {
    if (!b.trim()) return null;
    try { b = JSON.parse(b); } catch { return false; }
  }
  if (b === undefined || b === null) return null;
  if (typeof b !== 'object' || Array.isArray(b)) return false;
  const flow = (b as Record<string, unknown>).flow;
  if (flow === undefined || flow === null || flow === '') return null;
  return typeof flow === 'string' && (PORTAL_FLOWS as readonly string[]).includes(flow) ? (flow as PortalFlowType) : false;
}

/** Pure: Stripe `flow_data` for a flow; null when the flow cannot apply (no subscription). */
export function buildPortalFlowData(
  flow: PortalFlowType,
  subscription: Pick<Stripe.Subscription, 'id' | 'cancel_at_period_end' | 'status'> | null,
  returnUrl: string,
): Stripe.BillingPortal.SessionCreateParams.FlowData | null {
  const after_completion = { type: 'redirect' as const, redirect: { return_url: returnUrl } };
  if (flow === 'payment_method_update') return { type: 'payment_method_update', after_completion };
  if (!subscription) return null;
  if (flow === 'subscription_update') {
    return { type: 'subscription_update', subscription_update: { subscription: subscription.id }, after_completion };
  }
  // Already canceling: Stripe rejects a second cancel flow, so the portal home is shown instead.
  if (subscription.cancel_at_period_end) return null;
  return { type: 'subscription_cancel', subscription_cancel: { subscription: subscription.id }, after_completion };
}

/* ------------------------------------------------------------- A3 billing-summary */

export interface PaymentMethodDto { brand: string; last4: string; expMonth: number; expYear: number }

/** Pure: a (possibly unexpanded) payment method → card summary. Non-card methods → null. */
export function toPaymentMethodDto(pm: string | Stripe.PaymentMethod | null | undefined): PaymentMethodDto | null {
  if (!pm || typeof pm === 'string') return null;
  const card = pm.card;
  if (!card || !card.last4) return null;
  return { brand: card.brand || 'card', last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
}

const UPCOMING_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);

/** Whether a "Next payment" line makes sense for this subscription. */
export function hasUpcomingPayment(sub: Pick<Stripe.Subscription, 'status' | 'cancel_at_period_end'> | null): boolean {
  return !!sub && UPCOMING_STATUSES.has(sub.status) && !sub.cancel_at_period_end;
}
