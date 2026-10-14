/**
 * Notifications (the bell, the Activity feed, email/telegram outbox). Server-only.
 *
 * Rows are rendered client-side with next-intl: t(titleKey, params) under the
 * 'notifications' namespace, so titleKey is always a key path such as
 * 'types.draftSyncFailed' and params are ICU values (strings / numbers only).
 * Emails are rendered server-side from the same keys (lib/notificationCenter/render.ts).
 *
 * Contract:
 *  - notify()  writes on (userId, dedupeKey). Raising = create, or re-raise of an
 *              existing row (bump createdAt + params, clear readAt, un-resolve,
 *              raiseCount+1). Without a dedupeKey every call creates a row.
 *              - onlyIfNew: an existing unresolved row keeps createdAt/readAt
 *                (only params are refreshed); a resolved row is re-raised.
 *              - escalateOn: an existing unresolved row is re-raised only when
 *                params[escalateOn] increased numerically; otherwise its params
 *                refresh silently (rollups such as "3 orders overdue today").
 *              Per-user preferences (lib/notificationCenter/preferences.ts)
 *              decide badge (unread bell) vs activity-only, and which external
 *              channels get a NotificationDelivery on each raise. A type whose
 *              in-app preference is off is still written with badge=false.
 *              A raise supersedes the notification's older open deliveries on
 *              the same channel, and instant channels are not re-queued within
 *              REEMAIL_COOLDOWN_MS of the last send unless the raise escalated.
 *              Losing a concurrent create race only refreshes params.
 *              Every raise publishes a live event (bell updates in every tab).
 *  - resolve() sets resolvedAt on the unresolved row for (userId, dedupeKey) and
 *              skips its pending deliveries; resolved rows disappear from the bell.
 *
 * None of the write functions ever throws into the caller: every failure is
 * logged with logger.warn and swallowed. Hot paths should call them
 * fire-and-forget (`void notify(...)`) — they return a promise that never rejects.
 * Only DB work happens inline; emails are sent asynchronously by the dispatcher.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { publishLive } from '@/lib/live/publish';
import { loadNotificationConfigSafe, resolvePrefs, type ResolvedPrefs } from '@/lib/notificationCenter/preferences';
import { kickDispatcher, OPEN_DELIVERY_STATUSES } from '@/lib/notificationCenter/outbox';
import { isNotificationGroup, typesInGroup, type NotificationGroup } from '@/lib/notificationCenter/registry';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export type NotificationType =
  | 'draftSyncFailed'
  | 'draftConflict'
  | 'reauthRequired'
  | 'orderSyncFailed'
  | 'usageNearLimit'
  | 'usageLimitReached'
  // ---- Added by the event-driven rebuild (W0 contract; emitted by W1–W4) ----
  | 'orderNew'
  | 'orderCanceled'
  | 'orderCanceledAfterLabel'
  | 'orderShippedExternal'
  | 'dispatchDueTomorrow'
  | 'dispatchDueToday'
  | 'dispatchOverdue'
  | 'listingDeactivated'
  | 'listingExpired'
  | 'listingDeleted'
  | 'listingChangedExternally'
  | 'stockOutOfStock'
  | 'stockPushFailed'
  | 'stockDrift'
  | 'stockUnmatchedSale'
  | 'seoExperimentReady'
  | 'webhookBacklog';

export type NotificationParams = Record<string, string | number>;

export interface NotifyInput {
  type: NotificationType;
  severity: NotificationSeverity;
  /** Key path under the 'notifications' i18n namespace, e.g. 'types.draftSyncFailed'. */
  titleKey: string;
  params?: NotificationParams;
  /** In-app path where the user can fix the problem. */
  link?: string;
  /** Stable key so repeats collapse into one row, e.g. 'draft:<id>', 'ordersync:etsy'. */
  dedupeKey?: string;
  /**
   * Do not re-raise an existing unresolved row (keep createdAt/readAt; params
   * are refreshed). A resolved row with the same key is still re-raised.
   */
  onlyIfNew?: boolean;
  /** What the notification is about, e.g. { type: 'order', id } (Notification.entityType/entityId). */
  entity?: { type: string; id: string };
  /**
   * Default true. false = activity feed only (never raises the unread badge).
   * An explicit false always wins; true cannot override a registry activity
   * type (badge:false in the registry) or an in-app preference that is off.
   */
  badge?: boolean;
  /**
   * Rollup escalation: re-raise (clear readAt, new delivery) only when
   * params[escalateOn] increased numerically; otherwise params refresh silently.
   */
  escalateOn?: string;
}

