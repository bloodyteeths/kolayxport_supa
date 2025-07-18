import { buffer } from 'micro';
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import prisma from '../../../lib/prisma';

// Disable body parsing to verify the raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

const relevantEvents = new Set([
  'checkout.session.completed',
  'invoice.payment_succeeded',
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

  if (relevantEvents.has(event.type)) {
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          const checkoutSession = event.data.object as Stripe.Checkout.Session;
          if (checkoutSession.mode === 'subscription') {
            const subscriptionId = checkoutSession.subscription as string;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            
            // Calculate usage reset date based on billing interval
            const now = new Date();
            const usageResetAt = new Date(now);
            if (subscription.metadata.interval === 'month') {
              usageResetAt.setMonth(usageResetAt.getMonth() + 1);
            } else {
              usageResetAt.setFullYear(usageResetAt.getFullYear() + 1);
            }
            
            await prisma.user.update({
              where: { stripeCustomerId: subscription.customer as string },
              data: {
                subscriptionPlan: subscription.metadata.plan as any,
                billingInterval: subscription.metadata.interval as any,
                subscriptionStatus: subscription.status as any,
                trialExpiresAt: subscription.status === 'trialing'
                  ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
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
            
            // Calculate next usage reset date
            const now = new Date();
            const nextResetDate = new Date(now);
            if (subscription.metadata.interval === 'month') {
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
      return res.status(400).send('Webhook handler failed. View logs.');
    }
  }

  res.status(200).json({ received: true });
};

export default handler; 