// pages/api/integrations/shopify/status.ts
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
        },
      });

      // Validate at least one shop connection
      if (shops.length === 0) {
        return res.status(200).json({ connected: false, shops: [] });
      }

      return res.status(200).json({ connected: true, shops });
    } catch (error: any) {
      logger.error('Shopify status check failed', error, { userId: user.id });
      return res.status(500).json({ error: 'Failed to check Shopify status' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { shopId } = req.body || {};
      if (shopId) {
        await prisma.shopifyShop.update({
          where: { id: shopId, userId: user.id },
          data: { isActive: false },
        });
      } else {
        // Disconnect all
        await prisma.shopifyShop.updateMany({
          where: { userId: user.id },
          data: { isActive: false },
        });
        await prisma.credential.update({
          where: { userId: user.id },
          data: { shopifyAccessToken: null, shopifyShopDomain: null },
        });
      }

      logger.info('Shopify store disconnected', { userId: user.id, shopId });
      return res.status(200).json({ success: true });
    } catch (error: any) {
      logger.error('Shopify disconnect failed', error, { userId: user.id });
      return res.status(500).json({ error: 'Failed to disconnect Shopify' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