/** Link targets used by emitters (kept here so every caller agrees). */
export const NOTIFICATION_LINKS = {
  etsyListings: '/app/etsy-listings',
  connections: '/ayarlar?tab=connections',
  labels: '/app/labels',
  pricing: '/fiyatlandirma',
  notifications: '/app/bildirimler',
} as const;

// Per-process memo for `onlyIfNew` notifications so a per-request caller
// (usage limiter) does not hit the DB on every request once a row exists.
const ONLY_IF_NEW_TTL_MS = 10 * 60 * 1000;
const onlyIfNewSeen = new Map<string, number>();

/** Test hook. */
export function __resetNotificationMemo() {
  onlyIfNewSeen.clear();
  prefixResolveSeen.clear();
}

/** ICU params must be primitives; drop anything else (and clamp long strings). */
function cleanParams(params?: NotificationParams): NotificationParams | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const out: NotificationParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}

function warn(message: string, error: unknown, details: Record<string, unknown>) {
  try {
    void Promise.resolve(
      logger.warn(message, { ...details, error: error instanceof Error ? error.message : String(error) }),
    ).catch(() => undefined);
  } catch {
    /* logging must never break the caller either */
  }
}

function numericParam(params: unknown, key: string): number | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const v = (params as Record<string, unknown>)[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export type RaiseDecision = 'raise' | 'refresh';

/**
 * Pure: what to do with an EXISTING row for the same dedupeKey.
 *  - resolved row         -> raise (always)
 *  - onlyIfNew            -> refresh params only
 *  - escalateOn           -> raise only if params[escalateOn] increased, else refresh
 *  - default              -> raise (today's behaviour: every notify re-raises)
 */
export function decideRaise(
  existing: { resolvedAt: Date | null; params: unknown },
  input: Pick<NotifyInput, 'onlyIfNew' | 'escalateOn'>,
  newParams: NotificationParams | undefined,
): RaiseDecision {
  if (existing.resolvedAt) return 'raise';
  if (input.onlyIfNew) return 'refresh';
  if (input.escalateOn) {
    const next = numericParam(newParams, input.escalateOn);
    if (next === null) return 'refresh';
    const prev = numericParam(existing.params, input.escalateOn);
    return prev === null || next > prev ? 'raise' : 'refresh';
  }
  return 'raise';
}

const ITEM_SELECT = {
  id: true,
  type: true,
  severity: true,
  titleKey: true,
  params: true,
  link: true,
  readAt: true,
  resolvedAt: true,
  createdAt: true,
  badge: true,
  entityType: true,
  entityId: true,
  raiseCount: true,
} as const;

type ItemRow = {
  id: string;
  type: string;
  severity: string;
  titleKey: string;
  params: unknown;
  link: string | null;
  readAt: Date | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  badge?: boolean | null;
  entityType?: string | null;
  entityId?: string | null;
  raiseCount?: number | null;
};

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, error: 2 };

/**
 * Minimum gap between two instant (non-digest) external deliveries of the SAME
 * notification on the same channel. A re-raise inside the window updates the
 * bell but queues no new email/telegram, unless it escalated (escalateOn
 * param rose, or severity went up). Stops condition-driven re-raises (a
 * provider failing every 15 min, invalid_grant on every token fetch) from
 * emailing once per raise.
 */
export const REEMAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002');
}

