const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function auditShippoSync() {
  try {
    const userId = 'f0cb1c43-f30d-4f31-9a96-a9940ebada2d';
    
    const credentials = await prisma.credential.findUnique({
      where: { userId }
    });
    
    console.log('=== SHIPPO AUDIT ===');
    console.log('Shippo Token exists:', !!credentials?.shippoToken);
    
    if (!credentials?.shippoToken) {
      console.log('❌ No Shippo token found');
      return;
    }
    
    // Test API connection
    const fetch = require('node-fetch');
    const shippoToken = credentials.shippoToken;
    
    console.log('\n--- Testing API Connection ---');
    try {
      const response = await fetch('https://api.goshippo.com/orders/', {
        headers: {
          'Authorization': `ShippoToken ${shippoToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('API Status:', response.status);
      
      if (response.status === 200) {
        const data = await response.json();
        console.log('✅ Shippo API connection successful');
        console.log('Total orders returned:', data.results?.length || 0);
        console.log('Has next page:', !!data.next);
        
        if (data.results?.length > 0) {
          const sampleOrder = data.results[0];
          console.log('Sample order ID:', sampleOrder.object_id);
          console.log('Sample order status:', sampleOrder.order_status);
          console.log('Sample order created:', sampleOrder.object_created);
        }
      } else {
        console.log('❌ Shippo API connection failed');
        const errorText = await response.text();
        console.log('Error:', errorText);
      }
    } catch (error) {
      console.log('❌ API request failed:', error.message);
    }
    
    // Check existing orders in database
    console.log('\n--- Database Check ---');
    const shippoOrdersCount = await prisma.order.count({
      where: {
        userId,
        marketplace: 'Shippo'
      }
    });
    
    const recentShippoOrders = await prisma.order.findMany({
      where: {
        userId,
        marketplace: 'Shippo'
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
    
    console.log('Shippo orders in database:', shippoOrdersCount);
    console.log('Recent Shippo orders:');
    recentShippoOrders.forEach(order => {
      console.log(`  - Order ${order.orderNumber} (${order.marketplaceKey}) - Created: ${order.createdAt}, Updated: ${order.updatedAt}`);
    });
    
  } catch (error) {
    console.error('Audit failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

auditShippoSync();