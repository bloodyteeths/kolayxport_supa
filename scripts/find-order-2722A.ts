#!/usr/bin/env tsx
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findOrder2722A() {
  console.log('🔍 Searching for order #2722-A...\n');
  
  const userId = 'f0cb1c43-f30d-4f31-9a96-a9940ebada2d';
  
  try {
    // Search for the specific order
    const order = await prisma.order.findFirst({
      where: {
        userId,
        orderNumber: '#2722-A'
      },
      include: {
        items: true
      }
    });
    
    if (order) {
      console.log('✅ FOUND ORDER #2722-A:');
      console.log(`  - ID: ${order.id}`);
      console.log(`  - Marketplace: ${order.marketplace}`);
      console.log(`  - Status: ${order.status}`);
      console.log(`  - Customer: ${order.customerName}`);
      console.log(`  - Total Price: ${order.totalPrice} ${order.currency}`);
      console.log(`  - Created: ${order.createdAt}`);
      console.log(`  - uiOrderDate: ${order.uiOrderDate}`);
      console.log(`  - Has shipping address: ${!!order.shippingAddress}`);
      console.log(`  - Order Items: ${order.items.length}`);
      
      if (order.items.length > 0) {
        console.log('\n  Items:');
        order.items.forEach((item, idx) => {
          console.log(`    ${idx + 1}. ${item.productName} (Qty: ${item.quantity})`);
        });
      }
    } else {
      console.log('❌ ORDER #2722-A NOT FOUND');
      
      // Check if there are any orders with similar numbers
      console.log('\n🔍 Searching for similar order numbers...');
      const similarOrders = await prisma.order.findMany({
        where: {
          userId,
          orderNumber: {
            contains: '2722'
          }
        },
        select: {
          orderNumber: true,
          marketplace: true,
          status: true,
          createdAt: true
        }
      });
      
      if (similarOrders.length > 0) {
        console.log(`Found ${similarOrders.length} orders containing "2722":`);
        similarOrders.forEach(o => {
          console.log(`  - ${o.orderNumber} (${o.marketplace}) - ${o.status} - Created: ${o.createdAt}`);
        });
      } else {
        console.log('No orders found containing "2722"');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findOrder2722A().catch(console.error);