export async function notify(userId: string, input: NotifyInput): Promise<void> {
  try {
    if (!userId || !input?.type || !input?.titleKey) return;
    const params = cleanParams(input.params);

    const memoKey = input.dedupeKey ? `${userId}|${input.dedupeKey}` : '';
    if (input.onlyIfNew && memoKey) {
      const seenAt = onlyIfNewSeen.get(memoKey);
      if (seenAt && Date.now() - seenAt < ONLY_IF_NEW_TTL_MS) return;
    }

    const config = await loadNotificationConfigSafe(userId);
    const prefs = resolvePrefs(input.type, config, { callerBadge: input.badge });
    const base = {
      type: input.type,
      severity: input.severity,
      titleKey: input.titleKey,
      params: params ?? undefined,
      link: input.link ?? null,
      entityType: input.entity?.type ? String(input.entity.type).slice(0, 64) : null,
      entityId: input.entity?.id ? String(input.entity.id).slice(0, 128) : null,
      badge: prefs.badge,
    };

    let raised: ItemRow | null = null;
    let escalated = false;

    if (!input.dedupeKey) {
      raised = await prisma.notification.create({ data: { userId, ...base }, select: ITEM_SELECT });
    } else {
      const where = { userId_dedupeKey: { userId, dedupeKey: input.dedupeKey } };
      const existingSelect = { id: true, params: true, resolvedAt: true, severity: true } as const;
      let existing = await prisma.notification.findUnique({ where, select: existingSelect });
      let lostCreateRace = false;
      if (!existing) {
        try {
          raised = await prisma.notification.create({
            data: { userId, dedupeKey: input.dedupeKey, ...base },
            select: ITEM_SELECT,
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          // Lost a create race: a concurrent caller created this row a moment
          // ago for the same event, and that caller already queued the
          // deliveries and published the raise. Only refresh params here.
          existing = await prisma.notification.findUnique({ where, select: existingSelect });
          if (!existing) throw e;
          lostCreateRace = true;
        }
      }
      if (existing) {
        const decision: RaiseDecision =
          lostCreateRace && !existing.resolvedAt ? 'refresh' : decideRaise(existing, input, params);
        if (decision === 'raise') {
          // Escalated re-raises bypass the re-email cooldown.
          const prevRank = SEVERITY_RANK[String(existing.severity ?? '')] ?? 0;
          const nextRank = SEVERITY_RANK[input.severity] ?? 0;
          escalated = Boolean(input.escalateOn && !existing.resolvedAt) || nextRank > prevRank;
          raised = await prisma.notification.update({
            where: { id: existing.id },
            data: { ...base, createdAt: new Date(), readAt: null, resolvedAt: null, raiseCount: { increment: 1 } },
            select: ITEM_SELECT,
          });
        } else if (base.params !== undefined) {
          await prisma.notification.update({ where: { id: existing.id }, data: { params: base.params } });
        }
      }
      if (input.onlyIfNew) {
        if (onlyIfNewSeen.size > 5000) onlyIfNewSeen.clear();
        onlyIfNewSeen.set(memoKey, Date.now());
      }
    }

    if (raised) await afterRaise(userId, raised, prefs, { escalated });
  } catch (error) {
    warn('notify() failed', error, { userId, type: input?.type, dedupeKey: input?.dedupeKey });
  }
}

/**
 * Queue external deliveries and publish the live event for a created / re-raised row.
 *
 * Invariant: at most ONE open (pending | held | digest) delivery per
 * (notification, channel). Inserting a delivery for raise N marks every older
 * open delivery of that notification+channel 'skipped' (error 'superseded'),
 * so a condition re-raised all night yields one email at 08:00, not one per
 * raise. Instant channels additionally honour REEMAIL_COOLDOWN_MS: if this
 * notification already went out (or is being sent) on that channel within
 * the window and the raise did not escalate, no new delivery is queued and
 * the older open one (if any) is left untouched.
 */
async function afterRaise(
  userId: string,
  row: ItemRow,
  prefs: ResolvedPrefs,
  opts: { escalated?: boolean; now?: Date } = {},
): Promise<void> {
  const raiseSeq = typeof row.raiseCount === 'number' ? row.raiseCount : 0;
  let deliveries: { notificationId: string; channel: string; raiseSeq: number; status: string }[] = [];
  if (prefs.email) {
    deliveries.push({ notificationId: row.id, channel: 'email', raiseSeq, status: prefs.emailMode === 'digest' ? 'digest' : 'pending' });
  }
  if (prefs.telegram) deliveries.push({ notificationId: row.id, channel: 'telegram', raiseSeq, status: 'pending' });
  if (deliveries.length) {
    try {
      // A first raise (raiseSeq 0) has no earlier deliveries: skip the extra queries.
      if (raiseSeq > 0) {
        const instant = deliveries.filter((d) => d.status === 'pending').map((d) => d.channel);
        if (instant.length && !opts.escalated) {
          const since = new Date((opts.now ?? new Date()).getTime() - REEMAIL_COOLDOWN_MS);
          const recent = await prisma.notificationDelivery.findMany({
            where: {
              notificationId: row.id,
              channel: { in: instant },
              OR: [{ status: 'sent', sentAt: { gte: since } }, { status: 'sending' }],
            },
            select: { channel: true },
          });
          const cooling = new Set((recent || []).map((r) => r.channel));
          if (cooling.size) deliveries = deliveries.filter((d) => !(d.status === 'pending' && cooling.has(d.channel)));
        }
        if (deliveries.length) {
          await prisma.notificationDelivery.updateMany({
            where: {
              notificationId: row.id,
              channel: { in: deliveries.map((d) => d.channel) },
              status: { in: [...OPEN_DELIVERY_STATUSES] },
              raiseSeq: { lt: raiseSeq },
            },
            data: { status: 'skipped', error: 'superseded' },
          });
        }
      }
      if (deliveries.length) {
        await prisma.notificationDelivery.createMany({ data: deliveries, skipDuplicates: true });
        if (deliveries.some((d) => d.status === 'pending')) kickDispatcher();
      }
    } catch (error) {
      warn('notify() delivery enqueue failed', error, { userId, type: row.type });
    }
  }

  try {
    if (row.badge !== false) {
      let unreadCount: number | undefined;
      try {
        unreadCount = await countUnread(userId);
      } catch {
        unreadCount = undefined;
      }
      publishLive(userId, { type: 'notification', action: 'raised', notification: toItem(row), unreadCount });
    } else {
      publishLive(userId, { type: 'invalidate', keys: [ACTIVITY_KEY] });
    }
  } catch {
    /* publishLive never throws; belt and braces */
  }
}

/** notify() every admin user (role 'admin'). Never throws. */
export async function notifyAdmins(input: NotifyInput): Promise<void> {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true }, take: 50 });
    for (const a of admins) await notify(a.id, input);
  } catch (error) {
    warn('notifyAdmins() failed', error, { type: input?.type, dedupeKey: input?.dedupeKey });
  }
}

