const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearStuckSyncs() {
  try {
    // Find all stuck sync operations (in_progress for more than 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const stuckSyncs = await prisma.syncOperation.findMany({
      where: {
        status: 'in_progress',
        createdAt: {
          lt: tenMinutesAgo
        }
      }
    });
    
    console.log(`Found ${stuckSyncs.length} stuck sync operations`);
    
    if (stuckSyncs.length > 0) {
      // Mark them as failed
      const result = await prisma.syncOperation.updateMany({
        where: {
          status: 'in_progress',
          createdAt: {
            lt: tenMinutesAgo
          }
        },
        data: {
          status: 'failed',
          updatedAt: new Date()
        }
      });
      
      console.log(`Cleared ${result.count} stuck sync operations`);
    }
    
    // Also clear any in_progress syncs for the current session (last 10 minutes)
    const recentStuckSyncs = await prisma.syncOperation.findMany({
      where: {
        status: 'in_progress',
        createdAt: {
          gte: tenMinutesAgo
        }
      }
    });
    
    if (recentStuckSyncs.length > 0) {
      console.log(`Found ${recentStuckSyncs.length} recent stuck syncs, clearing them too...`);
      
      const recentResult = await prisma.syncOperation.updateMany({
        where: {
          status: 'in_progress'
        },
        data: {
          status: 'failed',
          updatedAt: new Date()
        }
      });
      
      console.log(`Cleared ${recentResult.count} recent stuck sync operations`);
    }
    
    console.log('All stuck sync operations have been cleared!');
    
  } catch (error) {
    console.error('Error clearing stuck syncs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearStuckSyncs();