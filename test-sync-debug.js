// Simple test script to debug sync issues
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testSyncDebug() {
  try {
    console.log('Testing sync debug...');
    
    // Check if Trendyol is enabled
    console.log('Trendyol enabled: true (feature flag removed)');
    
    // Check database connection
    const userCount = await prisma.user.count();
    console.log('Total users:', userCount);
    
    // Check if there are any existing orders
    const orderCount = await prisma.order.count();
    console.log('Total orders:', orderCount);
    
    // Check for any problematic marketplace values
    const marketplaces = await prisma.order.findMany({
      select: { marketplace: true },
      distinct: ['marketplace']
    });
    console.log('Existing marketplaces:', marketplaces.map(m => m.marketplace));
    
    // Check sync operations
    const syncOps = await prisma.syncOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    console.log('Recent sync operations:', syncOps.map(s => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      metrics: s.metrics
    })));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSyncDebug(); 