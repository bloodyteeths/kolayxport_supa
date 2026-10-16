/**
 * Reconnect state for marketplace connections whose auth keeps failing.
 *
 * Sync loops (lib/sync/shopify.ts, lib/sync/trendyol.ts, Amazon in lib/orderSync.ts) call:
 *   - isConnectionBlocked() before touching the provider: a flagged connection is skipped;
 *   - recordAuthFailure() when a call fails. Only real auth rejections count (401 / 403 /
 *     invalid_grant / token refresh rejected — never network errors, 429 or 5xx). After
 *     AUTH_FAILURE_THRESHOLD consecutive ones the connection is flagged `needsReconnect`, a
 *     `reauthRequired` notification is raised (onlyIfNew, same dedupe key as Etsy:
 *     'reauth:<provider>:<accountId>') and a live `connection.reauth_required` event goes out;
 *   - recordAuthSuccess() after a successful authenticated call: resets the counter, and when the
 *     connection was flagged, clears it and resolves the notification.
 * Reconnect / credential re-save calls clearConnectionAuthState().
 *
 * State lives in ConnectionAuthState (one row per user × provider × accountId). accountId is the
 * connection's user-facing id, i.e. the `externalId` lib/integrations/connectionStatus.ts reports
 * (Shopify shop domain, Trendyol supplier id, Amazon seller id), so Settings can flag the right
 * account. Every function here is best-effort and never throws into a sync loop.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify, resolveNotification, notificationKeys, NOTIFICATION_LINKS } from '@/lib/notifications';

export const AUTH_FAILURE_THRESHOLD = 3;

export type AuthTrackedProvider = 'shopify' | 'trendyol' | 'amazon';

const PROVIDER_NAMES: Record<AuthTrackedProvider, string> = {
  shopify: 'Shopify',
  trendyol: 'Trendyol',
  amazon: 'Amazon',
};

/** Error thrown/recorded when a sync skips a connection that needs reconnecting. */
export const RECONNECT_REQUIRED_ERROR = 'reconnect_required';

function message(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const m = (err as { message?: unknown }).message;
  return typeof m === 'string' ? m : String(err);
}

function statusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const v of [e.status, e.statusCode, e.response?.status]) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** A 403 that is really an edge/WAF block (Cloudflare HTML page), not a credential rejection. */
const EDGE_BLOCK = /cloudflare|<html|<!doctype|access denied \| |attention required/i;

/**
 * Pure: does this error mean the provider rejected our credentials / grant?
 * true  → 401, 403 (not an edge block), invalid_grant, "token refresh failed: 400|401|403".
 * false → network errors, timeouts, 429, 5xx, anything else.
 */
export function isAuthFailure(err: unknown): boolean {
  const msg = message(err);
  const status = statusOf(err);
  if (/\binvalid_grant\b/i.test(msg)) return true;
  if (status === 401) return true;
  if (status === 403) return !EDGE_BLOCK.test(msg);
  // e.g. "Token refresh failed: 401", "Amazon token refresh failed: 400 - {...invalid_grant...}"
  const refresh = /token refresh failed:?\s*(\d{3})/i.exec(msg);
  if (refresh) {
    const code = Number(refresh[1]);
    if (code === 401) return true;
    if (code === 403) return !EDGE_BLOCK.test(msg);
    return false; // 400 without invalid_grant (e.g. invalid_client = our config), 5xx, 429
  }
  // HTTP status embedded in client error messages:
  //   "Trendyol API 401: ...", "Shopify paginated GET /orders.json page 1 failed: 401 - ...",
  //   "HTTP 403", "status 401", "Shopify API error 401"
  const embedded = /(?:\bAPI(?: error)?|\bfailed:?|\bHTTP|\bstatus:?)\s*(401|403)\b/i.exec(msg);
  if (embedded) {
    if (embedded[1] === '401') return true;
    return !EDGE_BLOCK.test(msg);
  }
  return false;
}

/** Pure: the counter value at which a connection becomes `needsReconnect`. */
export function shouldFlag(consecutiveFailures: number, threshold = AUTH_FAILURE_THRESHOLD): boolean {
  return consecutiveFailures >= threshold;
}

function key(userId: string, provider: AuthTrackedProvider, accountId: string) {
  return { userId_provider_accountId: { userId, provider, accountId: accountId || '' } };
}

function raiseReconnect(userId: string, provider: AuthTrackedProvider, accountId: string) {
  const name = PROVIDER_NAMES[provider];
  void notify(userId, {
    type: 'reauthRequired',
    severity: 'error',
    titleKey: accountId ? 'types.reauthRejected' : 'types.reauthRequired',
    params: accountId ? { provider: name, account: accountId } : { provider: name },
    link: NOTIFICATION_LINKS.connections,
    dedupeKey: notificationKeys.reauth(provider, accountId),
    onlyIfNew: true,
  });
  void import('@/lib/live/publish')
    .then(({ publishLive }) => publishLive(userId, { type: 'connection', kind: 'reauth_required', provider, accountId }))
    .catch(() => undefined);
}

