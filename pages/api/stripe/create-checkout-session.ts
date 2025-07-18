import { STRIPE_PRICES } from '@/lib/stripePrices';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Get the authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Extract the access token
  const accessToken = authHeader.replace('Bearer ', '');
  
  // Verify the token with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  console.log('API auth check:', { user: user?.email, error: error?.message });
  
  if (error || !user) {
    console.log('API: Unauthorized user');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = user.id;
  console.log('API: Creating checkout for user:', user.email, 'plan:', req.body.plan);

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
      console.error('Missing price ID for plan:', plan, 'interval:', interval);
      return res.status(400).json({ error: 'Price configuration missing for selected plan' });
    }

    console.log('Using price ID:', priceId);

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
        console.log('User not found by ID, searching by email:', user.email);
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
          console.log('Found user by email with different ID, updating:', { oldId: dbUser.id, newId: userId });
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
      console.error('Database query error:', dbError);
      if (dbError.code === 'P2024') {
        return res.status(503).json({ error: 'Database temporarily unavailable. Please try again.' });
      }
      throw dbError;
    }

    // Create user only if not found by either ID or email
    if (!dbUser) {
      try {
        console.log('Creating new user for:', user.email);
        dbUser = await prisma.user.create({
          data: {
            id: userId,
            email: user.email || '',
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
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
        console.error('User creation error:', createError);
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
      console.log('Creating new Stripe customer for user:', dbUser.email);
      try {
        const customer = await stripe.customers.create({
          email: dbUser.email ?? undefined,
          name: dbUser.name ?? undefined,
          metadata: {
            userId: dbUser.id,
          },
        });
        stripeCustomerId = customer.id;
        console.log('Stripe customer created successfully:', stripeCustomerId);

        try {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { stripeCustomerId } as any,
          });
          console.log('Database updated with new Stripe customer ID');
        } catch (updateError: any) {
          console.error('Stripe customer ID update error:', updateError);
          // Continue with checkout even if update fails - customer is created in Stripe
        }
      } catch (stripeError: any) {
        console.error('Failed to create Stripe customer:', stripeError);
        throw stripeError;
      }
    } else {
      // Verify the customer exists in current Stripe mode (test/live)
      console.log('Checking existing Stripe customer:', stripeCustomerId);
      try {
        await stripe.customers.retrieve(stripeCustomerId);
        console.log('Existing Stripe customer found:', stripeCustomerId);
      } catch (customerError: any) {
        console.log('Stripe customer not found in current mode, creating new one:', customerError.message);
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
          console.log('New Stripe customer created for mode mismatch:', stripeCustomerId);

          try {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { stripeCustomerId } as any,
            });
            console.log('Database updated with new Stripe customer ID after mode mismatch');
          } catch (updateError: any) {
            console.error('Stripe customer ID update error:', updateError);
            // Continue with checkout even if update fails - customer is created in Stripe
          }
        } catch (stripeError: any) {
          console.error('Failed to create new Stripe customer:', stripeError);
          throw stripeError;
        }
      }
    }

    console.log('Creating checkout session for customer:', stripeCustomerId);
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
        success_url: `${req.headers.origin || 'http://localhost:3000'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'http://localhost:3000'}/fiyatlandirma`,
      });

      console.log('Checkout session created successfully:', checkoutSession.id);
      res.status(200).json({ sessionId: checkoutSession.id });
    } catch (checkoutError: any) {
      console.error('Failed to create checkout session:', checkoutError);
      throw checkoutError;
    }
  } catch (error: any) {
    console.error('Stripe Checkout Error:', error);
    
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