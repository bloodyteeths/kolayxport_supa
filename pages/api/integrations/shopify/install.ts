// pages/api/integrations/shopify/install.ts
//
// App Store entry point. Shopify hits this URL (configured as `application_url`
// in shopify.app.toml) whenever a merchant clicks Install in the App Store or
// opens the app from their Shopify admin. Unlike /connect, this endpoint does
// NOT require an existing KolayXport login — the callback will auto-provision
// a user from the shop's owner email.

import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../../../../lib/logger';
import {
  SHOPIFY_SCOPES,
  createOAuthState,
  isValidShopDomain,
  verifyShopifyQueryHmac,
} from '@/lib/integrations/shopify/oauth';

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

  // App Store policy 2.3.4 requires OAuth to run on every install/reinstall hit,
  // even when a valid token exists server-side. Token-reuse belongs in API call
  // paths, not the install entry point.
  const state = createOAuthState(res, { appStoreInstall: true, shop }, SHOPIFY_API_SECRET);

  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  logger.info('Shopify App Store install initiated', { shop });
  return res.redirect(authUrl);
}
