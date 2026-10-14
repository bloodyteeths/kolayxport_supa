import { buffer } from 'micro';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logIntegrationEvent, logSecurityEvent } from '@/lib/admin/events';
import { verifyEtsyWebhook } from '@/lib/etsy/webhooks/verify';
import {
  ETSY_WEBHOOK_PROVIDER,
  etsyEventPriority,
  isSupportedEtsyEvent,
  resourceKeyFor,
} from '@/lib/etsy/webhooks/events';
import { kickEtsyWorker } from '@/lib/etsy/webhooks/worker';

/**
 * Etsy webhook receiver (Standard Webhooks / Svix signing).
 *
 * Verifies the signature, stores the event (dedupe on webhook-id), answers
 * 200 immediately and leaves all Etsy API work to the queue worker
 * (lib/etsy/webhooks/worker.ts). Every stored event triggers one in-process
 * kick, whatever the env flags say; the 5 s worker loop, the 'etsy-webhook-sweep'
 * scheduler job and /api/cron/process-etsy-webhooks are the safety nets.
 *
 * Queue priority: order.* = 0, inventory.out_of_stock = 1, everything else = 2.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 64 * 1024;
const LAST_WEBHOOK_WRITE_MS = 60_000;
let missingSecretLogged = false;
const lastWebhookWrite = new Map<string, number>();

/** EtsyShop.lastWebhookAt, written at most once per 60 s per shop. Never throws. */
function touchLastWebhookAt(shopId: string, now: Date) {
  const prev = lastWebhookWrite.get(shopId) || 0;
  if (now.getTime() - prev < LAST_WEBHOOK_WRITE_MS) return;
  lastWebhookWrite.set(shopId, now.getTime());
  if (lastWebhookWrite.size > 5_000) lastWebhookWrite.clear();
  prisma.etsyShop.updateMany({
    where: { shopId, OR: [{ lastWebhookAt: null }, { lastWebhookAt: { lt: new Date(now.getTime() - LAST_WEBHOOK_WRITE_MS) } }] },
    data: { lastWebhookAt: now },
  }).catch(() => undefined);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.ETSY_WEBHOOK_SECRET;
  if (!secret) {
    if (!missingSecretLogged) {
      missingSecretLogged = true;
      logIntegrationEvent('error', {
        message: 'Etsy webhook received but ETSY_WEBHOOK_SECRET is not set',
        operation: 'etsy.webhook.secret_missing',
      });
    }
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await buffer(req, { limit: MAX_BODY_BYTES });
  } catch {
    return res.status(413).json({ error: 'Payload too large' });
  }

  const verified = verifyEtsyWebhook(req.headers, rawBody, secret);
  if (!verified.ok) {
    logSecurityEvent('warn', {
      message: 'Etsy webhook signature rejected',
      operation: 'etsy.webhook.bad_signature',
      details: { reason: verified.reason },
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const eventType = typeof payload.event_type === 'string' ? payload.event_type.slice(0, 64) : 'unknown';
  const shopId = payload.shop_id != null && /^\d+$/.test(String(payload.shop_id)) ? String(payload.shop_id) : null;
  const supported = isSupportedEtsyEvent(eventType) && !!shopId;
  const now = new Date();

  try {
    await prisma.webhookEvent.create({
      data: {
        id: `etsy:${verified.webhookId}`.slice(0, 191),
        provider: ETSY_WEBHOOK_PROVIDER,
        eventType,
        status: supported ? 'received' : 'ignored',
        errorMessage: supported ? null : 'ignored:unsupported event or missing shop_id',
        shopId,
        resourceKey: resourceKeyFor(eventType, payload),
        eventTypes: [eventType],
        priority: etsyEventPriority(eventType),
        firstReceivedAt: now,
        payload: { ...payload, __webhookTimestamp: verified.timestamp },
        nextAttemptAt: supported ? now : null,
        processedAt: supported ? null : now,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Etsy retry of an event we already stored.
      return res.status(200).json({ ok: true, duplicate: true });
    }
    logIntegrationEvent('error', {
      message: 'Failed to store Etsy webhook event',
      operation: 'etsy.webhook.store_failed',
      details: { eventType },
      error: err instanceof Error ? err : new Error(String(err)),
    });
    // Non-2xx so Etsy retries later.
    return res.status(500).json({ error: 'Storage failed' });
  }

  res.status(200).json({ ok: true });
  if (shopId) touchLastWebhookAt(shopId, now);
  // Orders: short debounce so the seller sees them within seconds. Listing
  // bursts (listing.updated + inventory.updated) get 3 s to coalesce.
  if (supported) setImmediate(() => kickEtsyWorker(etsyEventPriority(eventType) === 0 ? 500 : 3_000));
}
