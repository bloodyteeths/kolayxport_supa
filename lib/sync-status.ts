import prisma from './prisma';
import { logger } from './logger';

export type SyncStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type SyncType = 'full' | 'recent' | 'single' | 'label';

export interface SyncMetrics {
  startTime: Date;
  endTime?: Date;
  totalOrders: number;
  processedOrders: number;
  successfulOrders: number;
  failedOrders: number;
  errors: Array<{ orderId: string; error: string }>;
}

export async function startSync(userId: string, type: SyncType): Promise<string> {
  try {
    // Check for existing in_progress sync for the same user and type
    const existingInProgress = await prisma.syncOperation.findFirst({
      where: {
        userId,
        type,
        status: 'in_progress',
      },
    });

    if (existingInProgress) {
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
      if (new Date(existingInProgress.createdAt).getTime() < fifteenMinutesAgo) {
        logger.warn(`Stale 'in_progress' sync ${existingInProgress.id} (type: ${type}, user: ${userId}) found. Marking as failed.`);
        
        const updateDataForStale = {
          status: 'failed' as SyncStatus,
          metrics: {
            ...(existingInProgress.metrics as any || {}),
            endTime: new Date(),
            errors: [...((existingInProgress.metrics as any)?.errors || []), { orderId: 'stale_sync', error: 'Sync marked as stale after 15 minutes in_progress.' }],
            previousNotes: (existingInProgress.notes as string || undefined)
          },
        };
        
        logger.info(
          `Attempting to update stale SyncOperation ${existingInProgress.id} with data:`,
          { data: updateDataForStale }
        );

        try {
          await prisma.syncOperation.update({
            where: { id: existingInProgress.id },
            data: updateDataForStale as any, // Cast to any for flexibility with metrics
          });
          logger.info(`Successfully marked stale sync ${existingInProgress.id} as failed.`);
        } catch (staleUpdateError: any) {
          logger.error(
            `Failed to update stale SyncOperation ${existingInProgress.id}. Error: ${staleUpdateError.message}. Data: ${JSON.stringify(updateDataForStale)}. Stack: ${staleUpdateError.stack}`,
            staleUpdateError // Pass the error instance as the second argument
          );
          throw staleUpdateError; // Re-throw to be caught by outer handler or bubble up
        }
      } else {
        // Not stale yet, prevent new sync
        logger.warn(`Sync (type: ${type}, user: ${userId}) already 'in_progress' (id: ${existingInProgress.id}) and not stale. Preventing new sync.`);
        throw new Error(`Sync operation (type: ${type}) already in progress for this user and is not stale.`);
      }
    }

    // Proceed to create new sync operation
    const createData = {
      userId,
      type,
      status: 'in_progress' as SyncStatus,
      metrics: {
        startTime: new Date(),
        totalOrders: 0,
        processedOrders: 0,
        successfulOrders: 0,
        failedOrders: 0,
        errors: [],
      } as unknown as SyncMetrics,
    };

    logger.info('Attempting to create SyncOperation with data:', { data: createData });

    let sync;
    try {
      sync = await prisma.syncOperation.create({
        data: createData as any,
      });
    } catch (error: any) {
      logger.error(
        `Failed to create SyncOperation in startSync. Error: ${error.message}. Data: ${JSON.stringify(createData)}`,
        error // Pass error instance
      );
      throw error;
    }

    logger.info(`Started ${type} sync for user ${userId}`, { syncId: sync.id });
    return sync.id;

  } catch (error: any) {
    logger.error(
      `Error in startSync for user ${userId}, type ${type}. Error: ${error.message}`,
      error // Pass error instance
    );
    throw error;
  } finally {
    // prisma.$disconnect(); // Already confirmed removed
  }
}

export async function updateSyncProgress(
  syncId: string,
  metrics: Partial<SyncMetrics>
): Promise<void> {
  try {
    const sync = await prisma.syncOperation.findUnique({
      where: { id: syncId },
    });
    if (!sync) {
      throw new Error(`Sync operation ${syncId} not found`);
    }
    const currentMetrics = sync.metrics as unknown as SyncMetrics;
    const updatedMetrics = {
      ...currentMetrics,
      ...metrics,
    };
    await prisma.syncOperation.update({
      where: { id: syncId },
      data: {
        metrics: updatedMetrics,
      },
    });
    logger.debug(`Updated sync progress for ${syncId}`, { metrics: updatedMetrics });
  } finally {
    // await prisma.$disconnect(); // Removed
  }
}

export async function completeSync(
  syncId: string,
  success: boolean,
  finalMetrics: Partial<SyncMetrics>
): Promise<void> {
  try {
    const sync = await prisma.syncOperation.findUnique({
      where: { id: syncId },
    });
    if (!sync) {
      throw new Error(`Sync operation ${syncId} not found`);
    }
    const currentMetrics = sync.metrics as unknown as SyncMetrics;
    const updatedMetrics = {
      ...currentMetrics,
      ...finalMetrics,
      endTime: new Date(),
    };
    await prisma.syncOperation.update({
      where: { id: syncId },
      data: {
        status: success ? 'completed' : 'failed',
        metrics: updatedMetrics,
      },
    });
    logger.info(`Completed sync ${syncId}`, {
      success,
      metrics: updatedMetrics,
    });
  } finally {
    // await prisma.$disconnect(); // Removed
  }
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