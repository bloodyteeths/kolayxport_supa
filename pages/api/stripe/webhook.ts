import { buffer } from 'micro';
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import prisma from '../../../lib/prisma';
import { type PlanKey, type IntervalKey } from '../../../lib/stripePrices';
import { planFromPriceId as planFromPriceIdShared } from '@/lib/billing/stripeAccountServer';
import { logger } from '@/lib/logger';
import { contextFromMetadata, sendServerEvent } from '@/lib/tracking/server';
import { logBillingEvent, logSecurityEvent } from '@/lib/admin/events';
import { fulfilStripeCreditSession } from '@/lib/billing/aiCreditsPurchase';
import { attributePromoCheckout, attributePromoInvoice, bountyFromStripeInvoice, bountyFromStripeRefund } from '@/lib/partners/stripeBounty';
import { subscriptionIdOfInvoice, syncSubscriptionFromStripe } from '@/lib/billing/stripeV2';
import { linkPaymentLinkCustomer, notifyPaymentLinkSale, type LinkResult } from '@/lib/billing/paymentLinks';
import { dedupeAction } from '@/lib/billing/webhookDedupe';

/**
 * Upsert a WebhookEvent row with provider/eventType/status. Safe to call multiple times:
 * the unique `id` PK + Stripe's deterministic event id make this idempotent.
 */
async function recordWebhookEvent(args: {
  id: string;
  provider: 'stripe';
  eventType?: string;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  errorMessage?: string;
  userId?: string | null;
}) {
  try {
    await (prisma as any).webhookEvent.upsert({
      where: { id: args.id },
      update: {
        provider: args.provider,
        eventType: args.eventType ?? null,
        status: args.status,
        errorMessage: args.errorMessage?.slice(0, 200) ?? null,
        userId: args.userId ?? null,
        ...(args.status === 'received' ? { processingStartedAt: new Date() } : {}),
      },
      create: {
        id: args.id,
        provider: args.provider,
        eventType: args.eventType ?? null,
        status: args.status,
        errorMessage: args.errorMessage?.slice(0, 200) ?? null,
        userId: args.userId ?? null,
        ...(args.status === 'received' ? { processingStartedAt: new Date() } : {}),
      },
    });
  } catch (err) {
    // Audit-write failure must never break the webhook itself.
    logBillingEvent('warn', {
      message: 'WebhookEvent upsert failed',
      operation: 'stripe.webhook_event_write_failed',
      details: { id: args.id, status: args.status },
    });
  }
}

/** Reverse-lookup: given a Stripe price ID, return the plan name (base, legacy and per-currency ids). */
function planFromPriceId(priceId: string): PlanKey | null {
  return planFromPriceIdShared(priceId)?.plan ?? null;
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
  // Partner bounties only (lib/partners): a refund voids or claws back a bounty.
  'charge.refunded',
]);

/**
 * Defensive lookup: given a Stripe customer id, find the matching user.
 *
 * Why this exists: signature verification (constructEvent) proves Stripe sent the event,
 * but it does not prove the event's `customer` field corresponds to a user we own. A
 * misrouted webhook (e.g. test-mode event leaked to live env, or a Stripe account that
 * also hosts other apps' webhooks) could otherwise mutate the wrong row. By looking up
 * first and asserting the round-trip, we fail closed and log a redacted notice instead.
 *
 * Returns null when no matching user exists. Logs (via the redacting logger) so we can
 * trace stray events without printing customer ids in the wrong shape.
 */
