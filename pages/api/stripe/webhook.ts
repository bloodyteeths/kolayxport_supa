import { buffer } from 'micro';
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import prisma from '../../../lib/prisma';
import { STRIPE_PRICES, type PlanKey, type IntervalKey } from '../../../lib/stripePrices';

/** Reverse-lookup: given a Stripe price ID, return the plan name. */
function planFromPriceId(priceId: string): PlanKey | null {
  for (const [plan, intervals] of Object.entries(STRIPE_PRICES)) {
    for (const id of Object.values(intervals)) {
      if (id === priceId) return plan as PlanKey;
    }
  }
  return null;
}

// Disable body parsing to verify the raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

const relevantEvents = new Set([
  'checkout.session.completed',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (!sig || !webhookSecret) {
      console.error('Webhook secret not configured.');
      return res.status(400).send('Webhook secret not configured.');
    }
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: check if this event was already processed
  const existing = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  if (existing) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  if (relevantEvents.has(event.type)) {
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          const checkoutSession = event.data.object as Stripe.Checkout.Session;
          if (checkoutSession.mode === 'subscription') {
            const subscriptionId = checkoutSession.subscription as string;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);

            // Derive plan and interval from the subscription's price object
            const priceId = subscription.items.data[0]?.price?.id;
            const interval = (subscription.items.data[0]?.price?.recurring?.interval || 'month') as IntervalKey;
            const plan = priceId ? planFromPriceId(priceId) : null;

            // Calculate usage reset date based on billing interval
            const now = new Date();
            const usageResetAt = new Date(now);
            if (interval === 'month') {
              usageResetAt.setMonth(usageResetAt.getMonth() + 1);
            } else {
              usageResetAt.setFullYear(usageResetAt.getFullYear() + 1);
            }

            await prisma.user.update({
              where: { stripeCustomerId: subscription.customer as string },
              data: {
                subscriptionPlan: plan as any,
                billingInterval: interval as any,
                subscriptionStatus: subscription.status as any,
                trialExpiresAt: subscription.trial_end
                  ? new Date(subscription.trial_end * 1000)
                  : null,
                usageResetAt: subscription.status === 'active' ? usageResetAt : null,
              },
            });
          }
          break;
        case 'invoice.payment_succeeded':
          const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription };
          // For subscription renewals, reset usage counters and update next reset date
          if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
            const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);

            // Derive interval from the subscription's price object
            const renewalInterval = subscription.items.data[0]?.price?.recurring?.interval || 'month';

            // Calculate next usage reset date
            const now = new Date();
            const nextResetDate = new Date(now);
            if (renewalInterval === 'month') {
              nextResetDate.setMonth(nextResetDate.getMonth() + 1);
            } else {
              nextResetDate.setFullYear(nextResetDate.getFullYear() + 1);
            }

            await prisma.user.update({
              where: { stripeCustomerId: subscription.customer as string },
              data: {
                orderSyncCount: 0,
                labelCount: 0,
                usageResetAt: nextResetDate,
                subscriptionStatus: 'active' as any,
              },
            });
          }
          break;
        case 'invoice.payment_failed':
          const failedInvoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription };
          if (failedInvoice.subscription) {
            const failedSubId = typeof failedInvoice.subscription === 'string'
              ? failedInvoice.subscription
              : failedInvoice.subscription.id;
            const failedSub = await stripe.subscriptions.retrieve(failedSubId);
            const customerId = failedSub.customer as string;

            console.error(
              `Payment failed for subscription ${failedSubId}, customer ${customerId}`
            );

            await prisma.user.update({
              where: { stripeCustomerId: customerId },
              data: { subscriptionStatus: 'past_due' as any },
            });
          }
          break;
        case 'customer.subscription.updated':
          const updatedSubscription = event.data.object as Stripe.Subscription;
          const updateData: any = {
            subscriptionStatus: updatedSubscription.status,
          };

          // If subscription is canceled, clear the plan
          if (updatedSubscription.status === 'canceled') {
            updateData.subscriptionPlan = null;
            updateData.billingInterval = null;
            updateData.usageResetAt = null;
          }

          await prisma.user.update({
            where: { stripeCustomerId: updatedSubscription.customer as string },
            data: updateData,
          });
          break;

        case 'customer.subscription.deleted':
          const deletedSubscription = event.data.object as Stripe.Subscription;
          await prisma.user.update({
            where: { stripeCustomerId: deletedSubscription.customer as string },
            data: {
              subscriptionStatus: 'canceled' as any,
              subscriptionPlan: null,
              billingInterval: null,
              usageResetAt: null,
            },
          });
          break;
        default:
          throw new Error('Unhandled relevant event!');
      }
    } catch (error) {
      console.error('Webhook handler failed:', error);
      // Do NOT record event — Stripe will retry and we can process again
      return res.status(500).send('Webhook handler failed. View logs.');
    }
  }

  // Record event AFTER successful processing (idempotency).
  // Catch P2002 unique constraint in case a concurrent request already recorded it.
  try {
    await prisma.webhookEvent.create({ data: { id: event.id } });
  } catch (err: any) {
    if (err.code !== 'P2002') {
      console.error('Failed to record webhook event:', err);
    }
    // P2002 = duplicate, safe to ignore — event was already processed by a concurrent request
  }

  res.status(200).json({ received: true });
};

export default handler; 