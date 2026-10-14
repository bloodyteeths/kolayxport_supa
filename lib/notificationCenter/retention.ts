/**
 * Notification retention (owner W5). Daily job notifications-retention:
 *   - read or resolved notifications older than 90 days are deleted
 *   - unread, unresolved notifications older than 180 days are deleted
 *   - terminal deliveries (sent/failed/skipped) older than 30 days are deleted
 *   - EXCEPT unresolved rows of state-bearing types (STATE_BEARING_TYPES): they
 *     are the only record of a still-open problem (getOpenReauthFlags feeds
 *     connectionStatus; a parked Etsy shop never re-raises its reauth row), so
 *     they live until resolved, whatever their age. One row per account, bounded.
 * Deliveries of deleted notifications are removed first (relationMode=prisma
 * has no DB-level cascade). Batched so one run never holds long locks.
 */
import prisma from '@/lib/prisma';

const DAY = 24 * 60 * 60 * 1000;
const BATCH = 2000;
const MAX_BATCHES = 50;

/** Types whose unresolved rows are read back as live state; never aged out while unresolved. */
export const STATE_BEARING_TYPES: readonly string[] = ['reauthRequired'];

export function retentionCutoffs(now: Date) {
  return {
    readOrResolvedBefore: new Date(now.getTime() - 90 * DAY),
    unreadBefore: new Date(now.getTime() - 180 * DAY),
    deliveriesBefore: new Date(now.getTime() - 30 * DAY),
  };
}

/** Pure: the Notification filter for rows retention may delete. */
export function retentionWhere(c: ReturnType<typeof retentionCutoffs>) {
  const stateTypes = [...STATE_BEARING_TYPES];
  return {
    OR: [
      // resolved and old: always safe
      { createdAt: { lt: c.readOrResolvedBefore }, resolvedAt: { not: null } },
      // unresolved: read + 90 d, or unread + 180 d — never for state-bearing types
      { createdAt: { lt: c.readOrResolvedBefore }, resolvedAt: null, readAt: { not: null }, type: { notIn: stateTypes } },
      { createdAt: { lt: c.unreadBefore }, resolvedAt: null, type: { notIn: stateTypes } },
    ],
  };
}

export async function runNotificationRetention(opts: { now?: Date; signal?: AbortSignal } = {}) {
  const now = opts.now ?? new Date();
  const c = retentionCutoffs(now);
  let notifications = 0;
  let deliveries = 0;

  const where = retentionWhere(c);

  for (let i = 0; i < MAX_BATCHES; i++) {
    if (opts.signal?.aborted) break;
    const rows = await prisma.notification.findMany({ where, select: { id: true }, take: BATCH });
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    const d = await prisma.notificationDelivery.deleteMany({ where: { notificationId: { in: ids } } });
    const n = await prisma.notification.deleteMany({ where: { id: { in: ids } } });
    deliveries += d.count;
    notifications += n.count;
    if (rows.length < BATCH) break;
  }

  const old = await prisma.notificationDelivery.deleteMany({
    where: { status: { in: ['sent', 'failed', 'skipped'] }, createdAt: { lt: c.deliveriesBefore } },
  });
  deliveries += old.count;
  return { notifications, deliveries };
}
