/**
 * Plan limits: one module for the numbers the UI shows and the numbers the
 * server enforces (shell-nav §9.2, CRITIQUE C8). Isomorphic and pure (no I/O).
 *
 * Two tables live here on purpose:
 *
 * 1. ENFORCED_* + getPlanLimits/checkPlanLimit — what the server enforces.
 *    `lib/middleware/withUsageLimiter.ts` calls these directly, so the UI meters
 *    and the 402 responses cannot drift. `/api/user/settings` exposes the same
 *    limits (`subscription.limits`).
 *
 * 2. DECIDED_PLAN_LIMITS — the launch tiers decided in design/launch/tiers.md
 *    §1 (Trial, Starter, Growth, Pro, Enterprise, shopify_free). The enforced
 *    numbers follow them; what is still different (the order meter counts sync
 *    calls was fixed: it now counts new orders from manual/extension syncs; scheduled syncs, AI credits and store
 *    counts are not metered) is in ENFORCEMENT_GAP.
 *
 * `null` = unlimited everywhere in this module (JSON-safe, unlike Infinity).
 */

/* ------------------------------------------------------------------ keys */

/** Every plan key, current and decided (tiers.md §1 `PlanKey`), plus the pricing v2 keys (docs/gtm/pricing-v2.md). */
export type PlanKey = 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise' | 'shopify_free' | V2PlanKey;
/**
 * Pricing v2 (Turkey): one monthly plan (`aylik`) + yearly packages + `kurumsal` (quote). Recognised everywhere
 * (limits, features, entitlement) so an assigned account works; nothing sells them until PRICING_V2 is on
 * (lib/billing/pricingV2.ts).
 */
export type V2PlanKey = 'aylik' | 'baslangic_yil' | 'buyume_yil' | 'pro_yil' | 'kurumsal';
export const V2_PLAN_KEYS: readonly V2PlanKey[] = ['aylik', 'baslangic_yil', 'buyume_yil', 'pro_yil', 'kurumsal'];
/** Yearly packages: their order / label meters are yearly buckets (pricing-v2 §3). */
export const YEARLY_PLAN_KEYS: readonly V2PlanKey[] = ['baslangic_yil', 'buyume_yil', 'pro_yil', 'kurumsal'];
export function isYearlyPlan(plan: string | null | undefined): boolean {
  return typeof plan === 'string' && (YEARLY_PLAN_KEYS as readonly string[]).includes(plan);
}
/** The two meters the middleware enforces today. */
export type LimitKind = 'orderSync' | 'label';
/** tiers.md §1 meters. `orders` replaces today's `orderSync` (API calls) with counted orders (D6). */
export type DecidedMeter = 'orders' | 'labels' | 'connectedStores' | 'aiCredits';

/** Limits per meter; `null` = unlimited. */
export interface PlanLimits {
  orderSync: number | null;
  label: number | null;
}

/* ------------------------------------------------- 1. enforced today */

/**
 * The limits `lib/middleware/withUsageLimiter.ts` enforces (it calls `getPlanLimits`
 * and `checkPlanLimit` below). The numbers follow DECIDED_PLAN_LIMITS; the order
 * meter counts new orders imported by manual and extension syncs (D6; scheduled syncs are not metered yet, see ENFORCEMENT_GAP).
 */
export const ENFORCED_PLAN_LIMITS: Readonly<Record<'starter' | 'growth' | 'pro' | 'enterprise' | 'shopify_free' | V2PlanKey, PlanLimits>> = {
  starter: { orderSync: 500, label: 250 },
  growth: { orderSync: 2000, label: 1000 },
  pro: { orderSync: 6000, label: 3000 },
  enterprise: { orderSync: null, label: null },
  shopify_free: { orderSync: null, label: null },
  // Pricing v2: Aylık per month; yearly packages per year (pricing-v2 §3). Kurumsal is custom (unlimited here).
  aylik: { orderSync: 500, label: 250 },
  baslangic_yil: { orderSync: 6000, label: 3000 },
  buyume_yil: { orderSync: 24000, label: 12000 },
  pro_yil: { orderSync: 72000, label: 36000 },
  kurumsal: { orderSync: null, label: null },
};

/**
 * Module add-ons that change meters (pricing-v2 §3 "Modules"). `extraOrders` units add orders (+500 a month on
 * Aylık, +6.000 a year on a yearly package); labels are not extended. Store / feature modules live in
 * lib/billing/modules.ts.
 */
export interface MeterModules {
  extraOrders?: number;
  extraStores?: number;
}
export const EXTRA_ORDERS_PER_UNIT = { month: 500, year: 6000 } as const;

