import prisma from './prisma';
import { logger } from './logger';
import { SyncType } from './types';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function retryOperation<T>(operation: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return retryOperation(operation, retries - 1);
    }
    throw error;
  }
}

export type SyncStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type SyncOperationType = 'full' | 'recent' | 'single' | 'label';

export interface SyncMetrics {
  startTime: Date;
  endTime?: Date;
  totalOrders: number;
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
}

export async function startSync(userId: string, type: string): Promise<string> {
  return retryOperation(async () => {
    // Check for existing in-progress sync
    const existingSync = await prisma.syncOperation.findFirst({
      where: {
        userId,
        type,
        status: 'in_progress'
      }
    });

    if (existingSync) {
      // For fast sync operations (like Trendyol), use shorter stale threshold
      const staleThresholdMs = type === 'trendyol' ? 5 * 60 * 1000 : 15 * 60 * 1000; // 5 minutes for Trendyol, 15 for others
      const isStale = Date.now() - existingSync.updatedAt.getTime() > staleThresholdMs;
      
      logger.info(`[SYNC STATUS] Found existing ${type} sync for user ${userId}:`, {
        syncId: existingSync.id,
        status: existingSync.status,
        ageMinutes: Math.round((Date.now() - existingSync.updatedAt.getTime()) / (60 * 1000)),
        isStale
      });
      
      if (!isStale) {
        throw new Error(`Sync operation (type: ${type}) already in progress for this user and is not stale.`);
      }

      // Mark stale sync as failed
      await prisma.syncOperation.update({
        where: { id: existingSync.id },
        data: {
          status: 'failed',
          metrics: {
            ...(existingSync.metrics as any || {}),
            error: 'Sync operation was stale and marked as failed'
          }
        }
      });
    }

    // Create new sync operation
    const sync = await prisma.syncOperation.create({
      data: {
        userId,
        type,
        status: 'in_progress',
        metrics: {
          processedOrders: 0,
          successfulOrders: 0,
          failedOrders: 0,
          totalOrders: 0,
          errors: []
        }
      }
    });

    return sync.id;
  });
}

export async function updateSyncProgress(syncId: string, metrics: any): Promise<void> {
  return retryOperation(async () => {
    await prisma.syncOperation.update({
      where: { id: syncId },
      data: {
        metrics,
        updatedAt: new Date()
      }
    });
  });
}

export async function completeSync(syncId: string, success: boolean, metrics: any): Promise<void> {
  return retryOperation(async () => {
    await prisma.syncOperation.update({
      where: { id: syncId },
      data: {
        status: success ? 'completed' : 'failed',
        metrics,
        updatedAt: new Date()
      }
    });
  });
}

export async function retryFailedSync(syncId: string): Promise<string> {
  try {
    const originalSync = await prisma.syncOperation.findUnique({
      where: { id: syncId },
    });
    if (!originalSync) {
      throw new Error(`Sync operation ${syncId} not found`);
    }
    if (originalSync.status !== 'failed') {
      throw new Error(`Cannot retry sync ${syncId} with status ${originalSync.status}`);
    }
    const newSync = await prisma.syncOperation.create({
      data: {
        userId: originalSync.userId,
        type: originalSync.type,
        status: 'in_progress',
        metrics: {
          startTime: new Date(),
          totalOrders: 0,
          processedOrders: 0,
          successfulOrders: 0,
          failedOrders: 0,
          errors: [],
        },
        retryOf: syncId,
      },
    });
    logger.info(`Retrying failed sync ${syncId} as ${newSync.id}`);
    return newSync.id;
  } finally {
    // await prisma.$disconnect(); // Removed
  }
}

// Cleanup stale sync operations
export async function cleanupStaleSyncs(userId?: string, type?: string): Promise<number> {
  try {
    const where: any = {
      status: 'in_progress'
    };
    
    if (userId) where.userId = userId;
    if (type) where.type = type;
    
    const staleSyncs = await prisma.syncOperation.findMany({
      where,
      select: {
        id: true,
        type: true,
        userId: true,
        updatedAt: true
      }
    });
    
    let cleanedCount = 0;
    for (const sync of staleSyncs) {
      const staleThresholdMs = sync.type === 'trendyol' ? 5 * 60 * 1000 : 15 * 60 * 1000;
      const isStale = Date.now() - sync.updatedAt.getTime() > staleThresholdMs;
      
      if (isStale) {
        await prisma.syncOperation.update({
          where: { id: sync.id },
          data: {
            status: 'failed',
            metrics: {
              error: 'Sync operation was stale and cleaned up automatically'
            }
          }
        });
        cleanedCount++;
        logger.info(`[SYNC CLEANUP] Cleaned up stale ${sync.type} sync ${sync.id} for user ${sync.userId}`);
      }
    }
    
    return cleanedCount;
  } catch (error) {
    logger.error('[SYNC CLEANUP] Error cleaning up stale syncs:', error);
    return 0;
  }
} 