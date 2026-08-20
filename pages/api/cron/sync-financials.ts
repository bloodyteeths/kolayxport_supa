import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { runCronGuard } from '@/lib/cron/idempotency';
import { runFinancialSync, FINANCE_MARKETPLACES } from '@/lib/finance/financialAutoSync';

// Keeps every user's financial ledger current without manual "sync" clicks.
// Scheduled every 6 hours from the VPS crontab; each run re-syncs the last 35
// days per marketplace (idempotent upserts), which absorbs late-posted
// invoices, refunds and settlement lag.

const DAY_MS = 86_400_000;
const WINDOW_MS = 35 * DAY_MS;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const guard = await runCronGuard(req, res, { jobName: 'sync-financials', intervalMinutes: 300 });
  if (!guard.ok) return;

  const startedAt = Date.now();
  const results: Array<{ userId: string; marketplace: string; ok: boolean; detail?: string }> = [];

  try {
    // Only users who ever had ledger data or have Trendyol credentials —
    // avoids hammering marketplace APIs for accounts with nothing connected.
    const [cursorUsers, trendyolCreds] = await Promise.all([
      prisma.financialSyncCursor.findMany({ select: { userId: true, marketplace: true } }),
      prisma.credential.findMany({ where: { trendyolSupplierId: { not: null } }, select: { userId: true } }),
    ]);

    const targets = new Map<string, Set<string>>();
    for (const c of cursorUsers) {
      if (!(FINANCE_MARKETPLACES as readonly string[]).includes(c.marketplace)) continue;
      if (!targets.has(c.userId)) targets.set(c.userId, new Set());
      targets.get(c.userId)!.add(c.marketplace);
    }
    for (const c of trendyolCreds) {
      if (!targets.has(c.userId)) targets.set(c.userId, new Set());
      targets.get(c.userId)!.add('trendyol');
    }

    const now = Date.now();
    for (const [userId, marketplaces] of targets) {
      for (const marketplace of marketplaces) {
        try {
          const out = await runFinancialSync(userId, marketplace as any, now - WINDOW_MS, now);
          results.push({ userId, marketplace, ok: out.status < 400, detail: out.status >= 400 ? out.body?.error : undefined });
        } catch (err: any) {
          // {status: 400} = credentials removed since last sync — normal
          results.push({ userId, marketplace, ok: false, detail: err?.message || String(err) });
        }
      }
    }

    const failed = results.filter(r => !r.ok);
    logger.info('Cron sync-financials complete', {
      users: targets.size,
      jobs: results.length,
      failed: failed.length,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).json({ success: true, users: targets.size, jobs: results.length, failed });
  } catch (err: any) {
    logger.error('Cron sync-financials crashed', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: err?.message || 'sync-financials failed' });
  }
}
