import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Authenticate user
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    // Get all Etsy shops for the user
    try {
      const etsyShops = await prisma.etsyShop.findMany({
        where: { 
          userId: user.id,
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
          { isDefault: 'desc' },
          { createdAt: 'desc' }
        ]
      });

      // Also check for legacy connection in Credential model
      const legacyCredential = await prisma.credential.findUnique({
        where: { userId: user.id },
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
            isDefault: etsyShops.length === 0, // Default if no other shops
            isActive: true,
            tokenExpiresAt: legacyCredential.etsyTokenExpiresAt,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLegacy: true
          });
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
      if (action === 'setDefault') {
        // First, remove default from all user's shops
        await prisma.etsyShop.updateMany({
          where: { userId: user.id },
          data: { isDefault: false }
        });

        // Set the selected shop as default
        await prisma.etsyShop.update({
          where: { 
            userId_shopId: { 
              userId: user.id, 
              shopId: shopId 
            }
          },
          data: { isDefault: true }
        });

        return res.status(200).json({ message: 'Default shop updated successfully' });
      }

      if (action === 'delete') {
        // Check if it's a legacy shop
        if (shopId.startsWith('legacy-')) {
          const actualShopId = shopId.replace('legacy-', '');
          // Clear legacy credentials
          await prisma.credential.update({
            where: { userId: user.id },
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
                userId: user.id, 
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