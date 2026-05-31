import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';
import { logSecurityEvent } from '@/lib/admin/events';
import { verifyShopifyHmac, readRawBody } from '@/lib/integrations/shopify/verifyWebhook';

export const config = { api: { bodyParser: false } };

async function recordShopifyWebhook(args: {
  rawBody: string;
  eventType: string;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  errorMessage?: string;
  userId?: string | null;
}) {
  try {
    const id = 'shopify_' + crypto.createHash('sha256').update(args.rawBody).digest('hex').slice(0, 24);
    await (prisma as any).webhookEvent.upsert({
      where: { id },
      update: {
        provider: 'shopify',
        eventType: args.eventType,
        status: args.status,
        errorMessage: args.errorMessage?.slice(0, 200) ?? null,
        userId: args.userId ?? null,
      },
      create: {
        id,
        provider: 'shopify',
        eventType: args.eventType,
        status: args.status,
        errorMessage: args.errorMessage?.slice(0, 200) ?? null,
        userId: args.userId ?? null,
      },
    });
  } catch { /* trace-only */ }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

  if (!verifyShopifyHmac(rawBody, hmac)) {
    logSecurityEvent('warn', {
      message: 'Shopify subscription webhook HMAC verification failed',
      operation: 'shopify.signature_failed',
    });
    await recordShopifyWebhook({ rawBody, eventType: 'subscription_update', status: 'failed', errorMessage: 'hmac_failed' });
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

    await recordShopifyWebhook({
      rawBody,
      eventType: 'subscription_update',
      status: 'processed',
      userId: shop.userId,
    });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Shopify subscription webhook error', error);
    await recordShopifyWebhook({
      rawBody,
      eventType: 'subscription_update',
      status: 'failed',
      errorMessage: error?.message ?? String(error),
    });
    return res.status(200).json({ success: true });
  }
}
