// /api/cron/partner-bounties — daily: partner bounties whose 30-day hold has passed move pending → payable
// (lib/partners/bounty.ts). The admin report and payout run also promote due rows, so a missed run only delays the
// status, never a payout.
import type { NextApiRequest, NextApiResponse } from 'next';
import { runCronGuard } from '@/lib/cron/idempotency';
import { logger } from '@/lib/logger';
import { promoteDueBounties } from '@/lib/partners/bounty';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await runCronGuard(req, res, { jobName: 'partner-bounties', intervalMinutes: 1440 });
  if (!guard.ok) return;
  try {
    const promoted = await promoteDueBounties();
    return res.status(200).json({ ok: true, promoted });
  } catch (e) {
    logger.error('Partner bounty cron failed', e instanceof Error ? e : new Error(String(e)));
    return res.status(500).json({ error: 'failed' });
  }
}
