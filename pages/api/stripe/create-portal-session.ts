/**
 * POST /api/stripe/create-portal-session   body { flow?: 'payment_method_update'|'subscription_update'|'subscription_cancel' }
 *
 * Opens the Stripe customer portal, on the exact screen when `flow` is given (settings-billing-pricing §2.3 A2).
 *   200 { url: string, flow: <flow>|null }   `flow` = the flow actually applied. It is null when no flow
 *       was asked, when the account has no current subscription (subscription_* flows), when the
 *       subscription already cancels at period end (subscription_cancel), or when Stripe rejected the
 *       flow (e.g. disabled in the portal configuration): the portal home opens instead of failing.
 *       Every flow returns to `/ayarlar?tab=billing` after completion.
 *   400 { error: 'invalid_flow' }                                  unknown `flow` value
 *   400 { error: 'No billing account found', code: 'no_customer' } no Stripe customer
 *   401 { error: 'Not authenticated' }
 *   403 { error: 'Shopify-installed accounts use the free Shopify tier.', code: 'shopify_free' }
 *   405 { error: 'Method not allowed' }
 *   500 { error: 'Failed to create billing portal session', code: 'portal_session_failed' }  no raw Stripe text
 * The 400/403/500 `error` strings are the pre-A2 ones (the legacy Billing panel toasts them); new code reads
 * the status / `code`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import type Stripe from 'stripe';
import { getAuthUser } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import {
  appBaseUrl,
  buildPortalFlowData,
  findCurrentSubscription,
  loadStripeAccount,
  parsePortalFlow,
  type PortalFlowType,
} from '@/lib/billing/stripeAccountServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await getAuthUser(req, res);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const flow = parsePortalFlow(req.body);
  if (flow === false) return res.status(400).json({ error: 'invalid_flow' });

  try {
    const account = await loadStripeAccount(authUser.id);

    // Free Shopify-tier accounts have no Stripe billing to manage (App Store rule 1.2.1).
    if (account?.shopifyFree) {
      return res.status(403).json({ error: 'Shopify-installed accounts use the free Shopify tier.', code: 'shopify_free' });
    }
    if (!account?.customerId) {
      return res.status(400).json({ error: 'No billing account found', code: 'no_customer' });
    }

    const returnUrl = `${appBaseUrl(req.headers.origin)}/ayarlar?tab=billing`;
    let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | null = null;
    if (flow) {
      const subscription = flow === 'payment_method_update' ? null : await findCurrentSubscription(account.customerId);
      flowData = buildPortalFlowData(flow, subscription, returnUrl);
    }

    let applied: PortalFlowType | null = flowData ? (flow as PortalFlowType) : null;
    let session: Stripe.BillingPortal.Session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: account.customerId,
        return_url: returnUrl,
        ...(flowData ? { flow_data: flowData } : {}),
      });
    } catch (err) {
      if (!flowData) throw err;
      // The flow is not available for this customer/configuration: open the portal home instead.
      console.warn('[create-portal-session] flow rejected, opening portal home:', flow, err instanceof Error ? err.message : String(err));
      session = await stripe.billingPortal.sessions.create({ customer: account.customerId, return_url: returnUrl });
      applied = null;
    }

    return res.status(200).json({ url: session.url, flow: applied });
  } catch (error) {
    console.error('[create-portal-session] failed:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'Failed to create billing portal session', code: 'portal_session_failed' });
  }
}
