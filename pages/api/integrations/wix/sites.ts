import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const sites = await prisma.wixSite.findMany({
      where: { userId: user.id, isActive: true },
      select: { id: true, siteId: true, siteName: true, lastOrderSyncAt: true, createdAt: true },
    });
    return res.status(200).json({ sites });
  }

  if (req.method === 'POST') {
    const { action, siteId } = req.body;

    if (action === 'disconnect' && siteId) {
      await prisma.wixSite.updateMany({
        where: { userId: user.id, siteId },
        data: { isActive: false },
      });

      // If this was the site in Credential, clear it
      const cred = await prisma.credential.findUnique({ where: { userId: user.id } });
      if (cred?.wixSiteId === siteId) {
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
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
