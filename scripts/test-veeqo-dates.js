const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');
const prisma = new PrismaClient();

async function testVeeqoDates() {
  try {
    const userId = 'f0cb1c43-f30d-4f31-9a96-a9940ebada2d';
    
    const credentials = await prisma.credential.findUnique({
      where: { userId }
    });
    
    if (!credentials?.veeqoApiKey) {
      console.log('❌ No Veeqo API key found');
      return;
    }
    
    const veeqoApiKey = credentials.veeqoApiKey;
    
    console.log('=== TESTING VEEQO DATE FILTERING ===');
    
    // Test 1: No date filter (get any orders)
    console.log('\n--- Test 1: No date filter ---');
    try {
      const response1 = await fetch('https://api.veeqo.com/orders?page_size=5', {
        headers: {
          'x-api-key': veeqoApiKey,
          'Content-Type': 'application/json'
        }
      });
      
      if (response1.status === 200) {
        const data1 = await response1.json();
        console.log('✅ Orders without filter:', data1.orders?.length || 0);
        if (data1.orders?.length > 0) {
          console.log('Latest order:', data1.orders[0].number, 'updated:', data1.orders[0].updated_at);
        }
      } else {
        console.log('❌ Failed:', response1.status);
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
    
    // Test 2: Recent date filter (last 7 days)
    console.log('\n--- Test 2: Last 7 days ---');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const formattedDate = sevenDaysAgo.toISOString().replace('T', ' ').substring(0, 19);
    
    try {
      const response2 = await fetch(`https://api.veeqo.com/orders?page_size=5&updated_at_min=${encodeURIComponent(formattedDate)}`, {
        headers: {
          'x-api-key': veeqoApiKey,
          'Content-Type': 'application/json'
        }
      });
      
      if (response2.status === 200) {
        const data2 = await response2.json();
        console.log('✅ Orders in last 7 days:', data2.orders?.length || 0);
        console.log('Date filter used:', formattedDate);
      } else {
        console.log('❌ Failed:', response2.status);
        console.log('Response:', await response2.text());
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
    
    // Test 3: Check last sync time
    console.log('\n--- Test 3: Check last sync time ---');
    const lastSync = await prisma.syncOperation.findFirst({
      where: {
        userId,
        status: 'completed'
      },
      orderBy: { createdAt: 'desc' }
    });
    
    if (lastSync) {
      console.log('Last successful sync:', lastSync.createdAt);
      const lastSyncFormatted = lastSync.createdAt.toISOString().replace('T', ' ').substring(0, 19);
      console.log('Formatted for Veeqo:', lastSyncFormatted);
      
      try {
        const response3 = await fetch(`https://api.veeqo.com/orders?page_size=5&updated_at_min=${encodeURIComponent(lastSyncFormatted)}`, {
          headers: {
            'x-api-key': veeqoApiKey,
            'Content-Type': 'application/json'
          }
        });
        
        if (response3.status === 200) {
          const data3 = await response3.json();
          console.log('✅ Orders since last sync:', data3.orders?.length || 0);
        } else {
          console.log('❌ Failed:', response3.status);
        }
      } catch (error) {
        console.log('❌ Error:', error.message);
      }
    } else {
      console.log('No completed sync operations found');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testVeeqoDates();