/** Mark open deliveries of the user's resolved notifications 'skipped'. */
async function skipResolvedDeliveries(userId: string): Promise<void> {
  try {
    await prisma.notificationDelivery.updateMany({
      where: { status: { in: [...OPEN_DELIVERY_STATUSES] }, notification: { userId, resolvedAt: { not: null } } },
      data: { status: 'skipped', error: 'resolved' },
    });
  } catch (error) {
    warn('skipResolvedDeliveries() failed', error, { userId });
  }
}

export async function resolve(userId: string, dedupeKey: string): Promise<void> {
  try {
    if (!userId || !dedupeKey) return;
    onlyIfNewSeen.delete(`${userId}|${dedupeKey}`);
    const r = await prisma.notification.updateMany({
      where: { userId, dedupeKey, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (r && r.count > 0) {
      await skipResolvedDeliveries(userId);
      publishLive(userId, { type: 'notification', action: 'resolved', dedupeKeys: [dedupeKey] });
    }
  } catch (error) {
    warn('resolveNotification() failed', error, { userId, dedupeKey });
  }
}

// Per-process memo so per-request callers do not re-run the same prefix resolve.
const prefixResolveSeen = new Map<string, number>();

/**
 * Resolve every unresolved row whose dedupeKey starts with `prefix`, except
 * `exceptKeys`. With `memoTtlMs`, an identical call within the TTL is a no-op
 * (no DB round-trip). Never throws.
 */
export async function resolveByPrefix(
  userId: string,
  prefix: string,
  opts: { exceptKeys?: string[]; memoTtlMs?: number } = {},
): Promise<void> {
  try {
    if (!userId || !prefix) return;
    const except = (opts.exceptKeys || []).filter(Boolean);
    if (opts.memoTtlMs) {
      const memoKey = `${userId}|${prefix}|${except.join(',')}`;
      const seenAt = prefixResolveSeen.get(memoKey);
      if (seenAt && Date.now() - seenAt < opts.memoTtlMs) return;
      if (prefixResolveSeen.size > 5000) prefixResolveSeen.clear();
      prefixResolveSeen.set(memoKey, Date.now());
    }
    // Rows about to be resolved may be raised again: drop their onlyIfNew memo.
    for (const key of Array.from(onlyIfNewSeen.keys())) {
      if (key.startsWith(`${userId}|${prefix}`) && !except.some((k) => key === `${userId}|${k}`)) onlyIfNewSeen.delete(key);
    }
    const r = await prisma.notification.updateMany({
      where: {
        userId,
        resolvedAt: null,
        dedupeKey: { startsWith: prefix, ...(except.length ? { notIn: except } : {}) },
      },
      data: { resolvedAt: new Date() },
    });
    if (r && r.count > 0) {
      await skipResolvedDeliveries(userId);
      // Key list unknown without another query: clients refetch on a bare 'resolved'.
      publishLive(userId, { type: 'notification', action: 'resolved' });
    }
  } catch (error) {
    warn('resolveByPrefix() failed', error, { userId, prefix });
  }
}

/**
 * Forget memoised resolveByPrefix calls for `prefix` (any exceptKeys) so the
 * next call hits the DB, e.g. after a new limit-reached row was raised.
 */
export function invalidateResolveMemo(userId: string, prefix: string) {
  for (const key of Array.from(prefixResolveSeen.keys())) {
    if (key.startsWith(`${userId}|${prefix}|`)) prefixResolveSeen.delete(key);
  }
}

/** Alias for callers where `resolve` would shadow a Promise resolver. */
export const resolveNotification = resolve;

/** Dedupe-key builders — one place so emitters and readers agree. */
export const notificationKeys = {
  draft: (draftId: string) => `draft:${draftId}`,
  reauth: (provider: string, accountId: string) => `reauth:${provider}:${accountId}`,
  orderSync: (provider: string) => `ordersync:${provider}`,
  usage: (kind: string, period: string) => `usage:${kind}:${period}`,
  // ---- event-driven rebuild ----
  /** One row per order event kind: order:<orderId>:new | :canceled | :canceledAfterLabel | :shippedExternal */
  order: (orderId: string, kind: string) => `order:${orderId}:${kind}`,
  /** Daily rollup per dispatch stage (escalateOn 'count'). localDate = 'YYYY-MM-DD' in the user's timezone. */
  dispatch: (stage: 'overdue' | 'today' | 'tomorrow', localDate: string) => `dispatch:${stage}:${localDate}`,
  /** listing:<listingId>:<kind>[:<day>] */
  listing: (listingId: string, kind: string, day?: string) => `listing:${listingId}:${kind}${day ? `:${day}` : ''}`,
  stockOut: (stockItemId: string) => `stock:out:${stockItemId}`,
  stockPush: (linkId: string, window: string) => `stock:push:${linkId}:${window}`,
  stockDrift: (localDate: string) => `stock:drift:${localDate}`,
  stockUnmatched: (localDate: string) => `stock:unmatched:${localDate}`,
  seoExperiment: (experimentId: string) => `seo:${experimentId}`,
  webhookBacklog: (hourBucket: string) => `webhooks:backlog:${hourBucket}`,
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** SWR key the Activity feed uses (live 'invalidate' events target it). */
export const ACTIVITY_KEY = '/api/notifications/activity';

export interface NotificationItem {
  id: string;
  type: string;
  severity: string;
  titleKey: string;
  params: unknown;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  // ---- v2 (additive; older clients ignore them) ----
  badge?: boolean;
  entityType?: string | null;
  entityId?: string | null;
  resolvedAt?: string | null;
}

export type NotificationFeed = 'badge' | 'activity' | 'all';

export interface ListNotificationsOptions {
  /** badge (default: the bell) | activity (badge=false rows) | all */
  feed?: NotificationFeed;
  /** Opaque cursor from a previous page's nextCursor. */
  cursor?: string | null;
  group?: NotificationGroup | string | null;
  unreadOnly?: boolean;
  /** Include resolved rows (history view). Default false. */
  includeResolved?: boolean;
}

function toItem(r: ItemRow): NotificationItem {
  return {
    id: r.id,
    type: r.type,
    severity: r.severity,
    titleKey: r.titleKey,
    params: r.params ?? null,
    link: r.link ?? null,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    badge: r.badge !== false,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor || typeof cursor !== 'string' || cursor.length > 200) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const i = raw.indexOf('|');
    if (i <= 0) return null;
    const createdAt = new Date(raw.slice(0, i));
    const id = raw.slice(i + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Unread badge count: badge=true, unread, unresolved. */
export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, badge: true, resolvedAt: null, readAt: null } });
}

/**
 * GET /api/notifications payload. Throws on DB failure (API route answers 500).
 * `{ items, unreadCount }` is the stable contract; `nextCursor` is additive.
 */
export async function listNotifications(
  userId: string,
  limit = 20,
  opts: ListNotificationsOptions = {},
): Promise<{ items: NotificationItem[]; unreadCount: number; nextCursor: string | null }> {
  const take = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100);
  const feed: NotificationFeed = opts.feed === 'activity' || opts.feed === 'all' ? opts.feed : 'badge';
  const where: Record<string, unknown> = { userId };
  if (!opts.includeResolved) where.resolvedAt = null;
  if (feed === 'badge') where.badge = true;
  else if (feed === 'activity') where.badge = false;
  if (opts.unreadOnly) where.readAt = null;
  if (opts.group && isNotificationGroup(opts.group)) where.type = { in: typesInGroup(opts.group) };
  const c = decodeCursor(opts.cursor);
  if (c) where.OR = [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }];

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: ITEM_SELECT,
    }),
    countUnread(userId),
  ]);
  const page = rows.slice(0, take) as ItemRow[];
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    unreadCount,
    nextCursor: rows.length > take && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** POST /api/notifications/read. Scoped to the user; returns rows touched. Publishes a live 'read' event. */
