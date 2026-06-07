// pages/api/integrations/shopify/install.ts
//
// App Store entry point. Shopify hits this URL (configured as `application_url`
// in shopify.app.toml) whenever a merchant clicks Install in the App Store or
// opens the app from their Shopify admin. Unlike /connect, this endpoint does
// NOT require an existing KolayXport login — the callback will auto-provision
// a user from the shop's owner email.

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';

const SCOPES = 'read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_fulfillments,write_fulfillments';

function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function verifyShopifyQueryHmac(
  query: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const hmac = query.hmac;
  if (typeof hmac !== 'string') return false;

  const message = Object.entries(query)
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')])
    .sort(([a], [b]) => (a as string).localeCompare(b as string))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(hmac, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
  const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SHOPIFY_REDIRECT_URI) {
    logger.error('Shopify install: env not configured', undefined, {
      hasKey: !!SHOPIFY_API_KEY,
      hasSecret: !!SHOPIFY_API_SECRET,
      hasRedirect: !!SHOPIFY_REDIRECT_URI,
    });
    return res.status(500).send('Shopify app not configured');
  }

  const shop = typeof req.query.shop === 'string' ? req.query.shop.trim().toLowerCase() : '';

  // No shop param — someone hit the URL directly, not from Shopify.
  if (!shop) {
    return res.redirect('/');
  }

  if (!isValidShopDomain(shop)) {
    logger.warn('Shopify install: invalid shop domain', { shop });
    return res.status(400).send('Invalid shop domain');
  }

  // Validate the Shopify-signed query string. The App Store install button always
  // includes an hmac; admin "open app" clicks include it too. We only enforce when
  // hmac is present so manual testing (paste URL with just ?shop=) still works.
  if (req.query.hmac && !verifyShopifyQueryHmac(req.query as any, SHOPIFY_API_SECRET)) {
    logger.error('Shopify install: hmac verification failed', undefined, { shop });
    return res.status(401).send('Invalid HMAC');
  }

  // If the shop is already connected with a live token, skip OAuth and send the
  // merchant straight to the app. The session cookie (if any) determines whether
  // they land on /ayarlar logged in, or hit the login wall.
  const existing = await prisma.shopifyShop.findUnique({ where: { shopDomain: shop } });
  if (
    existing &&
    existing.isActive &&
    existing.tokenExpiresAt &&
    existing.tokenExpiresAt > new Date()
  ) {
    return res.redirect(`/ayarlar?shop=${encodeURIComponent(shop)}`);
  }

  // Start OAuth. State marks this as an App Store install so the callback knows
  // to auto-provision a KolayXport user instead of requiring an existing one.
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(
    JSON.stringify({ appStoreInstall: true, shop, nonce }),
  ).toString('base64url');

  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` +
    `&state=${state}`;

  logger.info('Shopify App Store install initiated', { shop });
  return res.redirect(authUrl);
}
