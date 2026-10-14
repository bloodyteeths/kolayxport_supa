import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, qstr } from '@/lib/stock/api';
import { etsyManagedVariants } from '@/lib/stock/etsyDraftHook';

/**
 * GET /api/stock/etsy-managed?listingId=&shopId=
 * -> { managed, live, variants: [{ variantKey, canonical, stockItemId, sku }] }
 * Used by the listing / variation editor to show quantities as read-only
 * ("Stok senkronu yönetiyor (7)") for managed variants.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET']);
  if (!userId) return;
  try {
    const listingId = qstr(req.query.listingId);
    if (!listingId || !/^\d{1,20}$/.test(listingId)) return fail(res, 400, 'invalid_listing');
    let shopId = qstr(req.query.shopId);
    if (shopId) {
      const own = await prisma.etsyShop.findFirst({ where: { userId, shopId, isActive: true }, select: { shopId: true } });
      if (!own) return fail(res, 404, 'shop_not_found');
    } else {
      const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true } });
      const hit = await prisma.etsyListing.findFirst({
        where: { etsyShopId: { in: shops.map((s) => s.shopId) }, etsyListingId: BigInt(listingId) },
        select: { etsyShopId: true },
      });
      shopId = hit?.etsyShopId;
    }
    if (!shopId) return res.status(200).json({ managed: false, live: false, variants: [] });
    return res.status(200).json(await etsyManagedVariants(userId, shopId, listingId));
  } catch (err) {
    return serverError(res, 'etsy-managed', err, userId);
  }
}
