// GET /api/ai/credits/shopify-return?shop=<ShopifyShop id>&back=<path>&charge_id=<id> — Shopify sends the seller
// here after approving a credit pack. The purchase is read back from Shopify (must be ACTIVE) and its credits are
// added once; then back to where the seller was, with ?credits=success|cancel.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { fulfilShopifyPurchase, safeReturnPath } from '@/lib/billing/aiCreditsPurchase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const back = safeReturnPath(req.query.back);
  const sep = back.includes('?') ? '&' : '?';
  const user = await getAuthUser(req, res);
  if (!user) return res.redirect(302, `/login?callbackUrl=${encodeURIComponent(req.url || back)}`);
  try {
    const r = await fulfilShopifyPurchase(user.id, String(req.query.shop || ''), String(req.query.charge_id || ''));
    return res.redirect(302, `${back}${sep}credits=${r.ok ? 'success' : 'cancel'}`);
  } catch (err: any) {
    logger.error('AI credits Shopify return failed', err, { userId: user.id });
    return res.redirect(302, `${back}${sep}credits=cancel`);
  }
}
