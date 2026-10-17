/**
 * Plan limits: one module for the numbers the UI shows and the numbers the
 * server enforces (shell-nav §9.2, CRITIQUE C8). Isomorphic and pure (no I/O).
 *
 * Two tables live here on purpose:
 *
 * 1. ENFORCED_* — exactly what `lib/middleware/withUsageLimiter.ts` enforces
 *    today (its `plans` table at :17–25 and `trialLimits` at :96). The
 *    middleware still carries its own copy: it is import-only for the UI track
 *    and the billing backend track rewrites it (tiers.md §2b). The parity test
 *    `test/billing/planLimits.test.ts` runs the real middleware against
 *    `getPlanLimits()` + `checkPlanLimit()` so the two cannot drift silently.
 *    `/api/user/settings` exposes these (`subscription.limits`), because a
 *    meter must show the limit that actually blocks the user.
 *
 * 2. DECIDED_PLAN_LIMITS — the launch tiers decided in design/launch/tiers.md
 *    §1 (Trial, Starter, Growth, Pro, Enterprise, shopify_free). Nothing
 *    enforces them yet. The billing track moves enforcement to them (and may
 *    move this table into `lib/billing/plans.ts`, tiers.md §1); until then they
 *    are for pricing/marketing copy only. See ENFORCEMENT_GAP below.
 *
 * `null` = unlimited everywhere in this module (JSON-safe, unlike Infinity).
 */

/* ------------------------------------------------------------------ keys */

/** Every plan key, current and decided (tiers.md §1 `PlanKey`). */
export type PlanKey = 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise' | 'shopify_free';
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
 * Byte-for-byte the middleware's `plans` table (withUsageLimiter.ts:17–25).
 * `pro` is absent on purpose: the middleware does not know it, so an active
 * `pro` user is answered `invalidPlan` today (see ENFORCEMENT_GAP).
 */
export const ENFORCED_PLAN_LIMITS: Readonly<Record<'starter' | 'growth' | 'enterprise' | 'shopify_free', PlanLimits>> = {
  starter: { orderSync: 200, label: 100 },
  growth: { orderSync: 2000, label: 500 },
  enterprise: { orderSync: null, label: null },
  shopify_free: { orderSync: null, label: null },
};

/** withUsageLimiter.ts:96 — applies while `subscriptionStatus === 'trialing'` and the trial date is in the future. */
export const ENFORCED_TRIAL_LIMITS: Readonly<PlanLimits> = { orderSync: 50, label: 10 };

/**
 * Which branch of the middleware applies.
 * - `shopify_free`: plan is shopify_free → never limited.
 * - `trial`: trialing and `trialExpiresAt` in the future → trial limits.
 * - `active`: status `active` with a known plan → plan limits.
 * - `noSubscription`: anything else (trial over, canceled, past_due, null) → blocked.
 * - `invalidPlan`: status `active` but plan missing/unknown → blocked.
 */
export type LimitState = 'shopify_free' | 'trial' | 'active' | 'noSubscription' | 'invalidPlan';

/** Usage window: the trial (one bucket for the whole trial) or the monthly reset period. */
export type LimitPeriod = 'trial' | 'month' | null;

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

/**
 * The limits the middleware applies to a user, in the middleware's order:
 * shopify_free → trial → not active → invalid plan → plan.
 * Pure; `now` is injectable for tests.
 */
export function getPlanLimits(
  plan: string | null | undefined,
  status: string | null | undefined,
  trialExpiresAt: Date | string | number | null | undefined,
  now: Date = new Date(),
): PlanLimitDecision {
  if (plan === 'shopify_free') {
    return { state: 'shopify_free', plan: 'shopify_free', limits: { orderSync: null, label: null }, period: null };
  }
  const trialEnd = toDate(trialExpiresAt);
  if (status === 'trialing' && trialEnd && now < trialEnd) {
    return { state: 'trial', plan: 'trial', limits: { ...ENFORCED_TRIAL_LIMITS }, period: 'trial' };
  }
  if (status !== 'active') {
    return { state: 'noSubscription', plan: plan ?? null, limits: { orderSync: 0, label: 0 }, period: null };
  }
  if (!hasEnforcedPlan(plan)) {
    return { state: 'invalidPlan', plan: plan ?? null, limits: { orderSync: 0, label: 0 }, period: null };
  }
  return { state: 'active', plan, limits: { ...ENFORCED_PLAN_LIMITS[plan] }, period: 'month' };
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
  shopify_free: { limits: { orders: null, labels: null, connectedStores: 1, aiCredits: 100 }, stripeUpsell: false },
};

/** tiers.md §1 constants (display only until the billing track enforces them). */
export const DECIDED_TRIAL_DAYS = 14;
export const DECIDED_GRACE_DAYS = 3;

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
  { plan: 'trial', meter: 'orderSync→orders', enforced: '50 sync calls', decided: '150 orders/month' },
  { plan: 'trial', meter: 'label→labels', enforced: '10', decided: '30/month' },
  { plan: 'trial', meter: 'period', enforced: 'Stripe trial (checkout: 30 days)', decided: '14 days + 3 days grace' },
  { plan: 'starter', meter: 'orderSync→orders', enforced: '200 sync calls', decided: '500 orders/month' },
  { plan: 'starter', meter: 'label→labels', enforced: '100', decided: '250/month' },
  { plan: 'growth', meter: 'label→labels', enforced: '500', decided: '1000/month' },
  { plan: 'growth', meter: 'orderSync→orders', enforced: '2000 sync calls', decided: '2000 orders/month' },
  { plan: 'pro', meter: 'meter', enforced: 'unknown plan → invalidPlan (blocked)', decided: '6000 orders, 3000 labels/month' },
  { plan: 'shopify_free', meter: 'meter', enforced: 'unlimited, no store cap', decided: '1 non-Shopify store' },
  // The middleware reads only User.subscriptionPlan; /api/user/settings also shows
  // shopify_free for an active ShopifyShop or billingProvider. Its `limits` follow
  // the middleware (raw plan), so such an account is reported trial/blocked, not unlimited.
  { plan: 'shopify_free', meter: 'meter', enforced: "only when User.subscriptionPlan = 'shopify_free' (an active ShopifyShop alone stays trial-limited / noSubscription)", decided: 'every account with a connected Shopify store' },
];
