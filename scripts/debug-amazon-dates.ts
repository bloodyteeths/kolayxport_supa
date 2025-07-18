import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAmazonInDateRange() {
  console.log('📅 Checking Amazon orders in current date range...\n');

  // Check the user's current date filter: 16.06.2025 - 16.07.2025
  const startDate = new Date('2025-06-16');
  const endDate = new Date('2025-07-16');
  
  console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);

  // Find Amazon orders in this date range
  const amazonOrders = await prisma.order.findMany({
    where: {
      AND: [
        {
          OR: [
            { marketplace: { contains: 'Amazon', mode: 'insensitive' } },
            { marketplace: { contains: 'amazon' } }
          ]
        },
        {
          OR: [
            {
              uiOrderDate: {
                gte: startDate,
                lte: endDate
              }
            },
            {
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            }
          ]
        }
      ]
    },
    select: {
      orderNumber: true,
      marketplace: true,
      customerName: true,
      createdAt: true,
      uiOrderDate: true,
      status: true
    },
    orderBy: {
      uiOrderDate: 'desc'
    },
    take: 10
  });

  console.log(`📦 Found ${amazonOrders.length} Amazon orders in date range:`);
  
  if (amazonOrders.length === 0) {
    console.log('❌ No Amazon orders found in the current date range!');
    console.log('This explains why they\'re not showing in the UI.\n');
    
    // Check when the most recent Amazon orders were
    const recentAmazon = await prisma.order.findMany({
      where: {
        OR: [
          { marketplace: { contains: 'Amazon', mode: 'insensitive' } },
          { marketplace: { contains: 'amazon' } }
        ]
      },
      select: {
        orderNumber: true,
        marketplace: true,
        customerName: true,
        createdAt: true,
        uiOrderDate: true
      },
      orderBy: {
        uiOrderDate: 'desc'
      },
      take: 5
    });
    
    console.log('📊 Most recent Amazon orders:');
    recentAmazon.forEach(order => {
      console.log(`  ${order.orderNumber} - ${order.marketplace} - ${order.uiOrderDate?.toISOString() || order.createdAt.toISOString()}`);
    });
    
  } else {
    amazonOrders.forEach(order => {
      console.log(`  ✅ ${order.orderNumber} - ${order.marketplace} - ${order.customerName} - ${order.uiOrderDate?.toISOString() || order.createdAt.toISOString()}`);
    });
  }

  // Check if the specific order the user mentioned exists at all
  const targetOrder = await prisma.order.findFirst({
    where: {
      orderNumber: '113-8445738-4457007'
    },
    select: {
      orderNumber: true,
      marketplace: true,
      customerName: true,
      createdAt: true,
      uiOrderDate: true
    }
  });

  if (targetOrder) {
    console.log(`\n🎯 Target order 113-8445738-4457007 found in database:`);
    console.log(`  Marketplace: ${targetOrder.marketplace}`);
    console.log(`  Customer: ${targetOrder.customerName}`);
    console.log(`  Created: ${targetOrder.createdAt.toISOString()}`);
    console.log(`  UI Date: ${targetOrder.uiOrderDate?.toISOString() || 'NULL'}`);
    
    const orderDate = targetOrder.uiOrderDate || targetOrder.createdAt;
    if (orderDate < startDate || orderDate > endDate) {
      console.log(`  ❌ Order is OUTSIDE current date filter range!`);
    } else {
      console.log(`  ✅ Order is WITHIN current date filter range`);
    }
  } else {
    console.log(`\n❌ Target order 113-8445738-4457007 NOT found in database`);
  }

  await prisma.$disconnect();
}

checkAmazonInDateRange().catch(console.error); 