// pages/api/shopify/webhooks/app-uninstalled.ts
// Fired by Shopify when a merchant uninstalls the app. Deactivates the shop
// record so stale tokens are never reused; reinstall always runs fresh OAuth
// via /api/integrations/shopify/install (App Store policy 2.3.4).
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logIntegrationEvent, logSecurityEvent } from '@/lib/admin/events';
import { verifyShopifyHmac, readRawBody } from '@/lib/integrations/shopify/verifyWebhook';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;
  const shopDomain = req.headers['x-shopify-shop-domain'] as string | undefined;

  if (!verifyShopifyHmac(rawBody, hmac)) {
    logSecurityEvent('warn', {
      message: 'Shopify app/uninstalled HMAC verification failed',
      operation: 'shopify.signature_failed',
      details: { shopDomain },
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!shopDomain) {
    return res.status(400).json({ error: 'Missing shop domain header' });
  }

  try {
    const result = await prisma.shopifyShop.updateMany({
      where: { shopDomain },
      data: {
        isActive: false,
        accessToken: '',
        refreshToken: null,
        tokenExpiresAt: null,
      },
    });
    logIntegrationEvent('info', {
      message: 'Shopify app uninstalled — shop deactivated',
      operation: 'shopify.app_uninstalled',
      details: { shopDomain, updated: result.count },
    });
  } catch (err: any) {
    logger.error('Shopify app/uninstalled handling failed', err, { shopDomain });
    // Still 200 — Shopify retries on non-2xx and the shop row can be repaired manually.
  }

  return res.status(200).json({ success: true });
}
