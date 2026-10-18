// /api/user/push-devices — the App Store app registers (POST) or drops (DELETE) its APNs device token.
// Body: { token: <64+ hex chars>, platform: 'ios' }. A token moving to another account follows the new sign-in.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

const TOKEN_RE = /^[0-9a-fA-F]{32,200}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user) return res.status(401).json({ code: 'unauthorized' });

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { token?: unknown; platform?: unknown };
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) return res.status(400).json({ code: 'badToken' });

  if (req.method === 'DELETE') {
    await prisma.pushDevice.deleteMany({ where: { token, userId: user.id } });
    return res.status(200).json({ ok: true });
  }
  const platform = body.platform === 'ios' ? 'ios' : null;
  if (!platform) return res.status(400).json({ code: 'badPlatform' });
  await prisma.pushDevice.upsert({
    where: { token },
    create: { userId: user.id, platform, token },
    update: { userId: user.id, platform, lastSeenAt: new Date() },
  });
  return res.status(200).json({ ok: true });
}
