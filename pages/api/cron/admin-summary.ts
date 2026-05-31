import type { NextApiRequest, NextApiResponse } from 'next';
import { runCronGuard } from '@/lib/cron/idempotency';
import { sendDailySummary } from '@/lib/admin/dailySummary';

/**
 * Daily admin summary cron. NOT scheduled by any workflow yet — wire it into
 * `.github/workflows/cron-daily.yml` after you've verified the summary body
 * and set `ADMIN_ALERT_EMAIL` on the host. Until then it can be triggered
 * manually for inspection:
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *     https://kolayxport.com/api/cron/admin-summary
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const methodAllowed = req.method === 'GET' || req.method === 'POST';
  if (!methodAllowed) return res.status(405).json({ error: 'Method not allowed' });

  const guard = await runCronGuard(req, res, { jobName: 'admin-summary', intervalMinutes: 1440 });
  if (!guard.ok) return;

  const result = await sendDailySummary();
  return res.status(200).json({ ok: true, ...result });
}
