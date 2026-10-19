// Pricing v2 (docs/gtm/pricing-v2.md §3): Turkey pricing, yearly packages first + one monthly plan + modules.
// Numbers confirmed by Atilla on 2026-10-19 (final). The page stays unpublished (PRICING_V2_DRAFT) until the
// installment checkout (P2) exists and the accountant has confirmed the no-KDV setup (seller: Tamsar, Inc.). It deliberately lives outside lib/billing: nothing here is wired to checkout, entitlements or Stripe.
// When P1 ships (plan keys + limits in lib/billing), this file is replaced by reads from lib/billing.

/** While true: draft banner + noindex on the v2 pricing page. Flip to false at go-live (P2 checkout live, §5 settled). */
export const PRICING_V2_DRAFT = true;

export type YearlyPlan = 'baslangic' | 'buyume' | 'pro' | 'kurumsal';
export type ModuleKey = 'financials' | 'arbitrage' | 'bulkPhotoStudio' | 'extraStore' | 'extraOrders';

export const YEARLY_PLANS: readonly YearlyPlan[] = ['baslangic', 'buyume', 'pro', 'kurumsal'];
export const RECOMMENDED_YEARLY: YearlyPlan = 'buyume';

export interface YearlyFacts {
  /** ₺ per year, the full amount (Tamsar, Inc. sells; no KDV added). `null` = quote (Kurumsal shows "from"). */
  priceYear: number | null;
  /** Kurumsal: "from" amount. */
  fromYear?: number;
  /** Max installments ("taksit"); `null` = by agreement. */
  taksit: number | null;
  stores: number | null;
  ordersYear: number | null;
  labelsYear: number | null;
  aiCreditsMonth: number;
  /** Pro-level features included (otherwise offered as modules). */
  proFeatures: boolean;
  prioritySupport: boolean;
}

export const YEARLY: Readonly<Record<YearlyPlan, YearlyFacts>> = {
  baslangic: { priceYear: 29990, taksit: 6, stores: 3, ordersYear: 6000, labelsYear: 3000, aiCreditsMonth: 300, proFeatures: false, prioritySupport: false },
  buyume: { priceYear: 54990, taksit: 9, stores: 6, ordersYear: 24000, labelsYear: 12000, aiCreditsMonth: 1500, proFeatures: false, prioritySupport: false },
  pro: { priceYear: 89990, taksit: 12, stores: 12, ordersYear: 72000, labelsYear: 36000, aiCreditsMonth: 3000, proFeatures: true, prioritySupport: true },
  kurumsal: { priceYear: null, fromYear: 149990, taksit: null, stores: null, ordersYear: null, labelsYear: null, aiCreditsMonth: 10000, proFeatures: true, prioritySupport: true },
};

export const MONTHLY = { priceMonth: 2999, stores: 2, ordersMonth: 500, labelsMonth: 250, aiCreditsMonth: 300 } as const;

/** Modules: per month on Aylık, per year on a yearly package. */
export const MODULES: ReadonlyArray<{ key: ModuleKey; month: number; year: number }> = [
  { key: 'financials', month: 990, year: 9900 },
  { key: 'arbitrage', month: 990, year: 9900 },
  { key: 'bulkPhotoStudio', month: 790, year: 7900 },
  { key: 'extraStore', month: 490, year: 4900 },
  { key: 'extraOrders', month: 490, year: 4900 },
];

/** Existing AI credit packs, read from billing (live prices, unchanged by v2). */
export { CREDIT_PACKS } from '@/lib/billing/aiCredits';

/** Features every package and Aylık include (the base product). */
export const BASE_FEATURES = ['listingStudio', 'aiText', 'research', 'extension', 'labels', 'etgb', 'stockSync'] as const;

/** Founding-member price (40% off for life) — the live counter decides whether the line shows. */
export function foundingPrice(amount: number, percentOff: number): number {
  return Math.round(amount * (1 - percentOff / 100));
}

export function perMonth(priceYear: number): number {
  return Math.round(priceYear / 12);
}
