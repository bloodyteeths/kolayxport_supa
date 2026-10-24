import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { encryptIfNeeded } from '@/lib/crypto/credentials';
import { verifyOAuthState } from '@/lib/auth/oauthState';
import { resolveNotification, notificationKeys } from '@/lib/notifications';
import { recordActivation } from '@/lib/activation/events';

/**
 * After a successful (re)connect: requeue webhook events parked while the shop
 * needed reauth, then catch up orders and listings in the background. Every
 * step is caught and logged — the OAuth redirect never waits on or fails
 * because of these.
 */
async function afterEtsyConnect(userId: string, shopId: string, previousOwnerId: string | null) {
  if (previousOwnerId && previousOwnerId !== userId) {
    try {
      const { onEtsyShopOwnershipChanged } = await import('@/lib/stock/hooks');
      await onEtsyShopOwnershipChanged(shopId, userId);
    } catch (err) {
      logger.error('onEtsyShopOwnershipChanged failed', err instanceof Error ? err : new Error(String(err)), { userId, shopId });
    }
  }
  // Decide the listing pass mode BEFORE anything else touches the shop: only a
  // shop that was never imported (or just changed owner) gets the silent
  // 'initial' import. A reconnect after a reauth gap runs with reconcile
  // semantics so transitions missed during the gap (deactivated / expired)
  // still alert.
  let listingMode: 'initial' | 'nightly' = 'initial';
  try {
    const ownerChanged = !!previousOwnerId && previousOwnerId !== userId;
    const shop = await prisma.etsyShop.findUnique({ where: { shopId }, select: { lastListingSyncAt: true } });
    const cachedCount = shop?.lastListingSyncAt ? 1 : await prisma.etsyListing.count({ where: { etsyShopId: shopId } });
    const { postConnectListingMode } = await import('@/lib/etsy/listingReconcile');
    listingMode = postConnectListingMode({ ownerChanged, lastListingSyncAt: shop?.lastListingSyncAt ?? null, cachedCount });
  } catch (err) {
    logger.warn('Post-connect listing mode lookup failed; using initial', { userId, shopId, error: err instanceof Error ? err.message : String(err) });
  }
  let requeued = 0;
  try {
    const { requeueBlockedEtsyEvents } = await import('@/lib/etsy/webhooks/queueOps');
    requeued = await requeueBlockedEtsyEvents(shopId);
    if (requeued) logger.info('Requeued Etsy webhook events after reconnect', { userId, shopId, count: requeued });
  } catch (err) {
    logger.error('requeueBlockedEtsyEvents failed', err instanceof Error ? err : new Error(String(err)), { userId, shopId });
  }
  void import('@/lib/orders/etsyLifecycle')
    .then((m) => m.runEtsyOrderIncremental(shopId, { reason: 'reconnect' }))
    .catch((err) => logger.warn('Post-connect Etsy order catch-up failed', { userId, shopId, error: err instanceof Error ? err.message : String(err) }));
  // Let the requeued listing.* webhooks drain first so they keep their
  // 'external' attribution and alert context; the reconcile then only picks up
  // what no webhook covered.
  void (requeued > 0 ? waitForParkedListingEvents(shopId) : Promise.resolve())
    .then(() => import('@/lib/etsy/listingReconcile'))
    .then((m) => m.reconcileShopListings(shopId, { mode: listingMode }))
    .then((r) =>
      logger.info('Post-connect Etsy listing import finished', { userId, shopId, mode: listingMode, success: r.success, fetched: r.fetched, synced: r.synced }),
    )
    .catch((err) => logger.warn('Post-connect Etsy listing import failed', { userId, shopId, error: err instanceof Error ? err.message : String(err) }));
}

const PARKED_DRAIN_MAX_MS = 3 * 60_000;
const PARKED_DRAIN_POLL_MS = 5_000;

