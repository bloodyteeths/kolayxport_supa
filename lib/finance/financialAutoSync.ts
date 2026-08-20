import type { NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  handleSync as handleTrendyolSync,
  handleEtsySync,
  handleEbaySync,
  handleAmazonSync,
} from '@/pages/api/finance/settlements';

// Financial data must be correct without the user ever pressing "sync". Two
// consumers drive this module: the sync-financials cron (every 6h, all users)
// and the dashboard endpoint (staleness fallback on load, in case cron
// missed). Both reuse the battle-tested per-marketplace sync handlers from
// /api/finance/settlements via a mock res — the handlers only ever call
// res.status().json() and update FinancialSyncCursor on success.

export const FINANCE_MARKETPLACES = ['trendyol', 'etsy', 'ebay', 'amazon'] as const;
export type FinanceMarketplace = (typeof FINANCE_MARKETPLACES)[number];

const DAY_MS = 86_400_000;
// How far back a full (re)sync reaches. 35 days covers Trendyol's weekly
// invoice cadence and Amazon's 14-30 day settlement lag.
const FULL_WINDOW_MS = 35 * DAY_MS;
// Re-sync overlap: invoices/refunds post days after their transactionDate.
const OVERLAP_MS = 3 * DAY_MS;

function mockRes(): { res: NextApiResponse; result: () => { status: number; body: any } } {
  let status = 200;
  let body: any = null;
  const res: any = {
    status(code: number) { status = code; return res; },
    json(payload: any) { body = payload; return res; },
  };
  return { res, result: () => ({ status, body }) };
}

export async function runFinancialSync(
  userId: string,
  marketplace: FinanceMarketplace,
  startMs: number,
  endMs: number,
): Promise<{ status: number; body: any }> {
  const { res, result } = mockRes();
  // Amazon SP-API rejects end dates less than 2 minutes in the past
  // ("Date is not valid, should be no later than 2 minutes from now").
  const clampedEnd = Math.min(endMs, Date.now() - 5 * 60_000);
  const body = { startDate: startMs, endDate: clampedEnd };
  switch (marketplace) {
    case 'trendyol': await handleTrendyolSync(userId, body, res); break;
    case 'etsy': await handleEtsySync(userId, body, res); break;
    case 'ebay': await handleEbaySync(userId, body, res); break;
    case 'amazon': await handleAmazonSync(userId, body, res); break;
  }
  return result();
}

/**
 * Bring one marketplace's ledger up to date if its cursor is older than
 * maxAgeMs. Waits at most timeoutMs so a dashboard load never hangs on a slow
 * marketplace API — the sync keeps running in the background past the timeout
 * and the next load serves fresh data.
 *
 * "Credentials not configured" (thrown as {status: 400}) is a normal state,
 * not an error — the user simply hasn't connected that marketplace.
 */
export async function refreshFinancialsIfStale(
  userId: string,
  marketplace: string,
  opts?: { maxAgeMs?: number; timeoutMs?: number },
): Promise<{ refreshed: boolean; timedOut?: boolean }> {
  if (!(FINANCE_MARKETPLACES as readonly string[]).includes(marketplace)) return { refreshed: false };
  const maxAgeMs = opts?.maxAgeMs ?? 3 * 3600_000;
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  const cursor = await prisma.financialSyncCursor.findUnique({
    where: { userId_marketplace: { userId, marketplace } },
  });
  const now = Date.now();
  const last = cursor?.lastSyncedTo?.getTime() ?? 0;
  if (now - last < maxAgeMs) return { refreshed: false };

  const startMs = last > 0 ? Math.max(now - FULL_WINDOW_MS, last - OVERLAP_MS) : now - FULL_WINDOW_MS;
  const syncPromise = runFinancialSync(userId, marketplace as FinanceMarketplace, startMs, now)
    .then((out) => {
      if (out.status >= 400) {
        // 400 = missing credentials → expected; anything else is worth a log
        if (out.status !== 400) logger.warn('Financial auto-refresh failed', { userId, marketplace, status: out.status, error: out.body?.error });
      }
      return out;
    })
    .catch((err: any) => {
      if (err?.status !== 400) logger.warn('Financial auto-refresh error', { userId, marketplace, error: err?.message || String(err) });
      return { status: err?.status ?? 500, body: null };
    });

  const winner = await Promise.race([
    syncPromise.then(() => 'done' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]);
  return { refreshed: winner === 'done', timedOut: winner === 'timeout' };
}
