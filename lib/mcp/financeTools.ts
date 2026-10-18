// lib/mcp/financeTools.ts — finance_summary for the seller's own AI over MCP (SERVER ONLY, read-only).
//
// It reads ONLY what KolayXport already synced for the in-app Financials dashboard (FinancialTransaction ledger rows
// + FinancialSyncCursor balance / held funds, filled by the finance sync cron and /api/finance/settlements: Etsy
// receipts + payment-account ledger, eBay finances + seller funds summary, Trendyol settlements, Amazon financial
// events + settlement groups, Hepsiburada transactions). It never calls a marketplace API. The numbers are the
// dashboard's own (pages/api/finance/dashboard buildDashboard), so the AI and the Financials page agree.
// Financials are a Pro feature in the app, so they are here too (lib/billing hasFeature 'financials').
import prisma from '@/lib/prisma';
import { hasFeature } from '@/lib/billing/requireFeature';
import { buildDashboard, lazyRates, type BuildResult } from '@/pages/api/finance/dashboard';
import { addDays, DEFAULT_REPORT_TZ, localDateKey, windowFromKeys } from '@/lib/finance/periods';
import { ToolError, type McpTool } from './types';

export const FINANCE_MARKETPLACES = ['etsy', 'ebay', 'trendyol', 'amazon', 'hepsiburada'] as const;
type FinanceMarketplace = (typeof FINANCE_MARKETPLACES)[number];

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const MAX_DAYS = 366;

