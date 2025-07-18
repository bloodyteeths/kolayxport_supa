import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugAmazonOrders() {
  console.log('🔍 Debugging Amazon orders...\n');

  // Check for Amazon orders in the database
  const amazonOrdersInDB = await prisma.order.findMany({
    where: {
      OR: [
        { marketplace: { contains: 'amazon', mode: 'insensitive' } },
        { marketplace: { contains: 'Amazon' } },
        { orderNumber: { startsWith: '1' } }, // Amazon order numbers start with 1
        { customerName: { contains: 'amazon', mode: 'insensitive' } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      orderNumber: true,
      marketplace: true,
      customerName: true,
      status: true,
      externalStatus: true,
      createdAt: true,
      uiOrderDate: true,
      rawData: true
    }
  });

  console.log(`📊 Found ${amazonOrdersInDB.length} Amazon-like orders in database:\n`);

  for (const order of amazonOrdersInDB) {
    console.log(`Order: ${order.orderNumber}`);
    console.log(`  Marketplace: ${order.marketplace}`);
    console.log(`  Customer: ${order.customerName}`);
    console.log(`  Status: ${order.status} (External: ${order.externalStatus})`);
    console.log(`  Created: ${order.createdAt}`);
    console.log(`  UI Date: ${order.uiOrderDate}`);
    
    // Check rawData for channel info
    let channelInfo = 'Unknown';
    try {
      const raw = typeof order.rawData === 'string' ? JSON.parse(order.rawData) : order.rawData;
      channelInfo = raw?.channel?.type_code || raw?.channel?.name || 'No channel info';
    } catch (e) {
      channelInfo = 'Parse error';
    }
    console.log(`  Channel: ${channelInfo}`);
    console.log('');
  }

  // Now check for the specific order the user mentioned
  const targetOrder = await prisma.order.findFirst({
    where: {
      orderNumber: '113-8445738-4457007'
    },
    select: {
      id: true,
      orderNumber: true,
      marketplace: true,
      customerName: true,
      status: true,
      externalStatus: true,
      createdAt: true,
      uiOrderDate: true,
      rawData: true
    }
  });

  if (targetOrder) {
    console.log(`🎯 FOUND TARGET ORDER in database: ${targetOrder.orderNumber}`);
    console.log(`  Marketplace: ${targetOrder.marketplace}`);
    console.log(`  Status: ${targetOrder.status} (External: ${targetOrder.externalStatus})`);
    console.log(`  Created: ${targetOrder.createdAt}`);
    console.log(`  UI Date: ${targetOrder.uiOrderDate}`);
  } else {
    console.log(`❌ TARGET ORDER 113-8445738-4457007 NOT FOUND in database`);
  }

  // Check for recent Veeqo orders
  console.log('\n📦 Recent Veeqo orders in database:');
  const veeqoOrders = await prisma.order.findMany({
    where: {
      OR: [
        { marketplace: 'Veeqo' },
        { marketplace: 'veeqo' },
        { marketplace: { contains: 'veeqo', mode: 'insensitive' } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      orderNumber: true,
      marketplace: true,
      customerName: true,
      status: true,
      createdAt: true
    }
  });

  veeqoOrders.forEach(order => {
    console.log(`  ${order.orderNumber} - ${order.marketplace} - ${order.customerName} - ${order.status}`);
  });

  await prisma.$disconnect();
}

debugAmazonOrders().catch(console.error); 