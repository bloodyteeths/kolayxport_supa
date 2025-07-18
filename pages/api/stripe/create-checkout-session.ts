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
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = user.id;

  const { plan, interval } = req.body as { plan: 'starter' | 'growth' | 'kurumsal'; interval: 'month' | 'year' };

  if (plan === 'kurumsal') {
    return res.status(400).json({ error: 'Kurumsal plan handled manually. Please contact sales.' });
  }

  if (!plan || !interval || !STRIPE_PRICES[plan as 'starter' | 'growth'] || !STRIPE_PRICES[plan as 'starter' | 'growth'][interval]) {
    return res.status(400).json({ error: 'Invalid plan or interval.' });
  }

  try {
    // Find or create user in database
    let dbUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!dbUser) {
      // Create user in database if they don't exist
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
      });
    }

    let stripeCustomerId = (dbUser as any).stripeCustomerId as string | null;

    // Create a new Stripe customer if one doesn't exist
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: dbUser.email ?? undefined,
        name: dbUser.name ?? undefined,
        metadata: {
          userId: dbUser.id,
        },
      });
      stripeCustomerId = customer.id;

      await prisma.user.update({
        where: { id: dbUser.id },
        data: { stripeCustomerId } as any,
      });
    }

    const priceId = STRIPE_PRICES[plan as 'starter' | 'growth'][interval];
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

    res.status(200).json({ sessionId: checkoutSession.id });
  } catch (error) {
    console.error('Stripe Checkout Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
} 