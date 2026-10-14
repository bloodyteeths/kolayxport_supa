import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { applyExtensionCors } from '@/lib/security/internalApiKey';

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

    // Find tracking submissions for Etsy orders that haven't been pushed via extension yet
    // Orders may have shop name (e.g. "BelleCoutureGifts") as marketplace, not "etsy"
    const pending = await prisma.trackingSubmission.findMany({
      where: {
        submittedBy: user.id,
        // needs_manual = typed by the extension but saving wasn't confirmed; keep offering it.
        etsySubmitStatus: { in: ['pending', 'needs_manual'] },
        order: {
          OR: [
            { marketplace: { contains: 'etsy', mode: 'insensitive' } },
            ...(etsyShopNames.length > 0
              ? etsyShopNames.map((name) => ({ marketplace: name }))
              : []),
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
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 50,
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
