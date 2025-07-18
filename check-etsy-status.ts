import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkEtsyStatus() {
  console.log('🔍 ETSY ORDER STATUS CHECK...\n');

  try {
    console.log('📋 STEP 1: Overall Etsy order statistics...\n');
    
    // Get overall Etsy stats
    const totalEtsyOrders = await prisma.order.count({
      where: {
        marketplace: { contains: 'etsy', mode: 'insensitive' }
      }
    });

    const totalEtsyItems = await prisma.orderItem.count({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        }
      }
    });

    const etsyItemsWithImages = await prisma.orderItem.count({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        },
        image: { not: { equals: '' } }
      }
    });

    const etsyItemsWithoutImages = await prisma.orderItem.count({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        },
        image: { equals: '' }
      }
    });

    const etsyItemsWithSku = await prisma.orderItem.count({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        },
        sku: { not: { equals: '' } }
      }
    });

    const etsyItemsWithoutSku = await prisma.orderItem.count({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        },
        OR: [
          { sku: { equals: '' } },
          { sku: null }
        ]
      }
    });

    console.log(`📊 ETSY STATISTICS:`);
    console.log(`   Total Etsy Orders: ${totalEtsyOrders}`);
    console.log(`   Total Etsy Items: ${totalEtsyItems}`);
    console.log(`   Items WITH images: ${etsyItemsWithImages} (${totalEtsyItems > 0 ? Math.round((etsyItemsWithImages / totalEtsyItems) * 100) : 0}%)`);
    console.log(`   Items WITHOUT images: ${etsyItemsWithoutImages} (${totalEtsyItems > 0 ? Math.round((etsyItemsWithoutImages / totalEtsyItems) * 100) : 0}%)`);
    console.log(`   Items WITH SKU: ${etsyItemsWithSku} (${totalEtsyItems > 0 ? Math.round((etsyItemsWithSku / totalEtsyItems) * 100) : 0}%)`);
    console.log(`   Items WITHOUT SKU: ${etsyItemsWithoutSku} (${totalEtsyItems > 0 ? Math.round((etsyItemsWithoutSku / totalEtsyItems) * 100) : 0}%)`);

    console.log('\n📋 STEP 2: Sample Etsy items without images...\n');

    // Get sample Etsy items without images
    const sampleEtsyItems = await prisma.orderItem.findMany({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        },
        image: { equals: '' }
      },
      include: {
        order: {
          select: {
            orderNumber: true,
            marketplace: true,
            customerName: true
          }
        }
      },
      take: 10
    });

    console.log(`📦 Sample of ${sampleEtsyItems.length} Etsy items without images:`);
    for (const item of sampleEtsyItems) {
      console.log(`   🛍️ Order ${item.order.orderNumber}: "${item.productName}" | SKU: "${item.sku || 'NO SKU'}" | Customer: ${item.order.customerName}`);
    }

    console.log('\n📋 STEP 3: Veeqo order statistics...\n');

    const totalVeeqoOrders = await prisma.order.count({
      where: { marketplace: 'Veeqo' }
    });

    const totalVeeqoItems = await prisma.orderItem.count({
      where: {
        order: { marketplace: 'Veeqo' }
      }
    });

    const veeqoItemsWithImages = await prisma.orderItem.count({
      where: {
        order: { marketplace: 'Veeqo' },
        image: { not: { equals: '' } }
      }
    });

    console.log(`📊 VEEQO STATISTICS:`);
    console.log(`   Total Veeqo Orders: ${totalVeeqoOrders}`);
    console.log(`   Total Veeqo Items: ${totalVeeqoItems}`);
    console.log(`   Items WITH images: ${veeqoItemsWithImages} (${totalVeeqoItems > 0 ? Math.round((veeqoItemsWithImages / totalVeeqoItems) * 100) : 0}%)`);

    console.log('\n📋 STEP 4: SKU overlap analysis...\n');

    // Get unique SKUs from Etsy items without images
    const etsySkusWithoutImages = await prisma.orderItem.findMany({
      where: {
        order: {
          marketplace: { contains: 'etsy', mode: 'insensitive' }
        },
        image: { equals: '' },
        sku: { not: { equals: '' } }
      },
      select: {
        sku: true,
        productName: true
      },
      distinct: ['sku']
    });

    // Get unique SKUs from Veeqo items with images
    const veeqoSkusWithImages = await prisma.orderItem.findMany({
      where: {
        order: { marketplace: 'Veeqo' },
        image: { not: { equals: '' } },
        sku: { not: { equals: '' } }
      },
      select: {
        sku: true,
        productName: true,
        image: true
      },
      distinct: ['sku']
    });

    const etsySkuSet = new Set(etsySkusWithoutImages.map(item => item.sku).filter(Boolean));
    const veeqoSkuSet = new Set(veeqoSkusWithImages.map(item => item.sku).filter(Boolean));
    
    const commonSkus = [...etsySkuSet].filter(sku => veeqoSkuSet.has(sku));

    console.log(`🏷️ SKU OVERLAP ANALYSIS:`);
    console.log(`   Etsy items without images (with SKU): ${etsySkusWithoutImages.length}`);
    console.log(`   Veeqo items with images (with SKU): ${veeqoSkusWithImages.length}`);
    console.log(`   Common SKUs: ${commonSkus.length}`);

    if (commonSkus.length > 0) {
      console.log(`\n📋 Common SKUs that could be unified:`);
      for (const sku of commonSkus.slice(0, 5)) {
        const etsyItem = etsySkusWithoutImages.find(item => item.sku === sku);
        const veeqoItem = veeqoSkusWithImages.find(item => item.sku === sku);
        console.log(`   🔗 SKU: ${sku}`);
        console.log(`      Etsy: ${etsyItem?.productName || 'Unknown'}`);
        console.log(`      Veeqo: ${veeqoItem?.productName || 'Unknown'} (${veeqoItem?.image?.substring(0, 50)}...)`);
      }
    }

    console.log('\n📋 STEP 5: Recent orders check...\n');

    // Check recent orders
    const recentEtsyOrders = await prisma.order.findMany({
      where: {
        marketplace: { contains: 'etsy', mode: 'insensitive' },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      include: {
        items: {
          select: {
            id: true,
            productName: true,
            sku: true,
            image: true
          }
        }
      },
      take: 5
    });

    console.log(`📦 Recent Etsy orders (last 24h): ${recentEtsyOrders.length}`);
    for (const order of recentEtsyOrders) {
      const itemsWithImages = order.items.filter(item => item.image && item.image !== '');
      const itemsWithoutImages = order.items.filter(item => !item.image || item.image === '');
      console.log(`   📦 Order ${order.orderNumber}: ${order.items.length} items (${itemsWithImages.length} with images, ${itemsWithoutImages.length} without)`);
    }

  } catch (error) {
    console.error('💥 Check failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkEtsyStatus().catch(console.error); 