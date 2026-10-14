// Shared Etsy OAuth access-token helper (used by the draft engine, the
// clawd Etsy API and the video upload route).
//
// Etsy refresh tokens are single-use (rotated on every refresh), so two
// concurrent refreshes for the same shop make the loser's stored token
// invalid ("invalid_grant") and the shop silently disconnects. Every refresh
// therefore runs inside a Postgres advisory transaction lock keyed on the shop,
// and re-reads the token row after acquiring it — if another process already
// refreshed, its fresh token is used instead of refreshing again.

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';
import { EtsyDraftError } from './draftErrors';
import { notify, resolveNotification, notificationKeys, NOTIFICATION_LINKS } from '@/lib/notifications';

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_FETCH_TIMEOUT_MS = 30_000;
const TOKEN_FETCH_MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tokenNeedsRefresh(expiresAt: Date | null | undefined) {
  return !expiresAt || expiresAt.getTime() - Date.now() < TOKEN_REFRESH_SKEW_MS;
}

function reauthError(message = 'Etsy connection expired — reconnect the Etsy shop in Settings') {
  return new EtsyDraftError('ETSY_REAUTH_REQUIRED', message, { status: 401, key: 'draftSync.reauthRequired' });
}

function shopNotFoundError() {
  return new EtsyDraftError('SHOP_NOT_FOUND', 'Etsy shop not found or not connected', { status: 404, key: 'draftSync.shopNotFound' });
}

/** POST to Etsy's token endpoint with a timeout and 429/5xx retry (Retry-After honoured). */
async function postTokenRequest(body: URLSearchParams): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < TOKEN_FETCH_MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.text().catch(() => undefined);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : Math.min(1000 * 2 ** attempt, 8_000));
      continue;
    }
    return response;
  }
}

/** Exchange a (plaintext) refresh token. Callers must hold the per-shop lock. */
async function exchangeRefreshToken(shopId: string, refreshToken: string) {
  const response = await postTokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: (process.env.ETSY_API_KEY || '').trim(),
  }));
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (/invalid_grant/i.test(text)) {
      // No reauth flag column exists on EtsyShop; the typed error lets the UI
      // show a "reconnect Etsy" prompt.
      logger.warn('Etsy refresh token rejected (invalid_grant) — shop needs reauthorization', { shopId });
      const err = reauthError();
      (err as any).invalidGrant = true; // getEtsyAccessToken raises the reauthRequired notification
      throw err;
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

/**
 * Returns a valid plaintext access token for `shopId`, refreshing it under a
 * per-shop advisory lock when it expires within 5 minutes. When `userId` is
 * given, only that user's shop/credential is considered.
 */
export async function getEtsyAccessToken(shopId: string, userId?: string): Promise<string> {
  const shop = await prisma.etsyShop.findFirst({
    where: { shopId, isActive: true, ...(userId ? { userId } : {}) },
    select: { accessToken: true, tokenExpiresAt: true },
  });
  if (shop && !tokenNeedsRefresh(shop.tokenExpiresAt)) {
    const plain = decryptIfNeeded(shop.accessToken) as string;
    if (!plain) throw new Error('Etsy access token could not be decrypted');
    return plain;
  }

  if (!shop) {
    const credential = await prisma.credential.findFirst({
      where: { etsyShopId: shopId, ...(userId ? { userId } : {}) },
      select: { etsyAccessToken: true, etsyTokenExpiresAt: true },
    });
    if (!credential?.etsyAccessToken) throw shopNotFoundError();
    if (!tokenNeedsRefresh(credential.etsyTokenExpiresAt)) {
      const plain = decryptIfNeeded(credential.etsyAccessToken) as string;
      if (!plain) throw new Error('Etsy access token could not be decrypted');
      return plain;
    }
  }

  // Owner of the shop/credential actually refreshed (for notifications) and
  // whether a refresh token exchange succeeded in this call.
  let ownerUserId: string | undefined = userId;
  let refreshed = false as boolean;
  const notifyKey = notificationKeys.reauth('etsy', shopId);

  try {
    const token = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`etsy-token:${shopId}`}))`;

      const lockedShop = await tx.etsyShop.findFirst({
        where: { shopId, isActive: true, ...(userId ? { userId } : {}) },
        select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, userId: true },
      });
      if (lockedShop) {
        ownerUserId = lockedShop.userId || ownerUserId;
        if (!tokenNeedsRefresh(lockedShop.tokenExpiresAt)) return decryptIfNeeded(lockedShop.accessToken) as string;
        const plainRefresh = decryptIfNeeded(lockedShop.refreshToken) as string | null;
        if (!plainRefresh) throw reauthError('No Etsy refresh token — reconnect the Etsy shop');
        const next = await exchangeRefreshToken(shopId, plainRefresh);
        await tx.etsyShop.updateMany({
          where: { shopId },
          data: { accessToken: encryptIfNeeded(next.accessToken), refreshToken: encryptIfNeeded(next.refreshToken), tokenExpiresAt: next.tokenExpiresAt },
        });
        refreshed = true;
        return next.accessToken;
      }

      const credential = await tx.credential.findFirst({
        where: { etsyShopId: shopId, ...(userId ? { userId } : {}) },
        select: { etsyAccessToken: true, etsyRefreshToken: true, etsyTokenExpiresAt: true, userId: true },
      });
      if (!credential?.etsyAccessToken) throw shopNotFoundError();
      ownerUserId = credential.userId || ownerUserId;
      if (!tokenNeedsRefresh(credential.etsyTokenExpiresAt)) return decryptIfNeeded(credential.etsyAccessToken) as string;
      const plainRefresh = decryptIfNeeded(credential.etsyRefreshToken) as string | null;
      if (!plainRefresh) throw reauthError('No Etsy refresh token — reconnect the Etsy shop');
      const next = await exchangeRefreshToken(shopId, plainRefresh);
      await tx.credential.updateMany({
        where: { etsyShopId: shopId, ...(userId ? { userId } : {}) },
        data: {
          etsyAccessToken: encryptIfNeeded(next.accessToken),
          etsyRefreshToken: encryptIfNeeded(next.refreshToken),
          etsyTokenExpiresAt: next.tokenExpiresAt,
        },
      });
      refreshed = true;
      return next.accessToken;
    }, { timeout: 60_000, maxWait: 60_000 });
    // A successful refresh proves the grant is valid again (e.g. after reconnect).
    if (refreshed && ownerUserId) void resolveNotification(ownerUserId, notifyKey);
    return token;
  } catch (err: any) {
    if (err?.invalidGrant && ownerUserId) {
      void notify(ownerUserId, {
        type: 'reauthRequired',
        severity: 'error',
        titleKey: 'types.reauthRequired',
        params: { provider: 'Etsy' },
        link: NOTIFICATION_LINKS.connections,
        dedupeKey: notifyKey,
      });
    }
    throw err;
  }
}
