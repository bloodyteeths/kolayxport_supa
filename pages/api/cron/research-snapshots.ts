import type { NextApiRequest, NextApiResponse } from 'next';
import { runCronGuard } from '@/lib/cron/idempotency';
import { logCronEvent } from '@/lib/admin/events';
import { runResearchSnapshots } from '@/lib/research/watchAdapter';

export const config = { runtime: 'nodejs', maxDuration: 300 };

/**
 * POST|GET /api/cron/research-snapshots — daily (research.md §8, §10; R3-A).
 * Auth: Authorization: Bearer <CRON_SECRET>; one run per UTC day (CronLock via runCronGuard).
 * One shared reading per distinct watched Etsy shop (`/shops/{id}` + ≤ 5 listing pages, Reconcile priority,
 * stops at the daily Etsy budget gate) and per watched Etsy query; raises the research alerts once BR-7's
 * notification types exist; prunes readings older than 400 days. Writes only ResearchSnapshot / ResearchCache.
 * Before BR-1c is deployed it answers 200 { ok: true, skipped: 'unavailable' }.
 * Scheduler registration (BR-8): `researchSnapshotsJob` in lib/research/watchAdapter.ts.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const guard = await runCronGuard(req, res, { jobName: 'research-snapshots', intervalMinutes: 1440 });
  if (!guard.ok) return;

  try {
    const summary = await runResearchSnapshots();
    return res.status(200).json({ ok: true, bucket: guard.bucket, ...summary });
  } catch (err) {
    logCronEvent('error', {
      message: 'Research snapshots crashed',
      operation: 'cron.research_snapshots_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(500).json({ ok: false, error: 'research_snapshots_failed' });
  }
}
