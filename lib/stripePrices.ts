export const STRIPE_PRICES = {
  starter: {
    month: process.env.PRICE_STARTER_MONTH as string,
    year: process.env.PRICE_STARTER_YEAR as string,
  },
  growth: {
    month: process.env.PRICE_GROWTH_MONTH as string,
    year: process.env.PRICE_GROWTH_YEAR as string,
  },
  pro: {
    month: process.env.PRICE_PRO_MONTH as string,
    year: process.env.PRICE_PRO_YEAR as string,
  },
} as const;

export type PlanKey = keyof typeof STRIPE_PRICES;
export type IntervalKey = keyof typeof STRIPE_PRICES[PlanKey];

/**
 * Price id for a plan/interval in the buyer's currency: `PRICE_{PLAN}_{INTERVAL}_{TRY|USD}`
 * when configured, else the base `PRICE_{PLAN}_{INTERVAL}` (same names as stripeAccountServer).
 */
export function priceIdFor(plan: PlanKey, interval: IntervalKey, currency?: string | null): string | undefined {
  const cur = typeof currency === 'string' ? currency.toUpperCase() : '';
  if (cur === 'TRY' || cur === 'USD') {
    const byCurrency = process.env[`PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}_${cur}`];
    if (byCurrency) return byCurrency;
  }
  return STRIPE_PRICES[plan][interval] || undefined;
}
