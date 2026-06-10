import { STRIPE_PRICES } from '@/lib/stripePrices';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

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

  const { plan, interval } = req.body as { plan: 'starter' | 'growth' | 'kurumsal'; interval: 'month' | 'year' };

  if (plan === 'kurumsal') {
    return res.status(400).json({ error: 'Kurumsal plan handled manually. Please contact sales.' });
  }

  if (!plan || !interval || !STRIPE_PRICES[plan as 'starter' | 'growth'] || !STRIPE_PRICES[plan as 'starter' | 'growth'][interval]) {
    return res.status(400).json({ error: 'Invalid plan or interval.' });
  }

  try {
    // Validate price configuration first
    const priceId = STRIPE_PRICES[plan as 'starter' | 'growth'][interval];
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
            usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
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

    try {
      const checkoutSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        billing_address_collection: 'required',
        customer: stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        subscription_data: {
          trial_period_days: 30,
          metadata: {
            userId: dbUser.id,
            plan: plan,
            interval: interval,
          }
        },
        success_url: `${req.headers.origin || 'http://localhost:3000'}/app?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'http://localhost:3000'}/fiyatlandirma`,
      });

      res.status(200).json({ sessionId: checkoutSession.id });
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
