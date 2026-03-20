import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import prisma from '../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // --- Authentication (same pattern as orders/index.ts) ---
  let user, authError;
  const supabase = getSupabaseServerClient(req, res);
  const result = await supabase.auth.getUser();
  user = result.data.user;
  authError = result.error;

  if (authError || !user) {
    const authHeaderRaw = req.headers['authorization'] || req.headers['Authorization'];
    let authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
    const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        const supabaseDirect = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );
        const { data, error: userError } = await supabaseDirect.auth.getUser(token);
        user = data.user;
        authError = userError;
      }
    }
  }

  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // --- Parse date range ---
  const range = (req.query.range as string) || '7days';
  const now = new Date();
  const startDate = new Date();

  switch (range) {
    case '30days':
      startDate.setDate(now.getDate() - 30);
      break;
    case '90days':
      startDate.setDate(now.getDate() - 90);
      break;
    case '7days':
    default:
      startDate.setDate(now.getDate() - 7);
      break;
  }

  try {
    const userId = user.id;

    // --- Total orders in range ---
    const totalOrders = await prisma.order.count({
      where: {
        userId,
        createdAt: { gte: startDate },
      },
    });

    // --- Pending orders (status contains common pending values) ---
    const pendingOrders = await prisma.order.count({
      where: {
        userId,
        createdAt: { gte: startDate },
        status: {
          in: [
            'PENDING', 'pending',
            'AWAITING_PAYMENT', 'awaiting_payment', 'pending_payment',
            'CREATED', 'Created',
            'PAID',
            'awaiting_fulfillment', 'AWAITING_FULFILLMENT',
            'UNSHIPPED',
          ],
        },
      },
    });

    // --- Shipped orders ---
    const shippedOrders = await prisma.order.count({
      where: {
        userId,
        createdAt: { gte: startDate },
        status: {
          in: [
            'SHIPPED', 'shipped', 'Shipped',
            'PARTIALLY_SHIPPED',
            'DELIVERED', 'delivered', 'Delivered',
            'COMPLETED',
          ],
        },
      },
    });

    // --- Total revenue (sum of totalPrice) ---
    const revenueResult = await prisma.order.aggregate({
      where: {
        userId,
        createdAt: { gte: startDate },
      },
      _sum: {
        totalPrice: true,
      },
    });
    const totalRevenue = revenueResult._sum.totalPrice ?? 0;

    // --- Marketplace breakdown ---
    const marketplaceGroups = await prisma.order.groupBy({
      by: ['marketplace'],
      where: {
        userId,
        createdAt: { gte: startDate },
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });

    const marketplaceColors: Record<string, string> = {
      'Veeqo': '#4F46E5',
      'veeqo': '#4F46E5',
      'Trendyol': '#F97316',
      'trendyol': '#F97316',
      'Shippo': '#10B981',
      'shippo': '#10B981',
      'Etsy': '#F59E0B',
      'etsy': '#F59E0B',
      'Hepsiburada': '#E11D48',
      'hepsiburada': '#E11D48',
    };

    const marketplaceBreakdown = marketplaceGroups.map((group) => ({
      name: group.marketplace,
      orders: group._count.id,
      color: marketplaceColors[group.marketplace] || '#6B7280',
    }));

    // --- Daily data for chart ---
    // Determine number of days based on range
    const dayCount = range === '90days' ? 90 : range === '30days' ? 30 : 7;

    const dailyDataRaw: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        DATE("createdAt") as day,
        COUNT(*)::int as orders,
        COALESCE(SUM("totalPrice"), 0) as revenue
      FROM "Order"
      WHERE "userId" = $1
        AND "createdAt" >= $2
      GROUP BY DATE("createdAt")
      ORDER BY day ASC`,
      userId,
      startDate
    );

    // Build a complete array of days (fill gaps with zeros)
    const dailyMap = new Map<string, { orders: number; revenue: number }>();
    for (const row of dailyDataRaw) {
      const dateStr =
        row.day instanceof Date
          ? row.day.toISOString().split('T')[0]
          : String(row.day);
      dailyMap.set(dateStr, {
        orders: Number(row.orders),
        revenue: Number(row.revenue),
      });
    }

    const dailyData: { date: string; orders: number; revenue: number }[] = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyData.push({
        date: key,
        orders: dailyMap.get(key)?.orders ?? 0,
        revenue: dailyMap.get(key)?.revenue ?? 0,
      });
    }

    return res.status(200).json({
      totalOrders,
      pendingOrders,
      shippedOrders,
      totalRevenue,
      marketplaceBreakdown,
      dailyData,
    });
  } catch (error: any) {
    console.error('[API stats] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
}
