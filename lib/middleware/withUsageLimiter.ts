import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../prisma';
import { getAuthUser } from '../auth';
import { logger } from '../logger';
import { User } from '@prisma/client';
import { notify, resolveByPrefix, invalidateResolveMemo, notificationKeys, NOTIFICATION_LINKS } from '../notifications';
import { getPlanLimits, checkPlanLimit, isYearlyPlan } from '../billing/planLimits';
import { loadAccountModules } from '../billing/modules';

interface UserWithSubscription extends User {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  orderSyncCount: number;
  labelCount: number;
  trialExpiresAt: Date | null;
  usageResetAt: Date | null;
}

// Plan limits and the allow/deny rules live in lib/billing/planLimits.ts (shared with the UI meters).

type LimitType = 'orderSync' | 'label';
/** Mirrors LimitReason in lib/http/limitInterceptor.ts. */
type LimitReason = 'trial' | 'noSubscription' | 'planLimit' | 'invalidPlan';

interface UsageCheck {
  allowed: boolean;
  error?: string;
  reason?: LimitReason;
  used?: number;
  limit?: number;
  plan?: string;
  /** Usage period id for notification dedupe ('trial' or the reset date). */
  period?: string;
}

const NEAR_LIMIT_RATIO = 0.8;
const USAGE_RESOLVE_MEMO_MS = 10 * 60 * 1000;

const checkUsage = async (userId: string, limitType: LimitType): Promise<UsageCheck> => {
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
    // Yearly packages (pricing v2) count orders / labels per year; everything else per 30 days.
    const nextReset = new Date(Date.now() + (isYearlyPlan(user.subscriptionPlan) ? 365 : 30) * 24 * 60 * 60 * 1000);
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
    // New period: earlier near-limit / limit-reached notifications are stale.
    void resolveByPrefix(userId, 'usage:');
  }

  const modules = await loadAccountModules(userId, now);
  const decision = getPlanLimits(user.subscriptionPlan, user.subscriptionStatus, user.trialExpiresAt, now, modules);
  const used = limitType === 'orderSync' ? user.orderSyncCount : user.labelCount;
  const result = checkPlanLimit(decision, limitType, used);

  if (decision.state === 'invalidPlan') {
    logger.error('User has active subscription but an invalid plan is assigned', undefined, { userId, subscriptionPlan: user.subscriptionPlan });
  }

  return {
    allowed: result.allowed,
    ...(result.allowed ? {} : { error: LIMIT_ERRORS[result.reason ?? 'planLimit'] }),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(typeof result.used === 'number' ? { used: result.used } : {}),
    ...(typeof result.limit === 'number' ? { limit: result.limit } : {}),
    ...(decision.plan ? { plan: decision.plan } : {}),
    ...(decision.period === 'trial'
      ? { period: 'trial' }
      : decision.period === 'month' || decision.period === 'year'
        ? { period: user.usageResetAt ? new Date(user.usageResetAt).toISOString().slice(0, 10) : 'current' }
        : {}),
  };
};

const LIMIT_ERRORS: Record<LimitReason, string> = {
  trial: 'Trial limit reached.',
  noSubscription: 'No active subscription.',
  invalidPlan: 'Subscription plan not found or invalid. Please contact support.',
  planLimit: 'Limit reached for your plan.',
};

/**
 * Raise / clear usage notifications. Fire-and-forget: notify/resolve never
 * reject, use onlyIfNew + in-process memos so steady-state requests do not
 * touch the DB on every call.
 */
function emitUsageNotifications(userId: string, limitType: LimitType, check: UsageCheck) {
  if (!check.period || typeof check.used !== 'number' || typeof check.limit !== 'number' || check.limit <= 0) return;
  const nearKey = notificationKeys.usage(`${limitType}:near`, check.period);
  const reachedKey = notificationKeys.usage(`${limitType}:reached`, check.period);

  if (!check.allowed) {
    if (check.reason !== 'trial' && check.reason !== 'planLimit') return;
    void notify(userId, {
      type: 'usageLimitReached',
      severity: 'error',
      titleKey: 'types.usageLimitReached',
      params: { kind: limitType },
      link: NOTIFICATION_LINKS.pricing,
      dedupeKey: reachedKey,
      onlyIfNew: true,
    });
    // The "near" warning is superseded by "reached".
    void resolveByPrefix(userId, `usage:${limitType}:near:`, { memoTtlMs: USAGE_RESOLVE_MEMO_MS });
    // The next allowed request (e.g. right after an upgrade) must clear this
    // row immediately instead of waiting out the allowed-path memo.
    invalidateResolveMemo(userId, `usage:${limitType}:`);
    return;
  }

  const near = check.used / check.limit >= NEAR_LIMIT_RATIO;
  if (near) {
    void notify(userId, {
      type: 'usageNearLimit',
      severity: 'warning',
      titleKey: 'types.usageNearLimit',
      params: { kind: limitType, used: check.used, limit: check.limit },
      link: NOTIFICATION_LINKS.pricing,
      dedupeKey: nearKey,
      onlyIfNew: true,
    });
  }
  // Allowed: any "reached" row (e.g. after an upgrade) and rows from other
  // periods are stale. Memoised, so at most one query per user per 10 min.
  void resolveByPrefix(userId, `usage:${limitType}:`, {
    exceptKeys: near ? [nearKey] : [],
    memoTtlMs: USAGE_RESOLVE_MEMO_MS,
  });
}

export const withUsageLimiter = (handler, limitType: 'orderSync' | 'label') => {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const user = await getAuthUser(req, res);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const check = await checkUsage(user.id, limitType);
    emitUsageNotifications(user.id, limitType, check);
    if (!check.allowed) {
      // limitType / used / limit / plan / reason are read by
      // lib/http/limitInterceptor.ts parseLimitResponse (details kept for compatibility).
      return res.status(402).json({
        error: 'Payment Required',
        details: check.error,
        limitType,
        ...(check.reason ? { reason: check.reason } : {}),
        ...(typeof check.used === 'number' ? { used: check.used } : {}),
        ...(typeof check.limit === 'number' ? { limit: check.limit } : {}),
        ...(check.plan ? { plan: check.plan } : {}),
      });
    }

    // Increment the counter after a successful operation
    // The handler should call this function
    // `amount`: labels count 1 per call; order syncs pass the number of NEW orders imported, so the
    // meter counts orders (what pricing promises), not refresh clicks.
    res.incrementUsage = async (amount: number = 1) => {
      const n = Math.max(0, Math.floor(Number(amount) || 0));
      if (n === 0) return;
      const fieldToIncrement = limitType === 'orderSync' ? 'orderSyncCount' : 'labelCount';
      await prisma.user.update({
        where: { id: user.id },
        data: { [fieldToIncrement]: { increment: n } },
      });
    };

    return handler(req, res);
  };
};

// Extend the NextApiResponse type to include our custom function
declare module 'http' {
  interface ServerResponse {
    incrementUsage?: (amount?: number) => Promise<void>;
  }
} 