async function findUserForStripeCustomer(
  customerId: string | null | undefined,
  eventId: string,
  eventType: string,
) {
  if (!customerId || typeof customerId !== 'string') {
    logger.warn('Stripe webhook: missing customer id on event', {
      eventId,
      eventType,
    });
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!user) {
    logger.warn('Stripe webhook: no user for customer', {
      eventId,
      eventType,
      // Mask the customer id — keep enough to grep, lose the full value.
      customerIdSuffix: customerId.slice(-4),
    });
    return null;
  }
  if (user.stripeCustomerId !== customerId) {
    // Defense-in-depth — should be impossible given the unique-key lookup.
    logger.error('Stripe webhook: customer id mismatch after lookup', undefined, {
      eventId,
      eventType,
      customerIdSuffix: customerId.slice(-4),
    });
    return null;
  }
  return user;
}

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
      logger.error('Stripe webhook: secret not configured', undefined, {});
      return res.status(400).send('Webhook secret not configured.');
    }
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err: any) {
    logSecurityEvent('warn', {
      message: 'Stripe webhook signature verification failed',
      operation: 'stripe.signature_failed',
      details: { reason: err?.message?.slice(0, 200) },
    });
    return res.status(400).send(`Webhook Error: signature verification failed`);
  }

  // Idempotency (lib/billing/webhookDedupe.ts): finished events are duplicates; failed or stale ones run again,
  // so Stripe's retry recovers a handler that threw; one still running gets 409 and Stripe retries later.
  const existing = await prisma.webhookEvent.findUnique({ where: { id: event.id }, select: { status: true, createdAt: true, processingStartedAt: true } });
  const action = dedupeAction(existing);
  if (action === 'duplicate') {
    return res.status(200).json({ received: true, duplicate: true });
  }
  if (action === 'in_flight') {
    return res.status(409).json({ received: true, inFlight: true });
  }

  // Record receipt before processing so an inflight failure still leaves a trace.
  await recordWebhookEvent({
    id: event.id,
    provider: 'stripe',
    eventType: event.type,
    status: 'received',
  });

  if (relevantEvents.has(event.type)) {
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const checkoutSession = event.data.object as Stripe.Checkout.Session;
          // Payment-link sale (1:1 sales): attach the new Stripe customer to the buyer's account by verified email
          // first, so the plan activation below finds the user; then alert. Never fatal.
          if (checkoutSession.payment_link) {
            let link: LinkResult = { status: 'no_match' };
            try {
              link = await linkPaymentLinkCustomer(checkoutSession);
            } catch (e) {
              logger.warn('Payment link customer match failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
            }
            await notifyPaymentLinkSale(checkoutSession, link);
          }
          if (checkoutSession.mode === 'payment' && checkoutSession.metadata?.kind === 'ai_credits') {
            // AI kredisi pack (lib/billing/aiCreditsPurchase): added once per session (the return page may be first).
            const r = await fulfilStripeCreditSession(checkoutSession);
            logBillingEvent('info', { message: 'AI credit pack paid', operation: 'stripe.ai_credits', details: { eventId: event.id, ok: r.ok, added: r.added, credits: r.credits } });
            break;
          }
          if (checkoutSession.mode === 'subscription') {
            const subscriptionId = checkoutSession.subscription as string;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);

            const customerId = subscription.customer as string;
            const user = await findUserForStripeCustomer(customerId, event.id, event.type);
            if (!user) break;

            // Defense-in-depth: assert subscription.customer matches the user's id.
            if (user.stripeCustomerId !== customerId) {
              logBillingEvent('warn', {
                message: 'Stripe webhook: subscription.customer mismatch, skipping',
                operation: 'stripe.customer_mismatch',
                details: { eventId: event.id, eventType: event.type },
              });
              break;
            }

            const priceId = subscription.items.data[0]?.price?.id;
            const interval = (subscription.items.data[0]?.price?.recurring?.interval || 'month') as IntervalKey;
            const plan = priceId ? planFromPriceId(priceId) : null;

            const now = new Date();
            const usageResetAt = new Date(now);
            if (interval === 'month') {
              usageResetAt.setMonth(usageResetAt.getMonth() + 1);
            } else {
              usageResetAt.setFullYear(usageResetAt.getFullYear() + 1);
            }

            await prisma.user.update({
              where: { id: user.id },
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

            // Funnel: server copy of `purchase` (consent + click ids captured at checkout, lib/tracking/server.ts).
            // A subscription with a card on file is the conversion we optimise ads for, even when the remaining
            // in-app trial carries over (amount_total 0): report the plan's price as the value.
            const item = subscription.items.data[0]?.price;
            const listValue = (item?.unit_amount ?? 0) / 100;
            await sendServerEvent({
              name: 'purchase',
              eventId: checkoutSession.id,
              email: checkoutSession.customer_details?.email ?? null,
              userId: user.id,
              value: (checkoutSession.amount_total ?? 0) > 0 ? (checkoutSession.amount_total ?? 0) / 100 : listValue,
              currency: checkoutSession.currency || item?.currency || undefined,
              params: { plan: String(plan || ''), interval: String(interval) },
            }, contextFromMetadata(checkoutSession.metadata as Record<string, string>));

            // Pricing v2 module items + v2 plan keys (lib/billing/stripeV2.ts). Errors are logged, never fatal.
            try {
              await syncSubscriptionFromStripe(user.id, subscription);
            } catch (e) {
              logger.warn('Subscription sync failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
            }

            // Partner promo code typed at checkout (docs/gtm/referral-spec.md §2.4). Never affects billing.
            try {
              await attributePromoCheckout(checkoutSession, user.id);
            } catch (e) {
              logger.warn('Partner promo attribution failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
            }
          }
          break;
        }
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription };
          if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
            const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const customerId = subscription.customer as string;

            const user = await findUserForStripeCustomer(customerId, event.id, event.type);
            if (!user) break;
            if (user.stripeCustomerId !== customerId) {
              logBillingEvent('warn', {
                message: 'Stripe webhook: subscription.customer mismatch, skipping',
                operation: 'stripe.customer_mismatch',
                details: { eventId: event.id, eventType: event.type },
              });
              break;
            }

            const renewalInterval = subscription.items.data[0]?.price?.recurring?.interval || 'month';
            const now = new Date();
            const nextResetDate = new Date(now);
            if (renewalInterval === 'month') {
              nextResetDate.setMonth(nextResetDate.getMonth() + 1);
            } else {
              nextResetDate.setFullYear(nextResetDate.getFullYear() + 1);
            }

            await prisma.user.update({
              where: { id: user.id },
              data: {
                orderSyncCount: 0,
                labelCount: 0,
                usageResetAt: nextResetDate,
                subscriptionStatus: 'active' as any,
              },
            });
          }

          // Partner bounty (lib/partners/bounty.ts): every paid plan invoice of a referred customer. Never affects billing.
          try {
            const bountyUser = await findUserForStripeCustomer(
              typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
              event.id,
              event.type,
            );
            if (bountyUser) {
              // The live endpoint gets no checkout.session.completed today, so the first paid invoice is where a new
              // subscription's plan + modules are applied (lib/billing/stripeV2.ts).
              const subId = subscriptionIdOfInvoice(invoice);
              if (subId) {
                try {
                  await syncSubscriptionFromStripe(bountyUser.id, await stripe.subscriptions.retrieve(subId));
                } catch (e) {
                  logger.warn('Subscription sync failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
                }
              }
              await attributePromoInvoice(invoice, bountyUser.id);
              await bountyFromStripeInvoice(invoice, bountyUser.id);
            }
          } catch (e) {
            logger.warn('Partner bounty failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }
        case 'invoice.payment_failed': {
          const failedInvoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription };
          if (failedInvoice.subscription) {
            const failedSubId = typeof failedInvoice.subscription === 'string'
              ? failedInvoice.subscription
              : failedInvoice.subscription.id;
            const failedSub = await stripe.subscriptions.retrieve(failedSubId);
            const customerId = failedSub.customer as string;

            const user = await findUserForStripeCustomer(customerId, event.id, event.type);
            if (!user) break;
            if (user.stripeCustomerId !== customerId) {
              logBillingEvent('warn', {
                message: 'Stripe webhook: subscription.customer mismatch, skipping',
                operation: 'stripe.customer_mismatch',
                details: { eventId: event.id, eventType: event.type },
              });
              break;
            }

            logger.warn('Stripe payment failed', {
              eventId: event.id,
              eventType: event.type,
              userId: user.id,
              subscriptionId: failedSubId.slice(-6),
            });

            await prisma.user.update({
              where: { id: user.id },
              data: { subscriptionStatus: 'past_due' as any },
            });
          }
          break;
        }
        case 'charge.refunded': {
          // Partner bounties only: void / reduce / reverse (lib/partners/bounty.ts). Never affects billing.
          try {
            await bountyFromStripeRefund(event.data.object as Stripe.Charge);
          } catch (e) {
            logger.warn('Partner bounty refund failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }
        case 'customer.subscription.updated': {
          const updatedSubscription = event.data.object as Stripe.Subscription;
          const customerId = updatedSubscription.customer as string;

          const user = await findUserForStripeCustomer(customerId, event.id, event.type);
          if (!user) break;
          if (user.stripeCustomerId !== customerId) {
            logger.warn('Stripe webhook: subscription.customer mismatch, skipping', {
              eventId: event.id,
              eventType: event.type,
            });
            break;
          }

          const updateData: any = {
            subscriptionStatus: updatedSubscription.status,
          };
          if (updatedSubscription.status === 'canceled') {
            updateData.subscriptionPlan = null;
            updateData.billingInterval = null;
            updateData.usageResetAt = null;
          }

          await prisma.user.update({
            where: { id: user.id },
            data: updateData,
          });
          // Plan changes in the portal and module add / remove (lib/billing/stripeV2.ts). Never fatal.
          if (updatedSubscription.status !== 'canceled') {
            try {
              await syncSubscriptionFromStripe(user.id, updatedSubscription);
            } catch (e) {
              logger.warn('Subscription sync failed', { eventId: event.id, error: e instanceof Error ? e.message : String(e) });
            }
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const deletedSubscription = event.data.object as Stripe.Subscription;
          const customerId = deletedSubscription.customer as string;

          const user = await findUserForStripeCustomer(customerId, event.id, event.type);
          if (!user) break;
          if (user.stripeCustomerId !== customerId) {
            logger.warn('Stripe webhook: subscription.customer mismatch, skipping', {
              eventId: event.id,
              eventType: event.type,
            });
            break;
          }

          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'canceled' as any,
              subscriptionPlan: null,
              billingInterval: null,
              usageResetAt: null,
            },
          });
          break;
        }
        default:
          throw new Error('Unhandled relevant event!');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logBillingEvent('error', {
        message: 'Stripe webhook handler failed',
        operation: 'stripe.handler_failed',
        details: { eventId: event.id, eventType: event.type },
        error: error instanceof Error ? error : new Error(msg),
      });
      await recordWebhookEvent({
        id: event.id,
        provider: 'stripe',
        eventType: event.type,
        status: 'failed',
        errorMessage: msg,
      });
      return res.status(500).send('Webhook handler failed. View logs.');
    }
  }

  // Mark processed (or ignored, if not in relevantEvents).
  await recordWebhookEvent({
    id: event.id,
    provider: 'stripe',
    eventType: event.type,
    status: relevantEvents.has(event.type) ? 'processed' : 'ignored',
  });

  res.status(200).json({ received: true });
};

export default handler;
