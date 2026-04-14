import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

/**
 * Debug endpoint to diagnose Etsy order ↔ listing matching.
 * GET /api/debug-etsy-matching?orderNumber=4030860799
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const orderNumber = req.query.orderNumber as string;

  // 1. Get all Etsy orders for this user (or specific order)
  const orderWhere: any = { userId: user.id };
  if (orderNumber) {
    orderWhere.orderNumber = orderNumber;
  } else {
    orderWhere.marketplace = { contains: 'tsy', mode: 'insensitive' };
  }

  const orders = await prisma.order.findMany({
    where: orderWhere,
    select: { id: true, marketplace: true, orderNumber: true, status: true },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });

  // 2. Get OrderItems for these orders
  const orderIds = orders.map(o => o.id);
  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, orderId: true, productName: true, image: true, sku: true },
  });

  // 3. Get all EtsyListings (sample)
  const listings = await prisma.etsyListing.findMany({
    select: { etsyListingId: true, title: true, state: true, url: true, thumbnailUrl570xN: true, thumbnailUrl170x135: true },
    orderBy: { syncedAt: 'desc' },
    take: 50,
  });

  // 4. Try matching each item
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  const matchResults = items.map(item => {
    const itemTitle = normalize(item.productName || '');
    const prefix = itemTitle.slice(0, 30);

    // Find all potential matches
    const exactMatches = listings.filter(l => normalize(l.title) === itemTitle);
    const prefixMatches = listings.filter(l => {
      const lt = normalize(l.title);
      return lt.startsWith(prefix) || itemTitle.startsWith(lt.slice(0, 30));
    });

    const itemWords = new Set(itemTitle.split(/\s+/).filter(w => w.length > 2));
    const wordOverlapMatches = listings
      .map(l => {
        const lt = normalize(l.title);
        const listingWords = new Set(lt.split(/\s+/).filter(w => w.length > 2));
        const overlap = [...itemWords].filter(w => listingWords.has(w)).length;
        const ratio = overlap / Math.max(itemWords.size, 1);
        return { listingId: l.etsyListingId.toString(), title: l.title.slice(0, 60), state: l.state, overlap, ratio: Math.round(ratio * 100) + '%' };
      })
      .filter(m => m.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5);

    return {
      orderId: item.orderId,
      itemTitle: item.productName?.slice(0, 80),
      itemImage: item.image ? item.image.slice(0, 60) + '...' : '(empty)',
      sku: item.sku,
      exactMatchCount: exactMatches.length,
      prefixMatchCount: prefixMatches.length,
      topWordOverlaps: wordOverlapMatches,
    };
  });

  return res.status(200).json({
    orders: orders.map(o => ({ id: o.id, marketplace: o.marketplace, orderNumber: o.orderNumber })),
    itemCount: items.length,
    listingCount: listings.length,
    listingSample: listings.slice(0, 5).map(l => ({
      id: l.etsyListingId.toString(),
      title: l.title.slice(0, 80),
      state: l.state,
      hasImage: !!(l.thumbnailUrl570xN || l.thumbnailUrl170x135),
    })),
    matchResults,
  });
}
