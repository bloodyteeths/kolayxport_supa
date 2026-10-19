import { STRIPE_PRICES, priceIdFor, type PlanKey } from '@/lib/stripePrices';
import { foundingCouponId, getFoundingSpots } from '@/lib/billing/foundingServer';
import { newTrialExpiry } from '@/lib/billing/planLimits';
import { contextFromRequest, contextToMetadata } from '@/lib/tracking/server';
import { TRIAL_CARRY_MS } from '@/lib/billing/billingState';
import { FOUNDING_INTERVALS } from '@/lib/billing/price';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { checkoutSuccessUrl, checkoutCancelUrl } from '@/lib/billing/checkoutUrls';
import { isPlayRequest } from '@/lib/billing/playClient';
import { pricingV2Enabled } from '@/lib/billing/pricingV2';
import { resolveV2PriceId, v2PlanInterval } from '@/lib/billing/stripeV2';
import { isModuleKey } from '@/lib/billing/modules';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }
  // Google Play app: nothing is sold in the Android app (lib/billing/playClient.ts).
  if (isPlayRequest(req)) return res.status(403).json({ error: 'Not available in the app', code: 'playApp' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const userId = user.id;

  // Shopify-installed merchants are on the free Shopify tier. Shopify App Store
  // rules forbid charging them outside Shopify Billing, so block Stripe checkout
  // for flagged accounts AND any account with an active Shopify store connected.
  const [billingCheck, activeShopifyShops] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { billingProvider: true },
    }),
    prisma.shopifyShop.count({ where: { userId, isActive: true } }),
  ]);
  if (billingCheck?.billingProvider === 'shopify_free' || activeShopifyShops > 0) {
    return res.status(403).json({
      error: 'Shopify-installed accounts use the free Shopify tier and cannot subscribe via Stripe.',
    });
  }

  const { plan, interval: requestedInterval, currency, expectFounding, modules: requestedModules } = req.body as {
    plan: PlanKey | 'kurumsal' | string;
    interval: 'month' | 'year';
    currency?: string;
    expectFounding?: boolean;
    /** Pricing v2 only: { financials: 1, extraStore: 2, ... } */
    modules?: Record<string, unknown>;
  };

  if (plan === 'kurumsal') {
    return res.status(400).json({ error: 'Kurumsal plan handled manually. Please contact sales.' });
  }

  // Pricing v2 (lib/billing/stripeV2.ts): only while PRICING_V2 is on. The plan fixes the interval (Aylık monthly,
  // packages yearly); modules are extra line items at the same interval.
  const v2Interval = pricingV2Enabled() ? v2PlanInterval(String(plan)) : null;
  const interval = v2Interval ?? requestedInterval;

  if (!v2Interval && (!plan || !interval || !Object.prototype.hasOwnProperty.call(STRIPE_PRICES, plan) || (interval !== 'month' && interval !== 'year'))) {
    return res.status(400).json({ error: 'Invalid plan or interval.' });
  }

  const moduleItems: { price: string; quantity: number }[] = [];
  try {
    // Validate price configuration first
    const priceId = v2Interval ? await resolveV2PriceId(String(plan), v2Interval) : priceIdFor(plan as PlanKey, interval, currency);
    if (v2Interval && requestedModules && typeof requestedModules === 'object') {
      for (const [key, raw] of Object.entries(requestedModules)) {
        const qty = Number(raw);
        if (!isModuleKey(key) || !Number.isInteger(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: `Invalid module ${key}.` });
        const modulePrice = await resolveV2PriceId(key, v2Interval);
        if (!modulePrice) return res.status(400).json({ error: 'Price configuration missing for a module.' });
        moduleItems.push({ price: modulePrice, quantity: qty });
      }
    }
    if (!priceId) {
      logger.error('Missing price ID for plan', undefined, { plan, interval });
      return res.status(400).json({ error: 'Price configuration missing for selected plan. Please check environment variables.' });
    }

    // Verify the price exists in Stripe
    try {
      await stripe.prices.retrieve(priceId);
    } catch (priceError: any) {
      logger.error('Invalid Stripe price ID', priceError, { priceId });
      return res.status(400).json({ error: 'Invalid price configuration. The price ID does not exist in your Stripe account.' });
    }

    // Smart user lookup: first by ID, then by email if needed
    let dbUser;
    try {
      // First, try to find user by Supabase ID
      dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          stripeCustomerId: true,
          trialExpiresAt: true,
        }
      });

      // If not found by ID, try to find by email (for existing users with different IDs)
      if (!dbUser && user.email) {
        dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: {
            id: true,
            email: true,
            name: true,
            stripeCustomerId: true,
          }
        });

        // If found by email but with different ID, update the ID to match Supabase
        if (dbUser && dbUser.id !== userId) {
          dbUser = await prisma.user.update({
            where: { email: user.email },
            data: { id: userId },
            select: {
              id: true,
              email: true,
              name: true,
              stripeCustomerId: true,
              trialExpiresAt: true,
            }
          });
        }
      }
    } catch (dbError: any) {
      logger.error('Database query error during checkout', dbError);
      if (dbError.code === 'P2024') {
        return res.status(503).json({ error: 'Database temporarily unavailable. Please try again.' });
      }
      throw dbError;
    }

    // Create user only if not found by either ID or email
    if (!dbUser) {
      try {
        dbUser = await prisma.user.create({
          data: {
            id: userId,
            email: user.email || '',
            name: user.name || user.email?.split('@')[0] || 'User',
            // Initialize billing fields
            subscriptionPlan: 'trial',
            subscriptionStatus: 'trialing',
            orderSyncCount: 0,
            labelCount: 0,
            trialExpiresAt: newTrialExpiry(),
            usageResetAt: newTrialExpiry(),
          },
          select: {
            id: true,
            email: true,
            name: true,
            stripeCustomerId: true,
          }
        });
      } catch (createError: any) {
        logger.error('User creation error during checkout', createError);
        if (createError.code === 'P2024') {
          return res.status(503).json({ error: 'Database temporarily unavailable. Please try again.' });
        }
        if (createError.code === 'P2002') {
          return res.status(409).json({ error: 'User account conflict. Please try again or contact support.' });
        }
        throw createError;
      }
    }

    let stripeCustomerId = (dbUser as any).stripeCustomerId as string | null;

    // Create a new Stripe customer if one doesn't exist or if there's a mode mismatch
    if (!stripeCustomerId) {
      try {
        const customer = await stripe.customers.create({
          email: dbUser.email ?? undefined,
          name: dbUser.name ?? undefined,
          metadata: {
            userId: dbUser.id,
          },
        });
        stripeCustomerId = customer.id;

        try {
          // Use a simpler approach for PgBouncer compatibility
          await prisma.$queryRaw`
            UPDATE "User"
            SET "stripeCustomerId" = ${stripeCustomerId}::text,
                "updatedAt" = NOW()
            WHERE "id" = ${dbUser.id}::text
            RETURNING "id"
          `;
        } catch (updateError: any) {
          logger.error('Stripe customer ID update failed', updateError);
          // Continue with checkout even if update fails - customer is created in Stripe
        }
      } catch (stripeError: any) {
        logger.error('Failed to create Stripe customer', stripeError);
        throw stripeError;
      }
    } else {
      // Verify the customer exists in current Stripe mode (test/live)
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch (customerError: any) {
        // Customer exists in different mode (live vs test), create a new one
        try {
          const customer = await stripe.customers.create({
            email: dbUser.email ?? undefined,
            name: dbUser.name ?? undefined,
            metadata: {
              userId: dbUser.id,
            },
          });
          stripeCustomerId = customer.id;

          try {
            // Use a simpler approach for PgBouncer compatibility
            await prisma.$queryRaw`
              UPDATE "User"
              SET "stripeCustomerId" = ${stripeCustomerId}::text,
                  "updatedAt" = NOW()
              WHERE "id" = ${dbUser.id}::text
              RETURNING "id"
            `;
          } catch (updateError: any) {
            logger.error('Stripe customer ID update failed after mode mismatch', updateError);
            // Continue with checkout even if update fails - customer is created in Stripe
          }
        } catch (stripeError: any) {
          logger.error('Failed to create Stripe customer after mode mismatch', stripeError);
          throw stripeError;
        }
      }
    }

    // Founding members: 40% off for life on the first N subscriptions (Stripe coupon max_redemptions).
    // The pricing page sends expectFounding when it showed the founding price; never charge full
    // price silently in that case.
    let discounts: { coupon: string }[] | undefined;
    if (FOUNDING_INTERVALS.includes(interval)) {
      const spots = await getFoundingSpots({ fresh: true });
      const couponId = foundingCouponId();
      if (couponId && spots.active && spots.remaining > 0) {
        discounts = [{ coupon: couponId }];
      } else if (expectFounding) {
        return res.status(409).json({ error: 'Founding spots are full.', reason: 'founding_full' });
      }
    }

    try {
      const checkoutSession = await stripe.checkout.sessions.create({
        // Stripe allows either a fixed discount or the promotion-code field: founding members get the
        // coupon; everyone else can enter a code (community / partner codes, docs/gtm/social).
        ...(discounts ? { discounts } : { allow_promotion_codes: true }),
        // Consent + click ids for the server-side `purchase` event sent by the webhook.
        metadata: { ...contextToMetadata(contextFromRequest(req)), plan, interval },
        payment_method_types: ['card'],
        billing_address_collection: 'required',
        customer: stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }, ...moduleItems],
        mode: 'subscription',
        subscription_data: {
          // Carry over what is left of the in-app trial instead of starting a new one.
          // Stripe needs trial_end at least 48h ahead (TRIAL_CARRY_MS = 49h), so a nearly-spent trial bills now.
          ...(stripeTrialEnd(dbUser.trialExpiresAt) ? { trial_end: stripeTrialEnd(dbUser.trialExpiresAt) } : {}),
          metadata: {
            userId: dbUser.id,
            plan: plan,
            interval: interval,
          }
        },
        success_url: checkoutSuccessUrl(req.headers.origin),
        cancel_url: checkoutCancelUrl(req.headers.origin),
      });

      res.status(200).json({ sessionId: checkoutSession.id, url: checkoutSession.url });
    } catch (checkoutError: any) {
      logger.error('Failed to create checkout session', checkoutError);
      throw checkoutError;
    }
  } catch (error: any) {
    logger.error('Stripe checkout error', error);

    // Better error handling based on error type
    if (error.code === 'P2024') {
      return res.status(503).json({ error: 'Database connection timeout. Please try again.' });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'User account conflict. Please try again or contact support.' });
    }

    if (error.type === 'StripeCardError' || error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ error: `Stripe error: ${error.message}` });
    }

    res.status(500).json({ error: 'Internal Server Error' });
  }
}

function stripeTrialEnd(trialExpiresAt: Date | null | undefined): number | undefined {
  if (!trialExpiresAt) return undefined;
  const end = new Date(trialExpiresAt).getTime();
  return end - Date.now() > TRIAL_CARRY_MS ? Math.floor(end / 1000) : undefined;
}
