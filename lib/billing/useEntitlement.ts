// lib/billing/useEntitlement.ts — settings §2.4: the one client read of the account's plan, state, usage
// and Pro features. SWR key `/api/billing/entitlement` (`revalidateOnFocus: true`, `dedupingInterval: 30s`).
//
// Fallback mode (until the billing backend ships the endpoint): when the entitlement request fails, the
// entitlement is derived from `GET /api/user/settings` (`subscription`, the SWR key the shell already
// loads) + the decided plan tables, with only the `orders` and `labels` meters, and
// `stripeUpsell = !(billingProvider === 'shopify_free' || plan === 'shopify_free')` (the server already
// folds "has an active ShopifyShop" into `billingProvider`). `fallback: true` tells the UI to label the
// order meter "Order imports" and show "Detailed usage will appear here soon." Remove the fallback once
// the endpoint is live.
//
// Both requests failed → `data` undefined, `state: 'error'`: the provider is unknown and no Stripe surface
// may render (settings §0.2 safe direction).
import useSWR from 'swr';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import { DECIDED_GRACE_DAYS, getPlanLimits } from './planLimits';
import { PLAN_FEATURES } from './featureMap';
import type { BillingState, Currency, Entitlement, Feature, Interval, MeterKey, MeterUsage, PlanKey } from './types';
import { FEATURES, METER_KEYS, isBillingState, isPaidPlan, isPlanKey } from './types';

export const ENTITLEMENT_KEY = '/api/billing/entitlement';
export const SETTINGS_KEY = '/api/user/settings';
const DAY_MS = 86_400_000;

/** Error with the HTTP status, so callers can tell "endpoint missing" (404) from a failure. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

// ── Pure normalizers ────────────────────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const count = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const limitOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null);
const interval = (v: unknown): Interval | null => (v === 'month' || v === 'year' ? v : null);
const currency = (v: unknown): Currency | null => {
  const c = typeof v === 'string' ? v.toUpperCase() : '';
  return c === 'TRY' || c === 'USD' ? c : null;
};

function features(raw: unknown, plan: PlanKey): Record<Feature, boolean> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const out = {} as Record<Feature, boolean>;
  for (const f of FEATURES) out[f] = src ? src[f] === true : PLAN_FEATURES[plan][f];
  return out;
}

/** Validates a `/api/billing/entitlement` body into an `Entitlement`; null when it is not one. */
export function normalizeEntitlement(raw: unknown): Entitlement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isPlanKey(r.plan) || !isBillingState(r.state)) return null;
  const meters: Partial<Record<MeterKey, MeterUsage>> = {};
  const rm = r.meters && typeof r.meters === 'object' ? (r.meters as Record<string, unknown>) : {};
  for (const k of METER_KEYS) {
    const m = rm[k];
    if (m && typeof m === 'object') {
      const mm = m as Record<string, unknown>;
      meters[k] = { used: count(mm.used), limit: limitOf(mm.limit) };
    }
  }
  const p = r.period && typeof r.period === 'object' ? (r.period as Record<string, unknown>) : null;
  const period = p && str(p.start) && str(p.end) ? { start: str(p.start) as string, end: str(p.end) as string } : null;
  return {
    plan: r.plan,
    state: r.state,
    // Anything but an explicit boolean true is treated as "no upsell" (Shopify-review-safe).
    stripeUpsell: r.stripeUpsell === true,
    interval: interval(r.interval),
    currency: currency(r.currency),
    foundingMember: r.foundingMember === true,
    trialEndsAt: str(r.trialEndsAt),
    graceEndsAt: str(r.graceEndsAt),
    currentPeriodEnd: str(r.currentPeriodEnd),
    cancelAtPeriodEnd: r.cancelAtPeriodEnd === true,
    period,
    meters,
    features: features(r.features, r.plan),
  };
}

/** The `subscription` block of `GET /api/user/settings` (structural; lib/hooks/useSettings.ts owns the type). */
export interface SettingsSubscription {
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  billingInterval?: string | null;
  billingProvider?: string | null;
  trialExpiresAt?: string | null;
  usageResetAt?: string | null;
  orderSyncCount?: number | null;
  labelCount?: number | null;
  limits?: { orderSync: number | null; label: number | null } | null;
  period?: 'trial' | 'month' | null;
}

function iso(t: number | null): string | null {
  return t === null ? null : new Date(t).toISOString();
}

