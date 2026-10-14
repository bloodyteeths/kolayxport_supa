/**
 * Scheduled jobs contributed by W4 (order pipeline). Registered via
 * lib/scheduler/jobs.ts and run by the in-process scheduler (W1) with the
 * GitHub run-due cron as fallback. Each run is idempotent per bucket.
 *
 *  etsy-orders-incremental  15 min   keyset poll per shop (safety net for webhooks)
 *  etsy-orders-reconcile    03:10Z   90-day hash-gated reconcile per shop
 *  order-effects-drain      1 min    OrderEffect outbox drain
 *  order-dispatch-alerts    15 min   ship-by rollup notifications
 *  trendyol-orders-fast     3 min    Trendyol recent orders for users with live Trendyol stock
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify, resolveNotification, notificationKeys, NOTIFICATION_LINKS } from '@/lib/notifications';
import type { ScheduledJob } from '@/lib/scheduler/types';

const HOUR = 60 * 60 * 1000;
export const POLL_SKIP_IF_POLLED_WITHIN_MS = 60 * 60 * 1000;
export const WEBHOOK_HEALTHY_WITHIN_MS = 6 * HOUR;
export const POLL_FAILURES_BEFORE_ALERT = 3;

/** Pure: should the incremental job poll this shop now? */
export function shouldPollShop(
  shop: { needsReauth: boolean; lastOrderPollAt: Date | null; lastWebhookAt: Date | null },
  now = Date.now(),
): { poll: boolean; reason: string } {
  if (shop.needsReauth) return { poll: false, reason: 'needs_reauth' };
  const polledRecently = !!shop.lastOrderPollAt && now - shop.lastOrderPollAt.getTime() < POLL_SKIP_IF_POLLED_WITHIN_MS;
  const webhooksHealthy = !!shop.lastWebhookAt && now - shop.lastWebhookAt.getTime() < WEBHOOK_HEALTHY_WITHIN_MS;
  if (polledRecently && webhooksHealthy) return { poll: false, reason: 'webhooks_healthy' };
  return { poll: true, reason: webhooksHealthy ? 'hourly' : 'no_recent_webhooks' };
}

async function recordPollFailure(shop: { shopId: string; userId: string }, err: unknown) {
  const updated = await prisma.etsyShop.update({
    where: { shopId: shop.shopId },
    data: { orderPollFailures: { increment: 1 } },
    select: { orderPollFailures: true },
  });
  logger.warn('[orderJobs] Etsy order poll failed', { shopId: shop.shopId, failures: updated.orderPollFailures, error: (err as Error)?.message });
  if (updated.orderPollFailures >= POLL_FAILURES_BEFORE_ALERT) {
    await notify(shop.userId, {
      type: 'orderSyncFailed',
      severity: 'warning',
      titleKey: 'types.orderSyncFailed',
      params: { provider: 'Etsy' },
      link: NOTIFICATION_LINKS.labels,
      dedupeKey: notificationKeys.orderSync('etsy'),
    });
  }
}

async function runIncremental(signal: AbortSignal) {
  const { runEtsyOrderIncremental } = await import('./etsyLifecycle');
  const shops = await prisma.etsyShop.findMany({
    where: { isActive: true },
    select: { shopId: true, userId: true, needsReauth: true, lastOrderPollAt: true, lastWebhookAt: true },
  });
  let polled = 0;
  let receipts = 0;
  let failed = 0;
  for (const shop of shops) {
    if (signal.aborted) break;
    const decision = shouldPollShop(shop);
    if (!decision.poll) continue;
    try {
      const r = await runEtsyOrderIncremental(shop.shopId, { reason: decision.reason, maxPages: 10 });
      polled++;
      receipts += r.receipts;
      void resolveNotification(shop.userId, notificationKeys.orderSync('etsy'));
    } catch (err) {
      failed++;
      await recordPollFailure(shop, err).catch(() => undefined);
    }
  }
  return { shops: shops.length, polled, receipts, failed };
}

async function runReconcile(signal: AbortSignal) {
  const { reconcileEtsyOrders } = await import('./etsyLifecycle');
  const shops = await prisma.etsyShop.findMany({ where: { isActive: true, needsReauth: false }, select: { shopId: true, userId: true } });
  let receipts = 0;
  let failed = 0;
  for (const shop of shops) {
    if (signal.aborted) break;
    try {
      const r = await reconcileEtsyOrders(shop.shopId, 90);
      receipts += r.receipts;
    } catch (err) {
      failed++;
      logger.warn('[orderJobs] Etsy order reconcile failed', { shopId: shop.shopId, error: (err as Error)?.message });
    }
  }
  return { shops: shops.length, receipts, failed };
}

async function runTrendyolFast(signal: AbortSignal) {
  const { listUsersWithLiveStockChannel } = await import('@/lib/stock/hooks');
  const { syncTrendyolRecentOrdersForUser } = await import('@/lib/sync/trendyol');
  const users = await listUsersWithLiveStockChannel('trendyol');
  let synced = 0;
  for (const userId of users) {
    if (signal.aborted) break;
    try {
      await syncTrendyolRecentOrdersForUser(userId);
      synced++;
    } catch (err) {
      logger.warn('[orderJobs] Trendyol fast sync failed', { userId, error: (err as Error)?.message });
    }
  }
  return { users: users.length, synced };
}

export const orderJobs: ScheduledJob[] = [
  {
    name: 'etsy-orders-incremental',
    intervalMinutes: 15,
    timeoutMs: 10 * 60 * 1000,
    run: ({ signal }) => runIncremental(signal),
  },
  {
    name: 'etsy-orders-reconcile',
    dailyAtUtc: '03:10',
    timeoutMs: 60 * 60 * 1000,
    maxAttemptsPerBucket: 2,
    run: ({ signal }) => runReconcile(signal),
  },
  {
    name: 'order-effects-drain',
    intervalMinutes: 1,
    timeoutMs: 55 * 1000,
    run: async () => {
      const { drainOrderEffects } = await import('./orderEffects');
      return drainOrderEffects({ limit: 100, maxBatches: 5 });
    },
  },
  {
    name: 'order-dispatch-alerts',
    intervalMinutes: 15,
    timeoutMs: 5 * 60 * 1000,
    run: async () => {
      const { runDispatchAlerts } = await import('./dispatch');
      return runDispatchAlerts();
    },
  },
  {
    name: 'trendyol-orders-fast',
    intervalMinutes: 3,
    timeoutMs: 150 * 1000,
    run: ({ signal }) => runTrendyolFast(signal),
  },
];
