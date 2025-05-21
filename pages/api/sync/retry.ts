import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { logger } from '../../../lib/logger';
import { SyncType, retryFailedSync } from '../../../lib/sync-status';

// Functions imported from auto-sync-all-users.js (or similar refactored location)
// These functions are expected to handle their own startSync, updateSyncProgress, completeSync calls.
const { syncVeeqoRecentOrders, syncShippoRecentOrders, syncTrendyolRecentOrders, syncHepsiburadaRecentOrders } = require('../../../scripts/auto-sync-all-users.js');

// Import the function that /api/orders/sync uses for its logic
// This might be fetchVeeqoOrders directly or a wrapper from veeqoService or similar
// For this example, let's assume there's a generic syncRecentOrdersForAllIntegrations
// or we call the specific ones based on user settings like in auto-sync-all-users
// For simplicity, the general 'recent' type will be re-routed to specific integrations if possible,
// or call a generic recent sync function if one exists for /api/orders/sync.

// Assuming your /api/orders/sync.ts (the one for recent orders) has its core logic in a function we can call:
// import { processRecentOrdersSync } from '../orders/sync'; // Adjust path as needed
// If not, we might need to replicate its logic or call the individual sync functions like auto-sync does.

async function triggerSpecificSync(user, userSettings, syncTypeString: string, newSyncId: string) {
  // The functions from auto-sync-all-users already call startSync, completeSync.
  // We are passing 'user' (which includes id) and 'userSettings' (which has API keys)
  // The `syncId` parameter in those functions is created internally by startSync.
  // So, when retrying, we let them create a *new* syncId for the new operation.
  // The `newSyncId` from `retryFailedSync` is for our record, but the actual functions will create their own.
  // This might lead to two syncIds for a retry if not handled carefully.
  // For now, we'll let the imported functions manage their sync lifecycle.
  // The `newSyncId` from `retryFailedSync` is primarily to link the retry attempt.

  logger.info(`[Retry:${newSyncId}] Attempting to trigger specific sync of type: ${syncTypeString}`);

  switch (syncTypeString.toLowerCase()) {
    case 'veeqo':
    case 'veeqo_recent':
    case 'veeqo_full':
      if (!userSettings.veeqoApiKey) throw new Error('Veeqo API key not configured for user.');
      await syncVeeqoRecentOrders(user, userSettings); // This function handles its own sync lifecycle
      break;
    case 'shippo':
    case 'shippo_recent':
    case 'shippo_full':
      if (!userSettings.shippoToken) throw new Error('Shippo token not configured for user.');
      await syncShippoRecentOrders(user, userSettings);
      break;
    case 'trendyol':
      if (!userSettings.trendyolApiKey || !userSettings.trendyolApiSecret || !userSettings.trendyolSupplierId) throw new Error('Trendyol settings not configured for user.');
      await syncTrendyolRecentOrders(user, userSettings);
      break;
    case 'hepsiburada':
      if (!userSettings.hepsiburadaApiKey || !userSettings.hepsiburadaMerchantId) throw new Error('Hepsiburada settings not configured for user.');
      await syncHepsiburadaRecentOrders(user, userSettings);
      break;
    case 'recent': // This is the generic type from the button on settings page
      logger.info(`[Retry:${newSyncId}] Retrying generic 'recent' sync. Will attempt all configured recent syncs.`);
      // Similar to auto-sync-all-users, iterate and call enabled integrations
      let anIntegrationWasAttempted = false;
      if (userSettings.veeqoApiKey) {
        await syncVeeqoRecentOrders(user, userSettings);
        anIntegrationWasAttempted = true;
      }
      if (userSettings.shippoToken) {
        await syncShippoRecentOrders(user, userSettings);
        anIntegrationWasAttempted = true;
      }
      if (userSettings.trendyolApiKey && userSettings.trendyolApiSecret && userSettings.trendyolSupplierId) {
        await syncTrendyolRecentOrders(user, userSettings);
        anIntegrationWasAttempted = true;
      }
      if (userSettings.hepsiburadaApiKey && userSettings.hepsiburadaMerchantId) {
        await syncHepsiburadaRecentOrders(user, userSettings);
        anIntegrationWasAttempted = true;
      }
      if (!anIntegrationWasAttempted) {
        throw new Error('No integrations configured for recent sync retry.');
      }
      break;
    default:
      // If we are here, the original sync operation (which has its own syncId) is now considered done (retried).
      // The new sync operation (identified by newSyncId) has failed because type is unknown.
      await prisma.syncOperation.update({
        where: { id: newSyncId },
        data: { status: 'failed', metrics: { startTime: new Date(), endTime: new Date(), totalOrders:0, processedOrders:0, successfulOrders:0, failedOrders:1, errors:[{orderId:'retry_setup', error:`Unsupported sync type: ${syncTypeString}`}] } }
      });
      throw new Error(`Unsupported sync type for retry: ${syncTypeString}`);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; newSyncId?: string; message?: string } | { error: string; details?: any }>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(); // Renamed to authUser to avoid conflict

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id: originalSyncId } = req.query;

  if (typeof originalSyncId !== 'string' || !originalSyncId) {
    return res.status(400).json({ error: 'Sync Operation ID (id) is required in query parameters.' });
  }

  let newSyncRetryRecordId: string | null = null;

  try {
    const originalSync = await prisma.syncOperation.findUnique({
      where: { id: originalSyncId, userId: authUser.id },
    });

    if (!originalSync) {
      return res.status(404).json({ error: `Sync operation ${originalSyncId} not found or access denied.` });
    }

    if (originalSync.status !== 'failed') {
      return res.status(400).json({ error: `Cannot retry sync ${originalSyncId} with status ${originalSync.status}. Only failed syncs can be retried.` });
    }

    newSyncRetryRecordId = await retryFailedSync(originalSyncId); // This creates the new SyncOperation entry
    logger.info(`[Retry] Initiated retry for original sync ${originalSyncId}. New SyncOperation record ID for retry: ${newSyncRetryRecordId}. Type: ${originalSync.type}`);
    
    const userDBSettings = await prisma.userIntegrationSettings.findUnique({ where: { userId: authUser.id } });
    if (!userDBSettings) {
        throw new Error ('User integration settings not found for retry execution.');
    }

    // The actual user object for the sync functions (if they expect more than just ID)
    const userForSync = await prisma.user.findUnique({ where: { id: authUser.id }});
    if (!userForSync) throw new Error('User not found for sync execution');

    // Execute the sync. This will internally create its own SyncOperation entries via startSync.
    await triggerSpecificSync(userForSync, userDBSettings, originalSync.type as string, newSyncRetryRecordId);
      
    logger.info(`[Retry] Successfully triggered retry execution for original sync ${originalSyncId} (new record ${newSyncRetryRecordId}).`);
    return res.status(200).json({ success: true, newSyncId: newSyncRetryRecordId, message: 'Sync retry process started successfully.' });

  } catch (error: any) {
    logger.error(`[Retry] Error processing retry for sync ${originalSyncId}:`, error);
    // If newSyncRetryRecordId was created, mark IT as failed because the triggerSpecificSync failed.
    if (newSyncRetryRecordId) {
        try {
            await prisma.syncOperation.update({
                where: { id: newSyncRetryRecordId },
                data: { 
                    status: 'failed', 
                    metrics: { 
                        startTime: new Date(), 
                        endTime: new Date(), 
                        totalOrders:0, 
                        processedOrders:0, 
                        successfulOrders:0, 
                        failedOrders:1, 
                        errors:[{orderId:'retry_trigger', error: error.message}]
                    }
                }
            });
        } catch (dbError) {
            logger.error(`[Retry] Failed to mark retry SyncOperation ${newSyncRetryRecordId} as failed:`, dbError);
        }
    }
    return res.status(500).json({ error: `Failed to retry sync: ${error.message}`, details: error.stack });
  } finally {
    await prisma.$disconnect();
  }
} 