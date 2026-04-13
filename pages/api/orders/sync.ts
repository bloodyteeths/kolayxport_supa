import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { syncAllOrders } from '@/lib/orderSync';
import { getAuthUser } from '@/lib/auth';
import { isTrendyolEnabled, isWixEnabled } from '@/lib/config';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';
import { syncWixRecentOrdersForUser } from '@/lib/sync/wix';
// Import Trendyol sync function from auto-sync script
const { syncTrendyolRecentOrders } = require('../../../scripts/auto-sync-all-users.js');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    logger.warn('Unauthorized sync attempt');
    return res.status(401).json({ error: 'Unauthorized' });
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
    const finalTrendyolApiKey = userSettings?.trendyolApiKey;
    const finalTrendyolApiSecret = userSettings?.trendyolApiSecret;
    const finalTrendyolSupplierId = userSettings?.trendyolSupplierId;

    const hasVeeqo = !!finalVeeqoApiKey;
    const hasShippo = !!finalShippoToken;
    const hasTrendyol = !!(finalTrendyolApiKey && finalTrendyolApiSecret && finalTrendyolSupplierId) && isTrendyolEnabled(userId);
    const hasWix = !!(userSettings?.wixAccessToken && userSettings?.wixSiteId) && isWixEnabled(userId);

    if (!hasVeeqo && !hasShippo && !hasTrendyol && !hasWix) {
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
        // Create array of sync promises to run in parallel
        const syncPromises: Promise<any>[] = [];
        let combinedResult = {
          newOrders: 0,
          updatedOrders: 0,
          skippedOrders: 0,
          failedOrders: 0,
          errors: [] as Array<{ orderId: string; error: string }>
        };

        // Add Veeqo + Shippo sync if credentials exist
        if (hasVeeqo || hasShippo) {
          syncPromises.push(
            syncAllOrders(userId, {
              veeqoApiKey: finalVeeqoApiKey,
              shippoToken: finalShippoToken,
              startDate: startDate === null ? undefined : startDate,
              syncType: syncType || 'full',
            })
          );
        }

        // Add Trendyol sync if enabled and credentials exist
        if (hasTrendyol) {
          syncPromises.push(
            (async () => {
              try {
                const user = await prisma.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error('User not found for Trendyol sync');
                
                const trendyolSettings = {
                  trendyolApiKey: finalTrendyolApiKey,
                  trendyolApiSecret: finalTrendyolApiSecret,
                  trendyolSupplierId: finalTrendyolSupplierId,
                };

                logger.info(`[Fast Sync] Starting Trendyol sync for user ${userId}`);
                await syncTrendyolRecentOrders(user, trendyolSettings);
                
                // Return a result structure compatible with syncAllOrders
                return {
                  newOrders: 0, // Trendyol sync doesn't return these metrics in same format
                  updatedOrders: 0,
                  skippedOrders: 0,
                  failedOrders: 0,
                  errors: []
                };
              } catch (error: any) {
                logger.error(`[Fast Sync] Trendyol sync failed for user ${userId}:`, error);
                // Return failed result instead of throwing to not break entire sync
                return {
                  newOrders: 0,
                  updatedOrders: 0,
                  skippedOrders: 0,
                  failedOrders: 1,
                  errors: [{ orderId: 'trendyol_sync', error: error.message }]
                };
              }
            })()
          );
        }

        // Add Wix sync if enabled and credentials exist
        if (hasWix) {
          syncPromises.push(
            (async () => {
              try {
                logger.info(`[Fast Sync] Starting Wix sync for user ${userId}`);
                await syncWixRecentOrdersForUser(userId);
                return { newOrders: 0, updatedOrders: 0, skippedOrders: 0, failedOrders: 0, errors: [] };
              } catch (error: any) {
                logger.error(`[Fast Sync] Wix sync failed for user ${userId}:`, error);
                return { newOrders: 0, updatedOrders: 0, skippedOrders: 0, failedOrders: 1, errors: [{ orderId: 'wix_sync', error: error.message }] };
              }
            })()
          );
        }

        // Execute all syncs in parallel
        const results = await Promise.all(syncPromises);
        
        // Combine results from all sync operations
        for (const result of results) {
          combinedResult.newOrders += result.newOrders || 0;
          combinedResult.updatedOrders += result.updatedOrders || 0;
          combinedResult.skippedOrders += result.skippedOrders || 0;
          combinedResult.failedOrders += result.failedOrders || 0;
          combinedResult.errors.push(...(result.errors || []));
        }

        // Increment usage counter after successful sync
        if (res.incrementUsage) {
          await res.incrementUsage();
        }

        logger.info(`[Fast Sync] Combined sync completed for user ${userId}:`, combinedResult);
        return res.status(200).json(combinedResult);
        
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

export default withUsageLimiter(handler, 'orderSync'); 