// pages/api/integrations/shopify/connect.ts
//
// NOTE: This is the in-app "link an additional shop" path, NOT the Shopify App
// Store install entry point. The App Store install URL is `/api/integrations/
// shopify/install`, which receives the shop domain from Shopify with an HMAC.
// This endpoint is only reachable by an already-authenticated KolayXport user
// who wants to attach another myshopify.com store to their existing account,
// which is permitted under App Store policy 2.3.1.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../../lib/auth';
import { logger } from '../../../../lib/logger';
import { SHOPIFY_SCOPES, createOAuthState, normalizeShopDomain } from '@/lib/integrations/shopify/oauth';
import { recordActivation } from '@/lib/activation/events';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
  const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SHOPIFY_REDIRECT_URI) {
    logger.error('Shopify env vars missing', undefined, {
      hasKey: !!SHOPIFY_API_KEY,
      hasRedirect: !!SHOPIFY_REDIRECT_URI,
    });
    return res.status(500).json({ error: 'Shopify integration not configured' });
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const shop = normalizeShopDomain(typeof req.query.shop === 'string' ? req.query.shop : '');
  if (!shop) {
    return res.status(400).json({ error: 'Invalid shop domain' });
  }

  const state = createOAuthState(res, { userId: user.id, shop }, SHOPIFY_API_SECRET);

  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  logger.info('Shopify OAuth connect initiated', { userId: user.id, shop });

  recordActivation(user.id, 'oauth_start', 'shopify');
  return res.redirect(authUrl);
}
