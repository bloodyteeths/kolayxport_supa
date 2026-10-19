// GET /api/partner/me — is this login a referral partner? Drives the Ortaklık nav row. Session only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { partnerForUser } from '@/lib/partners/dashboard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await getAuthUser(req, res, { allowBearer: false });
  if (!auth) return res.status(401).json({ isPartner: false });
  const partner = await partnerForUser(auth.id).catch(() => null);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ isPartner: Boolean(partner) });
}
