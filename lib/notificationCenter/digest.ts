/**
 * Daily notification digest (owner W5). Server-only.
 *
 * Every 15 min (job notifications-digest): for each user with queued 'digest'
 * email deliveries, once per local day at the first non-quiet moment at/after
 * NotificationSettings.digestHour, send ONE email listing the digest items plus the
 * unread badge notifications of the last 24 h, then mark the deliveries sent
 * and set lastDigestAt. Resolved items and users who turned email off are
 * skipped (deliveries -> 'skipped').
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { loadNotificationConfig, resolvePrefs, type EffectiveSettings } from './preferences';
import { inQuietHours, localParts } from './time';
import { emailChannel } from './channels/email';
import { MAX_ATTEMPTS } from './dispatcher';
import type { RenderableNotification } from './render';

export const DIGEST_MAX_LINES = 30;
const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * Pure: the most recent local `digestHour`:00 at or before `now` (today's slot
 * if the local hour has reached it, else yesterday's). DST shifts can move it
 * by up to an hour, which is fine for a daily email.
 */
export function lastDigestSlot(now: Date, timezone: string, digestHour: number): Date {
  const local = localParts(now, timezone);
  const hour = Number.isInteger(digestHour) && digestHour >= 0 && digestHour <= 23 ? digestHour : 8;
  const elapsedMin = ((local.hour - hour + 24) % 24) * 60 + local.minute;
  const out = new Date(now.getTime() - elapsedMin * 60_000);
  out.setUTCSeconds(0, 0);
  return out;
}

/**
 * Pure: is the digest due for this user now? One digest per daily slot: due at
 * the first non-quiet moment at/after the latest local digestHour that has
 * not been served yet. A digestHour inside quiet hours therefore sends when
 * the quiet window ends (e.g. 23 with quiet 23–08 -> 08:00 next morning)
 * instead of never.
 */
export function isDigestDue(now: Date, s: Pick<EffectiveSettings, 'timezone' | 'digestHour' | 'lastDigestAt' | 'quietHoursStart' | 'quietHoursEnd'>): boolean {
  if (inQuietHours(now, s.timezone, s.quietHoursStart, s.quietHoursEnd)) return false;
  if (!s.lastDigestAt) return true;
  return s.lastDigestAt.getTime() < lastDigestSlot(now, s.timezone, s.digestHour).getTime();
}

interface DigestRow {
  deliveryId: string;
  attempts: number;
  notification: RenderableNotification & { id: string; resolvedAt: Date | null };
}

/** Pure: split queued deliveries into what to send and what to skip. */
export function planDigest(
  rows: DigestRow[],
  emailAllowedFor: (type: string) => boolean,
): { send: DigestRow[]; skip: { id: string; reason: string }[] } {
  const send: DigestRow[] = [];
  const skip: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.notification.resolvedAt) skip.push({ id: r.deliveryId, reason: 'resolved' });
    else if (!emailAllowedFor(r.notification.type)) skip.push({ id: r.deliveryId, reason: 'disabled' });
    else if (seen.has(r.notification.id)) skip.push({ id: r.deliveryId, reason: 'duplicate' });
    else {
      seen.add(r.notification.id);
      send.push(r);
    }
  }
  return { send, skip };
}

export async function runDigests(opts: { now?: Date; signal?: AbortSignal } = {}) {
  const now = opts.now ?? new Date();
  const counts = { users: 0, sent: 0, skippedDeliveries: 0, failed: 0 };

  // One row per user (distinct), so a single user's backlog cannot crowd others out.
  const queued = await prisma.notification.findMany({
    where: { deliveries: { some: { status: 'digest', channel: 'email' } } },
    distinct: ['userId'],
    select: { userId: true },
    orderBy: { userId: 'asc' },
    take: 5000,
  });
  const userIds = Array.from(new Set(queued.map((q) => q.userId).filter((v): v is string => Boolean(v))));

  for (const userId of userIds) {
    if (opts.signal?.aborted) break;
    try {
      const config = await loadNotificationConfig(userId, { fresh: true });
      if (!isDigestDue(now, config.settings)) continue;
      counts.users += 1;

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { status: 'digest', channel: 'email', notification: { userId } },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          attempts: true,
          notification: { select: { id: true, type: true, titleKey: true, params: true, link: true, resolvedAt: true } },
        },
      });
      const rows: DigestRow[] = deliveries
        .filter((d) => d.notification)
        .map((d) => ({ deliveryId: d.id, attempts: d.attempts, notification: d.notification! }));
      const plan = planDigest(rows, (type) => resolvePrefs(type, config).email);

      for (const s of plan.skip) {
        await prisma.notificationDelivery.update({ where: { id: s.id }, data: { status: 'skipped', error: s.reason } });
        counts.skippedDeliveries += 1;
      }
      if (!plan.send.length) continue;

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      const recipient = { userId, email: user?.email ?? null, settings: config.settings };
      if (!user || !emailChannel.isConfigured(recipient)) {
        await prisma.notificationDelivery.updateMany({
          where: { id: { in: plan.send.map((r) => r.deliveryId) } },
          data: { status: 'skipped', error: 'not_configured' },
        });
        counts.skippedDeliveries += plan.send.length;
        continue;
      }

      const includedIds = new Set(plan.send.map((r) => r.notification.id));
      const recent = await prisma.notification.findMany({
        where: {
          userId,
          badge: true,
          readAt: null,
          resolvedAt: null,
          createdAt: { gte: new Date(now.getTime() - RECENT_MS) },
        },
        orderBy: { createdAt: 'desc' },
        take: DIGEST_MAX_LINES,
        select: { id: true, type: true, titleKey: true, params: true, link: true },
      });
      const items: RenderableNotification[] = [
        ...plan.send.map((r) => r.notification),
        ...recent.filter((n) => !includedIds.has(n.id)),
      ];
      const shown = items.slice(0, DIGEST_MAX_LINES);
      const res = await emailChannel.sendDigest!(recipient, shown, { moreCount: Math.max(0, items.length - shown.length) });

      const ids = plan.send.map((r) => r.deliveryId);
      if (res.ok) {
        await prisma.notificationDelivery.updateMany({ where: { id: { in: ids } }, data: { status: 'sent', sentAt: now, error: null } });
        await prisma.notificationSettings.upsert({
          where: { userId },
          create: { userId, lastDigestAt: now },
          update: { lastDigestAt: now },
        });
        counts.sent += 1;
      } else {
        // Retry on the next run (15 min); give up after MAX_ATTEMPTS.
        const maxPrev = Math.max(...plan.send.map((r) => r.attempts));
        const giveUp = res.permanent || maxPrev + 1 >= MAX_ATTEMPTS;
        await prisma.notificationDelivery.updateMany({
          where: { id: { in: ids } },
          data: giveUp
            ? { status: res.permanent ? 'skipped' : 'failed', error: (res.error || 'send_failed').slice(0, 300), attempts: { increment: 1 } }
            : { error: (res.error || 'send_failed').slice(0, 300), attempts: { increment: 1 } },
        });
        counts.failed += 1;
      }
    } catch (e) {
      counts.failed += 1;
      try {
        void Promise.resolve(
          logger.warn('notification digest failed', { userId, error: e instanceof Error ? e.message : String(e) }),
        ).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  }
  return counts;
}
