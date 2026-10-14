/**
 * Notification delivery dispatcher (owner W5). Server-only.
 *
 * NotificationDelivery is an outbox: notify() inserts one row per enabled
 * external channel on every create / re-raise, then calls kickDispatcher().
 * dispatchDueDeliveries() claims due rows and sends them:
 *
 *   status  pending  -> due now, will be sent
 *           held     -> quiet hours; nextAttemptAt = end of the window
 *           sending  -> claimed (lease 5 min; an expired lease is re-claimed)
 *           digest   -> waits for the daily digest (lib/notificationCenter/digest.ts)
 *           sent | failed | skipped  -> terminal
 *
 * Rules (decideDelivery, pure):
 *   - notification resolved, or read after the delivery was queued -> skipped
 *   - channel turned off since queuing / not configured             -> skipped
 *   - non-error severity inside quiet hours (default 23–08 local)   -> held
 *   - retries after a failure: 1m, 5m, 30m, 2h; the 5th failure     -> failed
 *
 * Runs from the in-process scheduler every minute (notifications-dispatch) and
 * immediately (debounced) after notify(). KX_DISABLE_INPROCESS_JOBS=1 turns
 * off the immediate kick (the cron safety net still runs the job).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { loadNotificationConfig, resolvePrefs, type EffectiveSettings, type ResolvedPrefs } from './preferences';
import { inQuietHours, quietHoursEnd } from './time';
import { getChannel } from './channels';
import type { ChannelRecipient } from './channels/types';

export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
/** 1 initial attempt + 4 retries. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const CLAIM_LEASE_MS = 5 * 60_000;
export const DISPATCH_BATCH = 100;
export { OPEN_DELIVERY_STATUSES } from './outbox';

export type DeliveryDecision =
  | { action: 'skip'; reason: string }
  | { action: 'hold'; until: Date }
  | { action: 'send' };

export interface DecisionInput {
  channel: string;
  severity: string;
  resolvedAt: Date | null;
  readAt: Date | null;
  deliveryCreatedAt: Date;
  prefs: Pick<ResolvedPrefs, 'email' | 'telegram'>;
  channelConfigured: boolean;
  settings: Pick<EffectiveSettings, 'timezone' | 'quietHoursStart' | 'quietHoursEnd'>;
  now: Date;
}

/** Pure decision for one claimed delivery. */
export function decideDelivery(d: DecisionInput): DeliveryDecision {
  if (d.resolvedAt) return { action: 'skip', reason: 'resolved' };
  if (d.readAt && d.readAt.getTime() >= d.deliveryCreatedAt.getTime()) return { action: 'skip', reason: 'read' };
  if (d.channel === 'email' && !d.prefs.email) return { action: 'skip', reason: 'disabled' };
  if (d.channel === 'telegram' && !d.prefs.telegram) return { action: 'skip', reason: 'disabled' };
  if (!d.channelConfigured) return { action: 'skip', reason: 'not_configured' };
  if (d.severity !== 'error' && inQuietHours(d.now, d.settings.timezone, d.settings.quietHoursStart, d.settings.quietHoursEnd)) {
    return { action: 'hold', until: quietHoursEnd(d.now, d.settings.timezone, d.settings.quietHoursStart, d.settings.quietHoursEnd) };
  }
  return { action: 'send' };
}

/** Next state after a failed send. `attempts` = attempts INCLUDING the one that just failed. */
export function afterFailure(attempts: number, now: Date, permanent = false): { status: 'pending' | 'failed' | 'skipped'; nextAttemptAt: Date } {
  if (permanent) return { status: 'skipped', nextAttemptAt: now };
  if (attempts >= MAX_ATTEMPTS) return { status: 'failed', nextAttemptAt: now };
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1];
  return { status: 'pending', nextAttemptAt: new Date(now.getTime() + delay) };
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

