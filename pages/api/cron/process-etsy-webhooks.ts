import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronAuth } from '@/lib/cron/idempotency';
import { logCronEvent, logSecurityEvent } from '@/lib/admin/events';
import { processEtsyWebhookQueue } from '@/lib/etsy/webhooks/processor';

export const config = { runtime: 'nodejs' };

/**
 * Sweeper for the Etsy webhook queue (retries with backoff, events whose
 * in-process kick was lost to a restart). Auth: Authorization: Bearer <CRON_SECRET>.
 *
 * No CronLock bucket: this runs every couple of minutes and the processor
 * claims rows atomically, so overlapping triggers are already safe.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronAuth(req)) {
    logSecurityEvent('warn', {
      message: 'Cron auth failed for "process-etsy-webhooks"',
      operation: 'cron.auth_failed',
      details: { jobName: 'process-etsy-webhooks' },
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await processEtsyWebhookQueue({ maxEvents: 200, maxApiEvents: 40 });
    if (!('skipped' in result) && (result.failed > 0 || result.retried > 0)) {
      logCronEvent('warn', {
        message: 'Etsy webhook sweep had failures',
        operation: 'cron.etsy_webhooks',
        details: result,
      });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logCronEvent('error', {
      message: 'Etsy webhook sweep crashed',
      operation: 'cron.etsy_webhooks_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(500).json({ ok: false, error: 'sweep_failed' });
  }
}