function announceReconnected(userId: string, provider: AuthTrackedProvider, accountId: string) {
  void resolveNotification(userId, notificationKeys.reauth(provider, accountId));
  void import('@/lib/live/publish')
    .then(({ publishLive }) => publishLive(userId, { type: 'connection', kind: 'reconnected', provider, accountId }))
    .catch(() => undefined);
}

/** True when the connection is parked until the user reconnects. Never throws (false on error). */
export async function isConnectionBlocked(userId: string, provider: AuthTrackedProvider, accountId: string): Promise<boolean> {
  try {
    const row = await prisma.connectionAuthState.findUnique({ where: key(userId, provider, accountId), select: { needsReconnect: true } });
    return !!row?.needsReconnect;
  } catch (err: any) {
    logger.warn('[authFailures] isConnectionBlocked failed', { userId, provider, error: err?.message });
    return false;
  }
}

export interface AuthFailureResult {
  /** Whether the error counted as an auth failure at all. */
  counted: boolean;
  consecutiveFailures: number;
  /** True when this call flipped the connection to needsReconnect. */
  flagged: boolean;
}

/**
 * Record a failed provider call. Non-auth errors are ignored (they neither count nor reset).
 * Returns what happened; never throws.
 */
export async function recordAuthFailure(
  userId: string,
  provider: AuthTrackedProvider,
  accountId: string,
  err: unknown,
): Promise<AuthFailureResult> {
  if (!isAuthFailure(err)) return { counted: false, consecutiveFailures: 0, flagged: false };
  const now = new Date();
  const lastError = message(err).slice(0, 500);
  try {
    const row = await prisma.connectionAuthState.upsert({
      where: key(userId, provider, accountId),
      create: { userId, provider, accountId: accountId || '', consecutiveFailures: 1, lastFailureAt: now, lastError },
      update: { consecutiveFailures: { increment: 1 }, lastFailureAt: now, lastError },
      select: { consecutiveFailures: true, needsReconnect: true },
    });
    let flagged = false;
    if (!row.needsReconnect && shouldFlag(row.consecutiveFailures)) {
      // Conditional update so two concurrent syncs raise the notification once.
      const r = await prisma.connectionAuthState.updateMany({
        where: { userId, provider, accountId: accountId || '', needsReconnect: false },
        data: { needsReconnect: true, needsReconnectAt: now },
      });
      flagged = r.count > 0;
      if (flagged) {
        logger.warn('[authFailures] connection needs reconnect', { userId, provider, accountId, failures: row.consecutiveFailures });
        raiseReconnect(userId, provider, accountId);
      }
    }
    return { counted: true, consecutiveFailures: row.consecutiveFailures, flagged };
  } catch (e: any) {
    logger.warn('[authFailures] recordAuthFailure failed', { userId, provider, error: e?.message });
    return { counted: true, consecutiveFailures: 0, flagged: false };
  }
}

/**
 * Record a successful authenticated call: reset the counter and clear a reconnect flag.
 * One conditional write (no-op when nothing was recorded). Never throws.
 */
export async function recordAuthSuccess(userId: string, provider: AuthTrackedProvider, accountId: string): Promise<void> {
  try {
    const flaggedRows = await prisma.connectionAuthState.deleteMany({
      where: { userId, provider, accountId: accountId || '', needsReconnect: true },
    });
    if (flaggedRows.count > 0) {
      logger.info('[authFailures] connection recovered', { userId, provider, accountId });
      announceReconnected(userId, provider, accountId);
      return;
    }
    await prisma.connectionAuthState.deleteMany({
      where: { userId, provider, accountId: accountId || '', consecutiveFailures: { gt: 0 } },
    });
  } catch (e: any) {
    logger.warn('[authFailures] recordAuthSuccess failed', { userId, provider, error: e?.message });
  }
}

/**
 * The user reconnected (OAuth callback) or re-saved credentials: forget every failure for the
 * provider (or one account) and resolve the matching reconnect notifications. Never throws.
 */
export async function clearConnectionAuthState(userId: string, provider: AuthTrackedProvider, accountId?: string): Promise<void> {
  try {
    const where = accountId === undefined ? { userId, provider } : { userId, provider, accountId };
    const rows = await prisma.connectionAuthState.findMany({ where, select: { accountId: true, needsReconnect: true } });
    if (rows.length === 0) return;
    await prisma.connectionAuthState.deleteMany({ where });
    for (const r of rows) if (r.needsReconnect) announceReconnected(userId, provider, r.accountId);
  } catch (e: any) {
    logger.warn('[authFailures] clearConnectionAuthState failed', { userId, provider, error: e?.message });
  }
}

/**
 * Flagged connections for a user, as { provider: Set<accountId> } (for connectionStatus).
 * Never throws (empty on error).
 */
export async function getReconnectFlags(userId: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  try {
    const rows = await prisma.connectionAuthState.findMany({
      where: { userId, needsReconnect: true },
      select: { provider: true, accountId: true },
    });
    for (const r of rows) {
      if (!out.has(r.provider)) out.set(r.provider, new Set());
      out.get(r.provider)!.add(r.accountId);
    }
  } catch (e: any) {
    logger.warn('[authFailures] getReconnectFlags failed', { userId, error: e?.message });
  }
  return out;
}
