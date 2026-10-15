// components/domain/pricing/pricingModel.ts — pure view model of the public pricing page (settings §10).
// Every number comes from `lib/billing/price.ts` (prices, founding maths) and `lib/billing/planLimits.ts`
// (decided limits, via `planLimit`). Nothing here types a price or a limit by hand; this file only says
// which facts each card / comparison row shows.
import { FOUNDING_INTERVALS, foundingPrice, listPrice, perMonthEquivalent, planLimit } from '@/lib/billing/price';
import { isNeutralBilling, type PricingViewer } from '@/lib/billing/billingState';
import type { Currency, Feature, Interval, MeterKey, PaidPlanKey, PricedPlanKey } from '@/lib/billing/types';

export const PRICING_PLANS: readonly PricedPlanKey[] = ['starter', 'growth', 'pro', 'enterprise'];
/** "Most popular" (1px accent border + caption). */
export const RECOMMENDED_PLAN: PricedPlanKey = 'growth';
/** Mobile order: the recommended plan first, then the ladder (settings §10.3). */
export const MOBILE_ORDER: readonly PricedPlanKey[] = ['growth', 'starter', 'pro', 'enterprise'];

/**
 * Founder decision §18.1 (KDV). `null` = not decided yet: no tax note is rendered rather than a guess.
 * Moves to `PLANS.taxIncluded` when `lib/billing/plans.ts` ships (outOfScope request).
 */
export const TAX_INCLUDED: boolean | null = null;

export type SupportLevel = 'email' | 'priority' | 'dedicated';
/** §18.3 Support row (founder to confirm). */
export const SUPPORT: Readonly<Record<PricedPlanKey, SupportLevel>> = {
  starter: 'email',
  growth: 'email',
  pro: 'priority',
  enterprise: 'dedicated',
};

export const SUPPORT_KEYS = {
  email: 'compare.supportEmail',
  priority: 'compare.supportPriority',
  dedicated: 'compare.supportDedicated',
} as const satisfies Record<SupportLevel, string>;

/** Pro features (settings §0.2) in card / table order. */
export const PRO_FEATURES: readonly Feature[] = ['arbitrage', 'financials', 'bulkPhotoStudio'];
const PRO_LIKE: ReadonlySet<PricedPlanKey> = new Set(['pro', 'enterprise']);

export const LIMIT_METERS: readonly MeterKey[] = ['orders', 'labels', 'connectedStores', 'aiCredits'];

export function defaultCurrency(locale: string | null | undefined): Currency {
  return (locale ?? '').toLowerCase().startsWith('en') ? 'USD' : 'TRY';
}

/** Monthly limit, `null` = unlimited (Enterprise). */
export function limitFor(plan: PricedPlanKey, meter: MeterKey): number | null {
  const v = planLimit(plan, meter);
  return v === undefined ? null : v;
}

/** Pro features are on Pro and Enterprise only (tiers.md §1 `features`). */
export function hasFeature(plan: PricedPlanKey, feature: Feature): boolean {
  return PRO_FEATURES.includes(feature) ? PRO_LIKE.has(plan) : true;
}

export interface CardPrice {
  /** The big number (founding price when the offer applies). */
  amount: number;
  /** Struck list price (only with founding). */
  struck: number | null;
  /** Yearly: amount ÷ 12 (founding-aware). Monthly: null. */
  perMonth: number | null;
  founding: boolean;
}

/**
 * Price shown on a card. `foundingPercent` = the live offer's percent (null when the line is hidden).
 * null for Enterprise (custom pricing).
 */
export function cardPrice(plan: PricedPlanKey, interval: Interval, currency: Currency, foundingPercent: number | null): CardPrice | null {
  if (plan === 'enterprise') return null;
  const list = listPrice(plan, interval, currency);
  if (list === null) return null;
  const foundingOn = foundingPercent !== null && FOUNDING_INTERVALS.includes(interval);
  const founding = foundingOn ? foundingPrice(plan, interval, currency, foundingPercent) : null;
  const amount = founding ?? list;
  const perMonth = interval === 'year'
    ? perMonthEquivalent(plan, interval, currency, { founding: founding !== null, percentOff: foundingPercent ?? undefined })
    : null;
  return { amount, struck: founding !== null ? list : null, perMonth, founding: founding !== null };
}

/** Card bullet list (after the 4 limit lines). `everythingIn` = "Everything in {plan}". */
export type CardFeature =
  | { key: 'listing' | 'labels' | 'research' | 'arbitrage' | 'financials' | 'bulkPhotoStudio' | 'prioritySupport' | 'dedicatedContact' }
  | { key: 'everythingIn'; plan: PricedPlanKey };

export const CARD_FEATURES: Readonly<Record<PricedPlanKey, readonly CardFeature[]>> = {
  starter: [{ key: 'listing' }, { key: 'labels' }, { key: 'research' }],
  growth: [{ key: 'everythingIn', plan: 'starter' }],
  pro: [{ key: 'everythingIn', plan: 'growth' }, { key: 'arbitrage' }, { key: 'financials' }, { key: 'bulkPhotoStudio' }, { key: 'prioritySupport' }],
  enterprise: [{ key: 'everythingIn', plan: 'pro' }, { key: 'dedicatedContact' }],
};

