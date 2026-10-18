// POST /api/user/delete-account — the signed-in seller permanently deletes their account (Google Play account
// deletion requirement; lib/account/deleteAccount.ts does the work). Browser session only (no extension token).
// Body: { confirm: <the account email>, password?: <current password, required when the account has one> }.
import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { deleteUserAccount } from '@/lib/account/deleteAccount';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const auth = await getAuthUser(req, res, { allowBearer: false });
  if (!auth) return res.status(401).json({ code: 'unauthorized' });

  const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { id: true, email: true, password: true } });
  if (!user) return res.status(401).json({ code: 'unauthorized' });

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { confirm?: unknown; password?: unknown };
  const confirm = typeof body.confirm === 'string' ? body.confirm.trim().toLowerCase() : '';
  if (!user.email || confirm !== user.email.trim().toLowerCase()) return res.status(400).json({ code: 'confirmMismatch' });
  if (user.password) {
    const ok = typeof body.password === 'string' && body.password.length > 0 && (await bcrypt.compare(body.password, user.password));
    if (!ok) return res.status(403).json({ code: 'wrongPassword' });
  }

  try {
    await deleteUserAccount(user.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('Account deletion failed', err as Error, { userId: user.id });
    return res.status(500).json({ code: 'deleteFailed' });
  }
}
