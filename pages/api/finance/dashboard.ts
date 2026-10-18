import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { isFeatureLockedError, requireFeature } from '@/lib/billing/requireFeature';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { refreshFinancialsIfStale } from '@/lib/finance/financialAutoSync';
import { getExchangeRates, convertToBase, normalizeCurrency, type FxRates } from '@/lib/fx';
import { canonicalStore } from '@/lib/marketplaces/canonical';
import { classifyTransactionType, type TransactionCategory } from '@/lib/finance/classifyTransaction';
import {
  bucketKey,
  bucketKeys,
  isGranularity,
  localDateKey,
  parseTz,
  previousKeys,
  windowFromKeys,
  type Granularity,
} from '@/lib/finance/periods';

// ---------------------------------------------------------------------------
// Types (finance-analytics §6.2)
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  /** Settlement currency of every amount in this response (B12). */
  currency: string;
  grossRevenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  discounts: number;
  adSpend: number;
  otherFees: number;
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
  // days). Zero for marketplaces where settlement posts immediately.
  pendingCancellationCount: number;
  // Orders the labels page counts (Order table). Includes receipts that
  // haven't settled yet. >= orderCount; the delta is "pending settlement".
  totalOrderCount: number;
  pendingSettlementCount: number;
  totalOrderRevenue: number;
  // Banked money paid to bank in the period + current not-yet-disbursed balance.
  // Absent on `previousSummary`.
  banked?: number;
  disbursementCount?: number;
  currentBalance?: number | null;
  balanceCurrency?: string | null;
  heldFunds?: number | null;
}

/** One zero-filled bucket. `netProfit` uses the same formula as `summary.netProfit` (B10). */
export interface TimeSeriesPoint {
  period: string;
  revenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  discounts: number;
  adSpend: number;
  otherFees: number;
  cogs: number;
  netProfit: number;
}

export interface ProductBreakdownItem {
  barcode: string | null;
  /** SKU of the matched ProductCost row, else null. */
  sku: string | null;
  productName: string | null;
  revenue: number;
  quantity: number;
  // Units returned in the period (İade / refunds). Revenue, commission and
  // COGS above are already net of them.
  returnedQuantity: number;
  commissions: number;
  shipping: number;
  cogs: number;
  /** Unit cost converted to `summary.currency` (0 when none or not convertible). */
  unitCost: number;
  netProfit: number;
}

export interface CostCoverage {
  /** Distinct products (by barcode) sold in the period. */
  products: number;
  /** Of those, products whose cost was applied (has a ProductCost row that could be converted). */
  productsWithCost: number;
  /** Sold units whose cost is unknown: uncosted products, rows without a barcode, unconvertible costs. */
  unitsWithoutCost: number;
}

export interface CogsExcluded {
  currency: string;
  /** ProductCost rows left out of COGS because there is no `currency → summary.currency` rate. */
  products: number;
}

/**
 * ProductCost rows saved as TRY on a non-Trendyol marketplace. The legacy bulk import (and the schema
 * default) wrote 'TRY' whatever the tab, so the label is not trusted: these rows keep the legacy behaviour
 * (amount used as is, in `summary.currency`) until the founder confirms the real currency (data audit).
 */
export interface CogsUnverified {
  currency: string;
  products: number;
}

/** Ledger rows whose `FinancialTransaction.currency` differs from `summary.currency`. */
export interface LedgerCurrencyCount {
  currency: string;
  rows: number;
}

export interface TransactionTypeSummaryItem {
  count: number;
  total: number;
  category: TransactionCategory;
}

// ---------------------------------------------------------------------------
// Cent accumulator: one formula for the summary and every bucket (B10)
// ---------------------------------------------------------------------------

interface Lines {
  revenue: number;
  commissions: number;
  shipping: number;
  returns: number;
  discounts: number;
  adSpend: number;
  otherFees: number;
  cogs: number;
}

const emptyLines = (): Lines => ({
  revenue: 0,
  commissions: 0,
  shipping: 0,
  returns: 0,
  discounts: 0,
  adSpend: 0,
  otherFees: 0,
  cogs: 0,
});

const toCents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const fromCents = (c: number) => c / 100;

const netCents = (l: Lines) =>
  l.revenue - l.commissions - l.shipping - l.returns - l.discounts - l.adSpend - l.otherFees - l.cogs;

