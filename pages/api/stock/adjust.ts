import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, int, ownedItem } from '@/lib/stock/api';
import { manualAdjust, seedItem } from '@/lib/stock/engine';

/**
 * POST /api/stock/adjust { stockItemId, setTo? | delta?, note? }
 * An item still waiting for its first count ('needs_review', never seeded)
 * is seeded with setTo and becomes active.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['POST']);
  if (!userId) return;
  const body = (req.body || {}) as Record<string, any>;
  try {
    const item = await ownedItem(userId, body.stockItemId);
    if (!item) return fail(res, 404, 'not_found');
    const setTo = body.setTo === undefined ? null : int(body.setTo, 0, 1_000_000);
    const delta = body.delta === undefined ? null : int(body.delta, -1_000_000, 1_000_000);
    if (setTo === null && delta === null) return fail(res, 400, 'invalid_quantity');
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null;
    const actor = `user:${userId}`;

    if (!item.seededAt) {
      const qty = setTo ?? Math.max(0, item.onHand + (delta ?? 0));
      await prisma.stockItem.update({ where: { id: item.id }, data: { status: 'active' } });
      const out = await seedItem({ userId, stockItemId: item.id, qty, actor, idempotencyKey: `seed:${userId}:${item.id}:manual:${Date.now()}`, note: note || 'manual' });
      return res.status(200).json({ ok: true, seeded: true, onHand: out.onHandAfter ?? qty });
    }
    const out = await manualAdjust({ userId, stockItemId: item.id, ...(setTo !== null ? { setTo } : { delta: delta! }), actor, note });
    return res.status(200).json({ ok: true, status: out.status, onHand: out.onHandAfter ?? item.onHand });
  } catch (err) {
    return serverError(res, 'adjust', err, userId);
  }
}
