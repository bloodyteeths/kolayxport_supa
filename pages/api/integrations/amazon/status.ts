// @ts-nocheck — Amazon credential fields pending migration
import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export const config = { runtime: 'nodejs' };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const credential = await prisma.credential.findUnique({
      where: { userId: user.id },
      select: {
        amazonAccessToken: true,
        amazonTokenExpiresAt: true,
        amazonSellerId: true,
        amazonMarketplaceId: true,
        amazonRegion: true,
      },
    });

    return res.status(200).json({
      connected: !!credential?.amazonAccessToken,
      tokenExpiresAt: credential?.amazonTokenExpiresAt || null,
      sellerId: credential?.amazonSellerId || null,
      marketplaceId: credential?.amazonMarketplaceId || null,
      region: credential?.amazonRegion || null,
    });
  }

  if (req.method === 'PUT') {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { marketplaceId, region } = req.body || {};

    await prisma.credential.update({
      where: { userId: user.id },
      data: {
        ...(marketplaceId && { amazonMarketplaceId: marketplaceId }),
        ...(region && { amazonRegion: region }),
      },
    });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    await prisma.credential.update({
      where: { userId: user.id },
      data: {
        amazonAccessToken: null,
        amazonRefreshToken: null,
        amazonTokenExpiresAt: null,
        amazonSellerId: null,
        amazonMarketplaceId: null,
        amazonRegion: null,
      },
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