interface TxCents {
  category: TransactionCategory;
  amount: number;
  commission: number;
  shipping: number;
  isTrendyol: boolean;
  quantity: number;
  /** (unit cost + unit shipping cost) in cents, converted; null when there is no usable cost. */
  unitCogs: number | null;
}

/** Apply one ledger row to `l`. Same sign rules the summary always used. */
function applyTx(l: Lines, tx: TxCents): void {
  const { amount, commission } = tx;
  switch (tx.category) {
    case 'revenue':
      l.revenue += amount;
      l.commissions += commission;
      // Trendyol headline shipping comes from Kargo Fatura invoice rows
      // (statement-exact); the per-sale shippingAmount is a partial cargo
      // line-item mapping kept for the product breakdown only.
      if (!tx.isTrendyol) l.shipping += tx.shipping;
      break;
    case 'commission':
      // Signed: a positive amount is a commission refund.
      if (amount > 0) l.commissions -= amount;
      else l.commissions += Math.abs(amount);
      break;
    case 'shipping':
      l.shipping += Math.abs(amount);
      break;
    case 'return':
      l.returns += Math.abs(amount);
      // Trendyol stores commissionAmount as positive even on returns — refunded.
      if (commission > 0) l.commissions -= commission;
      break;
    case 'discount':
      // Sign-aware: charges are negative (add), cancellations positive (reduce).
      l.discounts -= amount;
      // Trendyol: each İndirim/Kupon row gives back the discount's commission share.
      if (commission) l.commissions += amount < 0 ? -commission : commission;
      break;
    case 'adspend':
      l.adSpend += Math.abs(amount);
      break;
    case 'fees':
      // Cost rows are negative; credits (stopaj corrections) positive.
      l.otherFees -= amount;
      break;
    case 'commission_invoice':
      // Already represented by per-sale commission; kept in transactionTypeSummary only.
      break;
    case 'disbursement':
      // Bank transfer — not a P&L event.
      break;
    case 'passthrough':
      // Sales tax: a tax REFUND (positive) offsets the tax inside refund_gross.
      if (amount > 0) l.returns -= amount;
      break;
    default:
      if (amount > 0) l.revenue += amount;
      break;
  }
  // COGS for sales; a return puts the unit back in stock, so its cost comes back out.
  if ((tx.category === 'revenue' || tx.category === 'return') && tx.unitCogs != null) {
    const c = tx.unitCogs * tx.quantity;
    l.cogs += tx.category === 'return' ? -c : c;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FINANCE_MARKETPLACES = new Set(['etsy', 'trendyol', 'ebay', 'amazon', 'hepsiburada']);
const CANCELLED_STATUSES = new Set(['CANCELLED', 'cancelled', 'Cancelled', 'canceled', 'Canceled']);

function countList<K extends string>(m: Map<string, number>, field: K): Array<{ currency: string } & Record<K, number>> {
  return Array.from(m.entries())
    .map(([c, n]) => ({ currency: c, [field]: n }) as { currency: string } & Record<K, number>)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** trendyol / hepsiburada → TRY; else the cursor's balance currency; else the most frequent ledger currency; else USD. */
export function pickDashboardCurrency(
  marketplace: string,
  balanceCurrency: string | null | undefined,
  txCurrencies: Iterable<string | null | undefined>,
): string {
  if (marketplace.toLowerCase() === 'trendyol' || marketplace.toLowerCase() === 'hepsiburada') return 'TRY';
  if (balanceCurrency && balanceCurrency.trim()) return normalizeCurrency(balanceCurrency);
  const counts = new Map<string, number>();
  for (const c of txCurrencies) {
    if (!c || !String(c).trim()) continue;
    const k = normalizeCurrency(c);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best || 'USD';
}

/** Order-table `where` for the marketplace tab; Etsy shop names come from `EtsyShop` (B8). */
function orderMarketplaceOr(marketplace: string, etsyShopNames: readonly string[]) {
  const m = marketplace.toLowerCase();
  const ors: Array<{ marketplace: { contains?: string; equals?: string; mode: 'insensitive' } }> = [
    { marketplace: { contains: m, mode: 'insensitive' } },
  ];
  if (m === 'etsy') {
    for (const name of etsyShopNames) ors.push({ marketplace: { equals: name, mode: 'insensitive' } });
  }
  return ors;
}

export type RatesLoader = () => Promise<FxRates>;

export function lazyRates(): RatesLoader {
  let p: Promise<FxRates> | null = null;
  return () => {
    if (!p) p = getExchangeRates().then((s) => s.rates).catch(() => ({}) as FxRates);
    return p;
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

export interface BuildOptions {
  userId: string;
  marketplace: string;
  startDate: Date;
  endDate: Date;
  granularity: Granularity;
  tz: string;
  etsyShopNames: readonly string[];
  rates: RatesLoader;
  /** Previous-period pass: forced currency, no cursor/balance, no disbursement list. */
  previous?: { currency: string };
}

export interface BuildResult {
  summary: DashboardSummary;
  disbursements: Array<{ date: string; amount: number }>;
  timeSeries: TimeSeriesPoint[];
  productBreakdown: ProductBreakdownItem[];
  transactionTypeSummary: Record<string, TransactionTypeSummaryItem>;
  costCoverage: CostCoverage;
  cogsExcluded: CogsExcluded[];
  cogsUnverified: CogsUnverified[];
  /** Converted to `summary.currency` (the amounts are approximate, ≈). */
  ledgerConverted: LedgerCurrencyCount[];
  /** Left out: no `currency → summary.currency` rate. Never summed raw (DS §3.12). */
  ledgerExcluded: LedgerCurrencyCount[];
  lastSyncedAt: string | null;
}

interface CostEntry {
  /** Converted unit cost, cents. */
  unitCost: number;
  /** Converted unit cost + unit shipping cost, cents. */
  unitCogs: number;
  sku: string | null;
}

export async function buildDashboard(opts: BuildOptions): Promise<BuildResult> {
  const { userId, marketplace, startDate, endDate, granularity, tz, etsyShopNames } = opts;
  const mpLower = marketplace.toLowerCase();

  // Zero-filled, ascending buckets (B1/B10). Fails fast before any DB work.
  const keys = bucketKeys(startDate, endDate, granularity, tz);
  if (!keys) throw new HttpError(400, `Range too long for granularity "${granularity}"`);

  const transactions = await prisma.financialTransaction.findMany({
    where: { userId, marketplace, transactionDate: { gte: startDate, lte: endDate } },
    orderBy: { transactionDate: 'asc' },
  });

  // Order-table totals for the same window (labels-page truth; ledger lags 1–3 days).
  const orderRowsRaw = await prisma.order
    .findMany({
      where: {
        userId,
        OR: orderMarketplaceOr(marketplace, etsyShopNames),
        AND: [
          {
            OR: [
              { uiOrderDate: { gte: startDate, lte: endDate } },
              { AND: [{ uiOrderDate: null }, { createdAt: { gte: startDate, lte: endDate } }] },
            ],
          },
        ],
      },
      select: {
        id: true,
        marketplace: true,
        status: true,
        totalPrice: true,
        manualShippingCost: true,
        manualShippingCostCurrency: true,
        uiOrderDate: true,
        createdAt: true,
      },
    })
    .catch(() => [] as Array<{
      id: string;
      marketplace: string | null;
      status: string | null;
      totalPrice: number | null;
      manualShippingCost: unknown;
      manualShippingCostCurrency: string | null;
      uiOrderDate: Date | null;
      createdAt: Date;
    }>);
  // canonicalStore decides store identity (B8): "Amazon" inside an Etsy shop name stays Etsy.
  const orderRows = FINANCE_MARKETPLACES.has(mpLower)
    ? orderRowsRaw.filter((r) => canonicalStore(r.marketplace, etsyShopNames).marketplace === mpLower)
    : orderRowsRaw;
  const orderRowsActive = orderRows.filter((r) => !CANCELLED_STATUSES.has(r.status || ''));
  const refundedOrderCount = orderRows.length - orderRowsActive.length;
  const orderTableCount = orderRowsActive.length;
  const orderTableRevenue = orderRowsActive.reduce((acc, r) => acc + Number(r.totalPrice || 0), 0);

  // Cursor: balance (current pass only) and freshness.
  const cursor = opts.previous
    ? null
    : await prisma.financialSyncCursor
        .findUnique({
          where: { userId_marketplace: { userId, marketplace } },
          select: { currentBalance: true, balanceCurrency: true, heldFunds: true, updatedAt: true },
        })
        .catch(() => null);

  const currency =
    opts.previous?.currency ?? pickDashboardCurrency(marketplace, cursor?.balanceCurrency, transactions.map((t) => t.currency));

  // Product costs, converted to `currency` (B11). No rate → left out and counted.
  // A 'TRY' label on a non-Trendyol tab is not trusted (legacy bulk import / schema default): used as is.
  const productCosts = await prisma.productCost.findMany({ where: { userId, marketplace } });
  const costCurrencyOf = (pc: { costCurrency: string | null }) => {
    const c = normalizeCurrency(pc.costCurrency);
    return mpLower !== 'trendyol' && c === 'TRY' && currency !== 'TRY' ? null : c;
  };
  // Ledger rows: `null` currency = the dashboard currency.
  const txCurrencyOf = (tx: { currency?: string | null }) =>
    tx.currency && String(tx.currency).trim() ? normalizeCurrency(tx.currency) : currency;
  const needsRates =
    productCosts.some((pc) => { const c = costCurrencyOf(pc); return c != null && c !== currency; }) ||
    transactions.some((tx) => txCurrencyOf(tx) !== currency) ||
    orderRows.some((r) => r.manualShippingCost != null && normalizeCurrency(r.manualShippingCostCurrency || currency) !== currency);
  const rates: FxRates = needsRates ? await opts.rates() : {};

  const costMap = new Map<string, CostEntry>();
  const excluded = new Map<string, number>();
  const unverified = new Map<string, number>();
  for (const pc of productCosts) {
    const key = pc.barcode || pc.sku || '';
    if (!key) continue;
    const from = costCurrencyOf(pc);
    if (from == null) {
      const c = normalizeCurrency(pc.costCurrency);
      unverified.set(c, (unverified.get(c) || 0) + 1);
    }
    const cost = from == null ? Number(pc.costAmount) || 0 : convertToBase(Number(pc.costAmount), from, rates, currency);
    const ship = from == null ? Number(pc.shippingCost || 0) || 0 : convertToBase(Number(pc.shippingCost || 0), from, rates, currency);
    if (cost == null || ship == null) {
      const c = normalizeCurrency(pc.costCurrency);
      excluded.set(c, (excluded.get(c) || 0) + 1);
      costMap.delete(key);
      continue;
    }
    const unitCost = toCents(cost);
    costMap.set(key, { unitCost, unitCogs: unitCost + toCents(ship), sku: pc.sku || null });
  }

  const total = emptyLines();
  const buckets = new Map<string, Lines>(keys.map((k) => [k, emptyLines()]));
  const bucketFor = (d: Date) => {
    const k = bucketKey(d, granularity, tz);
    let b = buckets.get(k);
    if (!b) {
      b = emptyLines();
      buckets.set(k, b);
    }
    return b;
  };

  let orderCount = 0;
  let bankedCents = 0;
  const disbursements: Array<{ date: string; amount: number }> = [];
  // Distinct orderNumbers with a finalized refund event (several rows per order are common).
  const refundedOrderNumbers = new Set<string>();
  const transactionTypeSummary: Record<string, TransactionTypeSummaryItem> = {};
  const productMap = new Map<string, ProductBreakdownItem>();
  let unitsNoBarcode = 0;

  // Ledger currency (DS §3.12): a foreign-currency row is converted (≈) or, with no rate, left out and counted.
  const ledgerConverted = new Map<string, number>();
  const ledgerExcluded = new Map<string, number>();
  const ledger: Array<{ tx: (typeof transactions)[number]; amount: number; commission: number; shipping: number }> = [];
  for (const tx of transactions) {
    const from = txCurrencyOf(tx);
    const raw = { amount: Number(tx.amount), commission: Number(tx.commission || 0), shipping: Number(tx.shippingAmount || 0) };
    if (from === currency) {
      ledger.push({ tx, ...raw });
      continue;
    }
    const amount = convertToBase(raw.amount, from, rates, currency);
    const commission = convertToBase(raw.commission, from, rates, currency);
    const shipping = convertToBase(raw.shipping, from, rates, currency);
    if (amount == null || commission == null || shipping == null) {
      ledgerExcluded.set(from, (ledgerExcluded.get(from) || 0) + 1);
      continue;
    }
    ledgerConverted.set(from, (ledgerConverted.get(from) || 0) + 1);
    ledger.push({ tx, amount, commission, shipping });
  }

  // orderNumber → distinct products, to split an order's cargo cost across its products.
  const orderBarcodes = new Map<string, Set<string>>();
  for (const { tx } of ledger) {
    if (!tx.orderNumber || !tx.barcode || classifyTransactionType(tx.transactionType) !== 'revenue') continue;
    if (!orderBarcodes.has(tx.orderNumber)) orderBarcodes.set(tx.orderNumber, new Set());
    orderBarcodes.get(tx.orderNumber)!.add(tx.barcode);
  }
  const shippingCounted = new Set<string>();

  for (const { tx, amount, commission: commissionAmt, shipping: shippingAmt } of ledger) {
    const category = classifyTransactionType(tx.transactionType);
    const quantity = tx.quantity || 1;
    const cost = tx.barcode ? costMap.get(tx.barcode) : undefined;

    const row = transactionTypeSummary[tx.transactionType] ?? { count: 0, total: 0, category };
    row.count++;
    row.total += amount;
    transactionTypeSummary[tx.transactionType] = row;

    const c: TxCents = {
      category,
      amount: toCents(amount),
      commission: toCents(commissionAmt),
      shipping: toCents(shippingAmt),
      isTrendyol: tx.marketplace === 'trendyol',
      quantity,
      unitCogs: cost ? cost.unitCogs : null,
    };
    applyTx(total, c);
    applyTx(bucketFor(tx.transactionDate), c);

    if (category === 'revenue') {
      orderCount++;
      if (!tx.barcode) unitsNoBarcode += quantity;
    } else if (category === 'return') {
      if (tx.orderNumber) refundedOrderNumbers.add(tx.orderNumber);
    } else if (category === 'disbursement') {
      bankedCents += Math.abs(c.amount);
      disbursements.push({ date: localDateKey(tx.transactionDate, tz), amount: round2(Math.abs(amount)) });
    }

    // Product breakdown (barcode rows). Net per product: sales − returns − discounts.
    if (tx.barcode && (category === 'revenue' || category === 'return' || category === 'discount')) {
      const key = tx.barcode;
      let p = productMap.get(key);
      if (!p) {
        p = {
          barcode: tx.barcode,
          sku: cost?.sku ?? null,
          productName: tx.productName,
          revenue: 0,
          quantity: 0,
          returnedQuantity: 0,
          commissions: 0,
          shipping: 0,
          cogs: 0,
          unitCost: 0,
          netProfit: 0,
        };
        productMap.set(key, p);
      }
      if (cost) p.unitCost = fromCents(cost.unitCost);
      const unitCogs = cost ? fromCents(cost.unitCogs) * quantity : 0;
      p.revenue += amount;
      if (category === 'revenue') {
        p.quantity += quantity;
        p.commissions += commissionAmt;
        p.cogs += unitCogs;
        // shippingAmount is the whole order's cargo and sits on every row — once per order, split.
        const orderKey = tx.orderNumber ? `${tx.orderNumber}|${key}` : null;
        if (shippingAmt && (!orderKey || !shippingCounted.has(orderKey))) {
          if (orderKey) shippingCounted.add(orderKey);
          p.shipping += shippingAmt / (tx.orderNumber ? orderBarcodes.get(tx.orderNumber)?.size || 1 : 1);
        }
      } else if (category === 'return') {
        p.returnedQuantity += quantity;
        if (commissionAmt > 0) p.commissions -= commissionAmt;
        p.cogs -= unitCogs;
      } else if (commissionAmt) {
        p.commissions += amount < 0 ? -commissionAmt : commissionAmt;
      }
    }
  }

  // Manually-logged carrier costs (labels page), converted to `currency`, in the order's bucket.
  // Unconvertible entries are skipped, never mis-summed. Cancelled orders included.
  for (const r of orderRows) {
    const manualCost = r.manualShippingCost != null ? Number(r.manualShippingCost) : null;
    if (!manualCost) continue;
    const converted = convertToBase(manualCost, r.manualShippingCostCurrency || currency, rates, currency);
    if (converted == null) {
      logger.warn('Manual shipping cost skipped — FX rate unavailable', {
        orderId: r.id,
        currency: r.manualShippingCostCurrency,
        targetCurrency: currency,
      });
      continue;
    }
    const cents = toCents(converted);
    total.shipping += cents;
    bucketFor(r.uiOrderDate ?? r.createdAt).shipping += cents;
  }

  const netProfitC = netCents(total);
  const margin = total.revenue > 0 ? (netProfitC / total.revenue) * 100 : 0;
  disbursements.sort((a, b) => a.date.localeCompare(b.date));

  const timeSeries: TimeSeriesPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, l]) => ({
      period,
      revenue: fromCents(l.revenue),
      commissions: fromCents(l.commissions),
      shipping: fromCents(l.shipping),
      returns: fromCents(l.returns),
      discounts: fromCents(l.discounts),
      adSpend: fromCents(l.adSpend),
      otherFees: fromCents(l.otherFees),
      cogs: fromCents(l.cogs),
      netProfit: fromCents(netCents(l)),
    }));

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

  const costCoverage: CostCoverage = { products: 0, productsWithCost: 0, unitsWithoutCost: unitsNoBarcode };
  for (const [key, p] of productMap) {
    if (p.quantity <= 0) continue;
    costCoverage.products++;
    if (costMap.has(key)) costCoverage.productsWithCost++;
    else costCoverage.unitsWithoutCost += p.quantity;
  }

  const summary: DashboardSummary = {
    currency,
    grossRevenue: fromCents(total.revenue),
    commissions: fromCents(total.commissions),
    shipping: fromCents(total.shipping),
    returns: fromCents(total.returns),
    discounts: fromCents(total.discounts),
    adSpend: fromCents(total.adSpend),
    otherFees: fromCents(total.otherFees),
    cogs: fromCents(total.cogs),
    netProfit: fromCents(netProfitC),
    margin: round2(margin),
    orderCount,
    returnCount: refundedOrderNumbers.size,
    pendingCancellationCount: Math.max(0, refundedOrderCount - refundedOrderNumbers.size),
    totalOrderCount: orderTableCount,
    pendingSettlementCount: Math.max(0, orderTableCount - orderCount),
    totalOrderRevenue: round2(orderTableRevenue),
  };
  if (!opts.previous) {
    summary.banked = fromCents(bankedCents);
    summary.disbursementCount = disbursements.length;
    summary.currentBalance = cursor?.currentBalance != null ? Number(cursor.currentBalance) : null;
    summary.balanceCurrency = cursor?.balanceCurrency || null;
    summary.heldFunds = cursor?.heldFunds != null ? Number(cursor.heldFunds) : null;
  }

  return {
    summary,
    disbursements: opts.previous ? [] : disbursements,
    timeSeries,
    productBreakdown,
    transactionTypeSummary,
    costCoverage,
    cogsExcluded: Array.from(excluded.entries())
      .map(([c, products]) => ({ currency: c, products }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    cogsUnverified: countList(unverified, 'products'),
    ledgerConverted: countList(ledgerConverted, 'rows'),
    ledgerExcluded: countList(ledgerExcluded, 'rows'),
    lastSyncedAt: cursor?.updatedAt ? new Date(cursor.updatedAt).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

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
      // Profit, payouts, transactions and product costs are Pro (lib/billing/featureMap.ts).
      try {
        await requireFeature(user.id, 'financials');
      } catch (err) {
        if (isFeatureLockedError(err)) return res.status(402).json(err.body());
        throw err;
      }
    }
    const marketplace = first(req.query.marketplace) || first(req.query.mp) || 'trendyol';
    const granularityRaw = first(req.query.granularity) || first(req.query.groupBy) || 'month';
    if (!isGranularity(granularityRaw)) {
      return res.status(400).json({ error: 'groupBy must be one of: hour, day, week, month' });
    }
    const granularity: Granularity = granularityRaw;
    const compare = first(req.query.compare) === 'previous';
    const fromQ = first(req.query.from);
    const toQ = first(req.query.to);
    // New UI (from/to): seller tz, default Europe/Istanbul. Legacy calls without `tz` keep their
    // UTC windows and UTC buckets, so the legacy page sees no shifted/extra bucket.
    const tz = fromQ || toQ || req.query.tz ? parseTz(req.query.tz) : 'UTC';

    let startDate: Date;
    let endDate: Date;
    let fromKey: string | undefined;
    let toKey: string | undefined;
    let prevWindow: { startDate: Date; endDate: Date; from?: string; to?: string } | null = null;

    if (fromQ || toQ) {
      // New UI: local calendar days in the seller's time zone (B2/B13).
      const w = fromQ && toQ ? windowFromKeys(fromQ, toQ, tz) : null;
      if (!w) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD dates with from <= to' });
      startDate = w.start;
      endDate = w.end;
      fromKey = w.from;
      toKey = w.to;
      if (compare) {
        const p = previousKeys(w.from, w.to);
        const pw = windowFromKeys(p.from, p.to, tz)!;
        prevWindow = { startDate: pw.start, endDate: pw.end, from: pw.from, to: pw.to };
      }
    } else {
      // Legacy: epoch ms or ISO; default last 30 days.
      const now = new Date();
      const defaultStart = new Date(now);
      defaultStart.setDate(defaultStart.getDate() - 30);
      const startDateRaw = first(req.query.startDate);
      const endDateRaw = first(req.query.endDate);
      startDate = startDateRaw ? new Date(Number(startDateRaw) || startDateRaw) : defaultStart;
      endDate = endDateRaw ? new Date(Number(endDateRaw) || endDateRaw) : now;
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date format. Use epoch ms or ISO string.' });
      }
      // Date-only end (YYYY-MM-DD) parses to midnight UTC: include the whole day (labels parity).
      if (
        typeof endDateRaw === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw) &&
        endDate.getUTCHours() === 0 &&
        endDate.getUTCMinutes() === 0
      ) {
        endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
      }
      if (compare) {
        const len = endDate.getTime() - startDate.getTime() + 1;
        prevWindow = { startDate: new Date(startDate.getTime() - len), endDate: new Date(startDate.getTime() - 1) };
      }
    }

    // Debug mode: show raw transaction type distribution
    if (req.query.debug === 'true') {
      const txTypes = await prisma.financialTransaction.groupBy({
        by: ['transactionType'],
        where: { userId, marketplace, transactionDate: { gte: startDate, lte: endDate } },
        _count: true,
        _sum: { amount: true, commission: true, shippingAmount: true },
      });
      return res.status(200).json({
        debug: true,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        transactionTypes: txTypes.map((t) => ({
          type: t.transactionType,
          count: t._count,
          totalAmount: t._sum.amount ? Number(t._sum.amount) : 0,
          totalCommission: t._sum.commission ? Number(t._sum.commission) : 0,
          totalShipping: t._sum.shippingAmount ? Number(t._sum.shippingAmount) : 0,
          classifiedAs: classifyTransactionType(t.transactionType),
        })),
      });
    }

    // Staleness fallback (bounded 20s race inside); never blocks on failure.
    await refreshFinancialsIfStale(userId, marketplace).catch(() => undefined);

    // Every finance tab needs the Etsy shop names: canonicalStore keeps an Etsy shop called
    // "…amazon…" out of the Amazon tab, not only inside the Etsy tab (B8).
    const etsyShopNames =
      FINANCE_MARKETPLACES.has(marketplace.toLowerCase())
        ? await prisma.etsyShop
            .findMany({ where: { userId }, select: { shopName: true } })
            .then((shops) => shops.map((s) => s.shopName).filter((n): n is string => typeof n === 'string' && n.trim() !== ''))
            .catch(() => [] as string[])
        : [];
    const rates = lazyRates();
    const base = { userId, marketplace, granularity, tz, etsyShopNames, rates };

    const dashboard = await buildDashboard({ ...base, startDate, endDate });
    let previousSummary: DashboardSummary | undefined;
    if (prevWindow) {
      const prev = await buildDashboard({
        ...base,
        startDate: prevWindow.startDate,
        endDate: prevWindow.endDate,
        previous: { currency: dashboard.summary.currency },
      });
      previousSummary = prev.summary;
    }

    return res.status(200).json({
      marketplace,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ...(fromKey ? { from: fromKey, to: toKey } : {}),
      tz,
      groupBy: granularity,
      granularity,
      ...dashboard,
      ...(prevWindow
        ? {
            previous: {
              startDate: prevWindow.startDate.toISOString(),
              endDate: prevWindow.endDate.toISOString(),
              ...(prevWindow.from ? { from: prevWindow.from, to: prevWindow.to } : {}),
            },
            previousSummary,
          }
        : {}),
    });
  } catch (err: any) {
    if (err.status && err.message) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    logger.error('Finance dashboard API error', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
