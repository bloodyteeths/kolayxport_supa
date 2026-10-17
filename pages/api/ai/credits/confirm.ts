// POST /api/ai/credits/confirm { sessionId } → { ok, credits, added } — the Stripe return page asks for its paid
// session so the credits show at once (the webhook adds the same credits; whichever is first wins, once).
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { stripe } from '@/lib/stripe';
import { fulfilStripeCreditSession } from '@/lib/billing/aiCreditsPurchase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const sessionId = String(req.body?.sessionId || '');
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ code: 'badSession' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const r = await fulfilStripeCreditSession(session, user.id);
    return res.status(r.ok ? 200 : 409).json(r);
  } catch (err: any) {
    logger.warn('AI credits confirm failed', { userId: user.id, error: err?.message });
    return res.status(502).json({ ok: false, code: 'confirmFailed' });
  }
}
