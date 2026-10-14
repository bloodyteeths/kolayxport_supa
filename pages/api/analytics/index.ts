import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

interface AnalyticsQuery {
  dateRange: string;
  marketplace?: string;
}

// Module-level cache for exchange rates (amount_in_currency * rate = TRY).
// `cachedRatesAt` is when the cached rates were actually fetched, so a stale
// fallback can say how old it is.
let cachedRates: Record<string, number> = {};
let cachedRatesAt = 0;
let cacheExpiry = 0;
const RATES_TTL_MS = 60 * 60 * 1000;
// After a failed fetch, retry sooner than the normal TTL.
const RATES_RETRY_MS = 5 * 60 * 1000;

interface RatesSnapshot {
  rates: Record<string, number>;
  /** True when live rates could not be fetched (last-known or none used). */
  stale: boolean;
  /** When the rates in use were fetched; null when there are none. */
  asOf: number | null;
}

async function fetchLiveRates(): Promise<Record<string, number> | null> {
  try {
    // exchangerate-api.com, USD base
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!response.ok) throw new Error(`Exchange rate API ${response.status}`);
    const data = await response.json();
    const usdToTry = Number(data?.rates?.TRY);
    if (!data?.rates || typeof data.rates !== 'object' || !Number.isFinite(usdToTry) || usdToTry <= 0) {
      throw new Error('Exchange rate API returned no TRY rate');
    }
    const rates: Record<string, number> = {};
    for (const [currency, perUsd] of Object.entries(data.rates as Record<string, unknown>)) {
      const n = Number(perUsd);
      // amount_in_currency * (TRY_per_USD / currency_per_USD)
      if (Number.isFinite(n) && n > 0) rates[currency.toUpperCase()] = usdToTry / n;
    }
    rates.TRY = 1;
    rates.TL = 1;
    return rates;
  } catch (error) {
    console.error('[Analytics] Exchange rate API failed:', error);
    return null;
  }
}

