import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, qstr, int } from '@/lib/stock/api';
import { enqueuePushes } from '@/lib/stock/engine';
import { asPushReason } from '@/lib/stock/math';
import { dryRunReport } from '@/lib/stock/goLive';

const STATUSES = ['pending', 'in_flight', 'unknown', 'awaiting_batch', 'applied', 'skipped', 'failed', 'dry_run', 'superseded'];

/**
 * GET  /api/stock/pushes?status=&cursor=&limit=   -> { rows, nextCursor }
 * GET  /api/stock/pushes?report=dry_run           -> dry-run report (would-have-sent + oversell risks prevented)
 * POST /api/stock/pushes { action: 'retry', pushId } | { action: 'retry_failed' }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET', 'POST']);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      if (qstr(req.query.report) === 'dry_run') return res.status(200).json(await dryRunReport(userId));
      const status = qstr(req.query.status);
      const limit = int(qstr(req.query.limit), 1, 200) ?? 50;
      const cursor = qstr(req.query.cursor);
      const rows = await prisma.stockPush.findMany({
        where: { userId, ...(status && STATUSES.includes(status) ? { status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, stockItemId: true, linkId: true, reason: true, targetQty: true, freshRemoteQty: true, sentQty: true, status: true, attempts: true, lastError: true, externalRef: true, createdAt: true, appliedAt: true, updatedAt: true },
      });
      return res.status(200).json({ rows: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null });
    }

    const body = (req.body || {}) as Record<string, any>;
    if (body.action === 'retry') {
      const push = typeof body.pushId === 'string' ? await prisma.stockPush.findFirst({ where: { id: body.pushId, userId } }) : null;
      if (!push) return fail(res, 404, 'not_found');
      if (push.status !== 'failed') return fail(res, 409, 'not_failed');
      // Retry keeps the failed push's own reason: a retried 'sale' push must not gain the right to raise.
      const n = await enqueuePushes(push.stockItemId, asPushReason(push.reason), { onlyLinkIds: [push.linkId] });
      return res.status(200).json({ ok: true, enqueued: n });
    }
    if (body.action === 'retry_failed') {
      const failed = await prisma.stockPush.findMany({
        where: { userId, status: 'failed', updatedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
        orderBy: [{ linkId: 'asc' }, { updatedAt: 'desc' }],
        distinct: ['linkId'],
        select: { stockItemId: true, linkId: true, reason: true },
        take: 500,
      });
      let n = 0;
      for (const f of failed) n += await enqueuePushes(f.stockItemId, asPushReason(f.reason), { onlyLinkIds: [f.linkId] });
      return res.status(200).json({ ok: true, enqueued: n });
    }
    return fail(res, 400, 'invalid_action');
  } catch (err) {
    return serverError(res, 'pushes', err, userId);
  }
}
