import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

function verifyWebhookHmac(body: string, hmac: string | undefined): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !hmac) return false;
  const generated = crypto.createHmac('sha256', secret).update(body).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(hmac));
  } catch {
    return false;
  }
}

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

  if (!verifyWebhookHmac(rawBody, hmac)) {
    logger.error('Shopify subscription webhook HMAC failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = JSON.parse(rawBody);
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;
    const subscriptionGid = payload.app_subscription?.admin_graphql_api_id;
    const status = payload.app_subscription?.status;

    logger.info('Shopify subscription webhook received', { shopDomain, subscriptionGid, status });

    if (!subscriptionGid || !shopDomain) {
      return res.status(200).json({ success: true });
    }

    const shop = await prisma.shopifyShop.findFirst({
      where: { shopDomain, isActive: true },
    });

    if (!shop) {
      logger.warn('Shopify subscription webhook: shop not found', { shopDomain });
      return res.status(200).json({ success: true });
    }

    const statusMap: Record<string, string> = {
      ACTIVE: 'active',
      CANCELLED: 'cancelled',
      DECLINED: 'cancelled',
      EXPIRED: 'expired',
      FROZEN: 'past_due',
      PENDING: 'pending',
    };

    const internalStatus = statusMap[status] || status?.toLowerCase() || 'unknown';

    await prisma.user.updateMany({
      where: { id: shop.userId, shopifySubscriptionId: subscriptionGid },
      data: {
        subscriptionStatus: internalStatus,
        ...(internalStatus === 'cancelled' ? { shopifySubscriptionId: null } : {}),
      },
    });

    logger.info('Shopify subscription status updated', {
      userId: shop.userId,
      subscriptionGid,
      status: internalStatus,
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Shopify subscription webhook error', error);
    return res.status(200).json({ success: true });
  }
}
