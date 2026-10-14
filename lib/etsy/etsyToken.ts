// Shared Etsy OAuth access-token helper — the ONLY place that refreshes Etsy
// tokens (EtsyClient, the draft engine, the webhook worker, clawd routes all
// call getEtsyAccessToken).
//
// Etsy refresh tokens are single-use (rotated on every refresh), so two
// concurrent refreshes for the same shop make the loser's stored token
// invalid ("invalid_grant") and the shop silently disconnects.
//
// EtsyShop rows: a DB lease (EtsyShop.tokenRefreshLeaseUntil, 30 s) elects one
// refresher. It does a single POST (15 s timeout, no retry) and persists the
// new tokens immediately with plain updates — no network I/O ever runs inside
// a DB transaction. Everyone else polls the row for the fresh token.
//
// invalid_grant: the row is re-read; only if the refresh token is still the
// one we sent (no concurrent reconnect) is the shop flagged needsReauth, the
// reauthRequired notification raised and a live 'connection' event sent.
// A later successful refresh/reconnect clears the flag and requeues the
// webhook events parked in 'blocked_reauth'.
//
// Credential-only shops (legacy, no EtsyShop row) use an in-process per-shop
// mutex + re-read (single node) and the same single POST.

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';
import { EtsyDraftError } from './draftErrors';
import { EtsyDeferError } from './webhooks/types';
import { processState } from '@/lib/processState';
import { notify, resolveNotification, notificationKeys, NOTIFICATION_LINKS } from '@/lib/notifications';

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
export const TOKEN_POST_TIMEOUT_MS = 15_000;
/** Lease length is 30 s (literal in the lease SQL). */
const LEASE_WAIT_MS = 20_000;
const LEASE_POLL_MS = 500;
/** A token issued within this window is never force-refreshed again. */
const FORCE_REFRESH_MIN_AGE_MS = 60_000;
/** Etsy access tokens live 1 h; used to estimate when a token was issued. */
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type GetEtsyAccessTokenOptions = {
  /**
   * Refresh even though the stored token is not near expiry. Only for a 401
   * whose body says invalid_token/expired; ignored when the token was issued
   * less than 60 s ago or when the stored token differs from rejectedToken.
   */
  forceRefresh?: boolean;
  /** The access token Etsy just rejected (plaintext). */
  rejectedToken?: string;
};

function tokenNeedsRefresh(expiresAt: Date | null | undefined) {
  return !expiresAt || expiresAt.getTime() - Date.now() < TOKEN_REFRESH_SKEW_MS;
}

function reauthError(message = 'Etsy connection expired — reconnect the Etsy shop in Settings') {
  return new EtsyDraftError('ETSY_REAUTH_REQUIRED', message, { status: 401, key: 'draftSync.reauthRequired' });
}

function shopNotFoundError() {
  return new EtsyDraftError('SHOP_NOT_FOUND', 'Etsy shop not found or not connected', { status: 404, key: 'draftSync.shopNotFound' });
}

/** A 401 body that justifies a forced refresh. */
export function isInvalidTokenResponseBody(body: string): boolean {
  return /invalid_token|expired/i.test(body || '');
}

/** The shop is parked for reauth (and has not been reconnected since the flag was set). */
export function isShopReauthBlocked(shop: { needsReauth?: boolean | null; needsReauthAt?: Date | null; tokenExpiresAt?: Date | null } | null | undefined): boolean {
  if (!shop?.needsReauth) return false;
  // A reconnect (OAuth callback) writes a token ISSUED after the flag was set —
  // treat that as cleared even if the callback didn't reset the flag. The
  // issue time is estimated from the 1 h TTL; comparing raw expiry would
  // misread a still-unexpired dead token (forced refresh on a 401 long before
  // expiry) as a reconnect and flap the flag. invalid_grant also expires the
  // stored token, so a dead token can never look newer than the flag.
  if (shop.needsReauthAt && shop.tokenExpiresAt && shop.tokenExpiresAt.getTime() - ACCESS_TOKEN_TTL_MS > shop.needsReauthAt.getTime()) {
    return false;
  }
  return true;
}

