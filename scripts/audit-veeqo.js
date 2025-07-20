const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function auditVeeqoSync() {
  try {
    const userId = 'f0cb1c43-f30d-4f31-9a96-a9940ebada2d';
    
    // Check credentials
    const credentials = await prisma.credential.findUnique({
      where: { userId }
    });
    
    console.log('=== VEEQO AUDIT ===');
    console.log('Veeqo API Key exists:', !!credentials?.veeqoApiKey);
    
    if (!credentials?.veeqoApiKey) {
      console.log('❌ No Veeqo API key found');
      return;
    }
    
    // Test API connection
    const fetch = require('node-fetch');
    const veeqoApiKey = credentials.veeqoApiKey;
    
    console.log('\n--- Testing API Connection ---');
    try {
      const response = await fetch('https://api.veeqo.com/current_user', {
        headers: {
          'x-api-key': veeqoApiKey,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('API Status:', response.status);
      
      if (response.status === 200) {
        const user = await response.json();
        console.log('✅ Veeqo API connection successful');
        console.log('User:', user.email || user.name || 'Unknown');
      } else {
        console.log('❌ Veeqo API connection failed');
        const errorText = await response.text();
        console.log('Error:', errorText);
      }
    } catch (error) {
      console.log('❌ API request failed:', error.message);
    }
    
    // Test orders endpoint
    console.log('\n--- Testing Orders Endpoint ---');
    try {
      const ordersResponse = await fetch('https://api.veeqo.com/orders?page_size=5&since_id=0', {
        headers: {
          'x-api-key': veeqoApiKey,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Orders API Status:', ordersResponse.status);
      
      if (ordersResponse.status === 200) {
        const ordersData = await ordersResponse.json();
        console.log('✅ Orders endpoint accessible');
        console.log('Total orders returned:', ordersData.orders?.length || 0);
        
        if (ordersData.orders?.length > 0) {
          const sampleOrder = ordersData.orders[0];
          console.log('Sample order ID:', sampleOrder.id);
          console.log('Sample order number:', sampleOrder.number);
          console.log('Sample order status:', sampleOrder.status?.name || sampleOrder.status);
          console.log('Sample order created:', sampleOrder.created_at);
        }
      } else {
        console.log('❌ Orders endpoint failed');
        const errorText = await ordersResponse.text();
        console.log('Error:', errorText);
      }
    } catch (error) {
      console.log('❌ Orders request failed:', error.message);
    }
    
    // Check existing orders in database
    console.log('\n--- Database Check ---');
    const veeqoOrdersCount = await prisma.order.count({
      where: {
        userId,
        marketplace: 'Veeqo'
      }
    });
    
    const recentVeeqoOrders = await prisma.order.findMany({
      where: {
        userId,
        marketplace: 'Veeqo'
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
    
    console.log('Veeqo orders in database:', veeqoOrdersCount);
    console.log('Recent Veeqo orders:');
    recentVeeqoOrders.forEach(order => {
      console.log(`  - Order ${order.orderNumber} (${order.marketplaceKey}) - Created: ${order.createdAt}, Updated: ${order.updatedAt}`);
    });
    
  } catch (error) {
    console.error('Audit failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

auditVeeqoSync();