export async function markNotificationsRead(
  userId: string,
  opts: { ids?: string[]; all?: boolean },
): Promise<number> {
  const now = new Date();
  let count = 0;
  let ids: string[] = [];
  if (opts.all) {
    const r = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
    count = r.count;
  } else {
    ids = (opts.ids || []).filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(0, 200);
    if (ids.length === 0) return 0;
    const r = await prisma.notification.updateMany({ where: { userId, id: { in: ids }, readAt: null }, data: { readAt: now } });
    count = r.count;
  }
  if (count > 0) {
    let unreadCount: number | undefined;
    try {
      unreadCount = opts.all ? 0 : await countUnread(userId);
    } catch {
      unreadCount = undefined;
    }
    publishLive(userId, opts.all ? { type: 'notification', action: 'read', all: true, unreadCount } : { type: 'notification', action: 'read', ids, unreadCount });
  }
  return count;
}

/**
 * Unresolved reauthRequired rows for a user, as { provider, accountId } pairs
 * parsed from their dedupe keys ('reauth:<provider>:<accountId>').
 * Never throws (returns [] on failure) — used by connectionStatus.
 */
export interface OpenReauthFlag {
  provider: string;
  accountId: string | null;
  dedupeKey: string | null;
  createdAt: Date;
}

export async function getOpenReauthFlags(userId: string): Promise<OpenReauthFlag[]> {
  try {
    const rows = await prisma.notification.findMany({
      where: { userId, type: 'reauthRequired', resolvedAt: null },
      select: { dedupeKey: true, params: true, createdAt: true },
      take: 50,
    });
    const out: OpenReauthFlag[] = [];
    for (const r of rows) {
      const m = /^reauth:([^:]+):(.*)$/.exec(r.dedupeKey || '');
      const p = r.params && typeof r.params === 'object' && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {};
      const provider = m?.[1] || (typeof p.provider === 'string' ? p.provider.toLowerCase() : '');
      if (!provider) continue;
      out.push({ provider, accountId: m?.[2] || null, dedupeKey: r.dedupeKey ?? null, createdAt: r.createdAt });
    }
    return out;
  } catch (error) {
    warn('getOpenReauthFlags() failed', error, { userId });
    return [];
  }
}
