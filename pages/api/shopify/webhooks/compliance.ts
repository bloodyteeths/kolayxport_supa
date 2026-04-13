// pages/api/shopify/webhooks/compliance.ts
// Mandatory GDPR compliance webhooks required by Shopify
import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../../../../lib/logger';
import crypto from 'crypto';

function verifyWebhookHmac(body: string, hmac: string | undefined): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !hmac) return false;
  const generated = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(hmac));
}

export const config = { api: { bodyParser: false } };

async function getRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;
  const topic = req.headers['x-shopify-topic'] as string | undefined;

  if (!verifyWebhookHmac(rawBody, hmac)) {
    logger.error('Shopify webhook HMAC verification failed', undefined, { topic });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = JSON.parse(rawBody);

  switch (topic) {
    case 'customers/data_request':
      // Shopify asks us to report what customer data we store
      // We only store order data (name, address) linked to the shop
      logger.info('Shopify customers/data_request received', {
        shopDomain: req.headers['x-shopify-shop-domain'],
        customerId: payload.customer?.id,
      });
      break;

    case 'customers/redact':
      // Shopify asks us to delete customer data
      logger.info('Shopify customers/redact received', {
        shopDomain: req.headers['x-shopify-shop-domain'],
        customerId: payload.customer?.id,
      });
      // We don't store customer data separately — order data is tied to orders
      break;

    case 'shop/redact':
      // Shopify asks us to delete all shop data (48h after uninstall)
      logger.info('Shopify shop/redact received', {
        shopDomain: req.headers['x-shopify-shop-domain'],
        shopId: payload.shop_id,
      });
      // Could clean up ShopifyShop + ShopifyProduct records here
      break;

    default:
      logger.info('Shopify webhook received', { topic });
  }

  return res.status(200).json({ success: true });
}
