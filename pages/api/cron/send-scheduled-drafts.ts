import type { NextApiRequest, NextApiResponse } from 'next';
import { runCronGuard } from '@/lib/cron/idempotency';
import { logCronEvent } from '@/lib/admin/events';
import { runScheduledSends } from '@/lib/drafts/scheduledSend';

export const config = { runtime: 'nodejs', maxDuration: 300 };

/**
 * POST|GET /api/cron/send-scheduled-drafts — every 5 min.
 * Auth: Authorization: Bearer <CRON_SECRET>; one run per 5-min bucket (CronLock).
 * Sends due scheduled drafts (Etsy, eBay, Trendyol, Wix, Shopify) through the
 * normal executors, never forcing a conflict and never sending a queued delete,
 * then resolves pending Trendyol batches. See lib/drafts/scheduledSend.ts.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const guard = await runCronGuard(req, res, { jobName: 'send-scheduled-drafts', intervalMinutes: 5 });
  if (!guard.ok) return;

  try {
    const summary = await runScheduledSends();
    return res.status(200).json({ ok: true, bucket: guard.bucket, totals: summary.totals, batches: summary.batches, supported: summary.supported });
  } catch (err) {
    logCronEvent('error', {
      message: 'Scheduled draft sends crashed',
      operation: 'cron.send_scheduled_drafts_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(500).json({ ok: false, error: 'scheduled_send_failed' });
  }
}
