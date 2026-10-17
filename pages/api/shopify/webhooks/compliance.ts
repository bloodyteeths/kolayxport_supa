// pages/api/shopify/webhooks/compliance.ts
// Mandatory GDPR compliance webhooks required by Shopify.
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logSecurityEvent, logIntegrationEvent } from '@/lib/admin/events';
import { verifyShopifyHmac, readRawBody } from '@/lib/integrations/shopify/verifyWebhook';
import { deleteShopOrders, redactCustomerOrders } from '@/lib/integrations/shopify/redact';

export const config = { api: { bodyParser: false } };

async function recordShopifyWebhook(args: {
  rawBody: string;
  topic: string | undefined;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  errorMessage?: string;
}) {
  try {
    // Synthetic id — Shopify does not send a deterministic webhook event id.
    const id = 'shopify_' + crypto.createHash('sha256').update(args.rawBody).digest('hex').slice(0, 24);
    await (prisma as any).webhookEvent.upsert({
      where: { id },
      update: {
        provider: 'shopify',
        eventType: args.topic ?? null,
        status: args.status,
        errorMessage: args.errorMessage?.slice(0, 200) ?? null,
      },
      create: {
        id,
        provider: 'shopify',
        eventType: args.topic ?? null,
        status: args.status,
        errorMessage: args.errorMessage?.slice(0, 200) ?? null,
      },
    });
  } catch {
    /* trace-only failure */
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;
  const topic = req.headers['x-shopify-topic'] as string | undefined;

  if (!verifyShopifyHmac(rawBody, hmac)) {
    logSecurityEvent('warn', {
      message: 'Shopify webhook HMAC verification failed',
      operation: 'shopify.signature_failed',
      details: { topic },
    });
    await recordShopifyWebhook({ rawBody, topic, status: 'failed', errorMessage: 'hmac_failed' });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await recordShopifyWebhook({ rawBody, topic, status: 'failed', errorMessage: 'invalid_json' });
    return res.status(200).json({ success: true });
  }
  const shopDomain = (req.headers['x-shopify-shop-domain'] as string | undefined) || payload.shop_domain;

  switch (topic) {
    case 'customers/data_request':
      logIntegrationEvent('info', {
        message: 'Shopify customers/data_request received',
        operation: 'shopify.compliance.data_request',
        details: {
          shopDomain,
          customerIdSuffix: String(payload.customer?.id ?? '').slice(-4),
        },
      });
      break;

    case 'customers/redact': {
      // Strip the customer's personal data from the orders Shopify lists.
      let redacted = 0;
      if (shopDomain) {
        try {
          redacted = await redactCustomerOrders(shopDomain, Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact : []);
        } catch (err: any) {
          logger.error('Shopify customers/redact failed', err, { shopDomain });
        }
      }
      logIntegrationEvent('info', {
        message: 'Shopify customers/redact processed',
        operation: 'shopify.compliance.customer_redact',
        details: {
          shopDomain,
          customerIdSuffix: String(payload.customer?.id ?? '').slice(-4),
          redacted,
        },
      });
      break;
    }

    case 'shop/redact': {
      // Sent 48h after uninstall: drop the shop's synced orders, the shop, its synced products (cascade)
      // and the legacy token copy on Credential. Orders first: they are found through the shop's user.
      let shopsDeleted = 0;
      let ordersDeleted = 0;
      if (shopDomain) {
        try {
          ordersDeleted = await deleteShopOrders(shopDomain);
          shopsDeleted = (await prisma.shopifyShop.deleteMany({ where: { shopDomain } })).count;
          await prisma.credential.updateMany({
            where: { shopifyShopDomain: shopDomain },
            data: { shopifyAccessToken: null, shopifyShopDomain: null },
          });
        } catch (err: any) {
          logger.error('Shopify shop/redact cleanup failed', err, { shopDomain });
        }
      }
      logIntegrationEvent('info', {
        message: 'Shopify shop/redact processed',
        operation: 'shopify.compliance.shop_redact',
        details: { shopDomain, shopId: payload.shop_id, shopsDeleted, ordersDeleted },
      });
      break;
    }

    default:
      logger.info('Shopify compliance webhook received', { topic });
  }

  await recordShopifyWebhook({ rawBody, topic, status: 'processed' });
  return res.status(200).json({ success: true });
}
