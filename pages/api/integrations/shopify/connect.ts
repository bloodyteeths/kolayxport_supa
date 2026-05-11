// pages/api/integrations/shopify/connect.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../../lib/auth';
import { logger } from '../../../../lib/logger';
import crypto from 'crypto';

const SCOPES = 'read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_fulfillments,write_fulfillments';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
  const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;

  if (!SHOPIFY_API_KEY || !SHOPIFY_REDIRECT_URI) {
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

  const shop = req.query.shop as string;
  if (!shop || !shop.includes('.myshopify.com')) {
    return res.status(400).json({ error: 'Invalid shop domain. Must be like yourstore.myshopify.com' });
  }

  // Encode userId in state for callback verification
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(JSON.stringify({ userId: user.id, nonce })).toString('base64url');

  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` +
    `&state=${state}`;

  logger.info('Shopify OAuth connect initiated', { userId: user.id, shop });

  return res.redirect(authUrl);
}
