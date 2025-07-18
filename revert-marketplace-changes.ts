import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function revertMarketplaceChanges() {
  console.log('🔄 Reverting marketplace changes...\n');

  try {
    // Get the first user
    const user = await prisma.user.findFirst();
    if (!user) {
      console.log('❌ No user found');
      return;
    }

    console.log(`👤 Using user: ${user.id}\n`);

    // Find all Veeqo orders that were incorrectly changed
    const veeqoOrders = await prisma.order.findMany({
      where: {
        userId: user.id,
        marketplace: 'Veeqo'
      },
      include: {
        items: true
      }
    });

    console.log(`📊 Found ${veeqoOrders.length} orders with marketplace 'Veeqo'`);

    if (veeqoOrders.length === 0) {
      console.log('✅ No orders to revert');
      return;
    }

    // Revert based on rawData to restore original marketplace names
    let revertedCount = 0;
    let errorCount = 0;

    for (const order of veeqoOrders) {
      try {
        let originalMarketplace = 'Veeqo'; // Default fallback
        
        if (order.rawData) {
          try {
            const rawData = typeof order.rawData === 'string' ? JSON.parse(order.rawData) : order.rawData;
            
            // Extract original marketplace from rawData
            if (rawData.channel?.name) {
              originalMarketplace = rawData.channel.name;
            } else if (rawData.shop_app) {
              originalMarketplace = rawData.shop_app;
            } else if (rawData.marketplace) {
              originalMarketplace = rawData.marketplace;
            }
          } catch (e) {
            console.log(`⚠️ Could not parse rawData for order ${order.orderNumber}, keeping as Veeqo`);
            continue;
          }
        }

        if (originalMarketplace !== 'Veeqo') {
          console.log(`🔄 Reverting order ${order.orderNumber}: "Veeqo" -> "${originalMarketplace}"`);
          
          await prisma.order.update({
            where: { id: order.id },
            data: { marketplace: originalMarketplace }
          });
          
          revertedCount++;
        } else {
          console.log(`⏭️ Keeping order ${order.orderNumber} as "Veeqo" (no original marketplace found)`);
        }
      } catch (error) {
        console.error(`❌ Error reverting order ${order.orderNumber}:`, error);
        errorCount++;
      }
    }

    console.log(`\n📊 Revert Summary:`);
    console.log(`  Reverted: ${revertedCount} orders`);
    console.log(`  Errors: ${errorCount} orders`);
    console.log(`  Kept as Veeqo: ${veeqoOrders.length - revertedCount - errorCount} orders`);

  } catch (error) {
    console.error('❌ Error during marketplace revert:', error);
  } finally {
    await prisma.$disconnect();
  }
}

revertMarketplaceChanges(); 