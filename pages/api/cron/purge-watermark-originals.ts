import type { NextApiRequest, NextApiResponse } from 'next';
import { runCronGuard } from '@/lib/cron/idempotency';
import { purgeWatermarkOriginals, uploadDiskUse } from '@/lib/media/watermarkRetention';
import { logger } from '@/lib/logger';

export const config = { runtime: 'nodejs' };

/**
 * Daily: watermark originals older than 180 days (since the last watermark on the slot) and over the 1 GB per-account
 * cap are removed, with orphan files (lib/media/watermarkRetention.ts). Auth: Authorization: Bearer <CRON_SECRET>.
 * ?dryRun=1 reports what would be removed without removing it. Logs counts and bytes per account, never file names.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // A dry run has its own idempotency bucket, so it never uses up the day's real run.
  const dryRun = req.query.dryRun === '1';
  const guard = await runCronGuard(req, res, { jobName: dryRun ? 'purge-watermark-originals-dry' : 'purge-watermark-originals', intervalMinutes: 60 * 24 });
  if (!guard.ok) return;
  try {
    const result = await purgeWatermarkOriginals({ dryRun });
    const disk = await uploadDiskUse();
    logger.event('system', 'info', dryRun ? 'Watermark originals purge (dry run)' : 'Watermark originals purge', { ...result, disk }, { operation: 'watermark.purge' });
    return res.status(200).json({ ok: true, ...result, disk });
  } catch (err) {
    logger.event('system', 'error', 'Watermark originals purge failed', { error: err instanceof Error ? err.message : String(err) }, { operation: 'watermark.purge_error' });
    return res.status(500).json({ ok: false, error: 'purge_failed' });
  }
}
