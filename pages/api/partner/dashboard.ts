// GET /api/partner/dashboard — the signed-in partner's own referrals (masked), bounties and payouts.
// 404 for anyone who is not a partner (and for Shopify-connected accounts). docs/gtm/referral-spec.md §4.2.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { loadPartnerDashboard, partnerForUser } from '@/lib/partners/dashboard';
import { stripePayoutsConfigured } from '@/lib/partners/stripeGlobalPayouts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await getAuthUser(req, res, { allowBearer: false });
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const partner = await partnerForUser(auth.id);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  try {
    const data = await loadPartnerDashboard(partner.id);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      partner: { code: partner.code, name: partner.name, status: partner.status, promoCode: partner.stripePromotionCode ? partner.promoCodeText ?? partner.code : null },
      link: `https://kolayxport.com/?ref=${encodeURIComponent(partner.code)}`,
      bank: { provider: stripePayoutsConfigured() ? 'stripe_global' : 'manual', connected: Boolean(partner.stripeRecipientId) },
      ...data,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn('Partner dashboard failed', { error: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ error: 'failed' });
  }
}
