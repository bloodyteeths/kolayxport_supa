import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronAuth } from '@/lib/cron/idempotency';
import { logCronEvent, logSecurityEvent } from '@/lib/admin/events';
import { runDueJobs } from '@/lib/scheduler/runs';

export const config = { runtime: 'nodejs' };

/**
 * Scheduler fallback (GitHub Actions 'run-due', every 15 min) and manual trigger.
 * Auth: Authorization: Bearer <CRON_SECRET>.
 *
 *   GET/POST /api/cron/run-job?due=1          start every due job (JobRun-claimed: never
 *                                             double-runs a bucket the in-process scheduler ran)
 *   GET/POST /api/cron/run-job?job=<name>     run that job if its current bucket is due
 *   add &wait=1 to wait for the started jobs (bounded by the caller's timeout)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronAuth(req)) {
    logSecurityEvent('warn', {
      message: 'Cron auth failed for "run-job"',
      operation: 'cron.auth_failed',
      details: { jobName: 'run-job' },
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobParam = req.query.job;
  const only = (Array.isArray(jobParam) ? jobParam : jobParam ? [jobParam] : [])
    .flatMap((j) => String(j).split(','))
    .map((j) => j.trim())
    .filter((j) => /^[a-z0-9-]{1,64}$/.test(j));
  if (only.length === 0 && req.query.due !== '1') {
    return res.status(400).json({ error: 'Pass ?due=1 or ?job=<name>' });
  }

  try {
    const results = await runDueJobs({ only: only.length ? only : undefined, wait: req.query.wait === '1' });
    const failed = results.filter((r) => r.status === 'failed' || r.status === 'timeout' || r.status.startsWith('error:'));
    if (failed.length) {
      logCronEvent('warn', { message: 'run-job: some jobs failed', operation: 'cron.run_job', details: { failed } });
    }
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    logCronEvent('error', {
      message: 'run-job crashed',
      operation: 'cron.run_job_error',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(500).json({ ok: false, error: 'run_job_failed' });
  }
}