type TokenSet = { accessToken: string; refreshToken: string; tokenExpiresAt: Date };

class InvalidGrantError extends Error {
  constructor() {
    super('invalid_grant');
    this.name = 'InvalidGrantError';
  }
}

/** Single POST to Etsy's token endpoint (15 s, no retry). Throws InvalidGrantError on invalid_grant. */
async function exchangeRefreshToken(shopId: string, refreshToken: string): Promise<TokenSet> {
  const response = await fetch(ETSY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: (process.env.ETSY_API_KEY || '').trim(),
    }),
    signal: AbortSignal.timeout(TOKEN_POST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (/invalid_grant/i.test(text)) {
      logger.warn('Etsy refresh token rejected (invalid_grant)', { shopId });
      throw new InvalidGrantError();
    }
    throw new Error(`Failed to refresh Etsy token: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token || refreshToken) as string,
    tokenExpiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000),
  };
}

function plain(value: string | null | undefined): string {
  const v = decryptIfNeeded(value ?? null) as string | null;
  if (!v) throw new Error('Etsy access token could not be decrypted');
  return v;
}

function raiseReauth(userId: string, shopId: string) {
  void notify(userId, {
    type: 'reauthRequired',
    severity: 'error',
    titleKey: 'types.reauthRequired',
    params: { provider: 'Etsy' },
    link: NOTIFICATION_LINKS.connections,
    dedupeKey: notificationKeys.reauth('etsy', shopId),
    // Raised on every invalid_grant; only the first raise per incident should bump the bell / email.
    onlyIfNew: true,
  });
  void import('@/lib/live/publish')
    .then(({ publishLive }) => publishLive(userId, { type: 'connection', kind: 'reauth_required', provider: 'etsy', accountId: shopId }))
    .catch(() => undefined);
}

async function onReauthCleared(userId: string, shopId: string, wasFlagged: boolean) {
  void resolveNotification(userId, notificationKeys.reauth('etsy', shopId));
  if (!wasFlagged) return;
  try {
    const { requeueBlockedEtsyEvents } = await import('./webhooks/queueOps');
    await requeueBlockedEtsyEvents(shopId);
  } catch (err: any) {
    logger.warn('Could not requeue blocked Etsy events after token recovery', { shopId, error: err?.message });
  }
}

type ShopTokenRow = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  userId: string;
  needsReauth: boolean;
  needsReauthAt: Date | null;
};

const SHOP_TOKEN_SELECT = {
  accessToken: true,
  refreshToken: true,
  tokenExpiresAt: true,
  userId: true,
  needsReauth: true,
  needsReauthAt: true,
} as const;

/** Whether a forced refresh should be skipped because the stored token is already newer. */
function forceIsMoot(row: { accessToken: string; tokenExpiresAt: Date | null }, opts: GetEtsyAccessTokenOptions): boolean {
  if (opts.rejectedToken) {
    try {
      if (plain(row.accessToken) !== opts.rejectedToken) return true;
    } catch {
      return false;
    }
  }
  const issuedAt = row.tokenExpiresAt ? row.tokenExpiresAt.getTime() - ACCESS_TOKEN_TTL_MS : 0;
  return issuedAt > Date.now() - FORCE_REFRESH_MIN_AGE_MS;
}

function needsWork(row: { accessToken: string; tokenExpiresAt: Date | null }, opts: GetEtsyAccessTokenOptions): boolean {
  if (opts.forceRefresh) return !forceIsMoot(row, opts);
  return tokenNeedsRefresh(row.tokenExpiresAt);
}

async function tryTakeLease(shopId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ shopId: string }>>`
    UPDATE "EtsyShop"
    SET "tokenRefreshLeaseUntil" = now() + interval '30 seconds'
    WHERE "shopId" = ${shopId}
      AND ("tokenRefreshLeaseUntil" IS NULL OR "tokenRefreshLeaseUntil" < now())
    RETURNING "shopId"`;
  return rows.length > 0;
}

async function releaseLease(shopId: string) {
  await prisma.etsyShop.updateMany({ where: { shopId }, data: { tokenRefreshLeaseUntil: null } }).catch(() => undefined);
}

/** Refresh path for a shop with an EtsyShop row. */
async function refreshViaLease(shopId: string, userId: string | undefined, opts: GetEtsyAccessTokenOptions, depth = 0): Promise<string> {
  const where = { shopId, isActive: true, ...(userId ? { userId } : {}) };
  const deadline = Date.now() + LEASE_WAIT_MS;

  for (;;) {
    if (await tryTakeLease(shopId)) break;
    // Someone else is refreshing: wait for their result.
    await sleep(LEASE_POLL_MS);
    const row = await prisma.etsyShop.findFirst({ where, select: SHOP_TOKEN_SELECT }) as ShopTokenRow | null;
    if (!row) throw shopNotFoundError();
    if (!needsWork(row, { ...opts, forceRefresh: opts.forceRefresh })) return plain(row.accessToken);
    if (isShopReauthBlocked(row)) throw reauthError();
    if (Date.now() > deadline) {
      throw new EtsyDeferError('lock_busy', 15_000, `Etsy token refresh for shop ${shopId} is in progress elsewhere`);
    }
  }

  // We hold the lease. Re-read: another process may have refreshed already.
  let row: ShopTokenRow | null = null;
  let held = true;
  const release = async () => {
    if (!held) return;
    held = false;
    await releaseLease(shopId);
  };
  try {
    row = await prisma.etsyShop.findFirst({ where, select: SHOP_TOKEN_SELECT }) as ShopTokenRow | null;
    if (!row) throw shopNotFoundError();
    if (!needsWork(row, opts)) return plain(row.accessToken);

    const sentRefresh = decryptIfNeeded(row.refreshToken) as string | null;
    if (!sentRefresh) throw reauthError('No Etsy refresh token — reconnect the Etsy shop');

    let next: TokenSet;
    try {
      next = await exchangeRefreshToken(shopId, sentRefresh);
    } catch (err) {
      if (!(err instanceof InvalidGrantError)) throw err;
      // Outside any transaction: did a reconnect replace the refresh token meanwhile?
      const now = await prisma.etsyShop.findFirst({ where: { shopId }, select: SHOP_TOKEN_SELECT }) as ShopTokenRow | null;
      if (now && now.refreshToken !== row.refreshToken) {
        await release();
        if (depth < 1) return getEtsyAccessTokenInternal(shopId, userId, {}, depth + 1);
        return plain(now.accessToken);
      }
      // Also expire the stored (dead) access token so it is never handed out
      // again and cannot be mistaken for a post-flag reconnect.
      const flaggedAt = new Date();
      await prisma.etsyShop.updateMany({
        where: { shopId, refreshToken: row.refreshToken },
        data: { needsReauth: true, needsReauthAt: flaggedAt, tokenExpiresAt: flaggedAt },
      });
      raiseReauth(row.userId, shopId);
      throw reauthError();
    }

    const encAccess = encryptIfNeeded(next.accessToken) as string;
    const encRefresh = encryptIfNeeded(next.refreshToken) as string;
    await prisma.etsyShop.updateMany({
      where: { shopId },
      data: {
        accessToken: encAccess,
        refreshToken: encRefresh,
        tokenExpiresAt: next.tokenExpiresAt,
        needsReauth: false,
        needsReauthAt: null,
      },
    });
    // Keep the legacy Credential mirror in step (the old refresh token is now dead).
    await prisma.credential.updateMany({
      where: { etsyShopId: shopId, userId: row.userId },
      data: { etsyAccessToken: encAccess, etsyRefreshToken: encRefresh, etsyTokenExpiresAt: next.tokenExpiresAt },
    }).catch((err: any) => logger.warn('Could not mirror refreshed Etsy token to Credential', { shopId, error: err?.message }));
    void onReauthCleared(row.userId, shopId, row.needsReauth);
    return next.accessToken;
  } finally {
    await release();
  }
}

// In-process per-shop mutex for Credential-only (legacy) shops.
// On globalThis so the API-route and instrumentation bundles share it (lib/processState.ts).
const { credentialLocks } = processState('etsy.credentialLocks', () => ({ credentialLocks: new Map<string, Promise<unknown>>() }));

async function withCredentialLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = credentialLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  credentialLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (credentialLocks.get(key) === tail) credentialLocks.delete(key);
  }
}

async function refreshCredentialOnly(shopId: string, userId: string | undefined, opts: GetEtsyAccessTokenOptions): Promise<string> {
  return withCredentialLock(`${shopId}|${userId || ''}`, async () => {
    const credential = await prisma.credential.findFirst({
      where: { etsyShopId: shopId, ...(userId ? { userId } : {}) },
      select: { etsyAccessToken: true, etsyRefreshToken: true, etsyTokenExpiresAt: true, userId: true },
    });
    if (!credential?.etsyAccessToken) throw shopNotFoundError();
    const view = { accessToken: credential.etsyAccessToken, tokenExpiresAt: credential.etsyTokenExpiresAt };
    if (!needsWork(view, opts)) return plain(credential.etsyAccessToken);
    const plainRefresh = decryptIfNeeded(credential.etsyRefreshToken) as string | null;
    if (!plainRefresh) throw reauthError('No Etsy refresh token — reconnect the Etsy shop');
    try {
      const next = await exchangeRefreshToken(shopId, plainRefresh);
      await prisma.credential.updateMany({
        where: { etsyShopId: shopId, userId: credential.userId },
        data: {
          etsyAccessToken: encryptIfNeeded(next.accessToken),
          etsyRefreshToken: encryptIfNeeded(next.refreshToken),
          etsyTokenExpiresAt: next.tokenExpiresAt,
        },
      });
      void resolveNotification(credential.userId, notificationKeys.reauth('etsy', shopId));
      return next.accessToken;
    } catch (err) {
      if (err instanceof InvalidGrantError) {
        logger.warn('Etsy legacy credential refresh rejected (invalid_grant)', { shopId });
        raiseReauth(credential.userId, shopId);
        throw reauthError();
      }
      throw err;
    }
  });
}

async function getEtsyAccessTokenInternal(shopId: string, userId: string | undefined, opts: GetEtsyAccessTokenOptions, depth: number): Promise<string> {
  const shop = await prisma.etsyShop.findFirst({
    where: { shopId, isActive: true, ...(userId ? { userId } : {}) },
    select: SHOP_TOKEN_SELECT,
  }) as ShopTokenRow | null;

  if (shop) {
    // Parked for reauth: never return the dead token, never burn a POST that
    // is known to fail. Only a reconnect (or a token issued after the flag)
    // unblocks the shop.
    if (isShopReauthBlocked(shop)) throw reauthError();
    if (!needsWork(shop, opts)) {
      // A reconnect wrote fresh tokens after the reauth flag: clear it.
      if (shop.needsReauth && !isShopReauthBlocked(shop)) {
        await prisma.etsyShop.updateMany({ where: { shopId, needsReauth: true }, data: { needsReauth: false, needsReauthAt: null } }).catch(() => undefined);
        void onReauthCleared(shop.userId, shopId, true);
      }
      return plain(shop.accessToken);
    }
    return refreshViaLease(shopId, userId, opts, depth);
  }

  return refreshCredentialOnly(shopId, userId, opts);
}

/**
 * Returns a valid plaintext access token for `shopId`, refreshing it when it
 * expires within 5 minutes (or on a justified forceRefresh). When `userId` is
 * given, only that user's shop/credential is considered.
 */
export async function getEtsyAccessToken(shopId: string, userId?: string, opts: GetEtsyAccessTokenOptions = {}): Promise<string> {
  return getEtsyAccessTokenInternal(shopId, userId, opts, 0);
}
