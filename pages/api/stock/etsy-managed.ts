import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, qstr } from '@/lib/stock/api';
import { etsyManagedVariants, etsyManagedVariantsMany } from '@/lib/stock/etsyDraftHook';
import { parseManagedIdsParam } from '@/lib/stock/managedIds';

/**
 * GET /api/stock/etsy-managed?listingId=&shopId=
 * -> { managed, live, variants: [{ variantKey, canonical, stockItemId, sku }] }
 * Used by the listing / variation editor to show quantities as read-only
 * ("Stok senkronu yönetiyor (7)") for managed variants.
 *
 * Batch (BR-11, grid rows): GET /api/stock/etsy-managed?ids=1,2,3[&shopId=]
 * (comma list and/or repeated ids, at most 500 distinct)
 * -> { live, listings: { [listingId]: { managed, live, variants } } }  (an entry for every id)
 * 400 { error: 'invalid_listing' | 'too_many_ids' }; 404 { error: 'shop_not_found' }.
 * Without shopId each id resolves to the user's active shop holding it in the EtsyListing cache;
 * ids in no owned shop come back unmanaged.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET']);
  if (!userId) return;
  try {
    if (req.query.ids !== undefined) {
      const parsed = parseManagedIdsParam(req.query.ids);
      if (!parsed.ok) return fail(res, 400, parsed.code);
      const shopParam = qstr(req.query.shopId);
      const listingShops = new Map<string, string | null>(parsed.ids.map((id) => [id, null]));
      if (shopParam) {
        const own = await prisma.etsyShop.findFirst({ where: { userId, shopId: shopParam, isActive: true }, select: { shopId: true } });
        if (!own) return fail(res, 404, 'shop_not_found');
        for (const id of parsed.ids) listingShops.set(id, shopParam);
      } else {
        const shops = await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true } });
        if (shops.length) {
          const hits = await prisma.etsyListing.findMany({
            where: { etsyShopId: { in: shops.map((s) => s.shopId) }, etsyListingId: { in: parsed.ids.map((id) => BigInt(id)) } },
            select: { etsyShopId: true, etsyListingId: true },
          });
          for (const h of hits) listingShops.set(String(h.etsyListingId), h.etsyShopId);
        }
      }
      return res.status(200).json(await etsyManagedVariantsMany(userId, listingShops));
    }
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
