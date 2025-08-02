#!/usr/bin/env tsx

/**
 * Debug script to fetch a specific Trendyol order payload
 * Usage: tsx debug-trendyol-specific-order.ts
 */

import prisma from './lib/prisma';
import { fetchTrendyolOrders } from './lib/integrations/trendyolClient';

async function debugSpecificTrendyolOrder() {
  try {
    console.log('🔍 Fetching Trendyol credentials...');
    
    // Get Trendyol credentials from database
    const credentials = await prisma.credential.findFirst({
      where: {
        AND: [
          { trendyolApiKey: { not: null } },
          { trendyolApiSecret: { not: null } },
          { trendyolSupplierId: { not: null } }
        ]
      },
      select: {
        userId: true,
        trendyolApiKey: true,
        trendyolApiSecret: true,
        trendyolSupplierId: true
      }
    });

    if (!credentials || !credentials.trendyolApiKey || !credentials.trendyolApiSecret || !credentials.trendyolSupplierId) {
      console.error('❌ No Trendyol credentials found in database');
      return;
    }

    console.log('✅ Found Trendyol credentials for user:', credentials.userId);
    console.log('📋 Supplier ID:', credentials.trendyolSupplierId);

    // Target order number to investigate
    const targetOrderNumber = '10391393399';
    
    console.log(`\n🎯 Looking for order: ${targetOrderNumber}`);
    console.log('📦 Fetching recent Trendyol orders...');

    // Fetch recent orders to find the specific one
    const orders = await fetchTrendyolOrders({
      supplierId: credentials.trendyolSupplierId,
      apiKey: credentials.trendyolApiKey,
      apiSecret: credentials.trendyolApiSecret,
      startDateMs: null,
      endDateMs: null,
      pageSize: 100
    });

    console.log(`📊 Total orders fetched: ${orders.length}`);

    // Find the specific order
    const targetOrder = orders.find(order => 
      order.orderNumber === targetOrderNumber || 
      String(order.id) === targetOrderNumber
    );

    if (!targetOrder) {
      console.log(`❌ Order ${targetOrderNumber} not found in recent orders.`);
      console.log('📋 Available order numbers in recent fetch:');
      orders.slice(0, 10).forEach((order, index) => {
        console.log(`  ${index + 1}. ${order.orderNumber} (ID: ${order.id}) - ${new Date(order.orderDate).toLocaleDateString()}`);
      });
      
      // Show the most recent order as fallback
      if (orders.length > 0) {
        console.log('\n🔄 Using most recent order instead:');
        const recentOrder = orders[0];
        console.log(`📋 Order Number: ${recentOrder.orderNumber}`);
        console.log(`🆔 Order ID: ${recentOrder.id}`);
        console.log(`📅 Order Date: ${new Date(recentOrder.orderDate).toISOString()}`);
        console.log('\n📄 FULL ORDER PAYLOAD:');
        console.log('='.repeat(80));
        console.log(JSON.stringify(recentOrder, null, 2));
        console.log('='.repeat(80));
        
        // Analyze date fields
        console.log('\n🕐 DATE FIELD ANALYSIS:');
        analyzeOrderDates(recentOrder);
      }
      return;
    }

    console.log(`✅ Found target order: ${targetOrder.orderNumber}`);
    console.log(`🆔 Order ID: ${targetOrder.id}`);
    console.log(`📅 Order Date: ${new Date(targetOrder.orderDate).toISOString()}`);

    console.log('\n📄 FULL ORDER PAYLOAD:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(targetOrder, null, 2));
    console.log('='.repeat(80));

    // Analyze date fields
    console.log('\n🕐 DATE FIELD ANALYSIS:');
    analyzeOrderDates(targetOrder);

  } catch (error) {
    console.error('❌ Error fetching Trendyol order:', error);
  } finally {
    await prisma.$disconnect();
  }
}

function analyzeOrderDates(order: any) {
  const dateFields = [
    'orderDate',
    'lastModifiedDate',
    'originShipmentDate',
    'agreedDeliveryDate',
    'estimatedDeliveryStartDate',
    'estimatedDeliveryEndDate',
    'extendedAgreedDeliveryDate',
    'agreedDeliveryExtensionEndDate',
    'agreedDeliveryExtensionStartDate'
  ];

  console.log('📊 All date fields in order:');
  dateFields.forEach(field => {
    if (order[field] && order[field] !== 0) {
      const date = new Date(order[field]);
      const daysDiff = order.orderDate ? Math.round((order[field] - order.orderDate) / (1000 * 60 * 60 * 24)) : 0;
      console.log(`  ${field}: ${date.toISOString()} (${daysDiff > 0 ? '+' : ''}${daysDiff} days from order)`);
    } else {
      console.log(`  ${field}: null/0`);
    }
  });

  // Check if order has package histories with shipping info
  if (order.packageHistories && order.packageHistories.length > 0) {
    console.log('\n📦 PACKAGE HISTORY:');
    order.packageHistories.forEach((history: any, index: number) => {
      console.log(`  ${index + 1}. Status: ${history.status}, Date: ${new Date(history.createdDate).toISOString()}`);
    });
  }

  // Check cargo information
  if (order.cargoProviderName || order.cargoTrackingNumber) {
    console.log('\n🚚 CARGO INFO:');
    console.log(`  Provider: ${order.cargoProviderName || 'N/A'}`);
    console.log(`  Tracking: ${order.cargoTrackingNumber || 'N/A'}`);
    console.log(`  Sender Number: ${order.cargoSenderNumber || 'N/A'}`);
  }
}

// Run the debug function
debugSpecificTrendyolOrder().catch(console.error);