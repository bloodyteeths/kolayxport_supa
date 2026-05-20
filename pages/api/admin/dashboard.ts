import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { withAdmin } from '@/lib/middleware/withAdmin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    recentUsers,
    usersByPlan,
    usersByStatus,
    totalOrders,
    recentOrders,
    ordersByMarketplace,
    totalShipments,
    recentSyncLogs,
    usersDetailed,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.user.groupBy({ by: ['subscriptionPlan'], _count: true }),
    prisma.user.groupBy({ by: ['subscriptionStatus'], _count: true }),
    prisma.order.count(),
    prisma.order.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.order.groupBy({ by: ['marketplace'], _count: true }),
    prisma.shipment.count(),
    prisma.syncOperation.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        metrics: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { email: true, name: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastSyncedAt: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        trialExpiresAt: true,
        orderSyncCount: true,
        labelCount: true,
        billingProvider: true,
        stripeCustomerId: true,
        _count: {
          select: {
            orders: true,
            etsyShops: true,
          },
        },
      },
    }),
  ]);

  return res.json({
    stats: {
      totalUsers,
      recentUsers,
      totalOrders,
      recentOrders,
      totalShipments,
    },
    usersByPlan: usersByPlan.map((g) => ({
      plan: g.subscriptionPlan || 'none',
      count: g._count,
    })),
    usersByStatus: usersByStatus.map((g) => ({
      status: g.subscriptionStatus || 'none',
      count: g._count,
    })),
    ordersByMarketplace: ordersByMarketplace.map((g) => ({
      marketplace: g.marketplace,
      count: g._count,
    })),
    recentSyncOps: recentSyncLogs,
    users: usersDetailed,
  });
}

export default withAdmin(handler);
