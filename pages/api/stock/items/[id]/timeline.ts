import type { NextApiRequest, NextApiResponse } from 'next';
import { stockAuth, fail, serverError, qstr, int, ownedItem, serializeItem } from '@/lib/stock/api';
import { buildTimeline } from '@/lib/stock/timeline';
import prisma from '@/lib/prisma';

/** GET /api/stock/items/:id/timeline?limit= -> { item, entries } (plain-language, i18n keys + params) */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET']);
  if (!userId) return;
  try {
    const item = await ownedItem(userId, qstr(req.query.id));
    if (!item) return fail(res, 404, 'not_found');
    const limit = int(qstr(req.query.limit), 10, 200) ?? 80;
    const [entries, links] = await Promise.all([buildTimeline(userId, item.id, { limit }), prisma.stockLink.findMany({ where: { stockItemId: item.id, userId } })]);
    return res.status(200).json({ item: serializeItem({ ...item, links }), entries });
  } catch (err) {
    return serverError(res, 'timeline', err, userId);
  }
}
