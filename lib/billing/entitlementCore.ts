// lib/billing/entitlementCore.ts — the pure (React-free) half of useEntitlement: entitlement
// normalisation and the settings-fallback derivation. Server code (API routes, scheduler jobs)
// imports from here; importing the hook file pulls client-only React modules into server bundles.
import { DECIDED_GRACE_DAYS, getPlanLimits, isYearlyPlan } from './planLimits';
import { NO_MODULES, normalizeModules, withModuleFeatures } from './modules';
import { PLAN_FEATURES } from './featureMap';
import type { BillingState, Currency, Entitlement, Feature, Interval, MeterKey, MeterUsage, PlanKey } from './types';
import { FEATURES, METER_KEYS, isBillingState, isPlanKey, isSubscribedPlan } from './types';

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
  period?: 'trial' | 'month' | 'year' | null;
  /** Pricing v2 modules (server: lib/billing/modules.ts loadAccountModules). */
  modules?: { features?: unknown; extraStores?: unknown; extraOrders?: unknown } | null;
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

function minusOneYear(t: number): number {
  const d = new Date(t);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.getTime();
}

/** Contract plans (sales-led, unlimited meters): today's enterprise and pricing v2's kurumsal. */
const isContractPlan = (p: unknown) => p === 'enterprise' || p === 'kurumsal';

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
  } else if (isContractPlan(rawPlan) && status === 'active') {
    plan = rawPlan as PlanKey;
    state = 'enterprise';
  } else if (isSubscribedPlan(rawPlan) && (status === 'active' || status === 'trialing')) {
    plan = rawPlan;
    state = 'active';
  } else if (isSubscribedPlan(rawPlan) && status === 'past_due') {
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
  // Shopify-installed accounts never carry modules (App Store 1.2.1: no plan or add-on surface at all).
  const modules = shopify ? NO_MODULES : normalizeModules(sub.modules);
  const enforced = sub.limits && typeof sub.limits === 'object'
    ? sub.limits
    : getPlanLimits(rawPlan, status, sub.trialExpiresAt ?? null, now, modules).limits;
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
    const start = isYearlyPlan(plan) ? minusOneYear(reset) : minusOneMonth(reset);
    period = { start: new Date(start).toISOString(), end: new Date(reset).toISOString() };
  }

  // Module features count only while the account is in good standing (never on Shopify: everything is on there).
  const feats = state === 'active' || state === 'past_due_grace' ? withModuleFeatures({ ...PLAN_FEATURES[plan] }, modules) : { ...PLAN_FEATURES[plan] };
  if (state === 'expired') for (const f of FEATURES) feats[f] = false;

  return {
    plan,
    state,
    stripeUpsell: !shopify && !isContractPlan(plan),
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
    ...(modules.features.length || modules.extraStores || modules.extraOrders ? { modules } : {}),
  };
}

