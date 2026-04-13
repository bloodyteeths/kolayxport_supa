// pages/api/integrations/shopify/shops.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { logger } from '../../../../lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.method === 'GET') {
    try {
      const shops = await prisma.shopifyShop.findMany({
        where: { userId: user.id, isActive: true },
        select: {
          id: true,
          shopDomain: true,
          shopName: true,
          isActive: true,
          lastOrderSyncAt: true,
          lastProductSyncAt: true,
          createdAt: true,
          scopes: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ shops });
    } catch (error: any) {
      logger.error('Failed to list Shopify shops', error, { userId: user.id });
      return res.status(500).json({ error: 'Failed to list shops' });
    }
  }

  if (req.method === 'POST') {
    const { action, shopId } = req.body;

    if (action === 'delete' && shopId) {
      try {
        // Soft-delete by marking inactive
        await prisma.shopifyShop.update({
          where: { id: shopId, userId: user.id },
          data: { isActive: false },
        });

        // Check if any active shops remain
        const remaining = await prisma.shopifyShop.count({
          where: { userId: user.id, isActive: true },
        });

        // Clear credential if no active shops
        if (remaining === 0) {
          await prisma.credential.update({
            where: { userId: user.id },
            data: { shopifyAccessToken: null, shopifyShopDomain: null },
          });
        }

        logger.info('Shopify shop disconnected', { userId: user.id, shopId });
        return res.status(200).json({ success: true });
      } catch (error: any) {
        logger.error('Failed to disconnect Shopify shop', error, { userId: user.id, shopId });
        return res.status(500).json({ error: 'Failed to disconnect shop' });
      }
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
