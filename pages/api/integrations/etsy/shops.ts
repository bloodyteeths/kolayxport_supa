import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { onEtsyShopOwnershipChanged } from '@/lib/stock/hooks';

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
    // Shop actions (currently only 'delete' = disconnect)
    const { shopId, action } = req.body;

    if (!shopId || !action) {
      return res.status(400).json({ error: 'Shop ID and action are required' });
    }

    try {

      if (action === 'delete') {
        // Check if it's a legacy shop
        if (typeof shopId === 'string' && shopId.startsWith('legacy-')) {
          const actualShopId = shopId.replace('legacy-', '');
          // Clear legacy credentials — scoped to the shop being disconnected so a
          // stale legacy id can't wipe a different shop's fallback token.
          const cleared = await prisma.credential.updateMany({
            where: { userId: authUserId, etsyShopId: actualShopId },
            data: {
              etsyAccessToken: null,
              etsyRefreshToken: null,
              etsyShopId: null,
              etsyTokenExpiresAt: null
            }
          });
          if (cleared.count === 0) return res.status(404).json({ error: 'Shop not found' });
          // Stock sync: links to a disconnected shop must never be pushed again.
          await onEtsyShopOwnershipChanged(actualShopId, null);
        } else {
          // The settings UI sends the EtsyShop row id (what GET returns as `id`);
          // older callers may send Etsy's numeric shop id. Accept either, always
          // scoped to the authenticated user.
          const shop = await prisma.etsyShop.findFirst({
            where: { userId: authUserId, OR: [{ id: String(shopId) }, { shopId: String(shopId) }] },
            select: { id: true, shopId: true },
          });
          if (!shop) return res.status(404).json({ error: 'Shop not found' });

          // Soft delete by setting isActive to false
          await prisma.etsyShop.update({
            where: { id: shop.id },
            data: { isActive: false }
          });

          // The first connected shop is also mirrored into Credential (see etsy/callback).
          // Clear that mirror too, otherwise GET re-surfaces the shop as "legacy-<id>"
          // and the legacy token keeps being used by fallback code paths.
          await prisma.credential.updateMany({
            where: { userId: authUserId, etsyShopId: shop.shopId },
            data: {
              etsyAccessToken: null,
              etsyRefreshToken: null,
              etsyShopId: null,
              etsyTokenExpiresAt: null
            }
          });
        }

        if (!(typeof shopId === 'string' && shopId.startsWith('legacy-'))) {
          const disconnected = await prisma.etsyShop.findFirst({
            where: { userId: authUserId, OR: [{ id: String(shopId) }, { shopId: String(shopId) }] },
            select: { shopId: true },
          });
          // Stock sync: links to a disconnected shop are paused ('account_changed'), never pushed.
          if (disconnected) await onEtsyShopOwnershipChanged(disconnected.shopId, null);
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