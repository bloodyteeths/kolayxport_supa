// /api/partner/payout-onboarding — sends the signed-in partner to Stripe's hosted form to enter or update their bank
// details and tax form (Stripe Global Payouts, docs/gtm/referral-spec.md §4.3). We never see or store the IBAN.
// POST → { url } for the dashboard button. GET is Stripe's refresh_url: it re-authenticates by session and
// redirects to a fresh single-use link (links expire after 10 minutes).
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { partnerForUser } from '@/lib/partners/dashboard';
import { createRecipient, onboardingLink, stripePayoutsConfigured } from '@/lib/partners/stripeGlobalPayouts';

const BASE = (process.env.NEXTAUTH_URL || 'https://kolayxport.com').replace(/\/$/, '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await getAuthUser(req, res, { allowBearer: false });
  if (!auth) return req.method === 'GET' ? res.redirect(302, '/login?callbackUrl=/app/ortaklik') : res.status(401).json({ error: 'unauthorized' });
  const partner = await partnerForUser(auth.id);
  if (!partner) return res.status(404).json({ error: 'not_found' });
  if (!stripePayoutsConfigured()) return res.status(409).json({ error: 'payouts_not_configured' });

  try {
    let recipientId = partner.stripeRecipientId;
    const kind = recipientId ? 'account_update' : 'account_onboarding';
    if (!recipientId) {
      const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { email: true } });
      const email = partner.email || user?.email;
      if (!email) return res.status(409).json({ error: 'email_missing' });
      recipientId = await createRecipient({ email, name: partner.name, partnerId: partner.id });
      await prisma.partner.update({ where: { id: partner.id }, data: { stripeRecipientId: recipientId } });
    }
    const url = await onboardingLink(recipientId, kind, `${BASE}/app/ortaklik?bank=done`, `${BASE}/api/partner/payout-onboarding`);
    return req.method === 'GET' ? res.redirect(302, url) : res.status(200).json({ url });
  } catch (e) {
    logger.warn('Partner payout onboarding failed', { partnerId: partner.id, error: e instanceof Error ? e.message : String(e) });
    return req.method === 'GET' ? res.redirect(302, '/app/ortaklik?bank=error') : res.status(502).json({ error: 'stripe_failed' });
  }
}
