import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { fullSyncAllOrders } from '@/lib/orderSync';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Authenticate user
  const user = await getAuthUser(req, res);
  if (!user) {
    logger.warn('Unauthorized full sync attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Start the full background sync
    const syncId = await fullSyncAllOrders(user.id);
    return res.status(202).json({ success: true, syncId });
  } catch (error: any) {
    logger.error('Full sync failed', error);
    return res.status(500).json({ error: 'Failed to start full sync', details: error.message });
  }
}