function warn(message: string, details: Record<string, unknown>) {
  try {
    void Promise.resolve(logger.warn(message, details)).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/**
 * Claim and process due deliveries. Returns counts. Throws only on a failure
 * of the initial query (the scheduler records it); per-row failures are
 * recorded on the row.
 */
export async function dispatchDueDeliveries(opts: { now?: Date; limit?: number; signal?: AbortSignal } = {}) {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? DISPATCH_BATCH, 1), 500);
  const counts = { claimed: 0, sent: 0, held: 0, skipped: 0, failed: 0, retry: 0 };

  const due = await prisma.notificationDelivery.findMany({
    where: { status: { in: ['pending', 'held', 'sending'] }, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: {
      id: true,
      channel: true,
      status: true,
      attempts: true,
      raiseSeq: true,
      createdAt: true,
      notification: {
        select: {
          id: true,
          userId: true,
          type: true,
          severity: true,
          titleKey: true,
          params: true,
          link: true,
          readAt: true,
          resolvedAt: true,
        },
      },
    },
  });

  // Safety net for the afterRaise invariant (one open delivery per notification
  // + channel): if a batch still holds several waiting rows for the same
  // notification and channel (e.g. a quiet-hours pile-up), only the newest
  // raise is sent; older ones are marked superseded.
  const newestSeq = new Map<string, number>();
  for (const d of due) {
    if (d.status === 'sending' || !d.notification) continue;
    const k = `${d.notification.id}|${d.channel}`;
    const seq = typeof d.raiseSeq === 'number' ? d.raiseSeq : 0;
    if (!newestSeq.has(k) || seq > (newestSeq.get(k) as number)) newestSeq.set(k, seq);
  }

  const recipients = new Map<string, { recipient: ChannelRecipient; config: Awaited<ReturnType<typeof loadNotificationConfig>> } | null>();

  for (const d of due) {
    if (opts.signal?.aborted) break;
    // Claim (single node today; the conditional update keeps it safe if two runs overlap).
    const claim = await prisma.notificationDelivery.updateMany({
      where: { id: d.id, status: d.status, nextAttemptAt: { lte: now } },
      data: { status: 'sending', nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
    });
    if (claim.count !== 1) continue;
    counts.claimed += 1;

    const n = d.notification;
    try {
      if (n && d.status !== 'sending') {
        const newest = newestSeq.get(`${n.id}|${d.channel}`);
        if (newest !== undefined && (typeof d.raiseSeq === 'number' ? d.raiseSeq : 0) < newest) {
          await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'skipped', error: 'superseded' } });
          counts.skipped += 1;
          continue;
        }
      }
      if (!n) {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'skipped', error: 'notification_missing' } });
        counts.skipped += 1;
        continue;
      }
      let r = recipients.get(n.userId);
      if (r === undefined) {
        const [user, config] = await Promise.all([
          prisma.user.findUnique({ where: { id: n.userId }, select: { email: true } }),
          loadNotificationConfig(n.userId),
        ]);
        r = user ? { recipient: { userId: n.userId, email: user.email ?? null, settings: config.settings }, config } : null;
        recipients.set(n.userId, r);
      }
      if (!r) {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'skipped', error: 'user_missing' } });
        counts.skipped += 1;
        continue;
      }
      const channel = getChannel(d.channel);
      const prefs = resolvePrefs(n.type, r.config);
      const decision = decideDelivery({
        channel: d.channel,
        severity: n.severity,
        resolvedAt: n.resolvedAt,
        readAt: n.readAt,
        deliveryCreatedAt: d.createdAt,
        prefs,
        channelConfigured: Boolean(channel && channel.isConfigured(r.recipient)),
        settings: r.config.settings,
        now,
      });
      if (decision.action === 'skip') {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'skipped', error: decision.reason } });
        counts.skipped += 1;
        continue;
      }
      if (decision.action === 'hold') {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'held', nextAttemptAt: decision.until } });
        counts.held += 1;
        continue;
      }
      const res = await channel!.send(r.recipient, { type: n.type, titleKey: n.titleKey, params: n.params, link: n.link });
      const attempts = d.attempts + 1;
      if (res.ok) {
        await prisma.notificationDelivery.update({
          where: { id: d.id },
          data: { status: 'sent', sentAt: new Date(), attempts, error: null },
        });
        counts.sent += 1;
      } else {
        const next = afterFailure(attempts, now, res.permanent);
        await prisma.notificationDelivery.update({
          where: { id: d.id },
          data: { status: next.status, nextAttemptAt: next.nextAttemptAt, attempts, error: (res.error || 'send_failed').slice(0, 300) },
        });
        if (next.status === 'pending') counts.retry += 1;
        else if (next.status === 'failed') counts.failed += 1;
        else counts.skipped += 1;
      }
    } catch (e) {
      const attempts = d.attempts + 1;
      const next = afterFailure(attempts, now);
      warn('notification delivery failed', { deliveryId: d.id, channel: d.channel, error: errMsg(e) });
      await prisma.notificationDelivery
        .update({ where: { id: d.id }, data: { status: next.status, nextAttemptAt: next.nextAttemptAt, attempts, error: errMsg(e) } })
        .catch(() => undefined);
      if (next.status === 'pending') counts.retry += 1;
      else counts.failed += 1;
    }
  }
  return counts;
}

export { kickDispatcher, inProcessDispatchEnabled } from './outbox';
