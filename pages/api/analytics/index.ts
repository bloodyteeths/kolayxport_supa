import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

interface AnalyticsQuery {
  dateRange: string;
  marketplace?: string;
}

// Simple module-level cache for exchange rates
let cachedRates: Record<string, number> = {};
let cacheExpiry = 0;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUser = await getAuthUser(req, res);
    if (!supabaseUser) return res.status(401).json({ error: 'Not authenticated' });

    const dateRange = (req.query.dateRange as string) || '7days';
    const monthParam = req.query.month as string | undefined; // e.g. "2026-03"
    const marketplace = req.query.marketplace as string | undefined;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    let endDate = now;

    const dayParam = req.query.day as string | undefined; // e.g. "2026-03-20"

    if (dateRange === 'day' && dayParam) {
      // Specific day: "2026-03-20" → start=2026-03-20 00:00:00, end=2026-03-20 23:59:59
      const d = new Date(dayParam + 'T00:00:00');
      startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    } else if (dateRange === 'month' && monthParam) {
      // Specific month: "2026-03" → start=2026-03-01, end=2026-03-31 23:59:59
      const [year, month] = monthParam.split('-').map(Number);
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59, 999); // last day of month
    } else {
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
        case '6months':
          startDate.setMonth(now.getMonth() - 6);
          break;
        case '12months':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case 'all':
          startDate = new Date('2020-01-01');
          break;
        default:
          startDate = new Date('2020-01-01');
      }
    }

    // Get user from database using Supabase user email
    console.log('[Analytics API] Looking up user in database:', supabaseUser?.email);
    console.log('[Analytics API] User object:', JSON.stringify(supabaseUser, null, 2));
    
    if (!supabaseUser?.email) {
      console.log('[Analytics API] User email not found');
      return res.status(401).json({ error: 'User email not found' });
    }
    
    const dbUser = await prisma.user.findUnique({
      where: { email: supabaseUser.email }
    });

    if (!dbUser) {
      console.log('[Analytics API] User not found in database:', supabaseUser.email);
      return res.status(404).json({ error: 'User not found in database' });
    }

    console.log('[Analytics API] Database user found:', dbUser.id);

    // Build where clause
    const whereClause: any = {
      userId: dbUser.id,
      uiOrderDate: {
        gte: startDate,
        lte: endDate
      }
    };

    if (marketplace) {
      whereClause.marketplace = marketplace;
    }

    // Fetch real-time exchange rates
    const fetchExchangeRates = async (): Promise<Record<string, number>> => {
      try {
        // Using exchangerate-api.com - get rates with USD as base
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        if (!response.ok) {
          throw new Error('Failed to fetch exchange rates');
        }
        const data = await response.json();
        
        // Get USD to TRY rate
        const usdToTry = data.rates.TRY;
        
        // Calculate conversion rates to TRY
        const rates: Record<string, number> = {};
        Object.keys(data.rates).forEach(currency => {
          // To convert any currency to TRY:
          // amount_in_currency * (TRY_per_USD / currency_per_USD)
          rates[currency] = usdToTry / data.rates[currency];
        });
        
        rates['TRY'] = 1; // TRY to TRY is always 1
        rates['TL'] = 1;  // Alternative TRY notation
        
        console.log('[Analytics] Exchange rates loaded:', { usdToTry, sampleRates: { USD: rates.USD, EUR: rates.EUR } });
        
        return rates;
      } catch (error) {
        console.error('[Analytics] Exchange rate API failed, using last cached rates:', error);
        // If we have previously cached rates, reuse them even if expired
        if (Object.keys(cachedRates).length > 0) {
          return cachedRates;
        }
        // Absolute last resort — return empty so convertToTRY returns raw amounts
        // This should never happen in practice since the cache persists in-memory
        return {};
      }
    };

    // Get current exchange rates (with 1-hour cache)
    async function getCachedExchangeRates() {
      const now = Date.now();
      if (now < cacheExpiry && Object.keys(cachedRates).length > 0) {
        return cachedRates;
      }
      cachedRates = await fetchExchangeRates();
      cacheExpiry = now + 3600000; // 1 hour
      return cachedRates;
    }
    const exchangeRates = await getCachedExchangeRates();
    
    // Currency symbols
    const currencySymbols: Record<string, string> = {
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'TRY': '₺',
      'TL': '₺'
    };

    // Helper function to convert currency to TRY
    const convertToTRY = (amount: number, currency: string | null): number => {
      if (!amount || !currency) return amount || 0;
      
      // If currency is already TRY or TL, no conversion needed
      if (currency.toUpperCase() === 'TRY' || currency.toUpperCase() === 'TL') {
        return amount;
      }
      
      const rate = exchangeRates[currency.toUpperCase()];
      if (!rate) {
        console.log(`[Analytics] Currency rate not found for ${currency}. Available rates:`, Object.keys(exchangeRates));
        return amount; // If currency not found, return original amount
      }
      const converted = amount * rate;
      console.log(`[Analytics] Converting ${amount} ${currency} to ${converted.toFixed(2)} TRY (rate: ${rate})`);
      return converted;
    };

    // Get comprehensive order data in fewer queries to reduce connection pool usage
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [
      ordersData,
      dailyStats,
      statusBreakdown,
      topProducts,
      // New queries
      monthlyStatsRaw,
      marketplaceBreakdownRaw,
      totalLabels,
      labelsByCarrier,
      pendingLabels,
      recentActivity
    ] = await Promise.all([
      // Get all order data in one query
      prisma.order.findMany({
        where: whereClause,
        select: {
          totalPrice: true,
          currency: true,
          marketplace: true,
          customerName: true,
          externalStatus: true
        }
      }),

      // Daily statistics (grouped by date and currency for proper conversion)
      prisma.$queryRaw<Array<{ date: Date; orders: bigint; revenue: number; currency: string | null }>>`
        SELECT
          DATE(COALESCE("uiOrderDate", "createdAt")) as date,
          COUNT(*) as orders,
          SUM("totalPrice") as revenue,
          "currency" as currency
        FROM "Order"
        WHERE "userId" = ${dbUser.id}
          AND COALESCE("uiOrderDate", "createdAt") >= ${startDate}
          AND COALESCE("uiOrderDate", "createdAt") <= ${endDate}
        GROUP BY DATE(COALESCE("uiOrderDate", "createdAt")), "currency"
        ORDER BY date DESC
        LIMIT 90
      `,

      // Order status breakdown
      prisma.order.groupBy({
        by: ['externalStatus'],
        where: whereClause,
        _count: {
          _all: true
        }
      }),

      // Top products - fetch with order currency for proper conversion
      prisma.orderItem.findMany({
        where: {
          order: whereClause
        },
        select: {
          productName: true,
          totalPrice: true,
          order: {
            select: {
              currency: true
            }
          }
        }
      }),

      // 1. Monthly stats — last 12 months
      prisma.$queryRaw<Array<{ month: Date; orders: bigint; revenue: number; customers: bigint; currency: string | null }>>`
        SELECT DATE_TRUNC('month', COALESCE("uiOrderDate", "createdAt")) as month,
               COUNT(*) as orders,
               SUM("totalPrice") as revenue,
               COUNT(DISTINCT "customerName") as customers,
               "currency"
        FROM "Order"
        WHERE "userId" = ${dbUser.id} AND COALESCE("uiOrderDate", "createdAt") >= ${twelveMonthsAgo}
        GROUP BY DATE_TRUNC('month', COALESCE("uiOrderDate", "createdAt")), "currency"
        ORDER BY month ASC
      `,

      // 2. Marketplace breakdown — detailed per-marketplace stats
      prisma.$queryRaw<Array<{ marketplace: string | null; orders: bigint; revenue: number; customers: bigint; avg_order_value: number; currency: string | null }>>`
        SELECT "marketplace",
               COUNT(*) as orders,
               SUM("totalPrice") as revenue,
               COUNT(DISTINCT "customerName") as customers,
               AVG("totalPrice") as avg_order_value,
               "currency"
        FROM "Order"
        WHERE "userId" = ${dbUser.id}
          AND COALESCE("uiOrderDate", "createdAt") >= ${startDate}
          AND COALESCE("uiOrderDate", "createdAt") <= ${endDate}
        GROUP BY "marketplace", "currency"
        ORDER BY orders DESC
      `,

      // 3. Shipping stats — total labels
      prisma.shipment.count({ where: { order: { userId: dbUser.id } } }),

      // 3. Shipping stats — labels by carrier
      prisma.shipment.groupBy({
        by: ['carrier'],
        where: { order: { userId: dbUser.id } },
        _count: { _all: true }
      }),

      // 3. Shipping stats — pending labels
      prisma.order.count({
        where: { userId: dbUser.id, labelStatus: 'pending' }
      }),

      // 4. Recent activity — last 10 orders
      prisma.order.findMany({
        where: { userId: dbUser.id },
        select: {
          orderNumber: true,
          customerName: true,
          totalPrice: true,
          currency: true,
          marketplace: true,
          externalStatus: true,
          uiOrderDate: true,
          labelStatus: true
        },
        orderBy: { uiOrderDate: 'desc' },
        take: 10
      })
    ]);

    // Process the consolidated order data
    const totalOrders = ordersData.length;
    const ordersWithCurrency = ordersData.map(order => ({
      totalPrice: order.totalPrice,
      currency: order.currency
    }));
    const uniqueCustomers = [...new Set(ordersData.map(order => order.customerName).filter(Boolean))];
    const marketplaceOrders = ordersData.map(order => ({
      marketplace: order.marketplace,
      totalPrice: order.totalPrice,
      currency: order.currency
    }));

    // Calculate total revenue with currency conversion
    const currentRevenue = ordersWithCurrency.reduce((total, order) => {
      const convertedAmount = convertToTRY(order.totalPrice || 0, order.currency);
      return total + convertedAmount;
    }, 0);

    // Calculate trends (compare with previous period)
    let previousPeriodStart: Date;
    let previousPeriodEnd: Date;
    if (dateRange === 'day' && dayParam) {
      // Previous day (yesterday relative to selected day)
      const d = new Date(dayParam + 'T00:00:00');
      previousPeriodStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 0, 0, 0, 0);
      previousPeriodEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 59, 59, 999);
    } else if (dateRange === 'month' && monthParam) {
      // Previous month
      const [year, month] = monthParam.split('-').map(Number);
      previousPeriodStart = new Date(year, month - 2, 1);
      previousPeriodEnd = new Date(year, month - 1, 0, 23, 59, 59, 999);
    } else {
      const periodLength = endDate.getTime() - startDate.getTime();
      previousPeriodStart = new Date(startDate.getTime() - periodLength);
      previousPeriodEnd = new Date(startDate.getTime() - 1);
    }

    const previousOrdersData = await prisma.order.findMany({
      where: {
        userId: dbUser.id,
        ...(marketplace ? { marketplace } : {}),
        uiOrderDate: {
          gte: previousPeriodStart,
          lte: previousPeriodEnd
        }
      },
      select: {
        totalPrice: true,
        currency: true
      }
    });

    // Calculate previous period metrics
    const previousOrders = previousOrdersData.length;
    const prevRevenue = previousOrdersData.reduce((total, order) => {
      const convertedAmount = convertToTRY(order.totalPrice || 0, order.currency);
      return total + convertedAmount;
    }, 0);

    // Calculate trends
    const orderTrend = previousOrders > 0 
      ? ((totalOrders - previousOrders) / previousOrders) * 100 
      : 0;

    const revenueTrend = prevRevenue > 0 
      ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 
      : 0;

    // Format marketplace data
    const marketplaceColorPalette = [
      '#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#F97316',
      '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1', '#84CC16',
      '#06B6D4', '#D946EF', '#F43F5E', '#0EA5E9', '#A855F7',
    ];
    const marketplaceColors: Record<string, string> = {
      'trendyol': '#F59E0B',
      'amazon': '#3B82F6',
      'amazon fba': '#6366F1',
      'etsy': '#F97316',
      'veeqo': '#14B8A6',
      'shippo': '#10B981',
      'hepsiburada': '#EF4444',
      'bellecouturegifts': '#EC4899',
      'decorsweetart': '#8B5CF6',
      'mybabybymerry': '#06B6D4',
      'outletemporiumus': '#84CC16',
      'manual': '#9CA3AF',
    };

    // Normalize marketplace names (case-insensitive grouping)
    const normalizeMarketplace = (name: string | null | undefined): string => {
      if (!name) return 'Unknown';
      const lower = name.toLowerCase().trim();
      // Group known variations
      if (lower.includes('amazon') && lower.includes('fba')) return 'Amazon FBA';
      if (lower.includes('amazon')) return 'Amazon';
      if (lower.includes('etsy')) return 'Etsy';
      if (lower.includes('trendyol')) return 'Trendyol';
      if (lower.includes('hepsiburada')) return 'Hepsiburada';
      if (lower.includes('shippo')) return 'Shippo';
      if (lower.includes('veeqo')) return 'Veeqo';
      if (lower === 'manual') return 'Manual';
      // Title case for others
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    };

    // Calculate marketplace breakdown with currency conversion + native currency tracking
    const marketplaceBreakdown = marketplaceOrders.reduce((acc, order) => {
      const marketplace = normalizeMarketplace(order.marketplace);
      const rawAmount = order.totalPrice || 0;
      const currency = (order.currency || 'TRY').toUpperCase();
      const convertedRevenue = convertToTRY(rawAmount, order.currency);

      if (!acc[marketplace]) {
        acc[marketplace] = { orders: 0, revenue: 0, byCurrency: {} as Record<string, number> };
      }
      acc[marketplace].orders += 1;
      acc[marketplace].revenue += convertedRevenue;
      // Track native currency amounts
      acc[marketplace].byCurrency[currency] = (acc[marketplace].byCurrency[currency] || 0) + rawAmount;
      return acc;
    }, {} as Record<string, { orders: number; revenue: number; byCurrency: Record<string, number> }>);

    const topMarketplaces = Object.entries(marketplaceBreakdown).map(([name, stats], index) => ({
      name,
      orders: stats.orders,
      revenue: stats.revenue,
      byCurrency: stats.byCurrency,
      color: marketplaceColors[name?.toLowerCase()] || marketplaceColorPalette[index % marketplaceColorPalette.length]
    }));

    // Format daily stats - convert each currency row to TRY, then aggregate by date
    const dailyStatsMap = new Map<string, { orders: number; revenue: number }>();
    for (const stat of dailyStats) {
      const dateKey = stat.date.toISOString().split('T')[0];
      const convertedRevenue = convertToTRY(Number(stat.revenue) || 0, stat.currency);
      const existing = dailyStatsMap.get(dateKey);
      if (existing) {
        existing.orders += Number(stat.orders);
        existing.revenue += convertedRevenue;
      } else {
        dailyStatsMap.set(dateKey, {
          orders: Number(stat.orders),
          revenue: convertedRevenue
        });
      }
    }
    const formattedDailyStats = Array.from(dailyStatsMap.entries())
      .map(([date, stats]) => ({ date, orders: stats.orders, revenue: stats.revenue }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Format order status breakdown
    const statusColors = {
      'pending': '#F59E0B',
      'processing': '#3B82F6',
      'shipped': '#10B981',
      'delivered': '#6B7280',
      'cancelled': '#EF4444'
    };

    const orderStatusBreakdown = statusBreakdown.map(status => ({
      status: status.externalStatus || 'Unknown',
      count: status._count._all,
      color: statusColors[status.externalStatus?.toLowerCase() as keyof typeof statusColors] || statusColors.pending
    }));

    // Format top products - aggregate in JS with currency conversion
    const productAggregation = new Map<string, { orders: number; revenue: number }>();
    for (const item of topProducts) {
      const name = item.productName || 'Unknown Product';
      const convertedRevenue = convertToTRY(Number(item.totalPrice) || 0, item.order?.currency);
      const existing = productAggregation.get(name);
      if (existing) {
        existing.orders += 1;
        existing.revenue += convertedRevenue;
      } else {
        productAggregation.set(name, { orders: 1, revenue: convertedRevenue });
      }
    }
    const formattedTopProducts = Array.from(productAggregation.entries())
      .map(([name, stats]) => ({ name, orders: stats.orders, revenue: stats.revenue }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);

    // Format monthly stats — aggregate by month converting currencies to TRY
    const monthlyStatsMap = new Map<string, { orders: number; revenue: number; customers: number }>();
    for (const stat of monthlyStatsRaw) {
      const monthKey = stat.month.toISOString().slice(0, 7); // "YYYY-MM"
      const convertedRevenue = convertToTRY(Number(stat.revenue) || 0, stat.currency);
      const existing = monthlyStatsMap.get(monthKey);
      if (existing) {
        existing.orders += Number(stat.orders);
        existing.revenue += convertedRevenue;
        existing.customers += Number(stat.customers);
      } else {
        monthlyStatsMap.set(monthKey, {
          orders: Number(stat.orders),
          revenue: convertedRevenue,
          customers: Number(stat.customers)
        });
      }
    }
    const monthlyStats = Array.from(monthlyStatsMap.entries())
      .map(([month, stats]) => ({ month, orders: stats.orders, revenue: Math.round(stats.revenue * 100) / 100, customers: stats.customers }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Format marketplace breakdown — aggregate by marketplace converting currencies to TRY + track native
    const mpBreakdownMap = new Map<string, { orders: number; revenue: number; customers: number; avgOrderValueSum: number; avgOrderValueCount: number; byCurrency: Record<string, number> }>();
    for (const row of marketplaceBreakdownRaw) {
      const mp = normalizeMarketplace(row.marketplace);
      const rawRevenue = Number(row.revenue) || 0;
      const currency = (row.currency || 'TRY').toUpperCase();
      const convertedRevenue = convertToTRY(rawRevenue, row.currency);
      const convertedAvg = convertToTRY(Number(row.avg_order_value) || 0, row.currency);
      const existing = mpBreakdownMap.get(mp);
      if (existing) {
        existing.orders += Number(row.orders);
        existing.revenue += convertedRevenue;
        existing.customers += Number(row.customers);
        existing.avgOrderValueSum += convertedAvg * Number(row.orders);
        existing.avgOrderValueCount += Number(row.orders);
        existing.byCurrency[currency] = (existing.byCurrency[currency] || 0) + rawRevenue;
      } else {
        mpBreakdownMap.set(mp, {
          orders: Number(row.orders),
          revenue: convertedRevenue,
          customers: Number(row.customers),
          avgOrderValueSum: convertedAvg * Number(row.orders),
          avgOrderValueCount: Number(row.orders),
          byCurrency: { [currency]: rawRevenue }
        });
      }
    }
    const totalOrdersForPercentage = Array.from(mpBreakdownMap.values()).reduce((sum, s) => sum + s.orders, 0);
    const formattedMarketplaceBreakdown = Array.from(mpBreakdownMap.entries())
      .map(([marketplace, stats]) => ({
        marketplace,
        orders: stats.orders,
        revenue: Math.round(stats.revenue * 100) / 100,
        customers: stats.customers,
        avgOrderValue: stats.avgOrderValueCount > 0 ? Math.round((stats.avgOrderValueSum / stats.avgOrderValueCount) * 100) / 100 : 0,
        percentage: totalOrdersForPercentage > 0 ? Math.round((stats.orders / totalOrdersForPercentage) * 10000) / 100 : 0,
        byCurrency: Object.fromEntries(
          Object.entries(stats.byCurrency).map(([c, v]) => [c, Math.round(v * 100) / 100])
        )
      }))
      .sort((a, b) => b.orders - a.orders);

    // Format shipping stats
    const shippingStats = {
      totalLabels,
      pendingLabels,
      byCarrier: labelsByCarrier.map(item => ({
        carrier: item.carrier,
        count: item._count._all
      }))
    };

    // Hourly breakdown for day mode — query both selected day and previous day
    let hourlyBreakdown: { hour: number; orders: number; revenue: number; prevOrders: number; prevRevenue: number }[] | undefined;
    if (dateRange === 'day' && dayParam) {
      const [hourlyCurrentRaw, hourlyPrevRaw] = await Promise.all([
        prisma.$queryRaw<Array<{ hour: number; orders: bigint; revenue: number; currency: string | null }>>`
          SELECT EXTRACT(HOUR FROM COALESCE("uiOrderDate", "createdAt"))::int as hour,
                 COUNT(*) as orders,
                 SUM("totalPrice") as revenue,
                 "currency"
          FROM "Order"
          WHERE "userId" = ${dbUser.id}
            AND COALESCE("uiOrderDate", "createdAt") >= ${startDate}
            AND COALESCE("uiOrderDate", "createdAt") <= ${endDate}
          GROUP BY EXTRACT(HOUR FROM COALESCE("uiOrderDate", "createdAt"))::int, "currency"
          ORDER BY hour ASC
        `,
        prisma.$queryRaw<Array<{ hour: number; orders: bigint; revenue: number; currency: string | null }>>`
          SELECT EXTRACT(HOUR FROM COALESCE("uiOrderDate", "createdAt"))::int as hour,
                 COUNT(*) as orders,
                 SUM("totalPrice") as revenue,
                 "currency"
          FROM "Order"
          WHERE "userId" = ${dbUser.id}
            AND COALESCE("uiOrderDate", "createdAt") >= ${previousPeriodStart}
            AND COALESCE("uiOrderDate", "createdAt") <= ${previousPeriodEnd}
          GROUP BY EXTRACT(HOUR FROM COALESCE("uiOrderDate", "createdAt"))::int, "currency"
          ORDER BY hour ASC
        `,
      ]);

      // Aggregate by hour with currency conversion
      const currentByHour = new Map<number, { orders: number; revenue: number }>();
      for (const row of hourlyCurrentRaw) {
        const existing = currentByHour.get(row.hour) || { orders: 0, revenue: 0 };
        existing.orders += Number(row.orders);
        existing.revenue += convertToTRY(Number(row.revenue) || 0, row.currency);
        currentByHour.set(row.hour, existing);
      }
      const prevByHour = new Map<number, { orders: number; revenue: number }>();
      for (const row of hourlyPrevRaw) {
        const existing = prevByHour.get(row.hour) || { orders: 0, revenue: 0 };
        existing.orders += Number(row.orders);
        existing.revenue += convertToTRY(Number(row.revenue) || 0, row.currency);
        prevByHour.set(row.hour, existing);
      }

      hourlyBreakdown = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        orders: currentByHour.get(h)?.orders || 0,
        revenue: Math.round((currentByHour.get(h)?.revenue || 0) * 100) / 100,
        prevOrders: prevByHour.get(h)?.orders || 0,
        prevRevenue: Math.round((prevByHour.get(h)?.revenue || 0) * 100) / 100,
      }));
    }

    const analytics = {
      totalOrders,
      totalRevenue: currentRevenue,
      totalCustomers: uniqueCustomers.length,
      averageOrderValue: totalOrders > 0 ? currentRevenue / totalOrders : 0,
      orderTrend: Math.round(orderTrend * 100) / 100,
      revenueTrend: Math.round(revenueTrend * 100) / 100,
      previousPeriod: {
        orders: previousOrders,
        revenue: Math.round(prevRevenue * 100) / 100,
      },
      exchangeRates: Object.keys(exchangeRates).length > 0 ? {
        USD: exchangeRates['USD'] || 0,
        EUR: exchangeRates['EUR'] || 0,
        lastUpdated: new Date().toISOString()
      } : undefined,
      topMarketplaces,
      dailyStats: formattedDailyStats,
      topProducts: formattedTopProducts,
      orderStatusBreakdown,
      monthlyStats,
      marketplaceBreakdown: formattedMarketplaceBreakdown,
      shippingStats,
      recentActivity: recentActivity.map(o => ({ ...o, marketplace: normalizeMarketplace(o.marketplace) })),
      ...(hourlyBreakdown ? { hourlyBreakdown } : {}),
    };

    res.status(200).json(analytics);

  } catch (error) {
    console.error('Analytics API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Temporarily disable usage limiter for analytics to reduce connection pool pressure
export default handler;