export type CompareCell =
  | { kind: 'num'; value: number | null }
  | { kind: 'check'; on: boolean }
  | { kind: 'text'; key: 'compare.all' | (typeof SUPPORT_KEYS)[SupportLevel] };

export interface CompareRow {
  id: string;
  /** Message key relative to `marketing.pricingV2`. */
  labelKey: `compare.${'orders' | 'labels' | 'stores' | 'ai' | 'marketplaces' | 'carriers' | 'listing' | 'support'}` | `feature.${'research' | 'arbitrage' | 'financials' | 'bulkPhotoStudio'}`;
  /** `hint.<hintKey>` for the TermHint (?) */
  hintKey?: 'orders' | 'stores' | 'ai';
  cell: (plan: PricedPlanKey) => CompareCell;
}

export const COMPARE_ROWS: readonly CompareRow[] = [
  { id: 'orders', labelKey: 'compare.orders', hintKey: 'orders', cell: (p) => ({ kind: 'num', value: limitFor(p, 'orders') }) },
  { id: 'labels', labelKey: 'compare.labels', cell: (p) => ({ kind: 'num', value: limitFor(p, 'labels') }) },
  { id: 'stores', labelKey: 'compare.stores', hintKey: 'stores', cell: (p) => ({ kind: 'num', value: limitFor(p, 'connectedStores') }) },
  { id: 'ai', labelKey: 'compare.ai', hintKey: 'ai', cell: (p) => ({ kind: 'num', value: limitFor(p, 'aiCredits') }) },
  { id: 'marketplaces', labelKey: 'compare.marketplaces', cell: () => ({ kind: 'text', key: 'compare.all' }) },
  { id: 'carriers', labelKey: 'compare.carriers', cell: () => ({ kind: 'check', on: true }) },
  { id: 'listing', labelKey: 'compare.listing', cell: () => ({ kind: 'check', on: true }) },
  { id: 'research', labelKey: 'feature.research', cell: () => ({ kind: 'check', on: true }) },
  { id: 'arbitrage', labelKey: 'feature.arbitrage', cell: (p) => ({ kind: 'check', on: hasFeature(p, 'arbitrage') }) },
  { id: 'financials', labelKey: 'feature.financials', cell: (p) => ({ kind: 'check', on: hasFeature(p, 'financials') }) },
  { id: 'bulkPhotoStudio', labelKey: 'feature.bulkPhotoStudio', cell: (p) => ({ kind: 'check', on: hasFeature(p, 'bulkPhotoStudio') }) },
  { id: 'support', labelKey: 'compare.support', cell: (p) => ({ kind: 'text', key: SUPPORT_KEYS[SUPPORT[p]] }) },
];

export interface ReviewerPlanFacts {
  plan: PaidPlanKey;
  monthTry: number;
  yearTry: number;
  monthUsd: number;
  yearUsd: number;
  orders: number | null;
  labels: number | null;
  stores: number | null;
  ai: number | null;
}

/** English reviewer summary rows (list prices only; generated from the plan tables, tiers.md §4). */
export function reviewerFacts(): ReviewerPlanFacts[] {
  const paid: PaidPlanKey[] = ['starter', 'growth', 'pro'];
  return paid.map((plan) => ({
    plan,
    monthTry: listPrice(plan, 'month', 'TRY') ?? 0,
    yearTry: listPrice(plan, 'year', 'TRY') ?? 0,
    monthUsd: listPrice(plan, 'month', 'USD') ?? 0,
    yearUsd: listPrice(plan, 'year', 'USD') ?? 0,
    orders: limitFor(plan, 'orders'),
    labels: limitFor(plan, 'labels'),
    stores: limitFor(plan, 'connectedStores'),
    ai: limitFor(plan, 'aiCredits'),
  }));
}

/** Cheapest monthly list price ("From ₺2,499 a month") for the SEO description. */
export function fromPrice(currency: Currency): number {
  const prices = (['starter', 'growth', 'pro'] as const).map((p) => listPrice(p, 'month', currency) ?? Infinity);
  return Math.min(...prices);
}

/** Founding spots at or below this count read "Only N spots left" in warning-fg (never animated). */
export const FEW_SPOTS = 5;

export const INTERVALS: readonly Interval[] = ['month', 'year'];
export const CURRENCIES: readonly Currency[] = ['TRY', 'USD'];

export type PricingGate = 'skeleton' | 'redirect' | 'error' | 'show';

/**
 * §10.5 gate: never paint money until we know the viewer may see Stripe prices. A signed-in viewer whose
 * provider stays unknown (entitlement and settings fallback both failed) gets 'error' — no prices, no
 * currency toggles, a Reload — because they may be shopify_free (fails closed; §2 "provider unknown →
 * Stripe surfaces not rendered" wins over the §10.4/§11 "CTAs disabled" row, which still painted prices).
 */
export function pricingGate(input: {
  authLoading: boolean;
  signedIn: boolean;
  entitlement: PricingViewer['entitlement'];
  entitlementError: boolean;
}): PricingGate {
  if (input.authLoading) return 'skeleton';
  if (!input.signedIn) return 'show';
  if (input.entitlement && isNeutralBilling(input.entitlement)) return 'redirect';
  if (!input.entitlement) return input.entitlementError ? 'error' : 'skeleton';
  return 'show';
}
