import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { encryptIfNeeded } from '@/lib/crypto/credentials';

/**
 * POST: Claim a pending Wix connection for the authenticated user.
 * Called after the user installs the app and the webhook stores a pending connection.
 * The frontend sends { instanceId } and we assign it to the user.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { instanceId } = req.body;

  try {
    // Find the most recent pending connection
    const pending = await prisma.wixSite.findFirst({
      where: { userId: 'pending', isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      return res.status(404).json({ error: 'No pending Wix connection found. Please install the app first.' });
    }

    // Claim it for this user
    await prisma.wixSite.update({
      where: { id: pending.id },
      data: { userId: user.id },
    });

    // Update Credential. pending.accessToken was already encrypted by the webhook
    // write, but `encryptIfNeeded` is idempotent — passing an already-encrypted
    // value back through is a no-op.
    const encAccess = encryptIfNeeded(pending.accessToken);
    await prisma.credential.upsert({
      where: { userId: user.id },
      update: {
        wixAccessToken: encAccess,
        wixSiteId: pending.siteId,
        wixInstanceId: instanceId || pending.siteId,
        wixTokenExpiresAt: pending.tokenExpiresAt,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        wixAccessToken: encAccess,
        wixSiteId: pending.siteId,
        wixInstanceId: instanceId || pending.siteId,
        wixTokenExpiresAt: pending.tokenExpiresAt,
      },
    });

    logger.info('Wix connection claimed', { userId: user.id, siteId: pending.siteId, siteName: pending.siteName });
    return res.status(200).json({ success: true, siteName: pending.siteName, siteId: pending.siteId });
  } catch (err) {
    logger.error('Failed to claim Wix connection', err instanceof Error ? err : new Error(String(err)), { userId: user.id });
    return res.status(500).json({ error: 'Failed to claim connection' });
  }
}
