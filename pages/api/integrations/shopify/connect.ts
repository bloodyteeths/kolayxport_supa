// pages/api/integrations/shopify/connect.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../../lib/auth';
import { logger } from '../../../../lib/logger';
import crypto from 'crypto';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI!;
const SCOPES = 'read_orders,read_products,write_products,read_inventory,write_inventory';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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
