import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError } from '@/lib/stock/api';
import { restoreSnapshot } from '@/lib/stock/goLive';

export const config = { maxDuration: 300 };

/**
 * GET  /api/stock/restore -> { snapshot: { id, takenAt, expiresAt, restoredAt, links } | null }
 * POST /api/stock/restore { snapshotId?, typedConfirm } -> sets each link back to
 *      max(0, snapshot qty - units sold since Go Live) and turns stock sync OFF.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET', 'POST']);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const snap = await prisma.stockSnapshot.findFirst({ where: { userId }, orderBy: { takenAt: 'desc' } });
      return res.status(200).json({
        snapshot: snap
          ? {
              id: snap.id,
              takenAt: snap.takenAt.toISOString(),
              expiresAt: snap.expiresAt.toISOString(),
              restoredAt: snap.restoredAt ? snap.restoredAt.toISOString() : null,
              usable: !snap.restoredAt && snap.expiresAt.getTime() > Date.now(),
              links: Array.isArray(snap.data) ? (snap.data as any[]).length : 0,
            }
          : null,
      });
    }
    const body = (req.body || {}) as Record<string, any>;
    const r = await restoreSnapshot(userId, { snapshotId: typeof body.snapshotId === 'string' ? body.snapshotId : undefined, typedConfirm: body.typedConfirm });
    if (!r.ok) return fail(res, r.error === 'snapshot_not_found' ? 404 : 400, r.error);
    return res.status(200).json(r);
  } catch (err) {
    return serverError(res, 'restore', err, userId);
  }
}
