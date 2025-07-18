import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupStuckSyncs() {
  try {
    console.log('Cleaning up stuck sync operations...');
    
    // Find sync operations that are stuck (older than 5 minutes and still in progress)
    const stuckSyncs = await prisma.syncOperation.findMany({
      where: {
        status: 'in_progress',
        updatedAt: {
          lt: new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago
        }
      }
    });

    console.log(`Found ${stuckSyncs.length} stuck sync operations`);

    if (stuckSyncs.length > 0) {
      // Mark them as failed
      const result = await prisma.syncOperation.updateMany({
        where: {
          id: { in: stuckSyncs.map(s => s.id) }
        },
        data: {
          status: 'failed',
          updatedAt: new Date()
        }
      });

      console.log(`Marked ${result.count} sync operations as failed`);
    }

    console.log('Cleanup completed successfully');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupStuckSyncs(); 