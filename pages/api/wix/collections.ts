import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createWixClient } from '@/lib/integrations/wixClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const wixSite = await prisma.wixSite.findFirst({ where: { userId: user.id, isActive: true } });
  const credential = wixSite
    ? { wixAccessToken: wixSite.accessToken, wixRefreshToken: wixSite.refreshToken, wixSiteId: wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
    : await prisma.credential.findUnique({ where: { userId: user.id } });

  if (!credential?.wixAccessToken || !credential?.wixSiteId) {
    return res.status(400).json({ error: 'Wix credentials not configured' });
  }

  try {
    const client = createWixClient(credential);
    const { collections, totalResults } = await client.queryCollections({ limit: 100 });
    return res.status(200).json({ collections, totalResults });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch collections' });
  }
}
