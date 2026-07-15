import type { NextApiRequest, NextApiResponse } from 'next';
import { runCronGuard } from '@/lib/cron/idempotency';
import { purgeExpiredPii } from '@/lib/pii/purge';
import { logger } from '@/lib/logger';

export const config = { runtime: 'nodejs' };

/**
 * Enforces the buyer-PII retention policy (docs/security/DATA_HANDLING_POLICY.md).
 * Auth: Authorization: Bearer <CRON_SECRET>. Idempotent per 24h bucket.
 *
 * Dry-run by default — set PII_PURGE_DRY_RUN=false in the environment to actually
 * delete. See lib/pii/purge.ts.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const guard = await runCronGuard(req, res, { jobName: 'purge-pii', intervalMinutes: 60 * 24 });
  if (!guard.ok) return;

  try {
    const result = await purgeExpiredPii();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.event(
      'security',
      'error',
      'PII retention purge failed',
      { error: err instanceof Error ? err.message : String(err) },
      { operation: 'pii.purge_error' },
    );
    return res.status(500).json({ ok: false, error: 'purge_failed' });
  }
}
