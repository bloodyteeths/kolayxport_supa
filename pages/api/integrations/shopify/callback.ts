// pages/api/integrations/shopify/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { encode } from 'next-auth/jwt';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';
import { encryptIfNeeded } from '@/lib/crypto/credentials';
import crypto from 'crypto';

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

async function setSessionCookie(res: NextApiResponse, userId: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    logger.error('Shopify callback: NEXTAUTH_SECRET missing — cannot set session cookie');
    return;
  }
  const useSecureCookies = (process.env.NEXTAUTH_URL || '').startsWith('https://');
  const cookieName = useSecureCookies
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token';
  const token = await encode({
    token: { sub: userId },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  const cookieParts = [
    `${cookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ];
  if (useSecureCookies) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

async function provisionUserFromShop(args: {
  shopDomain: string;
  shopInfo: { email?: string; shop_owner?: string; name?: string } | null;
}): Promise<{ userId: string; created: boolean }> {
  // Prefer the shop owner's contact email (returned by /admin/api/shop.json),
  // fall back to a deterministic placeholder so we never leave email null.
  const rawEmail = (args.shopInfo?.email || '').toLowerCase().trim();
  const fallbackEmail = `${args.shopDomain.replace('.myshopify.com', '')}@shopify-install.kolayxport.com`;
  const email = rawEmail || fallbackEmail;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { userId: existing.id, created: false };
  }

  const trialMs = 30 * 24 * 60 * 60 * 1000;
  const user = await prisma.user.create({
    data: {
      id: uuidv4(),
      email,
      name: args.shopInfo?.shop_owner || args.shopInfo?.name || args.shopDomain,
      // Shopify-installed merchants are on the free Shopify tier — no Stripe upsell.
      // emailVerified is set to now() because we trust Shopify's HMAC-verified shop info.
      emailVerified: rawEmail ? new Date() : null,
      subscriptionPlan: 'shopify_free',
      subscriptionStatus: 'active',
      billingProvider: 'shopify_free',
      trialExpiresAt: new Date(Date.now() + trialMs),
      usageResetAt: new Date(Date.now() + trialMs),
      orderSyncCount: 0,
      labelCount: 0,
    },
  });
  return { userId: user.id, created: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return res.redirect('/ayarlar?error=shopify_connection_failed');
  }

  const { code, shop, state, hmac } = req.query as Record<string, string>;

  if (!code || !shop || !state || !hmac) {
    logger.error('Shopify callback missing params', undefined, { query: req.query });
    return res.redirect('/ayarlar?error=shopify_missing_params');
  }

  // Verify HMAC
  const queryWithoutHmac = Object.entries(req.query)
    .filter(([key]) => key !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(queryWithoutHmac)
    .digest('hex');

  if (generatedHmac !== hmac) {
    logger.error('Shopify HMAC verification failed');
    return res.redirect('/ayarlar?error=shopify_hmac_failed');
  }

  // Decode state. Two flows:
  //   1) App Store install (state.appStoreInstall === true): no userId yet —
  //      auto-provision a KolayXport user from the shop email after token exchange.
  //   2) Settings-page connect (state.userId set): an existing user linking a shop.
  let userId: string | null = null;
  let appStoreInstall = false;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    appStoreInstall = decoded.appStoreInstall === true;
    userId = typeof decoded.userId === 'string' ? decoded.userId : null;
    if (!appStoreInstall && !userId) {
      throw new Error('No userId in state and not an install');
    }
  } catch (e) {
    logger.error('Shopify callback invalid state', undefined, { state });
    return res.redirect('/ayarlar?error=shopify_invalid_state');
  }

  try {
    // Exchange code for an expiring offline access token (required since April 2026).
    // Shopify defaults to non-expiring offline tokens unless expiring=1 is supplied.
    const tokenParams = new URLSearchParams({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
      expiring: '1',
    });

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      logger.error('Shopify token exchange failed', undefined, { status: tokenResponse.status, body: err });
      return res.redirect('/ayarlar?error=shopify_token_failed');
    }

    const tokenData = await tokenResponse.json();
    const { access_token, scope, refresh_token, expires_in } = tokenData;
    const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

    logger.info('Shopify token exchange response', {
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      expiresIn: expires_in,
      tokenExpiresAt: tokenExpiresAt?.toISOString(),
      scope,
    });

    if (!access_token || !refresh_token || !expires_in || !tokenExpiresAt) {
      logger.error('Shopify returned a non-expiring token response', undefined, {
        hasAccessToken: !!access_token,
        hasRefreshToken: !!refresh_token,
        expiresIn: expires_in,
        shop,
      });
      return res.redirect('/ayarlar?error=shopify_expiring_token_required');
    }

    // Fetch shop info — used for shop name AND (for App Store installs) owner email.
    const shopInfoResponse = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': access_token },
    });
    const shopInfo = shopInfoResponse.ok ? (await shopInfoResponse.json()).shop : null;

    // App Store install: auto-provision the KolayXport user from the shop email
    // before we persist ShopifyShop (which requires a userId).
    let provisionedNow = false;
    if (appStoreInstall) {
      const result = await provisionUserFromShop({ shopDomain: shop, shopInfo });
      userId = result.userId;
      provisionedNow = result.created;
      logger.info('Shopify App Store install: user resolved', {
        userId,
        shop,
        created: result.created,
      });
    }

    if (!userId) {
      logger.error('Shopify callback: userId unresolved', undefined, { shop, appStoreInstall });
      return res.redirect('/ayarlar?error=shopify_connection_failed');
    }

    // Encrypt before persisting. Both ShopifyShop and Credential live behind
    // the same encryption envelope, so reads through `decryptIfNeeded` work uniformly.
    const encAccess = encryptIfNeeded(access_token);
    const encRefresh = refresh_token ? encryptIfNeeded(refresh_token) : null;

    // Upsert ShopifyShop record
    await prisma.shopifyShop.upsert({
      where: { shopDomain: shop },
      create: {
        userId,
        shopDomain: shop,
        shopName: shopInfo?.name || shop.split('.')[0],
        accessToken: encAccess,
        refreshToken: encRefresh,
        tokenExpiresAt,
        scopes: scope,
        isActive: true,
      },
      update: {
        userId,
        accessToken: encAccess,
        refreshToken: encRefresh,
        tokenExpiresAt,
        scopes: scope,
        shopName: shopInfo?.name || undefined,
        isActive: true,
      },
    });

    // Also update Credential for backward compat
    await prisma.credential.upsert({
      where: { userId },
      create: {
        userId,
        shopifyAccessToken: encAccess,
        shopifyShopDomain: shop,
      },
      update: {
        shopifyAccessToken: encAccess,
        shopifyShopDomain: shop,
      },
    });

    // Register subscription update webhook
    try {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'https://kolayxport.com';
      await fetch(`https://${shop}/admin/api/2024-10/webhooks.json`, {
        method: 'POST',
        headers: {
          // raw token — webhook registration happens before we read the encrypted row back
          'X-Shopify-Access-Token': access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhook: {
            topic: 'app_subscriptions/update',
            address: `${baseUrl}/api/shopify/webhooks/subscription-update`,
            format: 'json',
          },
        }),
      });
    } catch (webhookErr: any) {
      logger.warn('Failed to register subscription webhook (non-fatal)', { error: webhookErr.message });
    }

    // For App Store installs, log the merchant in immediately so they land
    // inside the app instead of hitting the login wall.
    if (appStoreInstall) {
      await setSessionCookie(res, userId);
      const successKey = provisionedNow ? 'shopify_install_complete' : 'shopify_connected';
      logger.info('Shopify App Store install complete', { userId, shop, provisionedNow });
      return res.redirect(`/ayarlar?success=${successKey}`);
    }

    logger.info('Shopify store connected successfully', { userId, shop, scopes: scope });
    return res.redirect('/ayarlar?success=shopify_connected');
  } catch (error: any) {
    logger.error('Shopify callback error', error, { userId, shop });
    return res.redirect('/ayarlar?error=shopify_connection_failed');
  }
}
