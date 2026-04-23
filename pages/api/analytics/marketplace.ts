import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

interface MarketplaceAnalyticsQuery {
  marketplace: string;
  dateRange?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth: API key or session
    let dbUserId: string;
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const envApiKey = process.env.CLAWD_API_KEY;

    if (envApiKey && apiKey === envApiKey) {
      const qUserId = req.query.userId as string;
      if (!qUserId) return res.status(400).json({ error: 'userId required with API key auth' });
      dbUserId = qUserId;
    } else {
      const user = await getAuthUser(req, res);
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const dbUser = await prisma.user.findUnique({ where: { email: user.email } });
      if (!dbUser) return res.status(404).json({ error: 'User not found' });
      dbUserId = dbUser.id;
    }

    const marketplace = req.query.marketplace as string | undefined;
    const dateRange = (req.query.dateRange as string) || '30days';

    if (!marketplace) {
      return res.status(400).json({ error: 'Marketplace parameter is required' });
    }

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (dateRange) {
      case '7days':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    const whereClause = {
      userId: dbUserId,
      marketplace: marketplace,
      uiOrderDate: {
        gte: startDate,
        lte: now
      }
    };

    // Get detailed marketplace statistics
    const [
      totalOrders,
      totalRevenue,
      averageOrderValue,
      topProducts,
      hourlyDistribution,
      dailyTrends,
      customerSegmentation
    ] = await Promise.all([
      // Total orders for this marketplace
      prisma.order.count({
        where: whereClause
      }),

      // Total revenue
      prisma.order.aggregate({
        where: whereClause,
        _sum: {
          totalPrice: true
        },
        _avg: {
          totalPrice: true
        }
      }),

      // Average order value calculation
      prisma.order.aggregate({
        where: whereClause,
        _avg: {
          totalPrice: true
        }
      }),

      // Top products for this marketplace
      prisma.orderItem.groupBy({
        by: ['productName', 'sku'],
        where: {
          order: whereClause
        },
        _count: {
          _all: true
        },
        _sum: {
          totalPrice: true,
          quantity: true
        },
        orderBy: {
          _sum: {
            totalPrice: 'desc'
          }
        },
        take: 10
      }),

      // Hourly order distribution
      prisma.$queryRaw<Array<{ hour: number; orders: bigint; revenue: number }>>`
        SELECT 
          EXTRACT(hour FROM "uiOrderDate") as hour,
          COUNT(*) as orders,
          SUM("totalPrice") as revenue
        FROM "Order" 
        WHERE "userId" = ${dbUserId}
          AND marketplace = ${marketplace}
          AND "uiOrderDate" >= ${startDate}
          AND "uiOrderDate" <= ${now}
        GROUP BY EXTRACT(hour FROM "uiOrderDate")
        ORDER BY hour
      `,

      // Daily trends
      prisma.$queryRaw<Array<{ date: Date; orders: bigint; revenue: number; customers: bigint }>>`
        SELECT 
          DATE("uiOrderDate") as date,
          COUNT(*) as orders,
          SUM("totalPrice") as revenue,
          COUNT(DISTINCT "customerName") as customers
        FROM "Order" 
        WHERE "userId" = ${dbUserId}
          AND marketplace = ${marketplace}
          AND "uiOrderDate" >= ${startDate}
          AND "uiOrderDate" <= ${now}
        GROUP BY DATE("uiOrderDate")
        ORDER BY date DESC
      `,

      // Customer segmentation
      prisma.$queryRaw<Array<{ 
        customer_name: string; 
        order_count: bigint;
        total_spent: number;
        first_order: Date;
        last_order: Date;
      }>>`
        SELECT 
          "customerName" as customer_name,
          COUNT(*) as order_count,
          SUM("totalPrice") as total_spent,
          MIN("uiOrderDate") as first_order,
          MAX("uiOrderDate") as last_order
        FROM "Order" 
        WHERE "userId" = ${dbUserId}
          AND marketplace = ${marketplace}
          AND "uiOrderDate" >= ${startDate}
          AND "uiOrderDate" <= ${now}
          AND "customerName" IS NOT NULL
        GROUP BY "customerName"
        ORDER BY total_spent DESC
        LIMIT 20
      `
    ]);

    // Format the response data
    const marketplaceAnalytics = {
      marketplace,
      dateRange,
      summary: {
        totalOrders,
        totalRevenue: totalRevenue._sum.totalPrice || 0,
        averageOrderValue: averageOrderValue._avg.totalPrice || 0,
        totalCustomers: customerSegmentation.length
      },
      topProducts: topProducts.map(product => ({
        name: product.productName || 'Unknown Product',
        sku: product.sku || '',
        orders: product._count._all,
        quantity: Number(product._sum.quantity || 0),
        revenue: product._sum.totalPrice || 0
      })),
      hourlyDistribution: Array.from({ length: 24 }, (_, hour) => {
        const data = hourlyDistribution.find(h => Number(h.hour) === hour);
        return {
          hour,
          orders: data ? Number(data.orders) : 0,
          revenue: data ? Number(data.revenue) : 0
        };
      }),
      dailyTrends: dailyTrends.map(day => ({
        date: day.date.toISOString().split('T')[0],
        orders: Number(day.orders),
        revenue: Number(day.revenue) || 0,
        customers: Number(day.customers)
      })),
      topCustomers: customerSegmentation.map(customer => ({
        name: customer.customer_name,
        orderCount: Number(customer.order_count),
        totalSpent: Number(customer.total_spent),
        firstOrder: customer.first_order.toISOString().split('T')[0],
        lastOrder: customer.last_order.toISOString().split('T')[0],
        customerType: Number(customer.order_count) > 1 ? 'returning' : 'new'
      }))
    };

    res.status(200).json(marketplaceAnalytics);

  } catch (error) {
    console.error('Marketplace analytics API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Temporarily disable usage limiter for analytics endpoints
export default handler;