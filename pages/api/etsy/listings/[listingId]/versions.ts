/**
 * GET /api/etsy/listings/:listingId/versions?shop_id=&cursor=&limit=&include_baseline=1
 * Change history of one listing, newest first (keyset cursor).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { assertShopOwnership } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';
import {
  VERSION_LIST_SELECT,
  decodeCursor,
  encodeCursor,
  parseBigIntParam,
  parseLimit,
  queryString,
  serializeVersion,
} from '@/lib/etsy/listingIntelApi';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const shopId = queryString(req, 'shop_id');
  const listingId = parseBigIntParam(req.query.listingId);
  if (!shopId || listingId === null) return res.status(400).json({ error: 'shop_id and a numeric listingId are required' });
  try {
    await assertShopOwnership(user.id, shopId);
    const limit = parseLimit(req.query.limit, 20, 50);
    const cursor = decodeCursor(queryString(req, 'cursor'));
    const includeBaseline = queryString(req, 'include_baseline') === '1';
    const rows = await prisma.etsyListingVersion.findMany({
      where: {
        etsyShopId: shopId,
        etsyListingId: listingId,
        ...(includeBaseline ? {} : { OR: [{ isTombstone: true }, { changedKeys: { isEmpty: false } }] }),
        ...(cursor
          ? { AND: [{ OR: [{ capturedAt: { lt: cursor.at } }, { capturedAt: cursor.at, id: { lt: cursor.id } }] }] }
          : {}),
      },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: VERSION_LIST_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return res.status(200).json({
      items: page.map(serializeVersion),
      nextCursor: rows.length > limit && last ? encodeCursor(last.capturedAt, last.id) : null,
    });
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Failed to load listing history');
    return res.status(status).json(body);
  }
}
