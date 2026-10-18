/**
 * Hepsiburada finance: accounting records (`GET /transactions`, mpfinance-external) → FinancialTransaction
 * (marketplace 'hepsiburada', TRY) + FinancialSyncCursor. Mirrors the Trendyol settlements sync
 * (pages/api/finance/settlements.ts `handleSync`) so the finance dashboard reads HB rows the same way.
 *
 * - Production refuses an unfiltered page: every request carries a complete RecordDate pair (ISO-8601).
 * - Windows are 7 days (the window size observed to work live); each is paged with Offset/Limit.
 * - Amounts are stored signed by `isIncome` (income +, expense −), the convention the dashboard's sign-aware
 *   buckets expect; categories come from HEPSIBURADA_TYPE_CATEGORY in lib/finance/classifyTransaction.ts.
 * - `TotalPayment` is an aggregate of `Payment` rows and is not stored (it would double the payouts).
 * - Pending payout (≈ HB balance) = net of non-payout rows with status WillBePaid in the synced window, like Trendyol.
 */
import type { NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isAuthFailure, isConnectionBlocked, recordAuthFailure, recordAuthSuccess } from '@/lib/integrations/authFailures';
import { classifyTransactionType } from '@/lib/finance/classifyTransaction';
import { hbErrorMessage, type HepsiburadaClient } from './client';
import { parseHbTimestamp } from './date';
import { loadHepsiburadaClient } from './server';
import type { GetTransactionsResponse } from './generated/finance';

export const HB_FINANCE_MARKETPLACE = 'hepsiburada';

const DAY_MS = 86_400_000;
const WINDOW_MS = 7 * DAY_MS;
const PAGE_SIZE = 200;
const MAX_PAGES_PER_WINDOW = 50;
/** First sync reaches back this far. */
export const HB_FINANCE_BACKFILL_MS = 90 * DAY_MS;
/** Re-sync overlap: invoices and refunds post days after the order. */
const OVERLAP_MS = 3 * DAY_MS;
const UPSERT_BATCH = 20;

export type HbFinanceItem = NonNullable<GetTransactionsResponse['items']>[number];

/** Types never stored. */
const SKIPPED_TYPES = new Set(['TotalPayment']);

export interface HbFinanceRow {
  externalId: string;
  transactionType: string;
  orderNumber: string | null;
  barcode: string | null;
  productName: string | null;
  quantity: number;
  amount: number;
  currency: string;
  commission: number | null;
  shippingAmount: number | null;
  transactionDate: Date;
  rawData: HbFinanceItem;
  /** Not a column: true when HB has not paid this row out yet (status WillBePaid). */
  pending: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: one HB accounting record → a FinancialTransaction row, or null when it is skipped. */
export function mapHbFinanceItem(item: HbFinanceItem, now = new Date()): HbFinanceRow | null {
  const type = String(item?.transactionType ?? '').trim() || 'unknown';
  if (SKIPPED_TYPES.has(type)) return null;
  const rawValue = Number(item?.amount?.value ?? item?.netAmount?.value ?? 0);
  if (!Number.isFinite(rawValue)) return null;
  const magnitude = Math.abs(rawValue);
  // isIncome decides the sign; without it keep HB's own sign.
  const amount = item?.isIncome === true ? magnitude : item?.isIncome === false ? -magnitude : rawValue;
  const date =
    parseHbTimestamp(item?.invoiceDate) ||
    parseHbTimestamp(item?.orderDate) ||
    parseHbTimestamp(item?.dueDate) ||
    parseHbTimestamp(item?.paymentDate ?? undefined) ||
    now;
  const externalId = item?.id
    ? String(item.id)
    : [type, item?.orderNumber || '', item?.orderItemNumber || item?.packageNumber || '', item?.invoiceNumber || '', date.toISOString()].join('_');
  return {
    externalId,
    transactionType: type,
    orderNumber: item?.orderNumber ? String(item.orderNumber) : null,
    barcode: item?.sku ? String(item.sku) : null,
    productName: item?.productName || item?.invoiceExplanation || null,
    quantity: Number.isFinite(Number(item?.quantity)) && Number(item?.quantity) > 0 ? Number(item.quantity) : 1,
    amount: round2(amount),
    currency: (item?.amount?.currencyCode || item?.netAmount?.currencyCode || 'TRY').toUpperCase(),
    commission: null,
    shippingAmount: null,
    transactionDate: date,
    rawData: item,
    pending: String(item?.status ?? '').toLowerCase() === 'willbepaid',
  };
}

/** Pure: split [startMs, endMs) into ≤7-day windows. */
export function financeWindows(startMs: number, endMs: number, size = WINDOW_MS): Array<{ start: Date; end: Date }> {
  const out: Array<{ start: Date; end: Date }> = [];
  for (let cursor = startMs; cursor < endMs; cursor += size) {
    out.push({ start: new Date(cursor), end: new Date(Math.min(cursor + size, endMs)) });
  }
  return out;
}

async function fetchWindow(client: HepsiburadaClient, start: Date, end: Date): Promise<HbFinanceItem[]> {
  const out: HbFinanceItem[] = [];
  for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
    const data = await client.listTransactions({ offset: page * PAGE_SIZE, limit: PAGE_SIZE, recordStart: start, recordEnd: end });
    const items = Array.isArray(data?.items) ? data.items : [];
    out.push(...items);
    const total = Number(data?.count);
    if (items.length < PAGE_SIZE || (Number.isFinite(total) && out.length >= total)) break;
  }
  return out;
}

