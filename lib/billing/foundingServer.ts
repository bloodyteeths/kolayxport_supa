// lib/billing/foundingServer.ts — server side of the founding-member offer (tiers.md §1 FOUNDING).
// The Stripe coupon is the source of truth: `max_redemptions` is the number of spots and
// `times_redeemed` the spots taken, so the pricing-page counter is always the real count.
// Without STRIPE_FOUNDING_COUPON_ID the offer is off (the pricing page hides founding prices).
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { FOUNDING_MAX_SPOTS, FOUNDING_PERCENT_OFF } from './price';
import type { FoundingSpots } from './types';

const CACHE_MS = 60_000;
let cache: { at: number; value: FoundingSpots } | null = null;

const OFF: FoundingSpots = { active: false, total: FOUNDING_MAX_SPOTS, remaining: 0, percentOff: FOUNDING_PERCENT_OFF };

export function foundingCouponId(): string | null {
  return process.env.STRIPE_FOUNDING_COUPON_ID || null;
}

/** Live founding spots, cached for a minute. `fresh` skips the cache (checkout). */
export async function getFoundingSpots(opts: { fresh?: boolean } = {}): Promise<FoundingSpots> {
  const couponId = foundingCouponId();
  if (!couponId) return OFF;
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const coupon = await stripe.coupons.retrieve(couponId);
    const total = coupon.max_redemptions ?? FOUNDING_MAX_SPOTS;
    const value: FoundingSpots = {
      active: coupon.valid,
      total,
      remaining: Math.max(0, total - coupon.times_redeemed),
      percentOff: coupon.percent_off ?? FOUNDING_PERCENT_OFF,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.error('Founding coupon lookup failed', err as Error, { couponId });
    return OFF;
  }
}
