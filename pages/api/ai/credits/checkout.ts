// POST /api/ai/credits/checkout { packId, currency?, returnTo?, locale? } → { url } — Stripe Checkout, or Shopify's
// approval page for Shopify-billed accounts (lib/billing/aiCreditsPurchase). Session user only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { creditPack } from '@/lib/billing/aiCredits';
import { getCreditBalance } from '@/lib/billing/aiCreditsServer';
import { safeReturnPath, shopifyCreditCheckout, stripeCreditCheckout } from '@/lib/billing/aiCreditsPurchase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const pack = creditPack(req.body?.packId);
  if (!pack) return res.status(400).json({ code: 'badPack' });
  const currency = String(req.body?.currency || '').toUpperCase() === 'USD' ? 'USD' : 'TRY';
  const locale = req.body?.locale === 'en' ? 'en' : 'tr';
  const back = safeReturnPath(req.body?.returnTo);
  try {
    const { channel } = await getCreditBalance(user.id, currency);
    if (channel === 'shopify') return res.status(200).json({ url: await shopifyCreditCheckout(user.id, pack, back, req.headers.origin) });
    if (channel === 'stripe') return res.status(200).json({ url: await stripeCreditCheckout(user.id, pack, currency, back, req.headers.origin, locale) });
    return res.status(409).json({ code: 'purchaseUnavailable' });
  } catch (err: any) {
    logger.error('AI credits checkout failed', err, { userId: user.id, packId: pack.id });
    return res.status(502).json({ code: 'checkoutFailed' });
  }
}
