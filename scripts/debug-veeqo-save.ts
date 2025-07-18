import { PrismaClient } from '@prisma/client';
import { fetchVeeqoOrders } from '../lib/integrations/veeqo';
import { getIntegrationCreds } from '../lib/config';

const prisma = new PrismaClient();

// Replicate the determineChannel function from orderSync.ts
function determineChannel(order: any): string {
  // Check Veeqo structure
  const veeqoChannelType = order.channel?.type_code?.toLowerCase();
  if (veeqoChannelType) {
    if (veeqoChannelType.includes('etsy')) return 'etsy';
    if (veeqoChannelType.includes('shopify')) return 'shopify';
    if (veeqoChannelType.includes('amazon')) {
      console.log(`[AMAZON DEBUG] Veeqo order ${order.number || order.id} detected as Amazon channel: ${veeqoChannelType}`);
      return 'amazon';
    }
    if (veeqoChannelType.includes('ebay')) return 'ebay';
  }
  
  return 'other';
}

// Replicate the validateAndMapOrder function logic for Amazon orders
function debugVeeqoOrder(order: any) {
  const channel = determineChannel(order);
  const marketplace = order.channel?.name || 'Veeqo';
  
  console.log(`\n=== VEEQO ORDER DEBUG ===`);
  console.log(`Order ID: ${order.id}`);
  console.log(`Order Number: ${order.number}`);
  console.log(`Status: ${order.status}`);
  console.log(`Channel Type Code: ${order.channel?.type_code || 'N/A'}`);
  console.log(`Channel Name: ${order.channel?.name || 'N/A'}`);
  console.log(`Determined Channel: ${channel}`);
  console.log(`Marketplace (will be saved as): ${marketplace}`);
  console.log(`Customer: ${order.deliver_to?.first_name} ${order.deliver_to?.last_name}`);
  console.log(`Line Items: ${order.line_items?.length || 0}`);
  
  // Check if this is Amazon
  if (channel === 'amazon') {
    console.log(`🎯 THIS IS AN AMAZON ORDER!`);
    console.log(`   Raw channel object:`, JSON.stringify(order.channel, null, 2));
  }
  
  return { channel, marketplace };
}

async function debugVeeqoAmazonSave() {
  console.log('🔍 Debugging Veeqo Amazon order save process...\n');

  try {
    // Get the first user with any credentials
    const firstUser = await prisma.user.findFirst({
      select: {
        id: true
      }
    });

    if (!firstUser) {
      console.log('❌ No users found');
      return;
    }

    const testUserId = firstUser.id;
    console.log(`📋 Using user ID: ${testUserId}`);
    
    const creds = await getIntegrationCreds(testUserId);
    
    if (!creds.veeqoApiKey) {
      console.log('❌ No Veeqo API key found');
      return;
    }

    console.log('✅ Found Veeqo credentials, fetching orders...\n');

    // Fetch just a small sample of orders
    const veeqoOrders = await fetchVeeqoOrders({
      apiKey: creds.veeqoApiKey,
      page: 1,
      perPage: 20
    });

    console.log(`📦 Fetched ${veeqoOrders.length} orders from Veeqo\n`);

    let amazonCount = 0;
    let totalCount = 0;

    for (const order of veeqoOrders) {
      totalCount++;
      const { channel } = debugVeeqoOrder(order);
      
      if (channel === 'amazon') {
        amazonCount++;
        
        // Check if this order exists in the database
        const existingOrder = await prisma.order.findFirst({
          where: {
            userId: testUserId,
            marketplaceKey: String(order.id)
          }
        });
        
        if (existingOrder) {
          console.log(`   ✅ Found in database with marketplace: ${existingOrder.marketplace}`);
        } else {
          console.log(`   ❌ NOT FOUND in database`);
        }
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`Total orders fetched: ${totalCount}`);
    console.log(`Amazon orders detected: ${amazonCount}`);
    
    if (amazonCount === 0) {
      console.log(`\n❗ No Amazon orders found in Veeqo API response`);
      console.log(`This might explain why they're not appearing in the database`);
    }

  } catch (error) {
    console.error('❌ Error during debug:', error);
  }

  await prisma.$disconnect();
}

debugVeeqoAmazonSave().catch(console.error); 