/** Applies to trial accounts (plan `trial`/null, status `trialing`) until the trial date plus the grace days. */
export const ENFORCED_TRIAL_LIMITS: Readonly<PlanLimits> = { orderSync: 150, label: 30 };

/**
 * Which branch of the middleware applies.
 * - `shopify_free`: plan is shopify_free → never limited.
 * - `trial`: trialing and `trialExpiresAt` in the future → trial limits.
 * - `active`: status `active` with a known plan → plan limits.
 * - `noSubscription`: anything else (trial over, canceled, past_due, null) → blocked.
 * - `invalidPlan`: status `active` but plan missing/unknown → blocked.
 */
export type LimitState = 'shopify_free' | 'trial' | 'active' | 'noSubscription' | 'invalidPlan';

/** Usage window: the trial (one bucket for the whole trial), the monthly reset period, or a yearly package's year. */
export type LimitPeriod = 'trial' | 'month' | 'year' | null;

export interface PlanLimitDecision {
  state: LimitState;
  /** The plan key the limits came from ('trial' for the trial branch); null when blocked without a plan. */
  plan: string | null;
  /**
   * `null` = unlimited. In the blocked states (`noSubscription`, `invalidPlan`)
   * both limits are `0`: nothing is allowed, which is what the middleware does.
   */
  limits: PlanLimits;
  period: LimitPeriod;
}

function hasEnforcedPlan(plan: string | null | undefined): plan is keyof typeof ENFORCED_PLAN_LIMITS {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(ENFORCED_PLAN_LIMITS, plan);
}

function toDate(v: Date | string | number | null | undefined): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Statuses under which a paid plan keeps its limits: Stripe-trialing subscribers and past_due (Stripe still retrying). */
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * The limits the middleware applies to a user, in order:
 * shopify_free → paid plan (active / trialing / past_due) → app trial incl. grace → not active → invalid plan.
 * Pure; `now` is injectable for tests.
 */
export function getPlanLimits(
  plan: string | null | undefined,
  status: string | null | undefined,
  trialExpiresAt: Date | string | number | null | undefined,
  now: Date = new Date(),
  modules?: MeterModules | null,
): PlanLimitDecision {
  const d = getBasePlanLimits(plan, status, trialExpiresAt, now);
  const extra = Math.max(0, Math.floor(modules?.extraOrders ?? 0));
  if (d.state === 'active' && extra > 0 && d.limits.orderSync !== null) {
    const per = d.period === 'year' ? EXTRA_ORDERS_PER_UNIT.year : EXTRA_ORDERS_PER_UNIT.month;
    return { ...d, limits: { ...d.limits, orderSync: d.limits.orderSync + extra * per } };
  }
  return d;
}

function activePeriod(plan: string): LimitPeriod {
  return isYearlyPlan(plan) ? 'year' : 'month';
}

function getBasePlanLimits(
  plan: string | null | undefined,
  status: string | null | undefined,
  trialExpiresAt: Date | string | number | null | undefined,
  now: Date,
): PlanLimitDecision {
  if (plan === 'shopify_free') {
    return { state: 'shopify_free', plan: 'shopify_free', limits: { orderSync: null, label: null }, period: null };
  }
  if (hasEnforcedPlan(plan) && typeof status === 'string' && PAID_STATUSES.has(status)) {
    return { state: 'active', plan, limits: { ...ENFORCED_PLAN_LIMITS[plan] }, period: activePeriod(plan) };
  }
  const trialEnd = toDate(trialExpiresAt);
  const graceEnd = trialEnd ? trialEnd.getTime() + DECIDED_GRACE_DAYS * 24 * 60 * 60 * 1000 : null;
  if ((plan === 'trial' || plan == null) && status === 'trialing' && graceEnd !== null && now.getTime() < graceEnd) {
    return { state: 'trial', plan: 'trial', limits: { ...ENFORCED_TRIAL_LIMITS }, period: 'trial' };
  }
  if (status !== 'active') {
    return { state: 'noSubscription', plan: plan ?? null, limits: { orderSync: 0, label: 0 }, period: null };
  }
  if (!hasEnforcedPlan(plan)) {
    return { state: 'invalidPlan', plan: plan ?? null, limits: { orderSync: 0, label: 0 }, period: null };
  }
  return { state: 'active', plan, limits: { ...ENFORCED_PLAN_LIMITS[plan] }, period: activePeriod(plan) };
}

/** Mirrors `LimitReason` in withUsageLimiter.ts / lib/http/limitInterceptor.ts. */
export type PlanLimitReason = 'trial' | 'noSubscription' | 'planLimit' | 'invalidPlan';

