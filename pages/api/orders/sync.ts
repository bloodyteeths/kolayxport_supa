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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user via Supabase client
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    logger.warn('Unauthorized sync attempt', { authError });
    return res.status(401).json({ error: 'Unauthorized', details: authError?.message });
  }
  const userId = user.id;

  try {
    // Get credentials from request body
    const { veeqoApiKey, shippoToken, syncType } = req.body;

    // Fetch Credential as fallback
    const userSettings = await prisma.credential.findUnique({ where: { userId } });

    // Use provided credentials or fall back to user settings
    const finalVeeqoApiKey = veeqoApiKey || userSettings?.veeqoApiKey;
    const finalShippoToken = shippoToken || userSettings?.shippoToken;

    if (!finalVeeqoApiKey && !finalShippoToken) {
      logger.error('No integration credentials found', undefined, { userId, operation: 'order-sync' });
      return res.status(400).json({ error: 'No integration credentials found. Please check your settings.' });
    }

    let startDate: Date | null | undefined = undefined;
    if (syncType === 'recent') {
      // Use last completed sync date for recent sync
      const lastSync = await prisma.syncOperation.findFirst({
        where: {
          userId,
          status: 'completed'
        },
        orderBy: { createdAt: 'desc' }
      });
      startDate = lastSync?.createdAt;
    } else if (syncType === 'full') {
      startDate = null;
    }

    // Perform sync using centralized logic with retry
    let retries = 3;
    let lastError: any;
    
    while (retries > 0) {
      try {
        const result = await syncAllOrders(userId, {
          veeqoApiKey: finalVeeqoApiKey,
          shippoToken: finalShippoToken,
          startDate: startDate === null ? undefined : startDate,
          syncType: syncType || 'full',
        });
        return res.status(200).json(result);
      } catch (error: any) {
        lastError = error;
        retries--;
        if (retries > 0) {
          logger.warn(`Sync failed, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    throw lastError;
  } catch (error: any) {
    logger.error('Sync failed', error);
    return res.status(500).json({ 
      error: 'Failed to sync orders',
      details: error.message
    });
  }
} 