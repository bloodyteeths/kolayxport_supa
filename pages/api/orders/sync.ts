import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { syncAllOrders } from '@/lib/orderSync';
import { getSupabaseServerClient } from '@/lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    console.log('[SYNC DEBUG] Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user via Supabase client
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.log('[SYNC DEBUG] Unauthorized sync attempt', { authError });
    logger.warn('Unauthorized sync attempt', { authError });
    return res.status(401).json({ error: 'Unauthorized', details: authError?.message });
  }
  const userId = user.id;

  try {
    // Get credentials from request body
    const { veeqoApiKey, shippoToken, syncType } = req.body;

    // Fetch UserIntegrationSettings as fallback
    const userSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId } });

    // Use provided credentials or fall back to user settings
    const finalVeeqoApiKey = veeqoApiKey || userSettings?.veeqoApiKey;
    const finalShippoToken = shippoToken || userSettings?.shippoToken;

    console.log('[SYNC DEBUG] Using Veeqo API Key:', !!finalVeeqoApiKey);
    console.log('[SYNC DEBUG] Using Shippo Token:', !!finalShippoToken);

    if (!finalVeeqoApiKey && !finalShippoToken) {
      logger.error('No integration credentials found', undefined, { userId, operation: 'order-sync' });
      return res.status(400).json({ error: 'No integration credentials found. Please check your settings.' });
    }

    let startDate: Date | undefined = undefined;
    if (syncType !== 'full') {
      // Default to recent sync: use last completed sync date
      const lastSync = await prisma.syncOperation.findFirst({
        where: {
          userId,
          type: 'recent',
          status: 'completed'
        },
        orderBy: { createdAt: 'desc' }
      });
      startDate = lastSync?.createdAt;
    }

    // Perform sync using centralized logic
    const result = await syncAllOrders(userId, {
      veeqoApiKey: finalVeeqoApiKey,
      shippoToken: finalShippoToken,
      startDate
    });
    return res.status(200).json(result);

  } catch (error: any) {
    console.error('[SYNC DEBUG] Sync failed:', error);
    logger.error('Sync failed', error, { userId });
    return res.status(500).json({ 
      error: 'Failed to sync orders',
      details: error.message 
    });
  }
} 