export interface PlanLimitCheck {
  allowed: boolean;
  reason?: PlanLimitReason;
  used?: number;
  /** Omitted when unlimited (the middleware never sends Infinity). */
  limit?: number;
}

/**
 * The allow/deny decision the middleware makes for one meter, given a decision
 * from `getPlanLimits` and the current counter. Same reasons, same `used`/`limit`
 * presence rules as the middleware's 402 body.
 */
export function checkPlanLimit(decision: PlanLimitDecision, kind: LimitKind, used: number): PlanLimitCheck {
  switch (decision.state) {
    case 'shopify_free':
      return { allowed: true };
    case 'noSubscription':
      return { allowed: false, reason: 'noSubscription' };
    case 'invalidPlan':
      return { allowed: false, reason: 'invalidPlan' };
    case 'trial':
    case 'active': {
      const limit = decision.limits[kind];
      const out: PlanLimitCheck = { allowed: true, used, ...(limit === null ? {} : { limit }) };
      if (limit !== null && used >= limit) {
        return { ...out, allowed: false, reason: decision.state === 'trial' ? 'trial' : 'planLimit' };
      }
      return out;
    }
  }
}

/* ---------------------------------------------- 2. decided (tiers.md) */

export interface DecidedPlan {
  /** `null` = unlimited. */
  limits: Record<DecidedMeter, number | null>;
  /** false → never show Stripe / pricing / upgrade copy (Shopify App Store rule 1.2.1). */
  stripeUpsell: boolean;
}

/**
 * tiers.md §1 `PLANS[*].limits` and `stripeUpsell`. Monthly. `aiCredits` = AI kredisi for image + video generation
 * (enforced: lib/billing/aiCreditsServer.ts; costs in lib/billing/aiCredits.ts; 1 credit ≈ $0.01 of Google cost).
 * Re-set 2026-10-17 for Veo / Nano Banana Pro costs: trial 200, pro 3000, shopify_free 100, enterprise 10000 (never
 * unlimited: Google bills every video — founder: "they can drain our API"; bigger deals get an 'adjust' grant). Text AI is not metered.
 * shopify_free: orders/labels unlimited as today; `connectedStores: 1` counts
 * non-Shopify stores only; the D16 founder decision may still change it.
 */
export const DECIDED_PLAN_LIMITS: Readonly<Record<PlanKey, DecidedPlan>> = {
  trial: { limits: { orders: 150, labels: 30, connectedStores: 3, aiCredits: 200 }, stripeUpsell: true },
  starter: { limits: { orders: 500, labels: 250, connectedStores: 2, aiCredits: 300 }, stripeUpsell: true },
  growth: { limits: { orders: 2000, labels: 1000, connectedStores: 5, aiCredits: 1500 }, stripeUpsell: true },
  pro: { limits: { orders: 6000, labels: 3000, connectedStores: 10, aiCredits: 3000 }, stripeUpsell: true },
  enterprise: { limits: { orders: null, labels: null, connectedStores: null, aiCredits: 10000 }, stripeUpsell: false },
  // Shopify merchants: free (App Store 1.2.1). 3 stores = their Shopify store + 2 marketplaces (the listing's multichannel
  // promise); 300 credits so a default first video (192) works.
  shopify_free: { limits: { orders: null, labels: null, connectedStores: 3, aiCredits: 300 }, stripeUpsell: false },
  // Pricing v2 (pricing-v2 §3; numbers are Atilla's to confirm). orders / labels: per month on Aylık, per year on
  // the yearly packages. aiCredits stay monthly on every plan.
  aylik: { limits: { orders: 500, labels: 250, connectedStores: 2, aiCredits: 300 }, stripeUpsell: true },
  baslangic_yil: { limits: { orders: 6000, labels: 3000, connectedStores: 3, aiCredits: 300 }, stripeUpsell: true },
  buyume_yil: { limits: { orders: 24000, labels: 12000, connectedStores: 6, aiCredits: 1500 }, stripeUpsell: true },
  pro_yil: { limits: { orders: 72000, labels: 36000, connectedStores: 12, aiCredits: 3000 }, stripeUpsell: true },
  kurumsal: { limits: { orders: null, labels: null, connectedStores: null, aiCredits: 10000 }, stripeUpsell: false },
};

/** tiers.md §1 constants. The trial length is enforced at account creation via `newTrialExpiry`. */
export const DECIDED_TRIAL_DAYS = 14;
export const DECIDED_GRACE_DAYS = 3;

