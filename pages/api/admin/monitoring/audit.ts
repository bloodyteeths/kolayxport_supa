import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { paging } from '@/lib/admin/monitoring';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, private');
  const limit = paging.clampLimit(req.query.limit);
  const offset = paging.clampOffset(req.query.offset);

  const delegate = (prisma as any).adminAuditLog;
  const [rows, total] = await Promise.all([
    delegate.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        adminUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ipHash: true,
        userAgent: true,
        createdAt: true,
      },
    }),
    delegate.count(),
  ]);

  return res.json({ rows, pagination: { limit, offset, total } });
}

export default withAdmin(handler);
