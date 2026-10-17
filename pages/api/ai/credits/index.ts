// GET /api/ai/credits?currency=TRY|USD → CreditBalance (lib/billing/aiCredits) for the session user: this month's
// plan allowance, purchased credits, how to buy more, and the last 20 ledger entries.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getCreditBalance } from '@/lib/billing/aiCreditsServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const currency = String(req.query.currency || '').toUpperCase() === 'USD' ? 'USD' : 'TRY';
    return res.status(200).json(await getCreditBalance(user.id, currency));
  } catch (err: any) {
    logger.error('AI credits balance failed', err, { userId: user.id });
    return res.status(500).json({ code: 'creditsFailed' });
  }
}