/**
 * Sync [startMs, endMs] for one user. Throws `{ status: 400 }` when HB is not connected/enabled (the same
 * "normal state" contract as the other finance handlers) and `{ status: 401 }` when HB rejects the credentials.
 */
export async function syncHepsiburadaFinanceRange(userId: string, startMs: number, endMs: number): Promise<{ upserted: number; fetched: number; pendingPayout: number }> {
  const loaded = await loadHepsiburadaClient(userId);
  if (!loaded.ok) throw { status: 400, message: `Hepsiburada ${loaded.reason}` };
  const { client, merchantId } = loaded;
  if (await isConnectionBlocked(userId, 'hepsiburada', merchantId)) {
    throw { status: 400, message: 'Hepsiburada reconnect required' };
  }

  const items: HbFinanceItem[] = [];
  try {
    for (const w of financeWindows(startMs, endMs)) items.push(...(await fetchWindow(client, w.start, w.end)));
    await recordAuthSuccess(userId, 'hepsiburada', merchantId);
  } catch (err) {
    if (isAuthFailure(err)) {
      await recordAuthFailure(userId, 'hepsiburada', merchantId, err);
      throw { status: 401, message: `Hepsiburada rejected the credentials: ${hbErrorMessage(err)}` };
    }
    throw { status: 502, message: hbErrorMessage(err) };
  }

  const now = new Date();
  const rows = new Map<string, HbFinanceRow>();
  for (const item of items) {
    const row = mapHbFinanceItem(item, now);
    if (row) rows.set(row.externalId, row);
  }

  let pendingPayout = 0;
  let upserted = 0;
  const list = Array.from(rows.values());
  for (let i = 0; i < list.length; i += UPSERT_BATCH) {
    const batch = list.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(({ externalId, pending, ...tx }) => {
      if (pending && classifyTransactionType(tx.transactionType) !== 'disbursement') pendingPayout += tx.amount;
      return prisma.financialTransaction.upsert({
        where: { userId_marketplace_externalId: { userId, marketplace: HB_FINANCE_MARKETPLACE, externalId } },
        update: { ...tx, rawData: tx.rawData as any, syncedAt: new Date() },
        create: { userId, marketplace: HB_FINANCE_MARKETPLACE, externalId, ...tx, rawData: tx.rawData as any },
      });
    }));
    upserted += batch.length;
  }

  const balance = { currentBalance: round2(pendingPayout), balanceCurrency: 'TRY' };
  await prisma.financialSyncCursor.upsert({
    where: { userId_marketplace: { userId, marketplace: HB_FINANCE_MARKETPLACE } },
    update: { lastSyncedTo: new Date(endMs), totalSynced: { increment: upserted }, ...balance },
    create: { userId, marketplace: HB_FINANCE_MARKETPLACE, lastSyncedTo: new Date(endMs), totalSynced: upserted, ...balance },
  });

  logger.info('[HEPSIBURADA FINANCE] synced', { userId, fetched: items.length, upserted });
  return { upserted, fetched: items.length, pendingPayout: round2(pendingPayout) };
}

/**
 * `handleSync`-style handler for lib/finance/financialAutoSync.ts `runFinancialSync` and the settlements API
 * (`POST /api/finance/settlements { action: 'sync', marketplace: 'hepsiburada', startDate, endDate }`, epoch ms).
 */
export async function handleHepsiburadaFinanceSync(userId: string, body: any, res: NextApiResponse) {
  const startMs = Number(body?.startDate);
  const endMs = Number(body?.endDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return res.status(400).json({ error: 'Invalid date range. startDate must be before endDate (epoch ms).' });
  }
  const out = await syncHepsiburadaFinanceRange(userId, startMs, endMs);
  return res.status(200).json({ success: true, marketplace: HB_FINANCE_MARKETPLACE, totalFetched: out.fetched, totalUpserted: out.upserted, pendingPayout: out.pendingPayout });
}

/** Daily job (lib/hepsiburada/jobs.ts): from the cursor (minus overlap), or a 90-day backfill on the first run. */
export async function syncHepsiburadaFinanceForUser(userId: string, now = Date.now()) {
  const cursor = await prisma.financialSyncCursor.findUnique({
    where: { userId_marketplace: { userId, marketplace: HB_FINANCE_MARKETPLACE } },
    select: { lastSyncedTo: true },
  });
  const last = cursor?.lastSyncedTo?.getTime() ?? 0;
  const startMs = last > 0 ? Math.max(now - HB_FINANCE_BACKFILL_MS, last - OVERLAP_MS) : now - HB_FINANCE_BACKFILL_MS;
  try {
    return await syncHepsiburadaFinanceRange(userId, startMs, now);
  } catch (err: any) {
    if (err?.status === 400) return { skipped: err.message };
    throw Object.assign(new Error(err?.message || String(err)), { status: err?.status });
  }
}
