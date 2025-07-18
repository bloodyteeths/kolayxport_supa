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

async function fixMissingDates() {
  console.log('🔧 Fixing missing uiOrderDate values...\n');

  // Find all orders with missing uiOrderDate
  const ordersWithMissingDates = await prisma.order.findMany({
    where: {
      uiOrderDate: null
    },
    select: {
      id: true,
      orderNumber: true,
      marketplace: true,
      createdAt: true,
      rawData: true
    }
  });

  console.log(`Found ${ordersWithMissingDates.length} orders with missing uiOrderDate\n`);

  if (ordersWithMissingDates.length === 0) {
    console.log('✅ No orders need fixing!');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const order of ordersWithMissingDates) {
    try {
      const newUiOrderDate = getUiOrderDate(order);
      
      await prisma.order.update({
        where: { id: order.id },
        data: { uiOrderDate: new Date(newUiOrderDate) }
      });
      
      console.log(`✅ Fixed ${order.marketplace} order ${order.orderNumber}: ${newUiOrderDate}`);
      updated++;
    } catch (error) {
      console.error(`❌ Failed to update order ${order.orderNumber}:`, error.message);
      errors++;
    }
  }

  console.log(`\n🎉 Update completed!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Errors: ${errors}`);
  
  await prisma.$disconnect();
}

fixMissingDates().catch(console.error); 