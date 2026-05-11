import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import {
  createShopifySubscription,
  getActiveShopifySubscription,
  cancelShopifySubscription,
  shopifyPlanToInternal,
  SHOPIFY_PLANS,
} from '../../../lib/shopifyBilling';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const action = req.query.action as string;

  // ================================================================
  // GET /api/shopify/billing?action=status
  // Check current subscription status
  // ================================================================
  if (action === 'status' && req.method === 'GET') {
    try {
      const shop = await prisma.shopifyShop.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!shop) {
        return res.status(200).json({ hasSubscription: false, reason: 'no_shop' });
      }

      const subscription = await getActiveShopifySubscription(shop.shopDomain, shop.accessToken);

      if (!subscription) {
        return res.status(200).json({ hasSubscription: false, reason: 'no_active_subscription' });
      }

      return res.status(200).json({
        hasSubscription: true,
        subscription: {
          id: subscription.id,
          name: subscription.name,
          status: subscription.status,
          trialDays: subscription.trialDays,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
      });
    } catch (error: any) {
      logger.error('Shopify billing status check failed', error, { userId: user.id });
      return res.status(500).json({ error: 'Failed to check billing status' });
    }
  }

  // ================================================================
  // POST /api/shopify/billing?action=subscribe
  // Create a new subscription
  // ================================================================
  if (action === 'subscribe' && req.method === 'POST') {
    const { planKey } = req.body;
    if (!planKey || !SHOPIFY_PLANS[planKey]) {
      return res.status(400).json({ error: 'Invalid plan', availablePlans: Object.keys(SHOPIFY_PLANS) });
    }

    try {
      const shop = await prisma.shopifyShop.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!shop) {
        return res.status(400).json({ error: 'No active Shopify store connected' });
      }

      const isTest = process.env.NODE_ENV !== 'production';
      const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'https://kolayxport.com';
      const returnUrl = `${baseUrl}/api/shopify/billing?action=confirm&shop=${encodeURIComponent(shop.shopDomain)}`;

      const result = await createShopifySubscription(
        shop.shopDomain,
        shop.accessToken,
        planKey,
        returnUrl,
        isTest,
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { shopifySubscriptionId: result.subscriptionId },
      });

      logger.info('Shopify subscription created, redirecting to confirmation', {
        userId: user.id,
        shop: shop.shopDomain,
        planKey,
        subscriptionId: result.subscriptionId,
      });

      return res.status(200).json({ confirmationUrl: result.confirmationUrl });
    } catch (error: any) {
      logger.error('Shopify subscription creation failed', error, { userId: user.id });
      return res.status(500).json({ error: error.message || 'Failed to create subscription' });
    }
  }

  // ================================================================
  // GET /api/shopify/billing?action=confirm
  // Shopify redirects here after merchant approves/declines
  // ================================================================
  if (action === 'confirm' && req.method === 'GET') {
    const shopDomain = req.query.shop as string;
    const chargeId = req.query.charge_id as string;

    try {
      const shop = await prisma.shopifyShop.findFirst({
        where: { shopDomain, isActive: true },
      });

      if (!shop) {
        return res.redirect('/ayarlar?error=shopify_billing_no_shop');
      }

      const subscription = await getActiveShopifySubscription(shop.shopDomain, shop.accessToken);

      if (subscription && subscription.status === 'ACTIVE') {
        const { plan, interval } = shopifyPlanToInternal(subscription.name);

        await prisma.user.update({
          where: { id: shop.userId },
          data: {
            billingProvider: 'shopify',
            shopifySubscriptionId: subscription.id,
            subscriptionPlan: plan,
            subscriptionStatus: 'active',
            billingInterval: interval,
          },
        });

        logger.info('Shopify subscription confirmed', {
          userId: shop.userId,
          subscriptionId: subscription.id,
          plan,
        });

        return res.redirect('/ayarlar?success=shopify_billing_active');
      }

      return res.redirect('/ayarlar?error=shopify_billing_declined');
    } catch (error: any) {
      logger.error('Shopify billing confirmation failed', error, { shopDomain });
      return res.redirect('/ayarlar?error=shopify_billing_failed');
    }
  }

  // ================================================================
  // POST /api/shopify/billing?action=cancel
  // Cancel the current subscription
  // ================================================================
  if (action === 'cancel' && req.method === 'POST') {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { shopifySubscriptionId: true },
      });

      if (!dbUser?.shopifySubscriptionId) {
        return res.status(400).json({ error: 'No active Shopify subscription' });
      }

      const shop = await prisma.shopifyShop.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!shop) {
        return res.status(400).json({ error: 'No active Shopify store' });
      }

      const cancelled = await cancelShopifySubscription(
        shop.shopDomain,
        shop.accessToken,
        dbUser.shopifySubscriptionId,
      );

      if (cancelled) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'cancelled',
            shopifySubscriptionId: null,
          },
        });

        return res.status(200).json({ success: true });
      }

      return res.status(500).json({ error: 'Failed to cancel subscription' });
    } catch (error: any) {
      logger.error('Shopify subscription cancellation failed', error, { userId: user.id });
      return res.status(500).json({ error: error.message || 'Cancellation failed' });
    }
  }

  // ================================================================
  // GET /api/shopify/billing?action=plans
  // List available plans
  // ================================================================
  if (action === 'plans' && req.method === 'GET') {
    return res.status(200).json({ plans: SHOPIFY_PLANS });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
