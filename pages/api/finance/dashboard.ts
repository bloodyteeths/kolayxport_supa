import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardSummary {
  grossRevenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  discounts: number;
  adSpend: number;
  cogs: number;
  netProfit: number;
  margin: number;
  // Orders Etsy / Trendyol have actually settled — what FinancialTransaction
  // knows about. Always lags the user's actual receipts.
  orderCount: number;
  // Distinct orders with at least one finalized refund event in the period —
  // i.e., money already returned to the buyer. NOT a count of cancelled rows.
  returnCount: number;
  // Cancellations whose refund event hasn't posted yet (Amazon lags 14-30
  // days). UI surfaces this as a separate badge under Returns so users don't
  // think they refunded $0 across 8 orders when reality is "0 settled, 8
  // pending". Zero for marketplaces where settlement posts immediately.
  pendingCancellationCount: number;
  // Orders the labels page counts (Order table). Includes receipts that
  // haven't settled yet. >= orderCount; the delta is "pending settlement".
  totalOrderCount: number;
  pendingSettlementCount: number;
  totalOrderRevenue: number;
}

interface TimeSeriesPoint {
  period: string;
  revenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  cogs: number;
  netProfit: number;
}

interface ProductBreakdownItem {
  barcode: string | null;
  productName: string | null;
  revenue: number;
  quantity: number;
  commissions: number;
  shipping: number;
  cogs: number;
  unitCost: number;
  netProfit: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDateTruncExpression(groupBy: string): string {
  switch (groupBy) {
    case 'day':
      return `DATE_TRUNC('day', "transactionDate")`;
    case 'week':
      return `DATE_TRUNC('week', "transactionDate")`;
    case 'month':
    default:
      return `DATE_TRUNC('month', "transactionDate")`;
  }
}

/**
 * Classify Trendyol transaction types into financial categories.
 */
function classifyTransactionType(type: string): 'revenue' | 'commission' | 'shipping' | 'return' | 'discount' | 'adspend' | 'other' {
  // Normalize: strip diacritics so Turkish İ→i, ş→s, etc. work with plain includes()
  const t = (type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Also check original for exact Turkish matches
  const orig = (type || '').trim();

  // Order matters — more specific patterns first
  if (t.includes('sale') || orig === 'Satış' || t.includes('satis')) return 'revenue';
  if (t.includes('shipping') || t.includes('cargo') || t.includes('kargo')) return 'shipping';
  if (t.includes('commission') || t.includes('komisyon') || t.includes('service')) return 'commission';
  // Discount cancel (İndirim İptal / DiscountCancel) — revenue recovery
  if (orig === 'İndirim İptal' || t.includes('discountcancel') || (t.includes('indirim') && t.includes('iptal'))) return 'revenue';
  // Returns (İade / Return / Refund)
  if (orig.startsWith('İade') || t.includes('return') || t.includes('iade') || t.includes('refund')) return 'return';
  // Discounts/coupons (İndirim / Kupon)
  if (orig.startsWith('İndirim') || t.includes('discount') || t.includes('indirim') || t.includes('coupon') || t.includes('kupon')) return 'discount';
  // Provision (weight/deci adjustments) — treat as shipping adjustment
  if (t.includes('provision')) return 'shipping';
  if (t.includes('adspend') || t.includes('promoted') || t.includes('offsite ads') || t.includes('etsy ads')) return 'adspend';
  // eBay-specific types
  if (t.includes('shippinglabel')) return 'shipping';
  if (t.includes('credit')) return 'revenue'; // eBay credits = revenue adjustment
  if (t.includes('storefee')) return 'other'; // eBay store subscription — don't mix with commissions
  if (t.includes('sellerrevenue') || t.includes('manualrefund')) return 'other';
  // Amazon-specific types
  if (t.includes('productcharges') || t.includes('productcharge')) return 'revenue';
  if (t.includes('referralfee') || t.includes('amazoncommission')) return 'commission';
  if (t.includes('fbafee') || t.includes('fulfillmentfee') || t.includes('fbainbound') || t.includes('fbastorage')) return 'shipping';
  if (t.includes('refundcommission') || t.includes('amazonrefund')) return 'return';
  if (t.includes('sponsoredproduct') || t.includes('sponsoredbrand') || t.includes('sponsoreddisplay') || t.includes('amazonadspend')) return 'adspend';
  if (t.includes('amazoncoupon') || t.includes('amazondiscount')) return 'discount';
  return 'other';
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

async function buildDashboard(
  userId: string,
  marketplace: string,
  startDate: Date,
  endDate: Date,
  groupBy: string
): Promise<{
  summary: DashboardSummary;
  timeSeries: TimeSeriesPoint[];
  productBreakdown: ProductBreakdownItem[];
  transactionTypeSummary: Record<string, { count: number; total: number }>;
}> {
  // Fetch all transactions in the date range
  const transactions = await prisma.financialTransaction.findMany({
    where: {
      userId,
      marketplace,
      transactionDate: { gte: startDate, lte: endDate },
    },
    orderBy: { transactionDate: 'asc' },
  });

  // Order-table totals for the same window. Etsy/Trendyol/eBay/Amazon hold
  // payments 1-3 days before they post as ledger entries, so the
  // `FinancialTransaction` Sale count is always behind the labels page.
  // Cross-reference the Order table — it gets the receipt the moment the
  // marketplace fires the webhook — so we can show the user the real order
  // total and a "X pending settlement" delta.
  // Match the same shop-name family that the marketplace tab represents
  // (Etsy can land as "BelleCoutureGifts", "Decorsweetart", etc. — see
  // reference_etsy_marketplace_detection memory).
  const marketplaceMatchers: Record<string, string[]> = {
    etsy: ['etsy', 'bellecouture', 'decorsweet', 'mybabybymerry', 'outletemporium'],
    trendyol: ['trendyol'],
    ebay: ['ebay'],
    amazon: ['amazon'],
  };
  const orderMarketplacePatterns =
    marketplaceMatchers[marketplace.toLowerCase()] || [marketplace.toLowerCase()];
  const orderRows = await prisma.order
    .findMany({
      where: {
        userId,
        OR: orderMarketplacePatterns.map(p => ({
          marketplace: { contains: p, mode: 'insensitive' as const },
        })),
        AND: [
          {
            OR: [
              { uiOrderDate: { gte: startDate, lte: endDate } },
              {
                AND: [
                  { uiOrderDate: null },
                  { createdAt: { gte: startDate, lte: endDate } },
                ],
              },
            ],
          },
        ],
      },
      select: { id: true, status: true, totalPrice: true },
    })
    .catch(() => [] as Array<{ id: string; status: string | null; totalPrice: number | null }>);
  const cancelledStatuses = new Set(['CANCELLED', 'cancelled', 'Cancelled', 'canceled', 'Canceled']);
  const orderRowsActive = orderRows.filter(r => !cancelledStatuses.has(r.status || ''));
  const orderRowsCancelled = orderRows.filter(r => cancelledStatuses.has(r.status || ''));
  const orderTableCount = orderRowsActive.length;
  const orderTableRevenue = orderRowsActive.reduce(
    (acc, r) => acc + Number(r.totalPrice || 0),
    0,
  );
  // Distinct refunded orders, NOT individual refund ledger events. Etsy emits
  // multiple refund entries per order (partial refund + return-shipping refund
  // + commission refund), so counting Refund FinancialTransaction rows shows
  // misleadingly high "X orders refunded" badges. The Order table is the
  // single source of truth for distinct-order counts.
  const refundedOrderCount = orderRowsCancelled.length;

  // Fetch product costs for COGS lookup
  const productCosts = await prisma.productCost.findMany({
    where: { userId, marketplace },
  });

  const costMap = new Map<string, { costAmount: number; shippingCost: number }>();
  for (const pc of productCosts) {
    const key = pc.barcode || pc.sku || '';
    if (key) {
      costMap.set(key, {
        costAmount: Number(pc.costAmount),
        shippingCost: Number(pc.shippingCost || 0),
      });
    }
  }

  // Aggregate summary
  let grossRevenue = 0;
  let commissions = 0;
  let shipping = 0;
  let returns = 0;
  let discounts = 0;
  let adSpend = 0;
  let cogs = 0;
  let orderCount = 0;
  // Distinct orderNumbers with at least one finalized refund event in the
  // period. Some marketplaces emit several refund ledger rows per order
  // (partial refund + commission refund + return-shipping refund) so a raw
  // increment overcounts; this Set gives us "real orders refunded".
  const refundedOrderNumbers = new Set<string>();

  // Transaction type summary
  const transactionTypeSummary: Record<string, { count: number; total: number }> = {};

  // Time series buckets
  const timeMap = new Map<string, { revenue: number; commissions: number; shipping: number; returns: number; cogs: number }>();

  // Product breakdown
  const productMap = new Map<string, ProductBreakdownItem>();

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const commissionAmt = Number(tx.commission || 0);
    const shippingAmt = Number(tx.shippingAmount || 0);
    const category = classifyTransactionType(tx.transactionType);
    const quantity = tx.quantity || 1;

    // Transaction type summary
    if (!transactionTypeSummary[tx.transactionType]) {
      transactionTypeSummary[tx.transactionType] = { count: 0, total: 0 };
    }
    transactionTypeSummary[tx.transactionType].count++;
    transactionTypeSummary[tx.transactionType].total += amount;

    // Aggregate by category
    switch (category) {
      case 'revenue':
        grossRevenue += amount;
        commissions += commissionAmt;
        shipping += shippingAmt;
        orderCount++;
        break;
      case 'commission':
        // CommissionPositive = refund (subtract), CommissionNegative = charge (add)
        // But since amount sign already reflects this, just add the signed amount
        if (amount > 0) {
          commissions -= amount; // commission refund reduces commissions
        } else {
          commissions += Math.abs(amount);
        }
        break;
      case 'shipping':
        shipping += Math.abs(amount);
        break;
      case 'return':
        returns += Math.abs(amount);
        if (tx.orderNumber) refundedOrderNumbers.add(tx.orderNumber);
        // Return transactions carry commission that should be refunded — subtract from total
        // Trendyol stores commissionAmount as positive even on returns
        if (commissionAmt > 0) {
          commissions -= commissionAmt;
        }
        break;
      case 'discount':
        discounts += Math.abs(amount);
        break;
      case 'adspend':
        adSpend += Math.abs(amount);
        break;
      default:
        // Other types — add to revenue if positive, ignore if negative
        if (amount > 0) grossRevenue += amount;
        break;
    }

    // COGS for revenue transactions
    if (category === 'revenue' && tx.barcode) {
      const cost = costMap.get(tx.barcode);
      if (cost) {
        cogs += (cost.costAmount + cost.shippingCost) * quantity;
      }
    }

    // Time series
    const period = formatPeriod(tx.transactionDate, groupBy);
    if (!timeMap.has(period)) {
      timeMap.set(period, { revenue: 0, commissions: 0, shipping: 0, returns: 0, cogs: 0 });
    }
    const bucket = timeMap.get(period)!;
    if (category === 'revenue') {
      bucket.revenue += amount;
      bucket.commissions += commissionAmt;
      bucket.shipping += shippingAmt;
      if (tx.barcode) {
        const cost = costMap.get(tx.barcode);
        if (cost) bucket.cogs += (cost.costAmount + cost.shippingCost) * quantity;
      }
    } else if (category === 'commission') {
      bucket.commissions += Math.abs(amount);
    } else if (category === 'shipping') {
      bucket.shipping += Math.abs(amount);
    } else if (category === 'return') {
      bucket.returns += Math.abs(amount);
    }

    // Product breakdown (only for transactions with barcode)
    if (tx.barcode && category === 'revenue') {
      const key = tx.barcode;
      if (!productMap.has(key)) {
        productMap.set(key, {
          barcode: tx.barcode,
          productName: tx.productName,
          revenue: 0,
          quantity: 0,
          commissions: 0,
          shipping: 0,
          cogs: 0,
          unitCost: 0,
          netProfit: 0,
        });
      }
      const p = productMap.get(key)!;
      p.revenue += amount;
      p.quantity += quantity;
      p.commissions += commissionAmt;
      p.shipping += shippingAmt;
      const cost = costMap.get(key);
      if (cost) {
        p.unitCost = cost.costAmount;
        p.cogs += (cost.costAmount + cost.shippingCost) * quantity;
      }
    }
  }

  const netProfit = grossRevenue - commissions - shipping - returns - discounts - adSpend - cogs;
  const margin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  // Build time series array
  const timeSeries: TimeSeriesPoint[] = Array.from(timeMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      revenue: round2(data.revenue),
      commissions: round2(data.commissions),
      shipping: round2(data.shipping),
      returns: round2(data.returns),
      cogs: round2(data.cogs),
      netProfit: round2(data.revenue - data.commissions - data.shipping - data.returns - data.cogs),
    }));

