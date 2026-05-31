import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Auth: API key or session
  let authUserId: string;
  const apiKey = req.headers['x-api-key'];
  const envApiKey = process.env.CLAWD_API_KEY;

  if (envApiKey && apiKey === envApiKey) {
    const qUserId = req.query.userId as string;
    if (!qUserId) return res.status(400).json({ error: 'userId required with API key auth' });
    authUserId = qUserId;
  } else {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    authUserId = user.id;
  }

  if (req.method === 'GET') {
    // Get all Etsy shops for the user
    try {
      const etsyShops = await prisma.etsyShop.findMany({
        where: { 
          userId: authUserId,
          isActive: true 
        },
        select: {
          id: true,
          shopId: true,
          shopName: true,
          isDefault: true,
          isActive: true,
          tokenExpiresAt: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [
          { createdAt: 'desc' }
        ]
      });

      // Also check for legacy connection in Credential model
      const legacyCredential = await prisma.credential.findUnique({
        where: { userId: authUserId },
        select: {
          etsyAccessToken: true,
          etsyShopId: true,
          etsyTokenExpiresAt: true
        }
      });

      // If there's a legacy connection that's not in EtsyShop table, include it
      let allShops = [...etsyShops];
      if (legacyCredential?.etsyAccessToken && legacyCredential?.etsyShopId) {
        const legacyShopExists = etsyShops.some(shop => shop.shopId === legacyCredential.etsyShopId);
        if (!legacyShopExists) {
          allShops.unshift({
            id: `legacy-${legacyCredential.etsyShopId}`,
            shopId: legacyCredential.etsyShopId,
            shopName: `Shop ${legacyCredential.etsyShopId}`,
            isDefault: false, // No default shops
            isActive: true,
            tokenExpiresAt: legacyCredential.etsyTokenExpiresAt,
            createdAt: new Date(),
            updatedAt: new Date()
          } as any);
        }
      }

      return res.status(200).json({ shops: allShops });
    } catch (error) {
      logger.error('Failed to fetch Etsy shops', error instanceof Error ? error : new Error(String(error)));
      return res.status(500).json({ error: 'Failed to fetch Etsy shops' });
    }
  }

  if (req.method === 'POST') {
    // Set default shop
    const { shopId, action } = req.body;

    if (!shopId || !action) {
      return res.status(400).json({ error: 'Shop ID and action are required' });
    }

    try {

      if (action === 'delete') {
        // Check if it's a legacy shop
        if (shopId.startsWith('legacy-')) {
          const actualShopId = shopId.replace('legacy-', '');
          // Clear legacy credentials
          await prisma.credential.update({
            where: { userId: authUserId },
            data: {
              etsyAccessToken: null,
              etsyRefreshToken: null,
              etsyShopId: null,
              etsyTokenExpiresAt: null
            }
          });
        } else {
          // Soft delete by setting isActive to false
          await prisma.etsyShop.update({
            where: { 
              userId_shopId: { 
                userId: authUserId, 
                shopId: shopId 
              }
            },
            data: { isActive: false }
          });
        }

        return res.status(200).json({ message: 'Shop disconnected successfully' });
      }

      return res.status(400).json({ error: 'Invalid action' });
    } catch (error) {
      logger.error('Failed to update Etsy shop', error instanceof Error ? error : new Error(String(error)));
      return res.status(500).json({ error: 'Failed to update Etsy shop' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}