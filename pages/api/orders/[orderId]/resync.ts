import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { syncAllOrders } from '../../../../lib/orderSync';
import { VEEQO_API_KEY as GLOBAL_VEEQO_API_KEY } from '../../../../lib/config';
import { getAuthUser } from '@/lib/auth';
import { logger } from '../../../../lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId } = req.query;
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    logger.warn('Unauthorized resync attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = user.id;

  try {
    // Fetch Credential
    const userSettings = await prisma.credential.findUnique({
      where: { userId },
    });
    const veeqoApiKey = userSettings?.veeqoApiKey || GLOBAL_VEEQO_API_KEY;
    if (!veeqoApiKey) {
      logger.error('Veeqo API Key missing for user', undefined, { userId, operation: 'order-resync', source: 'Veeqo' });
      return res.status(400).json({ error: 'Veeqo integration is not configured. Please check your settings.' });
    }

    // Perform resync for specific order using centralized logic
    const result = await syncAllOrders(userId, { veeqoApiKey });
    return res.status(200).json(result);

  } catch (error: any) {
    logger.error('Order resync failed', error, { userId, orderId });
    return res.status(500).json({ 
      error: 'Failed to resync order',
      details: error.message 
    });
  }
} 