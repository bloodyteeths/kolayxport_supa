import { PrismaClient } from '@prisma/client';
import { fetchVeeqoOrders } from '../lib/integrations/veeqo';
import { getIntegrationCreds } from '../lib/config';

const prisma = new PrismaClient();

async function debugSyncFiltering() {
  console.log('🔍 Debugging sync filtering logic...\n');

  try {
    // Get first user
    const firstUser = await prisma.user.findFirst({
      select: { id: true }
    });

    if (!firstUser) {
      console.log('❌ No users found');
      return;
    }

    const userId = firstUser.id;
    console.log(`📋 Using user ID: ${userId}\n`);
    
    const creds = await getIntegrationCreds(userId);
    
    if (!creds.veeqoApiKey) {
      console.log('❌ No Veeqo API key found');
      return;
    }

    // Fetch a few orders from Veeqo
    const veeqoOrders = await fetchVeeqoOrders({
      apiKey: creds.veeqoApiKey,
      page: 1,
      perPage: 5
    });

    console.log(`📦 Fetched ${veeqoOrders.length} orders from Veeqo\n`);

    // Simulate the sync filtering logic
    for (const order of veeqoOrders) {
      console.log(`\n=== PROCESSING ORDER: ${order.number || order.id} ===`);
      console.log(`Customer: ${order.deliver_to?.first_name} ${order.deliver_to?.last_name}`);
      console.log(`Channel: ${order.channel?.type_code || 'N/A'}`);
      console.log(`Status: ${order.status}`);
      
      // Check if order exists in database
      const existingOrder = await prisma.order.findFirst({
        where: {
          userId,
          marketplaceKey: String(order.id)
        },
        select: {
          id: true,
          marketplaceKey: true,
          orderNumber: true,
          status: true,
          externalStatus: true,
          totalPrice: true,
          customerName: true,
          uiOrderDate: true
        }
      });
      
      if (!existingOrder) {
        console.log(`✅ NEW ORDER - Should be created`);
      } else {
        console.log(`🔄 EXISTING ORDER - Checking for changes...`);
        console.log(`   DB Status: ${existingOrder.status} vs API Status: ${order.status}`);
        console.log(`   DB External Status: ${existingOrder.externalStatus} vs API: ${order.status}`);
        console.log(`   DB Customer: ${existingOrder.customerName}`);
        console.log(`   DB Total: ${existingOrder.totalPrice} vs API: ${order.total_price}`);
        console.log(`   DB UI Date: ${existingOrder.uiOrderDate}`);
        
        // Check if it would be processed
        const hasChanged = (
          (existingOrder.externalStatus !== order.status) ||
          (existingOrder.totalPrice !== order.total_price) ||
          (existingOrder.customerName !== `${order.deliver_to?.first_name || ''} ${order.deliver_to?.last_name || ''}`.trim())
        );
        const missingStatus = (!existingOrder.externalStatus && order.status);
        const missingUiOrderDate = !existingOrder.uiOrderDate;
        
        if (hasChanged || missingStatus || missingUiOrderDate) {
          console.log(`✅ WOULD BE PROCESSED (hasChanged=${hasChanged}, missingStatus=${missingStatus}, missingUiOrderDate=${missingUiOrderDate})`);
        } else {
          console.log(`❌ WOULD BE SKIPPED - no changes detected`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error during debug:', error);
  }

  await prisma.$disconnect();
}

debugSyncFiltering().catch(console.error); 