import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { applyExtensionCors } from '@/lib/security/internalApiKey';
import { hasStreet, parseStoredAddress } from '@/lib/orders/addressMerge';
import { isCancelledStatus } from '@/lib/orders/orderStatus';

/**
 * GET /api/integrations/etsy/address-pending   (Chrome extension v9.6.0 address queue)
 *
 * Etsy's API withholds buyer addresses; the extension scrapes them when the
 * seller opens an order page (POST /api/integrations/etsy/addresses). This
 * lists the direct-Etsy orders of the last 30 days that still have no street
 * address and no EtsyAddress row, newest first, max 100, so the extension can
 * badge the count and open the next order page.
 *
 * Auth: same as addresses.ts / tracking-pending.ts (session cookie or the
 * extension Bearer token). Returns ids only — no buyer PII.
 * -> { pending: [{ orderId, receiptId, orderUrl }], count }
 */
const WINDOW_DAYS = 30;
const MAX_RESULTS = 100;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyExtensionCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const shops = await prisma.etsyShop.findMany({ where: { userId: user.id, isActive: true }, select: { shopName: true } });
    const shopNames = shops.map((s) => s.shopName).filter((n): n is string => !!n);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await prisma.order.findMany({
      where: {
        userId: user.id,
        cancelledAt: null,
        OR: [{ uiOrderDate: { gte: since } }, { uiOrderDate: null, createdAt: { gte: since } }],
        AND: [
          {
            OR: [
              { source: 'etsy-api' },
              { marketplace: { contains: 'etsy', mode: 'insensitive' } },
              ...shopNames.map((name) => ({ marketplace: name })),
            ],
          },
        ],
      },
      select: { id: true, orderNumber: true, marketplaceKey: true, status: true, externalStatus: true, source: true, shippingAddress: true },
      orderBy: [{ uiOrderDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });

    const missing = rows.filter(
      (o) =>
        /^\d+$/.test(o.marketplaceKey) &&
        // direct Etsy receipts only (aggregator copies are keyed by the aggregator's own id)
        (o.source === 'etsy-api' || o.marketplaceKey === o.orderNumber) &&
        !isCancelledStatus(o.status, o.externalStatus) &&
        !hasStreet(parseStoredAddress(o.shippingAddress)),
    );
    const numbers = missing.map((o) => o.orderNumber);
    const scraped = numbers.length
      ? await prisma.etsyAddress.findMany({ where: { userId: user.id, orderNumber: { in: numbers } }, select: { orderNumber: true } })
      : [];
    const haveRow = new Set(scraped.map((r) => r.orderNumber));

    const pending = missing
      .filter((o) => !haveRow.has(o.orderNumber))
      .slice(0, MAX_RESULTS)
      .map((o) => ({
        orderId: o.id,
        receiptId: o.marketplaceKey,
        orderUrl: `https://www.etsy.com/your/orders/sold?order_id=${encodeURIComponent(o.marketplaceKey)}`,
      }));

    return res.status(200).json({ pending, count: pending.length });
  } catch (error) {
    logger.error('[address-pending] Error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