/** What the stored balance means per marketplace, and whether reserves / held funds are known. */
const BALANCE_MEANING: Record<FinanceMarketplace, { balance: string; held: string }> = {
  etsy: {
    balance: 'Etsy payment account balance from the latest Etsy ledger entry KolayXport synced: money earned on Etsy that has not been deposited to the bank yet.',
    held: 'Not available: Etsy\'s API does not report reserved or held funds separately, so KolayXport cannot say how much of the balance Etsy is holding back.',
  },
  ebay: {
    balance: 'eBay total seller funds (eBay seller funds summary, as of the last finance sync).',
    held: 'heldFunds = eBay funds on hold (eBay seller funds summary).',
  },
  trendyol: {
    balance: 'Pending Trendyol payout, derived from synced settlement rows not yet paid out (Trendyol has no balance API).',
    held: 'Not available: Trendyol does not report held funds.',
  },
  amazon: {
    balance: 'Amazon open settlement group total (money not yet paid out), as of the last finance sync.',
    held: 'Not stored: KolayXport does not keep Amazon reserve / deferred amounts separately.',
  },
  hepsiburada: {
    balance: 'Pending Hepsiburada payout, derived from synced transactions not yet paid out.',
    held: 'Not available: Hepsiburada does not report held funds.',
  },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export type FinanceWindow = { from: string; to: string; start: Date; end: Date; tz: string };

/** The reporting window: from/to (YYYY-MM-DD, seller's day in Europe/Istanbul) or the last 7/30/90 days. Pure. */
export function financeWindow(args: Record<string, unknown>, now: Date = new Date()): FinanceWindow {
  const tz = DEFAULT_REPORT_TZ;
  const fromQ = typeof args.from === 'string' ? args.from.trim() : '';
  const toQ = typeof args.to === 'string' ? args.to.trim() : '';
  let from: string;
  let to: string;
  if (fromQ || toQ) {
    from = fromQ || toQ;
    to = toQ || localDateKey(now, tz);
  } else {
    const days = PERIOD_DAYS[String(args.period ?? '30d')] ?? 30;
    to = localDateKey(now, tz);
    from = addDays(to, -(days - 1));
  }
  const w = windowFromKeys(from, to, tz);
  if (!w) throw new ToolError('from and to must be YYYY-MM-DD dates with from <= to');
  if (w.end.getTime() - w.start.getTime() > MAX_DAYS * 86_400_000) throw new ToolError(`At most ${MAX_DAYS} days at a time`);
  return { from: w.from, to: w.to, start: w.start, end: w.end, tz };
}

/** Etsy stores every seller fee as one 'EtsyFee' type; the ledger description says which fee it was. */
async function etsyFeeDetails(userId: string, w: FinanceWindow) {
  const rows = await prisma.financialTransaction.findMany({
    where: { userId, marketplace: 'etsy', transactionType: 'EtsyFee', transactionDate: { gte: w.start, lte: w.end } },
    select: { productName: true, amount: true },
  });
  const by = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    // "transaction fee: <listing title>" → "transaction fee"; descriptions of fee rows never carry buyer data.
    const label = String(r.productName || 'EtsyFee').split(':')[0].trim().slice(0, 60) || 'EtsyFee';
    const b = by.get(label) ?? { count: 0, total: 0 };
    b.count += 1;
    b.total += Number(r.amount) || 0;
    by.set(label, b);
  }
  return Array.from(by.entries())
    .map(([description, b]) => ({ description, count: b.count, total: r2(b.total) }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 15);
}

type Cursor = { marketplace: string; updatedAt: Date; currentBalance: unknown; balanceCurrency: string | null; heldFunds: unknown };

/** One marketplace's summary from the dashboard numbers. Pure (exported for tests). */
export function marketplaceSummary(mp: FinanceMarketplace, d: BuildResult, cursor: Cursor | null) {
  const s = d.summary;
  const feesByType = Object.entries(d.transactionTypeSummary)
    .filter(([, v]) => !['revenue', 'disbursement', 'passthrough'].includes(v.category))
    .map(([type, v]) => ({ type, category: v.category, count: v.count, total: r2(v.total) }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const meaning = BALANCE_MEANING[mp];
  const balance = cursor?.currentBalance != null ? Number(cursor.currentBalance) : null;
  const held = cursor?.heldFunds != null ? Number(cursor.heldFunds) : null;
  const notes: string[] = [];
  if (s.pendingSettlementCount > 0) notes.push(`${s.pendingSettlementCount} order(s) in this period are not in the marketplace's financial records yet (settlement lags orders by days); grossSales covers settled orders only.`);
  if (d.costCoverage.unitsWithoutCost > 0) notes.push(`productCosts covers only products with a cost entered in KolayXport (${d.costCoverage.productsWithCost} of ${d.costCoverage.products}); netProfit is too high by the missing costs.`);
  if (d.ledgerConverted.length) notes.push(`Some rows were converted from ${d.ledgerConverted.map((x) => x.currency).join(', ')} to ${s.currency} at current rates (approximate).`);
  if (d.ledgerExcluded.length) notes.push(`Rows in ${d.ledgerExcluded.map((x) => x.currency).join(', ')} were left out (no exchange rate).`);
  return {
    marketplace: mp,
    currency: s.currency,
    lastSyncedAt: d.lastSyncedAt,
    sales: {
      grossSales: s.grossRevenue,
      settledOrders: s.orderCount,
      ordersInPeriod: s.totalOrderCount,
      orderValueInPeriod: s.totalOrderRevenue,
      ordersNotYetSettled: s.pendingSettlementCount,
    },
    costs: {
      marketplaceFees: s.commissions,
      shipping: s.shipping,
      adSpend: s.adSpend,
      refunds: s.returns,
      discounts: s.discounts,
      otherFees: s.otherFees,
      productCosts: s.cogs,
    },
    feesByType,
    net: {
      netProfit: s.netProfit,
      marginPercent: s.margin,
      formula: 'grossSales − marketplaceFees − shipping − refunds − discounts − adSpend − otherFees − productCosts',
    },
    payouts: {
      paidToBank: s.banked ?? 0,
      count: s.disbursementCount ?? 0,
      recent: d.disbursements.slice(-10),
    },
    balance: {
      current: balance,
      currency: cursor?.balanceCurrency ?? (balance !== null ? s.currency : null),
      asOf: cursor?.updatedAt ? cursor.updatedAt.toISOString() : null,
      meaning: balance !== null ? meaning.balance : 'Not available: no balance has been synced for this marketplace.',
      heldFunds: held,
      heldFundsMeaning: held !== null ? meaning.held : meaning.held.startsWith('Not') ? meaning.held : 'Not available: not synced yet.',
    },
    notes,
  };
}

export const financeSummary: McpTool = {
  name: 'finance_summary',
  title: 'Finance summary',
  description:
    'Money the seller actually made, from the marketplace financial records KolayXport syncs (the Financials page): gross sales, marketplace fees by type '
    + '(transaction, processing, listing, shipping labels, ads, refunds, discounts), product costs, net profit and margin, payouts to the bank, and the current '
    + 'marketplace balance with the time it was synced; eBay also reports funds on hold. Period: last 7/30/90 days or from/to dates; optionally one '
    + 'marketplace (etsy, ebay, trendyol, amazon, hepsiburada). Reads synced data only (never live), so it can lag by hours; lastSyncedAt says when. '
    + 'Etsy does not report reserves separately, so held funds are not available for Etsy.',
  scope: 'read', readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: ['7d', '30d', '90d'], description: 'Last 7, 30 or 90 days (default 30d). Ignored when from/to are given.' },
      from: { type: 'string', description: 'First day, YYYY-MM-DD (Europe/Istanbul)' },
      to: { type: 'string', description: 'Last day, YYYY-MM-DD (default today)' },
      marketplace: { type: 'string', enum: [...FINANCE_MARKETPLACES], description: 'One marketplace; default every marketplace with financial data' },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const userId = auth.userId;
    const access = await hasFeature(userId, 'financials');
    if (!access.allowed) {
      throw new ToolError('Fees, profit, payouts and balances (Financials) are not included in this KolayXport account\'s plan. sales_summary still gives order counts and order value.');
    }
    const w = financeWindow(a);
    const only = typeof a.marketplace === 'string' ? a.marketplace.trim().toLowerCase() : '';
    if (only && !(FINANCE_MARKETPLACES as readonly string[]).includes(only)) throw new ToolError(`marketplace must be one of: ${FINANCE_MARKETPLACES.join(', ')}`);

    const [cursors, withRows, shops] = await Promise.all([
      prisma.financialSyncCursor.findMany({ where: { userId }, select: { marketplace: true, updatedAt: true, currentBalance: true, balanceCurrency: true, heldFunds: true } }),
      prisma.financialTransaction.findMany({ where: { userId, transactionDate: { gte: w.start, lte: w.end } }, distinct: ['marketplace'], select: { marketplace: true } }),
      prisma.etsyShop.findMany({ where: { userId }, select: { shopName: true } }),
    ]);
    const known = new Set<string>([...cursors.map((c) => c.marketplace), ...withRows.map((r) => r.marketplace)].map((m) => m.toLowerCase()));
    const list = (only ? [only] : FINANCE_MARKETPLACES.filter((m) => known.has(m))) as FinanceMarketplace[];
    const period = { from: w.from, to: w.to, timeZone: w.tz };
    if (!list.length) {
      return { period, marketplaces: [], note: 'No financial data has been synced for this account yet. The seller can open Financials in KolayXport (it syncs Etsy, eBay, Trendyol, Amazon and Hepsiburada payment records).' };
    }
    const etsyShopNames = shops.map((s) => s.shopName).filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    const rates = lazyRates();
    const out: Array<Record<string, unknown>> = [];
    for (const mp of list) {
      const cursor = cursors.find((c) => c.marketplace.toLowerCase() === mp) ?? null;
      if (!cursor && !withRows.some((r) => r.marketplace.toLowerCase() === mp)) {
        out.push({ marketplace: mp, available: false, note: `No ${mp} financial data has been synced for this account (none in this period and no sync on record).` });
        continue;
      }
      const d = await buildDashboard({ userId, marketplace: mp, startDate: w.start, endDate: w.end, granularity: 'month', tz: w.tz, etsyShopNames, rates });
      const summary = marketplaceSummary(mp, d, cursor);
      out.push(mp === 'etsy' ? { ...summary, etsyFeeDetails: await etsyFeeDetails(userId, w) } : summary);
    }
    return {
      period,
      basis: 'Marketplace payment records as synced into KolayXport (not live). Amounts are in each marketplace\'s settlement currency; marketplaces are never summed together.',
      marketplaces: out,
    };
  },
};

export const FINANCE_TOOLS: McpTool[] = [financeSummary];
