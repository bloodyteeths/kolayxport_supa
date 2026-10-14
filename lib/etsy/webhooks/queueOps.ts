/**
 * Etsy webhook queue operations used outside the worker (owner W1).
 *
 *  - requeueBlockedEtsyEvents: 'blocked_reauth' -> 'received' (nextAttemptAt=now,
 *    attempts=0) after a shop reconnects or its token recovers; returns rows requeued.
 *  - enqueueSyntheticEtsyEvent: inserts a WebhookEvent ('synthetic:<uuid>') so the
 *    reconcile/poll paths reuse the same coalescing worker. Use eventType
 *    'reconcile.changed' with resourceKey 'listing:<id>' (W3) or
 *    'reconcile.order' with 'receipt:<id>' (W4).
 *  - replayFailedEtsyEvents: admin replay of terminal 'failed' rows.
 */
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { logIntegrationEvent } from '@/lib/admin/events';
import { ETSY_WEBHOOK_PROVIDER } from './events';

function kickSoon(delayMs = 1_000) {
  void import('./worker').then(({ kickEtsyWorker }) => kickEtsyWorker(delayMs)).catch(() => undefined);
}

export async function requeueBlockedEtsyEvents(shopId: string): Promise<number> {
  if (!shopId) return 0;
  try {
    const res = await prisma.webhookEvent.updateMany({
      where: { provider: ETSY_WEBHOOK_PROVIDER, shopId, status: 'blocked_reauth' },
      data: { status: 'received', nextAttemptAt: new Date(), attempts: 0, note: 'requeued:reauth_cleared' },
    });
    if (res.count > 0) {
      logIntegrationEvent('info', {
        message: 'Requeued Etsy webhook events after reauth',
        operation: 'etsy.webhook.requeued_blocked',
        details: { shopId, count: res.count },
      });
      kickSoon();
    }
    return res.count;
  } catch (err) {
    logIntegrationEvent('warn', {
      message: 'Requeue of blocked Etsy webhook events failed',
      operation: 'etsy.webhook.requeue_failed',
      details: { shopId },
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return 0;
  }
}

export async function enqueueSyntheticEtsyEvent(a: {
  shopId: string;
  userId: string;
  resourceKey: string;
  eventType: string;
  priority: number;
  notBefore?: Date;
}): Promise<void> {
  const now = new Date();
  await prisma.webhookEvent.create({
    data: {
      id: `synthetic:${crypto.randomUUID()}`,
      provider: ETSY_WEBHOOK_PROVIDER,
      eventType: a.eventType.slice(0, 64),
      eventTypes: [a.eventType.slice(0, 64)],
      status: 'received',
      shopId: a.shopId,
      userId: a.userId,
      resourceKey: a.resourceKey,
      priority: Math.trunc(a.priority),
      payload: { synthetic: true, event_type: a.eventType, resource_key: a.resourceKey },
      nextAttemptAt: a.notBefore && a.notBefore > now ? a.notBefore : now,
      firstReceivedAt: now,
    },
  });
  if (!a.notBefore || a.notBefore <= now) kickSoon(3_000);
}

/** Moves 'failed' rows (by ids, or all failed rows of a shop) back to 'received' with attempts 0. */
export async function replayFailedEtsyEvents(a: { ids?: string[]; shopId?: string }): Promise<number> {
  const ids = (a.ids || []).filter((id) => typeof id === 'string' && id.length > 0).slice(0, 1000);
  if (ids.length === 0 && !a.shopId) return 0;
  const res = await prisma.webhookEvent.updateMany({
    where: {
      provider: ETSY_WEBHOOK_PROVIDER,
      status: 'failed',
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(a.shopId ? { shopId: a.shopId } : {}),
    },
    data: { status: 'received', attempts: 0, deferrals: 0, nextAttemptAt: new Date(), processedAt: null, note: 'replayed' },
  });
  if (res.count > 0) kickSoon();
  return res.count;
}
