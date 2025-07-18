import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Replicate the same getUiOrderDate logic from orderSync.ts
function getUiOrderDate(order: any): string {
  let safeRaw = order.rawData;
  if (typeof safeRaw === 'string') {
    try { safeRaw = JSON.parse(safeRaw); } catch { safeRaw = {}; }
  }
  
  // Try multiple date sources in order of preference
  const possibleDates = [
    safeRaw?.created_at,
    safeRaw?.to_address?.object_created,
    safeRaw?.placed_at,
    safeRaw?.to_address?.object_updated,
    order.created_at,
    order.order_date,
    order.ordered_at,
    order.marketplaceOrderDate,
    order.syncTimestamp,
    // NEW: Try additional Etsy/Veeqo specific date fields
    safeRaw?.ordered_at,
    safeRaw?.updated_at,
    safeRaw?.object_created,
    safeRaw?.date_created,
    // Fallback to current time instead of 1970 to avoid sorting issues
    new Date().toISOString()
  ];
  
  // Find the first valid date
  for (const dateStr of possibleDates) {
    if (dateStr && typeof dateStr === 'string') {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime()) && date.getFullYear() > 2020) {
        return date.toISOString();
      }
    }
  }
  
  // If all dates are invalid, use current time to avoid old dates appearing first
  return new Date().toISOString();
}

async function debugOrderDates() {
  console.log('Debugging order dates...\n');

  // Get some sample Etsy orders that might have date issues
  const etsyOrders = await prisma.order.findMany({
    where: {
      marketplace: 'Etsy'
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 10,
    select: {
      id: true,
      orderNumber: true,
      marketplace: true,
      createdAt: true,
      uiOrderDate: true,
      rawData: true
    }
  });

  console.log(`Found ${etsyOrders.length} Etsy orders to analyze:\n`);

  for (const order of etsyOrders) {
    console.log(`Order: ${order.orderNumber}`);
    console.log(`  Database createdAt: ${order.createdAt}`);
    console.log(`  Database uiOrderDate: ${order.uiOrderDate?.toISOString()}`);
    
    // Calculate what the new uiOrderDate would be
    const newUiOrderDate = getUiOrderDate(order);
    console.log(`  NEW calculated uiOrderDate: ${newUiOrderDate}`);
    
    // Check if there's a difference
    const currentDate = order.uiOrderDate?.toISOString();
    if (currentDate !== newUiOrderDate) {
      console.log(`  ❗ Date would change! Old: ${currentDate} -> New: ${newUiOrderDate}`);
    } else {
      console.log(`  ✅ Date is correct`);
    }
    
    console.log(''); // Empty line for readability
  }
  
  await prisma.$disconnect();
}

debugOrderDates().catch(console.error); 