/** Waits (bounded) until no listing:* webhook event of the shop is queued or processing. */
async function waitForParkedListingEvents(shopId: string): Promise<void> {
  const deadline = Date.now() + PARKED_DRAIN_MAX_MS;
  for (;;) {
    const pending = await prisma.webhookEvent
      .count({ where: { shopId, resourceKey: { startsWith: 'listing:' }, status: { in: ['received', 'processing'] } } })
      .catch(() => 0);
    if (pending === 0 || Date.now() >= deadline) return;
    await new Promise((r) => setTimeout(r, PARKED_DRAIN_POLL_MS));
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;

  // Handle Etsy OAuth errors
  if (error) {
    logger.error('Etsy OAuth error', undefined, {
      error: error as string,
      description: req.query.error_description as string
    });
    return res.redirect('/ayarlar?error=etsy_auth_failed');
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  let userId: string = '';
  let codeVerifier: string = '';
  let shopData: any = null;

  try {
    logger.info('Starting Etsy OAuth callback processing', { hasCode: !!code, hasState: !!state });

    // Verify the HMAC-signed state. Unsigned state would let an attacker
    // inject a victim's userId and write attacker-owned Etsy tokens to the
    // victim's row.
    const stateData = verifyOAuthState<{ userId?: string; codeVerifier?: string }>(state as string);
    if (!stateData || typeof stateData.userId !== 'string' || typeof stateData.codeVerifier !== 'string') {
      logger.error('Etsy OAuth state verification failed', undefined, {
        hasState: !!state,
      });
      return res.redirect('/ayarlar?error=etsy_auth_failed');
    }
    userId = stateData.userId;
    codeVerifier = stateData.codeVerifier;

    logger.info('Decoded OAuth state', { userId, hasCodeVerifier: !!codeVerifier });

    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: (process.env.ETSY_API_KEY || '').trim(),
      redirect_uri: (process.env.ETSY_REDIRECT_URI || '').trim(),
      code: code as string,
      code_verifier: codeVerifier
    });

    const tokenResponse = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      logger.error('Etsy token exchange failed', undefined, {
        status: tokenResponse.status,
        body: errorBody,
        userId
      });
      return res.redirect('/ayarlar?error=etsy_token_failed');
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    logger.info('Token exchange successful', { userId, hasAccessToken: !!tokens.access_token });

    // Validate API credentials - Etsy v3 requires keystring:shared_secret in x-api-key header
    const etsyKeystring = (process.env.ETSY_API_KEY || '').trim();
    const etsySharedSecret = (process.env.ETSY_API_SECRET || '').trim();
    if (!etsyKeystring) {
      logger.error('ETSY_API_KEY environment variable is not set', undefined, { userId });
      throw new Error('ETSY_API_KEY environment variable is not configured');
    }
    if (!etsySharedSecret) {
      logger.error('ETSY_API_SECRET environment variable is not set', undefined, { userId });
      throw new Error('ETSY_API_SECRET environment variable is not configured');
    }
    const etsyApiKey = `${etsyKeystring}:${etsySharedSecret}`;

    logger.info('Etsy API key check', {
      userId,
      keystringLength: etsyKeystring.length,
      hasSharedSecret: !!etsySharedSecret
    });

    // Step 1: Get user_id from /users/me
    const userResponse = await fetch('https://api.etsy.com/v3/application/users/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-api-key': etsyApiKey
      }
    });

    if (!userResponse.ok) {
      const errorBody = await userResponse.text();
      logger.error('Failed to fetch Etsy user info', undefined, {
        status: userResponse.status,
        body: errorBody,
        userId,
        apiKeySet: !!etsyApiKey,
        apiKeyLength: etsyApiKey.length
      });
      throw new Error(`Failed to get Etsy user info: ${userResponse.status} - ${errorBody}`);
    }

    const userData = await userResponse.json() as any;
    const etsyUserId = userData.user_id?.toString() || '';

    logger.info('Etsy user info retrieved', {
      userId,
      etsyUserId
    });

    // Step 2: Get actual shop_id from /users/{user_id}/shops
    const shopsResponse = await fetch(`https://api.etsy.com/v3/application/users/${etsyUserId}/shops`, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-api-key': etsyApiKey
      }
    });

    if (!shopsResponse.ok) {
      const errorBody = await shopsResponse.text();
      logger.error('Failed to fetch Etsy shops', undefined, {
        status: shopsResponse.status,
        body: errorBody,
        userId,
        etsyUserId
      });
      throw new Error(`Failed to get Etsy shops: ${shopsResponse.status} - ${errorBody}`);
    }

    const shopsData = await shopsResponse.json() as any;

    // Use the first shop (most users have one shop)
    const firstShop = shopsData.results?.[0] || shopsData;
    const actualShopId = firstShop.shop_id?.toString() || '';
    const shopName = firstShop.shop_name || `Shop ${actualShopId}`;

    if (!actualShopId) {
      throw new Error('No shop found for this Etsy user');
    }

    shopData = {
      shop_id: actualShopId,
      shop_name: shopName
    };

    logger.info('Etsy shop info retrieved', {
      userId,
      etsyUserId,
      shopId: actualShopId,
      shopName
    });

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    if (!shopData) {
      throw new Error('No shop data available');
    }

    // Who owned this Etsy shop before (EtsyShop.shopId is unique across users).
    const previousOwner = await prisma.etsyShop.findUnique({
      where: { shopId: shopData.shop_id.toString() },
      select: { userId: true },
    }).catch(() => null);

    // Check if user already has this shop
    const existingShop = await prisma.etsyShop.findUnique({
      where: {
        userId_shopId: {
          userId,
          shopId: shopData.shop_id.toString()
        }
      }
    });

    // Check if user has any Etsy shops yet (to determine if this should be default)
    const userShopCount = await prisma.etsyShop.count({
      where: { 
        userId,
        isActive: true 
      }
    });

    // Also check for legacy credentials
    const hasLegacyCredentials = await prisma.credential.findFirst({
      where: { 
        userId,
        etsyAccessToken: { not: null }
      }
    });

    const isFirstShop = userShopCount === 0 && !hasLegacyCredentials;

    // Store/update shop in new EtsyShop model
    let etsyShopSaved = false;
    try {
      await prisma.etsyShop.upsert({
        where: {
          userId_shopId: {
            userId,
            shopId: shopData.shop_id.toString()
          }
        },
        update: {
          shopName: shopData.shop_name,
          accessToken: encryptIfNeeded(tokens.access_token),
          refreshToken: encryptIfNeeded(tokens.refresh_token),
          tokenExpiresAt: tokenExpiresAt,
          isActive: true,
          // A fresh grant clears the reauth flag set on invalid_grant.
          needsReauth: false,
          needsReauthAt: null,
          updatedAt: new Date()
        },
        create: {
          userId,
          shopId: shopData.shop_id.toString(),
          shopName: shopData.shop_name,
          accessToken: encryptIfNeeded(tokens.access_token),
          refreshToken: encryptIfNeeded(tokens.refresh_token),
          tokenExpiresAt: tokenExpiresAt,
          isDefault: false, // No default shops - always auto-match
          isActive: true
        }
      });

      etsyShopSaved = true;
      // A successful (re)connect clears any open "reconnect Etsy" alert for this shop.
      void resolveNotification(userId, notificationKeys.reauth('etsy', shopData.shop_id.toString()));
      void afterEtsyConnect(userId, shopData.shop_id.toString(), previousOwner?.userId ?? null).catch(() => undefined);
      logger.info('Successfully stored shop in EtsyShop model', {
        userId,
        shopId: shopData.shop_id,
        shopName: shopData.shop_name,
        isFirstShop
      });
    } catch (etsyShopError) {
      logger.error('Failed to store in EtsyShop model', etsyShopError, {
        userId,
        shopId: shopData.shop_id
      });
    }

    // Update Credential table if this is the first shop OR if EtsyShop save failed (fallback).
    // Tokens are wrapped through encryptIfNeeded so production rows are stored as `enc:v1:`.
    if (isFirstShop || !etsyShopSaved) {
      const encAccess = encryptIfNeeded(tokens.access_token);
      const encRefresh = encryptIfNeeded(tokens.refresh_token);
      await prisma.credential.upsert({
        where: { userId },
        update: {
          etsyAccessToken: encAccess,
          etsyRefreshToken: encRefresh,
          etsyShopId: shopData.shop_id.toString(),
          etsyTokenExpiresAt: tokenExpiresAt,
          updatedAt: new Date()
        },
        create: {
          userId,
          etsyAccessToken: encAccess,
          etsyRefreshToken: encRefresh,
          etsyShopId: shopData.shop_id.toString(),
          etsyTokenExpiresAt: tokenExpiresAt
        }
      });

      if (!etsyShopSaved) {
        logger.warn('Fell back to Credential table for Etsy shop storage', {
          userId,
          shopId: shopData.shop_id
        });
      }
    }

    logger.info('Etsy OAuth completed successfully', {
      userId,
      shopId: shopData.shop_id,
      shopName: shopData.shop_name,
      expiresAt: tokenExpiresAt
    });

    // Redirect back to settings with success message
    logger.info('Etsy OAuth callback completed successfully', { 
      userId, 
      shopId: shopData.shop_id,
      shopName: shopData.shop_name 
    });
    recordActivation(userId, 'oauth_ok', 'etsy');
    res.redirect('/ayarlar?success=etsy_connected');

  } catch (error) {
    logger.error('Etsy OAuth callback failed', 
      error instanceof Error ? error : new Error(String(error)), {
        userId: userId || 'unknown',
        hasShopData: !!shopData,
        shopId: shopData?.shop_id,
        step: 'callback_processing'
      });

    const errorMsg = error instanceof Error ? error.message : String(error);
    const encodedError = encodeURIComponent(errorMsg.substring(0, 100));
    recordActivation(userId, 'oauth_fail', 'etsy');
    return res.redirect(`/ayarlar?error=etsy_callback_failed&details=${encodedError}`);
  }
}