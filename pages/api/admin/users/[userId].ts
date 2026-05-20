import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { withAdmin } from '@/lib/middleware/withAdmin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query;
  if (typeof userId !== 'string') {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  if (req.method === 'GET') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            orders: true,
            etsyShops: true,
            syncLogs: true,
            syncOperations: true,
            etsyListingDrafts: true,
          },
        },
        integrationSettings: {
          select: { id: true, etsyShopId: true },
        },
        etsyShops: {
          select: { shopId: true, shopName: true, isActive: true },
        },
        syncOperations: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            type: true,
            status: true,
            metrics: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password, ...safeUser } = user;
    return res.json(safeUser);
  }

  if (req.method === 'PATCH') {
    const allowedFields = [
      'role',
      'subscriptionPlan',
      'subscriptionStatus',
      'orderSyncCount',
      'labelCount',
    ] as const;

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (req.body.trialExpiresAt !== undefined) {
      updates.trialExpiresAt = req.body.trialExpiresAt
        ? new Date(req.body.trialExpiresAt)
        : null;
    }

    if (req.body.usageResetAt !== undefined) {
      updates.usageResetAt = req.body.usageResetAt
        ? new Date(req.body.usageResetAt)
        : null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updates,
      select: {
        id: true,
        email: true,
        role: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        orderSyncCount: true,
        labelCount: true,
        trialExpiresAt: true,
        usageResetAt: true,
      },
    });

    return res.json(updated);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAdmin(handler);
