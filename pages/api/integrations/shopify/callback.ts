// pages/api/integrations/shopify/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { encode } from 'next-auth/jwt';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';
import { encryptIfNeeded } from '@/lib/crypto/credentials';
import { clearConnectionAuthState } from '@/lib/integrations/authFailures';
import { SHOPIFY_API_VERSION } from '@/lib/integrations/shopifyApiVersion';
import {
  clearOAuthNonceCookie,
  isValidShopDomain,
  verifyOAuthState,
  verifyShopifyQueryHmac,
} from '@/lib/integrations/shopify/oauth';
import { recordActivation } from '@/lib/activation/events';

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

type ShopInfo = { email?: string; shop_owner?: string; name?: string };

async function fetchShopInfo(shop: string, accessToken: string): Promise<ShopInfo | null> {
  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ shop { name email shopOwnerName } }' }),
  });
  if (!response.ok) return null;
  const data = (await response.json())?.data?.shop;
  return data ? { name: data.name, email: data.email, shop_owner: data.shopOwnerName } : null;
}

async function provisionUserFromShop(args: {
  shopDomain: string;
  shopInfo: ShopInfo | null;
}): Promise<{ userId: string; created: boolean }> {
  // Only log back into an account this shop is already linked to. Matching on the
  // shop email alone would let anyone who sets their store's email to a victim's
  // address get a session for the victim's account.
  const linked = await prisma.shopifyShop.findUnique({
    where: { shopDomain: args.shopDomain },
    select: { userId: true },
  });
  if (linked) {
    return { userId: linked.userId, created: false };
  }

  // New shop: create a fresh account. Prefer the shop owner's email; if another
  // account already uses it, fall back to a per-shop placeholder (that user can
  // link this shop to their own account from Settings while logged in).
  const handle = args.shopDomain.replace('.myshopify.com', '');
  const rawEmail = (args.shopInfo?.email || '').toLowerCase().trim();
  const candidates = [
    rawEmail,
    `${handle}@shopify-install.kolayxport.com`,
    `${handle}+${uuidv4().slice(0, 8)}@shopify-install.kolayxport.com`,
  ].filter(Boolean);
  let email = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    if (!(await prisma.user.findUnique({ where: { email: candidate }, select: { id: true } }))) {
      email = candidate;
      break;
    }
  }

  const user = await prisma.user.create({
    data: {
      id: uuidv4(),
      email,
      name: args.shopInfo?.shop_owner || args.shopInfo?.name || args.shopDomain,
      // Shopify-installed merchants are on the free Shopify tier — no Stripe upsell.
      // emailVerified only when we kept the shop's own email (HMAC-verified via Shopify).
      emailVerified: email === rawEmail ? new Date() : null,
      subscriptionPlan: 'shopify_free',
      subscriptionStatus: 'active',
      billingProvider: 'shopify_free',
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

  if (!isValidShopDomain(shop)) {
    logger.error('Shopify callback invalid shop domain', undefined, { shop });
    return res.redirect('/ayarlar?error=shopify_missing_params');
  }

  if (!verifyShopifyQueryHmac(req.query as Record<string, string | string[] | undefined>, SHOPIFY_API_SECRET)) {
    logger.error('Shopify HMAC verification failed');
    return res.redirect('/ayarlar?error=shopify_hmac_failed');
  }

  // Decode state. Two flows:
  //   1) App Store install (state.appStoreInstall === true): no userId yet —
  //      auto-provision a KolayXport user from the shop email after token exchange.
  //   2) Settings-page connect (state.userId set): an existing user linking a shop.
  const verifiedState = verifyOAuthState(req, state, shop, SHOPIFY_API_SECRET);
  clearOAuthNonceCookie(res);
  const appStoreInstall = verifiedState?.appStoreInstall === true;
  let userId: string | null = typeof verifiedState?.userId === 'string' ? verifiedState.userId : null;
  if (!verifiedState || (!appStoreInstall && !userId)) {
    logger.error('Shopify callback invalid state', undefined, { shop });
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
    const shopInfo = await fetchShopInfo(shop, access_token);

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
    // Fresh grant: forget earlier auth failures and resolve a pending "reconnect" for this shop.
    await clearConnectionAuthState(userId, 'shopify', shop);

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

    // Any account with a connected Shopify store is on the free Shopify tier —
    // App Store rule 1.2.1 forbids exposing off-platform (Stripe) billing to
    // Shopify-installed merchants, regardless of how the store was connected.
    // Only an already-paying Stripe subscriber keeps their existing billing.
    const billingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { billingProvider: true, subscriptionStatus: true },
    });
    const isPayingStripeCustomer =
      billingUser?.billingProvider === 'stripe' &&
      (billingUser.subscriptionStatus === 'active' || billingUser.subscriptionStatus === 'past_due');
    if (!isPayingStripeCustomer && billingUser?.billingProvider !== 'shopify_free') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          billingProvider: 'shopify_free',
          subscriptionPlan: 'shopify_free',
          subscriptionStatus: 'active',
        },
      });
      logger.info('Shopify connect: user moved to free Shopify tier', { userId, shop });
    }

    // For App Store installs, log the merchant in immediately so they land
    // inside the app instead of hitting the login wall.
    if (appStoreInstall) {
      await setSessionCookie(res, userId);
      clearOAuthNonceCookie(res);
      const successKey = provisionedNow ? 'shopify_install_complete' : 'shopify_connected';
      logger.info('Shopify App Store install complete', { userId, shop, provisionedNow });
      recordActivation(userId, 'oauth_ok', 'shopify');
      return res.redirect(`/ayarlar?success=${successKey}`);
    }

    logger.info('Shopify store connected successfully', { userId, shop, scopes: scope });
    recordActivation(userId, 'oauth_ok', 'shopify');
    return res.redirect('/ayarlar?success=shopify_connected');
  } catch (error: any) {
    logger.error('Shopify callback error', error, { userId, shop });
    recordActivation(userId, 'oauth_fail', 'shopify');
    return res.redirect('/ayarlar?error=shopify_connection_failed');
  }
}
