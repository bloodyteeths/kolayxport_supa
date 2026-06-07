/**
 * Amazon SP-API outbound messaging.
 *
 * GET  ?orderId=…&marketplaceId=…
 *   Lists which message templates the seller is allowed to send to the
 *   buyer for this specific order. Amazon enforces per-order eligibility
 *   server-side: e.g. confirmDeliveryDetails only after the order has
 *   actually shipped, warranty only before delivery, etc.
 *
 * POST { orderId, marketplaceId, messageType, text?, action? }
 *   Sends one of the supported outbound templates. The `action` field is
 *   for the Solicitations API (e.g. request a product review).
 *
 * Amazon's `/messaging/v1/` API is one-way: there is no endpoint to read
 * buyer→seller messages. This composer is the entire surface area.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  getValidToken,
  callSpApiWithRetry,
  regionForMarketplaceId,
} from '@/lib/integrations/amazonClient';

export const config = { runtime: 'nodejs' };

/** Template types we accept on POST. Everything else is rejected at validation. */
type MessageType =
  | 'confirmCustomizationDetails'
  | 'confirmDeliveryDetails'
  | 'confirmOrderDetails'
  | 'confirmServiceDetails'
  | 'unexpectedProblem';

const TEXT_BODY_TYPES: ReadonlySet<MessageType> = new Set([
  'confirmCustomizationDetails',
  'confirmDeliveryDetails',
  'confirmOrderDetails',
  'confirmServiceDetails',
  'unexpectedProblem',
]);

/** Solicitations API actions. Distinct from /messaging/v1/. */
type SolicitationAction = 'productReviewAndSellerFeedback';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const cred: any = await prisma.credential.findUnique({ where: { userId: user.id } });
  if (!cred?.amazonAccessToken || !cred?.amazonRefreshToken) {
    return res.status(400).json({ error: 'Amazon account not connected.' });
  }

  const token = await getValidToken(cred, async (newToken: string, expiresAt: Date) => {
    await prisma.credential.update({
      where: { userId: user.id },
      data: { amazonAccessToken: newToken, amazonTokenExpiresAt: expiresAt } as any,
    });
  });
  if (!token) {
    return res.status(400).json({ error: 'Unable to obtain Amazon access token.' });
  }

  if (req.method === 'GET') {
    const orderId = String(req.query.orderId || '').trim();
    const marketplaceId = String(req.query.marketplaceId || cred.amazonMarketplaceId || '').trim();
    if (!orderId || !marketplaceId) {
      return res.status(400).json({ error: 'orderId and marketplaceId required' });
    }
    const region = regionForMarketplaceId(marketplaceId);
    try {
      const data: any = await callSpApiWithRetry(
        `/messaging/v1/orders/${encodeURIComponent(orderId)}?marketplaceIds=${marketplaceId}`,
        token, region, { method: 'GET' }, marketplaceId,
      );
      // SP-API returns HAL+JSON. `_links` carries the allowed actions.
      const links = data?._links || data?._embedded || {};
      const actions: string[] = [];
      for (const k of Object.keys(links)) {
        if (Array.isArray(links[k])) {
          for (const item of links[k]) {
            const name = item?.name || k;
            if (name && name !== 'self') actions.push(String(name));
          }
        } else if (typeof links[k] === 'object' && links[k]) {
          const name = (links[k] as any).name || k;
          if (name && name !== 'self') actions.push(String(name));
        }
      }
      return res.status(200).json({ orderId, marketplaceId, allowedActions: Array.from(new Set(actions)) });
    } catch (err: any) {
      const msg = (err?.message || String(err)).slice(0, 300);
      if (msg.includes('403')) {
        return res.status(403).json({
          error: 'Amazon rejected the request. The seller token does not yet include the Buyer Communication scope. Re-authorize this Amazon shop with the updated app role.',
        });
      }
      logger.error('Amazon messaging: GET allowedActions failed', err);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method === 'POST') {
    const { orderId, marketplaceId, messageType, action, text } = (req.body || {}) as {
      orderId?: string;
      marketplaceId?: string;
      messageType?: MessageType;
      action?: SolicitationAction;
      text?: string;
    };

    const mp = String(marketplaceId || cred.amazonMarketplaceId || '').trim();
    const oid = String(orderId || '').trim();
    if (!oid || !mp) return res.status(400).json({ error: 'orderId and marketplaceId required' });
    const region = regionForMarketplaceId(mp);

    // Solicitations API — request review / seller feedback.
    if (action) {
      if (action !== 'productReviewAndSellerFeedback') {
        return res.status(400).json({ error: 'Unsupported solicitation action.' });
      }
      try {
        await callSpApiWithRetry(
          `/solicitations/v1/orders/${encodeURIComponent(oid)}/solicitations/productReviewAndSellerFeedback?marketplaceIds=${mp}`,
          token, region, { method: 'POST', body: '' }, mp,
        );
        return res.status(200).json({ success: true, action });
      } catch (err: any) {
        const msg = (err?.message || String(err)).slice(0, 300);
        logger.error('Amazon solicitations failed', err);
        return res.status(500).json({ error: msg });
      }
    }

    // Templated messaging.
    if (!messageType || !TEXT_BODY_TYPES.has(messageType)) {
      return res.status(400).json({
        error: `messageType must be one of: ${Array.from(TEXT_BODY_TYPES).join(', ')}`,
      });
    }
    const body = (text || '').trim();
    if (body.length < 1 || body.length > 4000) {
      return res.status(400).json({ error: 'text must be 1–4000 characters' });
    }

    try {
      await callSpApiWithRetry(
        `/messaging/v1/orders/${encodeURIComponent(oid)}/messages/${messageType}?marketplaceIds=${mp}`,
        token, region,
        { method: 'POST', body: JSON.stringify({ text: body }) },
        mp,
      );
      logger.info('Amazon message sent', { userId: user.id, orderId: oid, messageType });
      return res.status(200).json({ success: true, orderId: oid, messageType });
    } catch (err: any) {
      const msg = (err?.message || String(err)).slice(0, 300);
      if (msg.includes('403')) {
        return res.status(403).json({
          error: 'Amazon rejected the send. The token lacks Buyer Communication scope, or this message type is not allowed for this order at this stage of its lifecycle.',
        });
      }
      logger.error('Amazon messaging: POST failed', err);
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
