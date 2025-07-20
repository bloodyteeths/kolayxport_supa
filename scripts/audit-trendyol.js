const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function auditTrendyolSync() {
  try {
    const userId = 'f0cb1c43-f30d-4f31-9a96-a9940ebada2d';
    
    const credentials = await prisma.credential.findUnique({
      where: { userId }
    });
    
    console.log('=== TRENDYOL AUDIT ===');
    console.log('Trendyol API Key exists:', !!credentials?.trendyolApiKey);
    console.log('Trendyol API Secret exists:', !!credentials?.trendyolApiSecret);
    console.log('Trendyol Supplier ID exists:', !!credentials?.trendyolSupplierId);
    
    // Check environment variables
    console.log('MARKETPLACE_TRENDYOL env var:', process.env.MARKETPLACE_TRENDYOL);
    
    if (!credentials?.trendyolApiKey || !credentials?.trendyolApiSecret || !credentials?.trendyolSupplierId) {
      console.log('❌ Missing Trendyol credentials');
      return;
    }
    
    // Test API connection
    const { fetchCreatedOrders } = require('../lib/integrations/trendyolClient');
    
    console.log('\n--- Testing API Connection ---');
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const today = new Date();
      
      const settings = {
        trendyolApiKey: credentials.trendyolApiKey,
        trendyolApiSecret: credentials.trendyolApiSecret,
        trendyolSupplierId: credentials.trendyolSupplierId
      };
      
      console.log('Fetching orders from yesterday to today...');
      const orders = await fetchCreatedOrders(settings, yesterday, today);
      
      console.log('✅ Trendyol API connection successful');
      console.log('Orders returned:', orders?.length || 0);
      
      if (orders?.length > 0) {
        const sampleOrder = orders[0];
        console.log('Sample order ID:', sampleOrder.id);
        console.log('Sample order number:', sampleOrder.orderNumber);
        console.log('Sample order status:', sampleOrder.status);
        console.log('Sample order items:', sampleOrder.lines?.length || 0);
      }
      
    } catch (error) {
      console.log('❌ Trendyol API connection failed:', error.message);
    }
    
    // Check existing orders in database
    console.log('\n--- Database Check ---');
    const trendyolOrdersCount = await prisma.order.count({
      where: {
        userId,
        marketplace: 'Trendyol'
      }
    });
    
    const recentTrendyolOrders = await prisma.order.findMany({
      where: {
        userId,
        marketplace: 'Trendyol'
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 3,
      select: {
        id: true,
        orderNumber: true,
        marketplaceKey: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    console.log('Trendyol orders in database:', trendyolOrdersCount);
    console.log('Recent Trendyol orders:');
    recentTrendyolOrders.forEach(order => {
      console.log(`  - Order ${order.orderNumber} (${order.marketplaceKey}) - Created: ${order.createdAt}, Updated: ${order.updatedAt}`);
    });
    
    // Check feature flag function
    console.log('\n--- Feature Flag Check ---');
    const { isTrendyolEnabled } = require('../lib/config');
    console.log('isTrendyolEnabled():', isTrendyolEnabled());
    console.log('isTrendyolEnabled(userId):', isTrendyolEnabled(userId));
    
  } catch (error) {
    console.error('Audit failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

auditTrendyolSync();