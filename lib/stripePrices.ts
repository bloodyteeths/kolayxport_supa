export const STRIPE_PRICES = {
  starter: {
    month: process.env.PRICE_STARTER_MONTH as string,
    year: process.env.PRICE_STARTER_YEAR as string,
  },
  growth: {
    month: process.env.PRICE_GROWTH_MONTH as string,
    year: process.env.PRICE_GROWTH_YEAR as string,
  },
} as const;

export type PlanKey = keyof typeof STRIPE_PRICES;
export type IntervalKey = keyof typeof STRIPE_PRICES[PlanKey]; 