  // Build product breakdown
  const productBreakdown: ProductBreakdownItem[] = Array.from(productMap.values())
    .map((p) => ({
      ...p,
      revenue: round2(p.revenue),
      commissions: round2(p.commissions),
      shipping: round2(p.shipping),
      cogs: round2(p.cogs),
      netProfit: round2(p.revenue - p.commissions - p.shipping - p.cogs),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    summary: {
      grossRevenue: round2(grossRevenue),
      commissions: round2(commissions),
      shipping: round2(shipping),
      returns: round2(returns),
      discounts: round2(discounts),
      adSpend: round2(adSpend),
      cogs: round2(cogs),
      netProfit: round2(netProfit),
      margin: round2(margin),
      orderCount,
      // Number of distinct orders whose refund event has actually posted in
      // the period. Drives the Returns card's "X refunds" subtitle.
      returnCount: refundedOrderNumbers.size,
      // Orders cancelled in the period but with no matching refund event yet
      // — Amazon settlement lags 14-30 days, so these will mature later.
      // Surfaced as a separate "+N cancellations pending settlement" badge
      // so the user understands why "$0 refunded across 8 cancellations".
      pendingCancellationCount: Math.max(
        0,
        refundedOrderCount - refundedOrderNumbers.size,
      ),
      totalOrderCount: orderTableCount,
      pendingSettlementCount: Math.max(0, orderTableCount - orderCount),
      totalOrderRevenue: round2(orderTableRevenue),
    },
    timeSeries,
    productBreakdown,
    transactionTypeSummary,
  };
}

function formatPeriod(date: Date, groupBy: string): string {
  const d = new Date(date);
  switch (groupBy) {
    case 'day':
      return d.toISOString().slice(0, 10);
    case 'week': {
      // ISO week start (Monday)
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
    default:
      return d.toISOString().slice(0, 7);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    // Auth: API key or session
    let userId: string;
    const apiKey = req.headers['x-api-key'];
    const envApiKey = process.env.CLAWD_API_KEY;

    if (envApiKey && apiKey === envApiKey) {
      const qUserId = req.query.userId as string;
      if (!qUserId) return res.status(400).json({ error: 'userId required with API key auth' });
      userId = qUserId;
    } else {
      const user = await getAuthUser(req, res);
      if (!user) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
      userId = user.id;
    }
    const marketplace = (req.query.marketplace as string) || 'trendyol';
    const groupBy = (req.query.groupBy as string) || 'month';

    if (!['day', 'week', 'month'].includes(groupBy)) {
      return res.status(400).json({ error: 'groupBy must be one of: day, week, month' });
    }

    // Default: last 30 days
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 30);

    const startDateRaw = req.query.startDate as string | undefined;
    const endDateRaw = req.query.endDate as string | undefined;

    const startDate = startDateRaw
      ? new Date(Number(startDateRaw) || startDateRaw)
      : defaultStart;
    let endDate = endDateRaw
      ? new Date(Number(endDateRaw) || endDateRaw)
      : now;

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use epoch ms or ISO string.' });
    }

    // Date-only inputs (YYYY-MM-DD) parse to midnight UTC on that day. Without
    // this fix the dashboard misses everything placed *during* the last day of
    // the range — labels page already does the same end-of-day bump so without
    // it, the two views report different counts. (Off-by-one between "9
    // orders" on financials and "10 orders" on labels was this exact issue.)
    if (
      typeof endDateRaw === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw) &&
      endDate.getUTCHours() === 0 &&
      endDate.getUTCMinutes() === 0
    ) {
      endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    }

    // Debug mode: show raw transaction type distribution
    if (req.query.debug === 'true') {
      const txTypes = await prisma.financialTransaction.groupBy({
        by: ['transactionType'],
        where: {
          userId,
          marketplace,
          transactionDate: { gte: startDate, lte: endDate },
        },
        _count: true,
        _sum: { amount: true, commission: true, shippingAmount: true },
      });
      return res.status(200).json({
        debug: true,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        transactionTypes: txTypes.map(t => ({
          type: t.transactionType,
          count: t._count,
          totalAmount: t._sum.amount ? Number(t._sum.amount) : 0,
          totalCommission: t._sum.commission ? Number(t._sum.commission) : 0,
          totalShipping: t._sum.shippingAmount ? Number(t._sum.shippingAmount) : 0,
          classifiedAs: classifyTransactionType(t.transactionType),
        })),
      });
    }

    const dashboard = await buildDashboard(userId, marketplace, startDate, endDate, groupBy);

    return res.status(200).json({
      marketplace,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      groupBy,
      ...dashboard,
    });
  } catch (err: any) {
    if (err.status && err.message) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    logger.error('Finance dashboard API error', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