function time(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function minusOneMonth(t: number): number {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getTime();
}

/**
 * Fallback-mode derivation (settings §2.4) from the settings `subscription` block. Pure; null without a
 * subscription block (the caller treats that as unknown).
 * - shopify_free (effective provider or plan) → `shopify_free`, no upsell.
 * - app trial (plan `trial`/null, status trialing, end in the future) → `trial`; ended < 3 days ago → `grace`.
 * - Stripe trialing/active on a paid plan → `active` (tiers D3). past_due → `past_due_grace`.
 * - active enterprise → `enterprise`. Anything else → `expired`.
 * Meters: Order imports + Labels with the limits the server enforces (`subscription.limits`).
 */
export function entitlementFromSettings(sub: SettingsSubscription | null | undefined, now: Date = new Date()): Entitlement | null {
  if (!sub || typeof sub !== 'object') return null;
  const rawPlan = sub.subscriptionPlan ?? null;
  const status = sub.subscriptionStatus ?? null;
  const shopify = sub.billingProvider === 'shopify_free' || rawPlan === 'shopify_free';
  const trialEnd = time(sub.trialExpiresAt);
  const nowMs = now.getTime();

  let plan: PlanKey;
  let state: BillingState;
  let graceEndsAt: string | null = null;
  if (shopify) {
    plan = 'shopify_free';
    state = 'shopify_free';
  } else if (rawPlan === 'enterprise' && status === 'active') {
    plan = 'enterprise';
    state = 'enterprise';
  } else if (isPaidPlan(rawPlan) && (status === 'active' || status === 'trialing')) {
    plan = rawPlan;
    state = 'active';
  } else if (isPaidPlan(rawPlan) && status === 'past_due') {
    plan = rawPlan;
    state = 'past_due_grace';
  } else if ((rawPlan === 'trial' || rawPlan === null) && trialEnd !== null && (status === 'trialing' || status === null)) {
    plan = 'trial';
    const graceEnd = trialEnd + DECIDED_GRACE_DAYS * DAY_MS;
    if (nowMs < trialEnd) state = 'trial';
    else if (nowMs < graceEnd) {
      state = 'grace';
      graceEndsAt = iso(graceEnd);
    } else state = 'expired';
  } else {
    plan = isPlanKey(rawPlan) ? rawPlan : 'trial';
    state = 'expired';
  }

  // Limits the middleware applies (null = unlimited). The server sends them; older payloads → local table.
  const enforced = sub.limits && typeof sub.limits === 'object'
    ? sub.limits
    : getPlanLimits(rawPlan, status, sub.trialExpiresAt ?? null, now).limits;
  const meters: Partial<Record<MeterKey, MeterUsage>> = shopify || state === 'enterprise'
    ? { orders: { used: count(sub.orderSyncCount), limit: null }, labels: { used: count(sub.labelCount), limit: null } }
    : {
        orders: { used: count(sub.orderSyncCount), limit: limitOf(enforced.orderSync) },
        labels: { used: count(sub.labelCount), limit: limitOf(enforced.label) },
      };

  let period: Entitlement['period'] = null;
  const reset = time(sub.usageResetAt);
  if (state === 'trial' && trialEnd !== null) {
    period = { start: new Date(trialEnd - 14 * DAY_MS).toISOString(), end: new Date(trialEnd).toISOString() };
  } else if (reset !== null && state !== 'expired') {
    period = { start: new Date(minusOneMonth(reset)).toISOString(), end: new Date(reset).toISOString() };
  }

  const feats = { ...PLAN_FEATURES[plan] };
  if (state === 'expired') for (const f of FEATURES) feats[f] = false;

  return {
    plan,
    state,
    stripeUpsell: !shopify && plan !== 'enterprise',
    interval: interval(sub.billingInterval),
    currency: null,
    foundingMember: false,
    trialEndsAt: iso(trialEnd),
    graceEndsAt,
    currentPeriodEnd: state === 'active' || state === 'past_due_grace' ? iso(reset) : null,
    cancelAtPeriodEnd: false,
    period,
    meters,
    features: feats,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────────────────────

export interface UseEntitlementResult {
  data?: Entitlement;
  state: AsyncState;
  /** true while `data` is derived from `/api/user/settings` (2 meters, no currency/founding). */
  fallback: boolean;
  /** Revalidates the entitlement (and the fallback source). */
  mutate: () => Promise<unknown>;
  /** Restarts the async timers and revalidates (ErrorState Retry). */
  retry: () => void;
  isLoading: boolean;
}

export interface UseEntitlementOptions {
  /** false = no request (anonymous visitor on the pricing page). Default true. */
  enabled?: boolean;
}

type SettingsBody = { subscription?: SettingsSubscription | null } | null;

export function useEntitlement(options: UseEntitlementOptions = {}): UseEntitlementResult {
  const enabled = options.enabled ?? true;
  const primary = useSWR<unknown>(enabled ? ENTITLEMENT_KEY : null, jsonFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
    // A missing endpoint (404) is the fallback signal, not a transient error.
    shouldRetryOnError: (err: unknown) => !(err instanceof HttpError && (err.status === 404 || err.status === 401 || err.status === 403)),
  });
  const live = primary.data !== undefined ? normalizeEntitlement(primary.data) : null;
  const needFallback = enabled && (primary.error !== undefined || (primary.data !== undefined && !live));

  const settings = useSWR<SettingsBody>(needFallback ? SETTINGS_KEY : null, jsonFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
  });
  const derived = needFallback && settings.data ? entitlementFromSettings(settings.data?.subscription ?? null) : null;
  const data = live ?? derived ?? undefined;

  const waitingFallback = needFallback && settings.data === undefined && !settings.error;
  const combined = {
    data,
    error: !data && needFallback && (settings.error || (settings.data !== undefined && !derived)) ? (settings.error ?? new Error('no subscription')) : undefined,
    isLoading: enabled && !data && (primary.isLoading || waitingFallback || (needFallback && settings.isLoading)),
    isValidating: primary.isValidating || settings.isValidating,
    mutate: () => Promise.all([primary.mutate(), needFallback ? settings.mutate() : undefined]),
  };
  const region = useAsyncRegion(combined, { idle: 'empty' });

  return {
    data,
    state: region.state,
    fallback: !live && !!derived,
    mutate: combined.mutate,
    retry: region.retry,
    isLoading: !!combined.isLoading,
  };
}

export default useEntitlement;
