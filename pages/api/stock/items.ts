import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, qstr, int, ownedItem, serializeItem } from '@/lib/stock/api';
import { enqueuePushes } from '@/lib/stock/engine';
import { directionWhenLargerLowers, reasonForTargetEdit } from '@/lib/stock/math';

/**
 * GET   /api/stock/items?q=&status=&limit=  -> { items, total }
 * PATCH /api/stock/items { id, safetyBuffer?, tracking?, status?('active'|'paused'), title? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET', 'PATCH']);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const q = (qstr(req.query.q) || '').trim().slice(0, 100);
      const status = qstr(req.query.status);
      const limit = int(qstr(req.query.limit), 1, 1000) ?? 500;
      const where: any = { userId };
      if (status && ['active', 'paused', 'needs_review'].includes(status)) where.status = status;
      if (q) where.OR = [{ displaySku: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }];
      const [items, total] = await Promise.all([
        prisma.stockItem.findMany({ where, include: { links: { orderBy: [{ channel: 'asc' }, { createdAt: 'asc' }] } }, orderBy: [{ status: 'asc' }, { displaySku: 'asc' }], take: limit }),
        prisma.stockItem.count({ where }),
      ]);
      const ids = items.map((i) => i.id);
      const open = ids.length
        ? await prisma.stockPush.groupBy({ by: ['stockItemId'], where: { stockItemId: { in: ids }, status: { in: ['pending', 'in_flight', 'unknown', 'awaiting_batch'] } }, _count: { _all: true } })
        : [];
      const failed = ids.length
        ? await prisma.stockPush.findMany({ where: { stockItemId: { in: ids }, status: 'failed' }, orderBy: { updatedAt: 'desc' }, distinct: ['stockItemId'], select: { stockItemId: true, lastError: true } })
        : [];
      const openBy = new Map(open.map((o) => [o.stockItemId, o._count._all]));
      const errBy = new Map(failed.map((f) => [f.stockItemId, f.lastError]));
      return res.status(200).json({ items: items.map((i) => serializeItem(i, { openPushes: openBy.get(i.id) ?? 0, lastError: errBy.get(i.id) ?? null })), total });
    }

    const body = (req.body || {}) as Record<string, any>;
    const item = await ownedItem(userId, body.id);
    if (!item) return fail(res, 404, 'not_found');
    const data: Record<string, unknown> = {};
    if (body.safetyBuffer !== undefined) {
      const v = int(body.safetyBuffer, 0, 100000);
      if (v === null) return fail(res, 400, 'invalid_safety_buffer');
      data.safetyBuffer = v;
    }
    if (body.tracking !== undefined) {
      if (!['tracked', 'untracked'].includes(body.tracking)) return fail(res, 400, 'invalid_tracking');
      data.tracking = body.tracking;
    }
    if (body.status !== undefined) {
      if (!['active', 'paused'].includes(body.status)) return fail(res, 400, 'invalid_status');
      if (body.status === 'active' && !item.seededAt) return fail(res, 409, 'needs_seed');
      data.status = body.status;
    }
    if (typeof body.title === 'string') data.title = body.title.slice(0, 300);
    if (!Object.keys(data).length) return fail(res, 400, 'nothing_to_update');
    const updated = await prisma.stockItem.update({ where: { id: item.id }, data, include: { links: true } });
    // Only edits that change what the links should show enqueue pushes. Turning
    // the item (back) on may raise ('manual'); a safety-buffer change raises only
    // when it went down. Title-only edits push nothing.
    const reactivated =
      (data.status === 'active' && item.status !== 'active') || (data.tracking === 'tracked' && item.tracking !== 'tracked');
    const bufferReason = data.safetyBuffer !== undefined ? reasonForTargetEdit(directionWhenLargerLowers(item.safetyBuffer, data.safetyBuffer as number)) : null;
    const reason = reactivated ? 'manual' : bufferReason;
    if (reason && updated.status === 'active' && updated.tracking === 'tracked') await enqueuePushes(item.id, reason);
    return res.status(200).json({ item: serializeItem(updated) });
  } catch (err) {
    return serverError(res, 'items', err, userId);
  }
}
