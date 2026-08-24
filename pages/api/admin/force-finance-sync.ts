import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { runCronGuard } from '@/lib/cron/idempotency';
import { runFinancialSync, FINANCE_MARKETPLACES } from '@/lib/finance/financialAutoSync';

// Maintenance: force a financial re-sync for one user+marketplace outside the
// 6-hour cron cadence (e.g. after an accounting-logic change). Cron-secret
// guarded, read-from-marketplace / idempotent-upsert.
//   curl -X POST '.../api/admin/force-finance-sync?marketplace=etsy&days=35' -H 'Authorization: Bearer $CRON_SECRET'
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await runCronGuard(req, res, { jobName: 'force-finance-sync', intervalMinutes: 1 });
  if (!guard.ok) return;

  const marketplace = String(req.query.marketplace || '');
  if (!(FINANCE_MARKETPLACES as readonly string[]).includes(marketplace)) {
    return res.status(400).json({ error: `marketplace must be one of ${FINANCE_MARKETPLACES.join(', ')}` });
  }
  const days = Math.min(120, Math.max(1, Number(req.query.days) || 35));
  const now = Date.now();
  const startMs = now - days * 86_400_000;

  // Resolve which users to sync: explicit userId, or everyone with a cursor for
  // this marketplace (+ Etsy shops / Trendyol creds).
  const explicitUser = req.query.userId ? String(req.query.userId) : null;
  let userIds: string[];
  if (explicitUser) {
    userIds = [explicitUser];
  } else {
    const cursors = await prisma.financialSyncCursor.findMany({ where: { marketplace }, select: { userId: true } });
    userIds = [...new Set(cursors.map((c) => c.userId))];
    if (marketplace === 'etsy') {
      const shops = await prisma.etsyShop.findMany({ where: { isActive: true }, select: { userId: true } });
      for (const s of shops) if (!userIds.includes(s.userId)) userIds.push(s.userId);
    }
  }

  const results: any[] = [];
  for (const userId of userIds) {
    try {
      const out = await runFinancialSync(userId, marketplace as any, startMs, now);
      results.push({ userId: userId.slice(0, 8), status: out.status, body: out.body });
    } catch (err: any) {
      results.push({ userId: userId.slice(0, 8), error: err?.message?.slice(0, 200) });
    }
  }
  return res.status(200).json({ marketplace, days, users: userIds.length, results });
}
