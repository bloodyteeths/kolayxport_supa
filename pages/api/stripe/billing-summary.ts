/**
 * GET /api/stripe/billing-summary
 *
 * Payment method row + "Next payment" line of Settings › Plan & billing (settings-billing-pricing §2.3 A3).
 * Kept out of `/api/billing/entitlement` so that call stays DB-only.
 *   200 { paymentMethod: { brand, last4, expMonth, expYear } | null,
 *         upcoming: { amount (major units), currency (upper), date (ISO) } | null }
 *       paymentMethod: the current subscription's default payment method, else the customer's
 *         `invoice_settings.default_payment_method`; non-card methods → null.
 *       upcoming: `invoices.createPreview` for the current subscription when it is active / trialing /
 *         past_due and not canceling at period end; a preview failure → null (the rest still returns).
 *       No Stripe customer (or a deleted one) → both null.
 *   401 { error: 'Not authenticated' }
 *   403 { error: 'shopify_free' }
 *   405 { error: 'Method not allowed' }
 *   500 { error: 'billing_summary_failed' }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import type Stripe from 'stripe';
import { getAuthUser } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import {
  findCurrentSubscription,
  hasUpcomingPayment,
  isoFromUnix,
  loadStripeAccount,
  toMajor,
  toPaymentMethodDto,
  type PaymentMethodDto,
} from '@/lib/billing/stripeAccountServer';

const EMPTY = { paymentMethod: null, upcoming: null };

async function resolvePaymentMethod(pm: string | Stripe.PaymentMethod | null | undefined): Promise<PaymentMethodDto | null> {
  if (!pm) return null;
  if (typeof pm !== 'string') return toPaymentMethodDto(pm);
  return toPaymentMethodDto(await stripe.paymentMethods.retrieve(pm));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await getAuthUser(req, res);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const account = await loadStripeAccount(authUser.id);
    if (account?.shopifyFree) return res.status(403).json({ error: 'shopify_free' });
    if (!account?.customerId) return res.status(200).json(EMPTY);

    const customer = await stripe.customers.retrieve(account.customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if ((customer as Stripe.DeletedCustomer).deleted) return res.status(200).json(EMPTY);
    const liveCustomer = customer as Stripe.Customer;

    const subscription = await findCurrentSubscription(account.customerId, ['data.default_payment_method']);

    const paymentMethod =
      (await resolvePaymentMethod(subscription?.default_payment_method)) ??
      (await resolvePaymentMethod(liveCustomer.invoice_settings?.default_payment_method));

    let upcoming: { amount: number; currency: string; date: string } | null = null;
    if (subscription && hasUpcomingPayment(subscription)) {
      try {
        const preview = await stripe.invoices.createPreview({ customer: account.customerId, subscription: subscription.id });
        const date =
          isoFromUnix(preview.next_payment_attempt) ??
          isoFromUnix(subscription.items?.data?.[0]?.current_period_end) ??
          isoFromUnix(preview.period_end);
        if (date) {
          upcoming = {
            amount: toMajor(preview.amount_due, preview.currency),
            currency: (preview.currency || '').toUpperCase(),
            date,
          };
        }
      } catch (err) {
        console.warn('[billing-summary] invoice preview failed:', err instanceof Error ? err.message : String(err));
      }
    }

    return res.status(200).json({ paymentMethod, upcoming });
  } catch (error) {
    console.error('[billing-summary] failed:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'billing_summary_failed' });
  }
}
