import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, qstr, int, ownedItem } from '@/lib/stock/api';

/**
 * GET /api/stock/ledger?stockItemId=&cursor=&limit=  -> { rows, nextCursor }
 * Cursor = last row id (createdAt desc, id desc).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET']);
  if (!userId) return;
  try {
    const stockItemId = qstr(req.query.stockItemId);
    if (stockItemId && !(await ownedItem(userId, stockItemId))) return fail(res, 404, 'not_found');
    const limit = int(qstr(req.query.limit), 1, 200) ?? 50;
    const cursor = qstr(req.query.cursor);
    const rows = await prisma.stockLedger.findMany({
      where: { userId, ...(stockItemId ? { stockItemId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, stockItemId: true, kind: true, delta: true, qtyAfter: true, channel: true, orderKey: true, actor: true, note: true, createdAt: true },
    });
    const next = rows.length > limit ? rows[limit - 1].id : null;
    return res.status(200).json({ rows: rows.slice(0, limit), nextCursor: next });
  } catch (err) {
    return serverError(res, 'ledger', err, userId);
  }
}
