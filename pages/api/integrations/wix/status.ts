import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const sites = await prisma.wixSite.findMany({
      where: { userId: user.id, isActive: true },
      select: { siteId: true, siteName: true, tokenExpiresAt: true, lastOrderSyncAt: true, createdAt: true },
    });

    // Also check Credential fallback
    const credential = await prisma.credential.findUnique({
      where: { userId: user.id },
      select: { wixAccessToken: true, wixSiteId: true, wixTokenExpiresAt: true },
    });

    const connected = sites.length > 0 || !!(credential?.wixAccessToken);

    return res.status(200).json({ connected, sites, tokenExpiresAt: credential?.wixTokenExpiresAt || null });
  }

  if (req.method === 'DELETE') {
    // Disconnect all Wix sites
    await prisma.wixSite.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    });

    await prisma.credential.update({
      where: { userId: user.id },
      data: {
        wixAccessToken: null,
        wixRefreshToken: null,
        wixSiteId: null,
        wixInstanceId: null,
        wixTokenExpiresAt: null,
      },
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
