/**
 * GET /api/etsy/activity?shop_id=&attribution=external|kolayxport_draft|kolayxport_stock|unknown&cursor=&limit=
 * Listing change feed across the user's Etsy shops (baselines hidden).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import {
  VERSION_LIST_SELECT,
  decodeCursor,
  encodeCursor,
  ownedShopIds,
  parseLimit,
  queryString,
  serializeVersion,
} from '@/lib/etsy/listingIntelApi';

const ATTRIBUTIONS = new Set(['external', 'kolayxport_draft', 'kolayxport_stock', 'unknown']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const shopFilter = queryString(req, 'shop_id');
    const shops = await ownedShopIds(user.id, shopFilter || undefined);
    if (!shops.length) return res.status(200).json({ items: [], nextCursor: null });
    const attribution = queryString(req, 'attribution');
    const limit = parseLimit(req.query.limit, 30, 100);
    const cursor = decodeCursor(queryString(req, 'cursor'));
    const rows = await prisma.etsyListingVersion.findMany({
      where: {
        etsyShopId: { in: shops },
        OR: [{ isTombstone: true }, { changedKeys: { isEmpty: false } }],
        ...(attribution && ATTRIBUTIONS.has(attribution) ? { attribution } : {}),
        ...(cursor
          ? { AND: [{ OR: [{ capturedAt: { lt: cursor.at } }, { capturedAt: cursor.at, id: { lt: cursor.id } }] }] }
          : {}),
      },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: VERSION_LIST_SELECT,
    });
    const page = rows.slice(0, limit);
    const listingKeys = Array.from(new Set(page.map((v) => `${v.etsyShopId}|${v.etsyListingId}`)));
    const listings = listingKeys.length
      ? await prisma.etsyListing.findMany({
          where: {
            OR: listingKeys.map((k) => {
              const [s, l] = k.split('|');
              return { etsyShopId: s, etsyListingId: BigInt(l) };
            }),
          },
          select: { etsyShopId: true, etsyListingId: true, title: true, thumbnailUrl75x75: true, thumbnailUrl170x135: true, state: true, url: true },
        })
      : [];
    const byKey = new Map(listings.map((l) => [`${l.etsyShopId}|${l.etsyListingId}`, l]));
    const last = page[page.length - 1];
    return res.status(200).json({
      items: page.map((v) => {
        const l = byKey.get(`${v.etsyShopId}|${v.etsyListingId}`);
        const diffTitle = (v.diff as any)?.title;
        return {
          ...serializeVersion(v),
          listing: {
            title: l?.title ?? (typeof diffTitle === 'string' ? diffTitle : diffTitle?.to ?? null),
            thumbnail: l?.thumbnailUrl170x135 || l?.thumbnailUrl75x75 || null,
            state: l?.state ?? null,
            url: l?.url ?? null,
            exists: !!l,
          },
        };
      }),
      nextCursor: rows.length > limit && last ? encodeCursor(last.capturedAt, last.id) : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load activity' });
  }
}
