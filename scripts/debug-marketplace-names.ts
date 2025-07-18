import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMarketplaceNames() {
  console.log('📊 Checking marketplace names in database...\n');

  // Get unique marketplace names and their counts
  const marketplaces = await prisma.order.groupBy({
    by: ['marketplace'],
    _count: {
      marketplace: true
    },
    orderBy: {
      _count: {
        marketplace: 'desc'
      }
    }
  });

  console.log('Marketplace distribution:');
  marketplaces.forEach(({ marketplace, _count }) => {
    console.log(`  ${marketplace}: ${_count.marketplace} orders`);
  });

  // Check for Amazon-related orders specifically
  const amazonLikeOrders = await prisma.order.findMany({
    where: {
      OR: [
        { marketplace: { contains: 'amazon', mode: 'insensitive' } },
        { marketplace: { contains: 'Amazon' } },
        { orderNumber: { startsWith: '1' } }
      ]
    },
    select: {
      orderNumber: true,
      marketplace: true,
      customerName: true,
      rawData: true
    },
    take: 5
  });

  console.log(`\n🔍 Sample Amazon-like orders:`);
  amazonLikeOrders.forEach(order => {
    let channelInfo = 'No channel info';
    try {
      const raw = typeof order.rawData === 'string' ? JSON.parse(order.rawData) : order.rawData;
      channelInfo = raw?.channel?.type_code || raw?.channel?.name || 'No channel info';
    } catch (e) {
      channelInfo = 'Parse error';
    }
    
    console.log(`  ${order.orderNumber} - Marketplace: "${order.marketplace}" - Channel: ${channelInfo}`);
  });

  await prisma.$disconnect();
}

checkMarketplaceNames().catch(console.error); 