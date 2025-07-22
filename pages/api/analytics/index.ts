import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import prisma from '@/lib/prisma';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

interface AnalyticsQuery {
  dateRange: string;
  marketplace?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Use Supabase Auth instead of NextAuth
    let supabaseUser, authError;
    
    console.log('[Analytics API] Starting authentication check...');
    
    const supabase = getSupabaseServerClient(req, res);
    const result = await supabase.auth.getUser();
    supabaseUser = result.data?.user;
    authError = result.error;
    
    console.log('[Analytics API] Initial auth result:', { 
      hasUser: !!supabaseUser, 
      userEmail: supabaseUser?.email, 
      authError: authError?.message 
    });
    
    if (authError || !supabaseUser) {
      console.log('[Analytics API] Trying Authorization header fallback...');
      // Try Authorization header fallback
      const authHeaderRaw = req.headers['authorization'] || req.headers['Authorization'];
      let authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
      const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      
      console.log('[Analytics API] Auth header token found:', !!token);
      
      if (token) {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
          console.error('[API analytics] Missing Supabase environment variables for Authorization header fallback.');
        } else {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
          
          const supabaseDirect = createClient(supabaseUrl, supabaseAnonKey);
          const { data, error: userError } = await supabaseDirect.auth.getUser(token);
          supabaseUser = data?.user;
          authError = userError;
          
          console.log('[Analytics API] Fallback auth result:', { 
            hasUser: !!supabaseUser, 
            userEmail: supabaseUser?.email, 
            authError: authError?.message 
          });
        }
      }
    }
    
    if (authError || !supabaseUser) {
      console.log('[Analytics API] Authentication failed:', authError?.message);
      return res.status(401).json({ error: 'Not authenticated', details: authError?.message });
    }

    console.log('[Analytics API] User authenticated:', supabaseUser.email);

    const dateRange = (req.query.dateRange as string) || '7days';
    const marketplace = req.query.marketplace as string | undefined;

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
        startDate.setDate(now.getDate() - 7);
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
        lte: now
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
        console.error('Error fetching exchange rates:', error);
        // Return empty rates object - this will cause convertToTRY to return original amounts
        // This way we show data without incorrect conversions
        return {};
      }
    };

    // Get current exchange rates
    const exchangeRates = await fetchExchangeRates();
    
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
    const [
      ordersData,
      dailyStats,
      statusBreakdown,
      topProducts
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

      // Daily statistics
      prisma.$queryRaw<Array<{ date: Date; orders: bigint; revenue: number }>>`
        SELECT 
          DATE("uiOrderDate") as date,
          COUNT(*) as orders,
          SUM("totalPrice") as revenue
        FROM "Order" 
        WHERE "userId" = ${dbUser.id}
          AND "uiOrderDate" >= ${startDate}
          AND "uiOrderDate" <= ${now}
        GROUP BY DATE("uiOrderDate")
        ORDER BY date DESC
        LIMIT 30
      `,

      // Order status breakdown
      prisma.order.groupBy({
        by: ['externalStatus'],
        where: whereClause,
        _count: {
          _all: true
        }
      }),

      // Top products by order count
      prisma.orderItem.groupBy({
        by: ['productName'],
        where: {
          order: whereClause
        },
        _count: {
          productName: true
        },
        _sum: {
          totalPrice: true
        },
        orderBy: {
          _count: {
            productName: 'desc'
          }
        },
        take: 5
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

    // Calculate trends (compare with previous period) - single query optimization
    const previousPeriodStart = new Date(startDate);
    const periodLength = now.getTime() - startDate.getTime();
    previousPeriodStart.setTime(previousPeriodStart.getTime() - periodLength);

    const previousOrdersData = await prisma.order.findMany({
      where: {
        ...whereClause,
        uiOrderDate: {
          gte: previousPeriodStart,
          lt: startDate
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
    const marketplaceColors = {
      'veeqo': '#4F46E5',
      'trendyol': '#F97316',
      'hepsiburada': '#EF4444',
      'shippo': '#10B981',
      'other': '#6B7280'
    };

    // Calculate marketplace breakdown with currency conversion
    const marketplaceBreakdown = marketplaceOrders.reduce((acc, order) => {
      const marketplace = order.marketplace || 'Unknown';
      const convertedRevenue = convertToTRY(order.totalPrice || 0, order.currency);
      
      if (!acc[marketplace]) {
        acc[marketplace] = { orders: 0, revenue: 0 };
      }
      acc[marketplace].orders += 1;
      acc[marketplace].revenue += convertedRevenue;
      return acc;
    }, {} as Record<string, { orders: number; revenue: number }>);

    const topMarketplaces = Object.entries(marketplaceBreakdown).map(([name, stats]) => ({
      name,
      orders: stats.orders,
      revenue: stats.revenue,
      color: marketplaceColors[name?.toLowerCase() as keyof typeof marketplaceColors] || marketplaceColors.other
    }));

    // Format daily stats
    const formattedDailyStats = dailyStats.map(stat => ({
      date: stat.date.toISOString().split('T')[0],
      orders: Number(stat.orders),
      revenue: Number(stat.revenue) || 0
    }));

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

    // Format top products
    const formattedTopProducts = topProducts.map(product => ({
      name: product.productName || 'Unknown Product',
      orders: product._count.productName,
      revenue: product._sum.totalPrice || 0
    }));

    const analytics = {
      totalOrders,
      totalRevenue: currentRevenue,
      totalCustomers: uniqueCustomers.length,
      averageOrderValue: totalOrders > 0 ? currentRevenue / totalOrders : 0,
      orderTrend: Math.round(orderTrend * 100) / 100,
      revenueTrend: Math.round(revenueTrend * 100) / 100,
      exchangeRates: Object.keys(exchangeRates).length > 0 ? {
        USD: exchangeRates['USD'] || 0,
        EUR: exchangeRates['EUR'] || 0,
        lastUpdated: new Date().toISOString()
      } : undefined,
      topMarketplaces,
      dailyStats: formattedDailyStats,
      topProducts: formattedTopProducts,
      orderStatusBreakdown
    };

    res.status(200).json(analytics);

  } catch (error) {
    console.error('Analytics API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    // Ensure connection is returned to pool
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.warn('Warning: Error during Prisma disconnect:', disconnectError);
    }
  }
}

// Temporarily disable usage limiter for analytics to reduce connection pool pressure
export default handler;