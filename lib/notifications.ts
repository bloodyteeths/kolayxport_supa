/**
 * In-app notifications (the bell). Server-only.
 *
 * Rows are rendered client-side with next-intl: t(titleKey, params) under the
 * 'notifications' namespace, so titleKey is always a key path such as
 * 'types.draftSyncFailed' and params are ICU values (strings / numbers only).
 *
 * Contract:
 *  - notify()  upserts on (userId, dedupeKey). Re-raising an existing row bumps
 *              createdAt + params, clears readAt and un-resolves it.
 *              With `onlyIfNew` an existing unresolved row keeps its createdAt /
 *              readAt (only params are refreshed), but a previously resolved row
 *              is re-raised (used for per-request signals such as usage thresholds).
 *  - resolve() sets resolvedAt on the unresolved row for (userId, dedupeKey);
 *              resolved rows disappear from GET /api/notifications.
 *
 * Neither function ever throws into the caller: every failure is logged with
 * logger.warn and swallowed. Hot paths should call them fire-and-forget
 * (`void notify(...)`) — both already return a promise that never rejects.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export type NotificationType =
  | 'draftSyncFailed'
  | 'draftConflict'
  | 'reauthRequired'
  | 'orderSyncFailed'
  | 'usageNearLimit'
  | 'usageLimitReached';

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
}

/** Link targets used by emitters (kept here so every caller agrees). */
export const NOTIFICATION_LINKS = {
  etsyListings: '/app/etsy-listings',
  connections: '/ayarlar?tab=connections',
  labels: '/app/labels',
  pricing: '/fiyatlandirma',
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

export async function notify(userId: string, input: NotifyInput): Promise<void> {
  try {
    if (!userId || !input?.type || !input?.titleKey) return;
    const params = cleanParams(input.params);
    const base = {
      type: input.type,
      severity: input.severity,
      titleKey: input.titleKey,
      params: params ?? undefined,
      link: input.link ?? null,
    };

    if (!input.dedupeKey) {
      await prisma.notification.create({ data: { userId, ...base } });
      return;
    }

    const memoKey = `${userId}|${input.dedupeKey}`;
    if (input.onlyIfNew) {
      const seenAt = onlyIfNewSeen.get(memoKey);
      if (seenAt && Date.now() - seenAt < ONLY_IF_NEW_TTL_MS) return;
    }

    const now = new Date();
    if (input.onlyIfNew) {
      // A resolved row with the same key (e.g. limit hit again after an
      // upgrade within the same period) must be shown again.
      await prisma.notification.updateMany({
        where: { userId, dedupeKey: input.dedupeKey, resolvedAt: { not: null } },
        data: { ...base, createdAt: now, readAt: null, resolvedAt: null },
      });
    }
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: input.dedupeKey } },
      create: { userId, dedupeKey: input.dedupeKey, ...base },
      update: input.onlyIfNew
        ? { params: base.params }
        : { ...base, createdAt: now, readAt: null, resolvedAt: null },
    });
    if (input.onlyIfNew) {
      if (onlyIfNewSeen.size > 5000) onlyIfNewSeen.clear();
      onlyIfNewSeen.set(memoKey, Date.now());
    }
  } catch (error) {
    warn('notify() failed', error, { userId, type: input?.type, dedupeKey: input?.dedupeKey });
  }
}

export async function resolve(userId: string, dedupeKey: string): Promise<void> {
  try {
    if (!userId || !dedupeKey) return;
    onlyIfNewSeen.delete(`${userId}|${dedupeKey}`);
    await prisma.notification.updateMany({
      where: { userId, dedupeKey, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
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
    await prisma.notification.updateMany({
      where: {
        userId,
        resolvedAt: null,
        dedupeKey: { startsWith: prefix, ...(except.length ? { notIn: except } : {}) },
      },
      data: { resolvedAt: new Date() },
    });
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
};

export interface NotificationItem {
  id: string;
  type: string;
  severity: string;
  titleKey: string;
  params: unknown;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** GET /api/notifications payload. Throws on DB failure (API route answers 500). */
export async function listNotifications(
  userId: string,
  limit = 20,
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const take = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100);
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, type: true, severity: true, titleKey: true, params: true, link: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, resolvedAt: null, readAt: null } }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      titleKey: r.titleKey,
      params: r.params ?? null,
      link: r.link ?? null,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

/** POST /api/notifications/read. Scoped to the user; returns rows touched. */
export async function markNotificationsRead(
  userId: string,
  opts: { ids?: string[]; all?: boolean },
): Promise<number> {
  const now = new Date();
  if (opts.all) {
    const r = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
    return r.count;
  }
  const ids = (opts.ids || []).filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(0, 200);
  if (ids.length === 0) return 0;
  const r = await prisma.notification.updateMany({ where: { userId, id: { in: ids }, readAt: null }, data: { readAt: now } });
  return r.count;
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
