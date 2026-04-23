import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS for Chrome extension
  const origin = req.headers.origin;
  const ALLOWED_EXTENSION_IDS = [process.env.CHROME_EXTENSION_ID].filter(Boolean);
  if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
    const extensionId = origin.replace('chrome-extension://', '').replace('moz-extension://', '');
    if (ALLOWED_EXTENSION_IDS.length === 0 || ALLOWED_EXTENSION_IDS.includes(extensionId)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://kolayxport.com');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Extension-Version, X-Extension-Auth');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: NextAuth session or extension fallback via shop name
  let user = await getAuthUser(req, res);

  if (!user && origin && origin.startsWith('chrome-extension://')) {
    const shopName = req.query.shopName as string | undefined;
    if (shopName) {
      const shop = await prisma.etsyShop.findFirst({
        where: { shopName: { equals: shopName, mode: 'insensitive' }, isActive: true },
        select: { userId: true, user: { select: { id: true, email: true, name: true } } },
      });
      if (shop?.user) {
        user = { id: shop.user.id, email: shop.user.email, name: shop.user.name };
      }
    }
  }

  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    console.log('[tracking-pending] Authenticated user', { userId: user.id, email: user.email });

    // Resolve Etsy shop names to match orders by marketplace
    const etsyShops = await prisma.etsyShop.findMany({
      where: { userId: user.id, isActive: true },
      select: { shopName: true },
    });
    const etsyShopNames = etsyShops.map((s) => s.shopName).filter((n): n is string => !!n);
    console.log('[tracking-pending] Etsy shops for user', { userId: user.id, etsyShopNames });

    // Find tracking submissions for Etsy orders that haven't been pushed via extension yet
    // Orders may have shop name (e.g. "BelleCoutureGifts") as marketplace, not "etsy"
    const pending = await prisma.trackingSubmission.findMany({
      where: {
        submittedBy: user.id,
        etsySubmitStatus: 'pending',
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
