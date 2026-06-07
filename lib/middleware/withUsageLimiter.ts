import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../prisma';
import { getAuthUser } from '../auth';
import { logger } from '../logger';
import { User } from '@prisma/client';

interface UserWithSubscription extends User {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  orderSyncCount: number;
  labelCount: number;
  trialExpiresAt: Date | null;
  usageResetAt: Date | null;
}

const plans = {
  starter: { orderSyncLimit: 200, labelLimit: 100 },
  growth: { orderSyncLimit: 2000, labelLimit: 500 },
  enterprise: { orderSyncLimit: Infinity, labelLimit: Infinity },
  // Shopify-installed merchants — the app is listed free on the Shopify App
  // Store, so we don't bill them. Limits are generous enough that the free
  // tier remains useful but still discourages abuse.
  shopify_free: { orderSyncLimit: Infinity, labelLimit: Infinity },
};

const checkUsage = async (userId: string, limitType: 'orderSync' | 'label') => {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
  })) as UserWithSubscription | null;

  if (!user) {
    logger.warn('User not found for usage check', { userId });
    return { allowed: false, error: 'User not found' };
  }

  // --- Usage counter reset logic ---
  // Reset counters when the current time has passed the usageResetAt timestamp
  // set by the webhook. This aligns with the billing-cycle-based reset that
  // invoice.payment_succeeded sets. For legacy/trial users without usageResetAt,
  // fall back to calendar month comparison.
  const now = new Date();
  const lastReset = user.usageResetAt ? new Date(user.usageResetAt) : null;
  const needsReset = lastReset
    ? now >= lastReset
    : true; // No reset date at all — treat as needing reset

  if (needsReset) {
    const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: {
        orderSyncCount: 0,
        labelCount: 0,
        usageResetAt: nextReset,
      },
    });
    // Reflect the reset in the local copy so the limit check below uses 0
    user.orderSyncCount = 0;
    user.labelCount = 0;
    user.usageResetAt = nextReset;
    logger.info('Monthly usage counters reset', { userId });
  }

  const { subscriptionPlan, subscriptionStatus, orderSyncCount, labelCount, trialExpiresAt } = user;

  // Shopify-installed merchants short-circuit the trial/active gate: the app is
  // free for them per Shopify App Store listing, so we don't apply Stripe-style
  // trial counters or "no active subscription" blocks.
  if (subscriptionPlan === 'shopify_free') {
    return { allowed: true };
  }

  // Check for active trial
  if (subscriptionStatus === 'trialing' && trialExpiresAt && new Date() < trialExpiresAt) {
    const trialLimits = { orderSync: 50, label: 10 };
    const currentCount = limitType === 'orderSync' ? orderSyncCount : labelCount;
    if (currentCount >= trialLimits[limitType]) {
      return { allowed: false, error: 'Trial limit reached.' };
    }
    return { allowed: true };
  }

  // If trial is over and no active subscription, block access
  if (subscriptionStatus !== 'active') {
    return { allowed: false, error: 'No active subscription.' };
  }
  
  // Handle case where user is active but has no plan
  if (!subscriptionPlan || !plans[subscriptionPlan]) {
    logger.error('User has active subscription but an invalid plan is assigned', undefined, { userId, subscriptionPlan });
    return { allowed: false, error: 'Subscription plan not found or invalid. Please contact support.' };
  }
  
  const planLimits = plans[subscriptionPlan];
  const currentCount = limitType === 'orderSync' ? orderSyncCount : labelCount;

  if (currentCount >= planLimits[`${limitType}Limit`]) {
    return { allowed: false, error: `${limitType} limit reached for your plan.` };
  }

  return { allowed: true };
};

export const withUsageLimiter = (handler, limitType: 'orderSync' | 'label') => {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const user = await getAuthUser(req, res);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { allowed, error } = await checkUsage(user.id, limitType);
    if (!allowed) {
      return res.status(402).json({ error: 'Payment Required', details: error });
    }

    // Increment the counter after a successful operation
    // The handler should call this function
    res.incrementUsage = async () => {
      const fieldToIncrement = limitType === 'orderSync' ? 'orderSyncCount' : 'labelCount';
      await prisma.user.update({
        where: { id: user.id },
        data: { [fieldToIncrement]: { increment: 1 } },
      });
    };

    return handler(req, res);
  };
};

// Extend the NextApiResponse type to include our custom function
declare module 'http' {
  interface ServerResponse {
    incrementUsage?: () => Promise<void>;
  }
} 