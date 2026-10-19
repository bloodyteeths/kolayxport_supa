// POST /api/user/acquisition/claim — first-touch attribution for users who signed up through Google / Apple (or
// anything the signup write missed). docs/gtm/referral-spec.md §2.3. Uses the normal session; NextAuth config is
// untouched. Accounts older than 24 hours can't attach a partner later.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { recordAcquisition } from '@/lib/partners/acquisition';
import { FT_COOKIE, REF_COOKIE } from '@/lib/partners/cookies';

export const CLAIM_MAX_AGE_MS = 24 * 3_600_000;

const clearCookies = (res: NextApiResponse) =>
  res.setHeader('Set-Cookie', [REF_COOKIE, FT_COOKIE].map((n) => `${n}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'method_not_allowed' });
  }
  const auth = await getAuthUser(req, res, { allowBearer: false });
  if (!auth) return res.status(401).json({ status: 'unauthorized' });

  try {
    const existing = await prisma.userAcquisition.findUnique({ where: { userId: auth.id }, select: { userId: true } });
    if (existing) {
      clearCookies(res);
      return res.status(200).json({ status: 'exists' });
    }
    const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { createdAt: true } });
    if (!user) return res.status(401).json({ status: 'unauthorized' });
    if (Date.now() - user.createdAt.getTime() > CLAIM_MAX_AGE_MS) return res.status(200).json({ status: 'too_old' });

    const body = req.body && typeof req.body === 'object' ? (req.body as { attribution?: unknown }).attribution : undefined;
    const result = await recordAcquisition(auth.id, { cookies: req.cookies, body, via: 'claim' });
    clearCookies(res);
    return res.status(result.status === 'created' ? 201 : 200).json({ status: result.status });
  } catch (e) {
    logger.warn('Acquisition claim failed', { error: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ status: 'error' });
  }
}