async function getExchangeRates(): Promise<RatesSnapshot> {
  const now = Date.now();
  const haveCache = Object.keys(cachedRates).length > 0;
  if (haveCache && now < cacheExpiry) {
    // Inside a post-failure retry window the cache can be older than the TTL.
    return { rates: cachedRates, stale: now - cachedRatesAt > RATES_TTL_MS, asOf: cachedRatesAt };
  }
  if (!haveCache && now < cacheExpiry) {
    // A fetch failed recently and there is nothing cached — don't hammer the API.
    return { rates: {}, stale: true, asOf: null };
  }
  const live = await fetchLiveRates();
  if (live) {
    cachedRates = live;
    cachedRatesAt = now;
    cacheExpiry = now + RATES_TTL_MS;
    return { rates: live, stale: false, asOf: now };
  }
  cacheExpiry = now + RATES_RETRY_MS;
  // Last-known rates (even if expired) beat summing USD as if it were TRY.
  if (haveCache) return { rates: cachedRates, stale: true, asOf: cachedRatesAt };
  return { rates: {}, stale: true, asOf: null };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth: API key or session
    let resolvedUserId: string | null = null;
    const apiKey = req.headers['x-api-key'];
    const envApiKey = process.env.CLAWD_API_KEY;

    if (envApiKey && apiKey === envApiKey) {
      const qUserId = req.query.userId as string;
      if (!qUserId) return res.status(400).json({ error: 'userId required with API key auth' });
      resolvedUserId = qUserId;
    } else {
      const supabaseUser = await getAuthUser(req, res);
      if (!supabaseUser) return res.status(401).json({ error: 'Not authenticated' });
      if (!supabaseUser.email) return res.status(401).json({ error: 'User email not found' });
      const dbUserLookup = await prisma.user.findUnique({ where: { email: supabaseUser.email } });
      if (!dbUserLookup) return res.status(404).json({ error: 'User not found in database' });
      resolvedUserId = dbUserLookup.id;
    }

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
    } else if (dateRange === 'day') {
      // Today
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (dateRange === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      startDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
      endDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
    } else if (dateRange === 'month' && monthParam) {
      // Specific month: "2026-03" → start=2026-03-01, end=2026-03-31 23:59:59
      const [year, month] = monthParam.split('-').map(Number);
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59, 999); // last day of month
    } else if (dateRange === 'month') {
      // This month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
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
        case '3months':
          startDate.setMonth(now.getMonth() - 3);
          break;
        case '6months':
          startDate.setMonth(now.getMonth() - 6);
          break;
        case '9months':
          startDate.setMonth(now.getMonth() - 9);
          break;
        case 'thisYear':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        case 'lastYear':
          startDate = new Date(now.getFullYear() - 1, 0, 1);
          endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
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

    const dbUserId = resolvedUserId!;

    // Build where clause — use uiOrderDate when available, fall back to createdAt
    const whereClause: any = {
      userId: dbUserId,
      OR: [
        { uiOrderDate: { gte: startDate, lte: endDate } },
        { uiOrderDate: null, createdAt: { gte: startDate, lte: endDate } },
      ],
    };

    if (marketplace) {
      whereClause.marketplace = marketplace;
    }

    const ratesSnapshot = await getExchangeRates();
    const exchangeRates = ratesSnapshot.rates;

    // Convert to TRY; null when no rate is available for the currency.
    const tryConvertToTRY = (amount: number, currency: string | null | undefined): number | null => {
      if (!amount) return 0;
      // No currency recorded: orders are stored in TRY unless they say otherwise.
      if (!currency) return amount;
      const code = currency.toUpperCase();
      if (code === 'TRY' || code === 'TL') return amount;
      const rate = exchangeRates[code];
      // No rate: leave the amount OUT of TRY totals instead of summing it as TRY.
      if (!rate) return null;
      return amount * rate;
    };

    // Same, but excluded amounts count as 0 (for sums).
    const convertToTRY = (amount: number, currency: string | null | undefined): number =>
      tryConvertToTRY(amount, currency) ?? 0;

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
        WHERE "userId" = ${dbUserId}
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
        WHERE "userId" = ${dbUserId} AND COALESCE("uiOrderDate", "createdAt") >= ${twelveMonthsAgo}
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
        WHERE "userId" = ${dbUserId}
          AND COALESCE("uiOrderDate", "createdAt") >= ${startDate}
          AND COALESCE("uiOrderDate", "createdAt") <= ${endDate}
        GROUP BY "marketplace", "currency"
        ORDER BY orders DESC
      `,

      // 3. Shipping stats — total labels
      prisma.shipment.count({ where: { order: { userId: dbUserId } } }),

      // 3. Shipping stats — labels by carrier
      prisma.shipment.groupBy({
        by: ['carrier'],
        where: { order: { userId: dbUserId } },
        _count: { _all: true }
      }),

      // 3. Shipping stats — pending labels
      prisma.order.count({
        where: { userId: dbUserId, labelStatus: 'pending' }
      }),

      // 4. Recent activity — last 10 orders
      prisma.order.findMany({
        where: { userId: dbUserId },
        select: {
          orderNumber: true,
          customerName: true,
          totalPrice: true,
          currency: true,
          marketplace: true,
          externalStatus: true,
          status: true,
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

    // Calculate total revenue with currency conversion. Orders whose currency
    // can't be converted are excluded from the revenue AND from the AOV divisor.
    // The warning only reports currencies excluded from the SELECTED period's
    // totals; misses in the previous period / 12-month chart don't count.
    const currentPeriodUnconverted = new Set<string>();
    let convertedOrderCount = 0;
    const currentRevenue = ordersWithCurrency.reduce((total, order) => {
      const convertedAmount = tryConvertToTRY(order.totalPrice || 0, order.currency);
      if (convertedAmount == null) {
        if (order.currency) currentPeriodUnconverted.add(order.currency.toUpperCase());
        return total;
      }
      convertedOrderCount += 1;
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
        userId: dbUserId,
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

    // Render statuses like "Awaiting Fulfillment" regardless of how the source
    // sync writes them (snake_case, UPPER, mixed). Returns '' if no input.
    const prettyStatus = (s: string | null | undefined): string => {
      if (!s) return '';
      return s
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    };

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

    // Normalize marketplace names — fold known platforms, keep brand casing.
    const normalizeMarketplace = (name: string | null | undefined): string => {
      if (!name) return 'Unknown';
      const lower = name.toLowerCase().trim();
      if (lower.includes('amazon') && lower.includes('fba')) return 'Amazon FBA';
      if (lower.includes('amazon')) return 'Amazon';
      if (lower.includes('etsy')) return 'Etsy';
      if (lower.includes('trendyol')) return 'Trendyol';
      if (lower.includes('hepsiburada')) return 'Hepsiburada';
      if (lower.includes('shippo')) return 'Shippo';
      if (lower.includes('veeqo')) return 'Veeqo';
      if (lower === 'manual') return 'Manual';
      // Shop names: preserve the original casing the marketplace uses
      // (e.g. "BelleCoutureGifts", not "Bellecouturegifts").
      return name.trim();
    };

    // Case-insensitive bucketing so "Decorsweetart" and "decorsweetart" merge.
    const marketplaceBreakdown = marketplaceOrders.reduce((acc, order) => {
      const marketplace = normalizeMarketplace(order.marketplace);
      const key = marketplace.toLowerCase();
      const rawAmount = order.totalPrice || 0;
      const currency = (order.currency || 'TRY').toUpperCase();
      const convertedRevenue = convertToTRY(rawAmount, order.currency);

      if (!acc[key]) {
        acc[key] = { displayName: marketplace, orders: 0, revenue: 0, byCurrency: {} as Record<string, number> };
      }
      acc[key].orders += 1;
      acc[key].revenue += convertedRevenue;
      acc[key].byCurrency[currency] = (acc[key].byCurrency[currency] || 0) + rawAmount;
      return acc;
    }, {} as Record<string, { displayName: string; orders: number; revenue: number; byCurrency: Record<string, number> }>);

    const topMarketplaces = Object.entries(marketplaceBreakdown).map(([key, stats], index) => ({
      name: stats.displayName,
      orders: stats.orders,
      revenue: stats.revenue,
      byCurrency: stats.byCurrency,
      color: marketplaceColors[key] || marketplaceColorPalette[index % marketplaceColorPalette.length]
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
      const convertedAvgOrNull = tryConvertToTRY(Number(row.avg_order_value) || 0, row.currency);
      // Unconvertible rows don't count toward the TRY average.
      const avgWeight = convertedAvgOrNull == null ? 0 : Number(row.orders);
      const convertedAvg = convertedAvgOrNull ?? 0;
      const existing = mpBreakdownMap.get(mp);
      if (existing) {
        existing.orders += Number(row.orders);
        existing.revenue += convertedRevenue;
        existing.customers += Number(row.customers);
        existing.avgOrderValueSum += convertedAvg * avgWeight;
        existing.avgOrderValueCount += avgWeight;
        existing.byCurrency[currency] = (existing.byCurrency[currency] || 0) + rawRevenue;
      } else {
        mpBreakdownMap.set(mp, {
          orders: Number(row.orders),
          revenue: convertedRevenue,
          customers: Number(row.customers),
          avgOrderValueSum: convertedAvg * avgWeight,
          avgOrderValueCount: avgWeight,
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
          WHERE "userId" = ${dbUserId}
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
          WHERE "userId" = ${dbUserId}
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
      averageOrderValue: convertedOrderCount > 0 ? currentRevenue / convertedOrderCount : 0,
      orderTrend: Math.round(orderTrend * 100) / 100,
      revenueTrend: Math.round(revenueTrend * 100) / 100,
      previousPeriod: {
        orders: previousOrders,
        revenue: Math.round(prevRevenue * 100) / 100,
      },
      exchangeRates: Object.keys(exchangeRates).length > 0 ? {
        USD: exchangeRates['USD'] || 0,
        EUR: exchangeRates['EUR'] || 0,
        lastUpdated: ratesSnapshot.asOf ? new Date(ratesSnapshot.asOf).toISOString() : undefined,
      } : undefined,
      // Live FX fetch failed; totals use last-known rates (exchangeRates.lastUpdated) or none.
      ratesStale: ratesSnapshot.stale,
      // Currencies left out of the selected period's TRY totals (no rate available).
      unconvertedCurrencies: Array.from(currentPeriodUnconverted).sort(),
      topMarketplaces,
      dailyStats: formattedDailyStats,
      topProducts: formattedTopProducts,
      orderStatusBreakdown,
      monthlyStats,
      marketplaceBreakdown: formattedMarketplaceBreakdown,
      shippingStats,
      recentActivity: recentActivity.map(o => ({
        ...o,
        marketplace: normalizeMarketplace(o.marketplace),
        // Fall back to internal status when marketplace didn't return one.
        // Title-case so "awaiting_fulfillment" and "AWAITING_FULFILLMENT" render the same way.
        externalStatus: prettyStatus(o.externalStatus || o.status || ''),
      })),
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