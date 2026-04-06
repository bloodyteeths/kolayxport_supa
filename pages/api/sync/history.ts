import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from 'lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { withPrismaRetry } from 'lib/prismaWithRetry';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const userId = user.id;

  // Pagination params
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const cursor = req.query.cursor as string | undefined; // ISO string

  // Query SyncOperation
  const where: any = { userId };
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }
  const syncs = await withPrismaRetry(() =>
    prisma.syncOperation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  );

  // Format response
  const resultSyncs = syncs.map(sync => {
    let metrics: any = sync.metrics || {};
    if (typeof metrics === 'string') {
      try {
        metrics = JSON.parse(metrics);
      } catch {
        metrics = {};
      }
    }
    return {
      id: sync.id,
      type: sync.type,
      status: sync.status,
      startedAt: metrics.startTime || sync.createdAt,
      endedAt: metrics.endTime || sync.updatedAt,
      processedOrders: metrics.processedOrders ?? 0,
      successfulOrders: metrics.successfulOrders ?? 0,
      failedOrders: metrics.failedOrders ?? 0,
      errors: metrics.errors ?? [],
    };
  });

  res.status(200).json({
    syncs: resultSyncs,
    nextCursor: resultSyncs.length === limit ? resultSyncs[resultSyncs.length - 1].startedAt : null,
  });
}