/** Trial end for an account created at `now` (signup, Google OAuth, Shopify install). */
export function newTrialExpiry(now: number = Date.now()): Date {
  return new Date(now + DECIDED_TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

/** Decided limits for a plan key; `undefined` for an unknown key. */
export function getDecidedPlanLimits(plan: string | null | undefined): DecidedPlan | undefined {
  if (typeof plan !== 'string' || !Object.prototype.hasOwnProperty.call(DECIDED_PLAN_LIMITS, plan)) return undefined;
  return DECIDED_PLAN_LIMITS[plan as PlanKey];
}

/**
 * Where enforcement (today) and the decided tiers differ. Kept as data so the
 * test pins it and the billing track can delete entries as it closes them.
 * Order meter: today counts sync API calls (`orderSyncCount`), decided counts orders (D6).
 */
export const ENFORCEMENT_GAP: ReadonlyArray<{ plan: PlanKey; meter: 'orderSync→orders' | 'label→labels' | 'meter' | 'period'; enforced: string; decided: string }> = [
  { plan: 'trial', meter: 'orderSync→orders', enforced: '150 new orders via manual / extension sync (scheduled syncs not metered yet, G16)', decided: '150 orders/month' },
  { plan: 'starter', meter: 'orderSync→orders', enforced: '500 new orders via manual / extension sync', decided: '500 orders/month' },
  { plan: 'growth', meter: 'orderSync→orders', enforced: '2000 new orders via manual / extension sync', decided: '2000 orders/month' },
  { plan: 'pro', meter: 'orderSync→orders', enforced: '6000 new orders via manual / extension sync', decided: '6000 orders/month' },
  { plan: 'shopify_free', meter: 'meter', enforced: 'unlimited, no store/AI cap', decided: '1 non-Shopify store, 100 AI credits' },
  // The middleware reads only User.subscriptionPlan; /api/user/settings also shows
  // shopify_free for an active ShopifyShop or billingProvider. Its `limits` follow
  // the middleware (raw plan), so such an account is reported trial/blocked, not unlimited.
  { plan: 'shopify_free', meter: 'meter', enforced: "only when User.subscriptionPlan = 'shopify_free' (an active ShopifyShop alone stays trial-limited / noSubscription)", decided: 'every account with a connected Shopify store' },
];

/* ------------------------------- 3. extension research (daily lookups) */

/**
 * Chrome-extension research lookups per day (00:00 Europe/Istanbul reset), enforced by
 * lib/ext/researchQuota.ts. One lookup = one extension research request that misses the
 * shared cross-user cache and calls a marketplace API (a page view with several calls counts once).
 * Founder decision 2026-10-18: the marketplace APIs are on basic commercial tiers, so one heavy
 * user must not drain the shared quota.
 */
export const EXT_RESEARCH_DAILY_LOOKUPS: Readonly<Record<PlanKey, number>> = {
  trial: 50,
  starter: 150,
  growth: 500,
  pro: 1500,
  enterprise: 5000,
  shopify_free: 50,
  aylik: 150,
  baslangic_yil: 150,
  buyume_yil: 500,
  pro_yil: 1500,
  kurumsal: 5000,
};

export interface ExtResearchLimit {
  /** Plan key the limit came from; null when the account has no usable plan (limit 0). */
  plan: PlanKey | null;
  state: LimitState;
  /** Lookups per Istanbul day. 0 = blocked (trial over / no subscription / invalid plan). */
  limit: number;
}

/**
 * Daily extension research limit for a user. Resolves the plan exactly like the usage
 * middleware (`getPlanLimits`): shopify_free → paid plan (active / trialing / past_due) →
 * app trial incl. grace → blocked. Pure; `now` is injectable for tests.
 */
export function getExtResearchDailyLimit(
  plan: string | null | undefined,
  status: string | null | undefined,
  trialExpiresAt: Date | string | number | null | undefined,
  now: Date = new Date(),
): ExtResearchLimit {
  const decision = getPlanLimits(plan, status, trialExpiresAt, now);
  switch (decision.state) {
    case 'shopify_free':
      return { plan: 'shopify_free', state: decision.state, limit: EXT_RESEARCH_DAILY_LOOKUPS.shopify_free };
    case 'trial':
      return { plan: 'trial', state: decision.state, limit: EXT_RESEARCH_DAILY_LOOKUPS.trial };
    case 'active': {
      const key = decision.plan as PlanKey;
      const limit = Object.prototype.hasOwnProperty.call(EXT_RESEARCH_DAILY_LOOKUPS, key) ? EXT_RESEARCH_DAILY_LOOKUPS[key] : 0;
      return { plan: limit ? key : null, state: decision.state, limit };
    }
    default:
      return { plan: null, state: decision.state, limit: 0 };
  }
}
