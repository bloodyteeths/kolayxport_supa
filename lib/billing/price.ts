// lib/billing/price.ts — settings §2.4: every derived price the UI shows (founding, per-month equivalent,
// "next plan up"). Pure and client-safe; cents-exact (`Math.round(x * 100) / 100`). Unit-tested against
// the settings §0.2 tables (test/billing/d-price.test.ts).
//
// Source of the numbers: tiers.md §1 `PLANS`. The billing backend track creates `lib/billing/plans.ts`;
// until it lands, the display prices live in `PLAN_PRICES` below (the ONLY copy in UI code) and the
// limits come from `DECIDED_PLAN_LIMITS` (lib/billing/planLimits.ts). When `plans.ts` ships, replace
// `PLAN_PRICES` / `planLimit()` with reads of `PLANS[plan].price` / `PLANS[plan].limits` (one edit here;
// every consumer goes through these functions).
import { DECIDED_PLAN_LIMITS } from './planLimits';
import type { Currency, Interval, MeterKey, PaidPlanKey, PlanKey } from './types';

/** tiers.md §1 `FOUNDING.percentOff` (Stripe coupon `percent_off 40`, `duration forever`). */
export const FOUNDING_PERCENT_OFF = 40;
/** tiers.md §1 `FOUNDING.maxSpots`. Display only; the live count comes from `/api/billing/founding-spots`. */
export const FOUNDING_MAX_SPOTS = 20;
/** tiers.md §1 `OVERAGE_BUFFER`: scheduled order imports pause at limit × 1.10 (soft enforcement). */
export const OVERAGE_BUFFER = 0.1;
/**
 * Founder decision §18.5: founding applies to these intervals. `['month']` hides founding prices on the
 * yearly cards. Default: both (the coupon is `duration: forever`).
 */
export const FOUNDING_INTERVALS: readonly Interval[] = ['month', 'year'];

type PriceKey = 'try' | 'usd';

/** tiers.md §1 `PLANS[plan].price` (major units). Interim copy until `lib/billing/plans.ts` exists. */
export const PLAN_PRICES: Readonly<Record<PaidPlanKey, Record<PriceKey, Record<Interval, number>>>> = {
  starter: { try: { month: 2499, year: 24990 }, usd: { month: 59, year: 590 } },
  growth: { try: { month: 4999, year: 49990 }, usd: { month: 99, year: 990 } },
  pro: { try: { month: 7999, year: 79990 }, usd: { month: 149, year: 1490 } },
};

/** Upgrade order (lowest first). Trial and shopify_free are not on the ladder. */
export const PLAN_LADDER: readonly (PaidPlanKey | 'enterprise')[] = ['starter', 'growth', 'pro', 'enterprise'];

export const round2 = (x: number): number => Math.round(x * 100) / 100;

function priceKey(currency: Currency | PriceKey | string | null | undefined): PriceKey | null {
  const c = (currency ?? '').toString().trim().toLowerCase();
  return c === 'try' || c === 'usd' ? c : null;
}

/** ISO code for `Money` ('TRY' | 'USD'), or null for an unknown currency. */
export function currencyCode(currency: Currency | PriceKey | string | null | undefined): Currency | null {
  const k = priceKey(currency);
  return k === 'try' ? 'TRY' : k === 'usd' ? 'USD' : null;
}

/** List price in major units; null for plans without a list price (trial, enterprise, shopify_free). */
export function listPrice(plan: PlanKey | string, interval: Interval, currency: Currency | PriceKey | string): number | null {
  const k = priceKey(currency);
  if (!k || !(plan in PLAN_PRICES)) return null;
  return PLAN_PRICES[plan as PaidPlanKey][k][interval];
}

/** Founding price (40 % off for life). null when there is no list price or founding is off for the interval. */
export function foundingPrice(
  plan: PlanKey | string,
  interval: Interval,
  currency: Currency | PriceKey | string,
  percentOff: number = FOUNDING_PERCENT_OFF,
): number | null {
  if (!FOUNDING_INTERVALS.includes(interval)) return null;
  const list = listPrice(plan, interval, currency);
  if (list === null) return null;
  return round2(list * (1 - percentOff / 100));
}

/** Yearly price ÷ 12 (founding when `founding`); the monthly price for a monthly interval. */
export function perMonthEquivalent(
  plan: PlanKey | string,
  interval: Interval,
  currency: Currency | PriceKey | string,
  opts: { founding?: boolean; percentOff?: number } = {},
): number | null {
  const price = opts.founding ? foundingPrice(plan, interval, currency, opts.percentOff) : listPrice(plan, interval, currency);
  if (price === null) return null;
  return interval === 'year' ? round2(price / 12) : price;
}

/**
 * What the account pays per interval: founding price for founding members, else the list price.
 * `{ amount, list }` — `list` is set only when it differs (the struck price).
 */
export function effectivePrice(
  plan: PlanKey | string,
  interval: Interval,
  currency: Currency | PriceKey | string,
  foundingMember: boolean,
): { amount: number; list: number | null } | null {
  const list = listPrice(plan, interval, currency);
  if (list === null) return null;
  const founding = foundingMember ? foundingPrice(plan, interval, currency) : null;
  return founding === null || founding === list ? { amount: list, list: null } : { amount: founding, list };
}

/** Monthly limit of a meter on a plan (null = unlimited, undefined = unknown plan). */
export function planLimit(plan: PlanKey | string, meter: MeterKey): number | null | undefined {
  const p = DECIDED_PLAN_LIMITS[plan as PlanKey];
  return p ? p.limits[meter] : undefined;
}

function rank(plan: PlanKey | string | null | undefined): number {
  return PLAN_LADDER.indexOf(plan as PaidPlanKey | 'enterprise');
}

/**
 * Cheapest plan whose `meter` limit covers `needed` (null limit = unlimited), optionally only plans above
 * `above` on the ladder. Enterprise when no paid plan covers it. Used by the near-limit upsell
 * ("Pro includes 3,000 a month", next plan from the current one) and by the pricing page.
 */
export function cheapestPlanFor(meter: MeterKey, needed: number, above?: PlanKey | string | null): PaidPlanKey | 'enterprise' {
  const floor = above ? rank(above) : -1;
  for (const plan of PLAN_LADDER) {
    if (rank(plan) <= floor) continue;
    if (plan === 'enterprise') return 'enterprise';
    const limit = planLimit(plan, meter);
    if (limit === null || (typeof limit === 'number' && limit >= needed)) return plan;
  }
  return 'enterprise';
}

/**
 * Next plan up whose `meter` limit is higher than the current plan's (trial/shopify_free → starter ladder
 * start). Enterprise when the account is on Pro.
 */
export function nextPlanFor(meter: MeterKey, current: PlanKey | string | null | undefined): PaidPlanKey | 'enterprise' {
  const currentLimit = current ? planLimit(current, meter) : undefined;
  const needed = typeof currentLimit === 'number' ? currentLimit + 1 : 0;
  const above = current && rank(current) >= 0 ? current : null;
  return cheapestPlanFor(meter, needed, above);
}
