import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const credential = await prisma.credential.findUnique({
      where: { userId: user.id },
      select: {
        ebayAccessToken: true,
        ebayTokenExpiresAt: true,
      },
    });

    const connected = !!(credential?.ebayAccessToken);
    const tokenExpiresAt = credential?.ebayTokenExpiresAt || null;

    return res.status(200).json({
      connected,
      tokenExpiresAt,
    });
  }

  if (req.method === 'DELETE') {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    await prisma.credential.update({
      where: { userId: user.id },
      data: {
        ebayAccessToken: null,
        ebayRefreshToken: null,
        ebayTokenExpiresAt: null,
      },
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
