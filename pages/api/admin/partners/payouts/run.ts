// POST /api/admin/partners/payouts/run?month=YYYY-MM[&confirm=true] — partner payout run (lib/partners/payouts.ts).
// Admin only. Without confirm=true it is a dry run: no DB writes, no Stripe call.
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { logger } from '@/lib/logger';
import { runPayouts } from '@/lib/partners/payouts';

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const month = typeof req.query.month === 'string' ? req.query.month : null;
  const confirm = req.query.confirm === 'true';
  try {
    const result = await runPayouts({ period: month, confirm });
    if (confirm) logger.info('Partner payout run', { period: result.period, provider: result.provider, sent: result.results?.length ?? 0 });
    return res.status(200).json(result);
  } catch (e) {
    logger.warn('Partner payout run failed', { error: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'payout run failed' });
  }
});
