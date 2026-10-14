import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronAuth } from '@/lib/cron/idempotency';
import { logCronEvent, logSecurityEvent } from '@/lib/admin/events';
import { processEtsyWebhookQueue } from '@/lib/etsy/webhooks/processor';
import { isEtsyWorkerHealthy } from '@/lib/etsy/webhooks/worker';
import { getLastSuccessfulRun } from '@/lib/scheduler/runs';

export const config = { runtime: 'nodejs' };

const HEALTHY_WITHIN_MS = 2 * 60_000;

/**
 * Safety-net sweeper for the Etsy webhook queue (GitHub Actions, every 2 min).
 * Auth: Authorization: Bearer <CRON_SECRET>.
 *
 * Self-skips while the in-process worker is healthy (its 5 s loop ran within
 * 2 min, or the 'etsy-webhook-sweep' scheduler job succeeded within 2 min);
 * otherwise runs one worker pass and waits for the events it started.
 * Rows are claimed atomically, so overlapping triggers are safe.
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
    const force = req.query.force === '1';
    if (!force) {
      if (isEtsyWorkerHealthy()) return res.status(200).json({ ok: true, skipped: 'worker_healthy' });
      const lastSweep = await getLastSuccessfulRun('etsy-webhook-sweep').catch(() => null);
      if (lastSweep && Date.now() - lastSweep.getTime() < HEALTHY_WITHIN_MS) {
        return res.status(200).json({ ok: true, skipped: 'worker_healthy' });
      }
    }

    const result = await processEtsyWebhookQueue({ waitTimeoutMs: 90_000 });
    const outcomes = result.outcomes || {};
    if ((outcomes.failed || 0) > 0 || (outcomes.retried || 0) > 0) {
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
