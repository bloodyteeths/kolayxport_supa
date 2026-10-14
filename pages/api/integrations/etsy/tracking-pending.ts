import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { applyExtensionCors } from '@/lib/security/internalApiKey';

const CANCELLED_STATUS_VARIANTS = ['CANCELLED', 'CANCELED', 'cancelled', 'canceled', 'Cancelled', 'Canceled', 'REFUNDED', 'refunded', 'Refunded'];

function normTracking(v: unknown): string {
  return String(v || '').replace(/\s+/g, '').toUpperCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS: kolayxport.com + configured official extension origin only (fail closed).
  applyExtensionCors(req, res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: NextAuth cookie session or Bearer token from /api/auth/extension only.
  // No fallback by (public) Etsy shop name.
  const user = await getAuthUser(req, res);

  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    console.log('[tracking-pending] Authenticated user', { userId: user.id });

    // Resolve Etsy shop names to match orders by marketplace
    const etsyShops = await prisma.etsyShop.findMany({
      where: { userId: user.id, isActive: true },
      select: { shopName: true },
    });
    const etsyShopNames = etsyShops.map((s) => s.shopName).filter((n): n is string => !!n);

    // Optional keyset cursor: the last submissionId of the previous page.
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length <= 64 ? req.query.cursor : null;

    // Find tracking submissions for Etsy orders that haven't been pushed via extension yet
    // Orders may have shop name (e.g. "BelleCoutureGifts") as marketplace, not "etsy".
    // Cancelled orders are excluded. SHIPPED is deliberately NOT filtered:
    // submit-tracking sets status 'shipped' on submit, before the push.
    const rows = await prisma.trackingSubmission.findMany({
      where: {
        submittedBy: user.id,
        // needs_manual = typed by the extension but saving wasn't confirmed; keep offering it.
        etsySubmitStatus: { in: ['pending', 'needs_manual'] },
        order: {
          cancelledAt: null,
          AND: [
            {
              OR: [
                { marketplace: { contains: 'etsy', mode: 'insensitive' } },
                ...(etsyShopNames.length > 0
                  ? etsyShopNames.map((name) => ({ marketplace: name }))
                  : []),
              ],
            },
            { OR: [{ status: null }, { status: { notIn: CANCELLED_STATUS_VARIANTS } }] },
          ],
        },
      },
      select: {
        id: true,
        trackingNumber: true,
        carrierName: true,
        etsySubmitStatus: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            marketplaceKey: true,
            customerName: true,
            rawData: true,
          },
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // A number Etsy already shows on the receipt is done (pushed by the
    // extension, another app or by hand) — don't offer it again.
    const pending = rows.filter((ts) => {
      const ships = Array.isArray((ts.order.rawData as any)?.shipments) ? (ts.order.rawData as any).shipments : [];
      const remote = new Set(ships.map((x: any) => normTracking(x?.tracking_code)).filter(Boolean));
      return !remote.has(normTracking(ts.trackingNumber));
    });

    console.log('[tracking-pending] Query result', { userId: user.id, pendingCount: pending.length, shopNames: etsyShopNames });

    const result = pending.map((ts) => ({
      submissionId: ts.id,
      orderId: ts.order.id,
      receiptId: ts.order.orderNumber,
      marketplaceKey: ts.order.marketplaceKey,
      customerName: ts.order.customerName,
      trackingNumber: ts.trackingNumber,
      carrierName: ts.carrierName,
      status: ts.etsySubmitStatus,
    }));

    logger.info('[tracking-pending] Returning pending Etsy tracking', {
      userId: user.id,
      count: result.length,
    });

    return res.status(200).json({ pending: result, count: result.length });
  } catch (error) {
    logger.error('[tracking-pending] Error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
