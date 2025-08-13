#!/usr/bin/env tsx

/**
 * Test script for ETGB flow
 * Usage: tsx scripts/test-etgb-flow.ts
 */

import { EtgbService } from '../lib/services/etgbService';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function testEtgbFlow() {
  console.log('🧪 Testing ETGB Flow...\n');

  try {
    // 1. Find a test user
    const testUser = await prisma.user.findFirst({
      select: { id: true, email: true, name: true }
    });

    if (!testUser) {
      console.error('❌ No users found in database. Please create a test user first.');
      return;
    }

    console.log(`✅ Found test user: ${testUser.name} (${testUser.email})`);

    // 2. Find some test orders
    const testOrders = await prisma.order.findMany({
      where: { userId: testUser.id },
      include: { items: true },
      take: 3 // Limit to 3 orders for testing
    });

    if (testOrders.length === 0) {
      console.error('❌ No orders found for test user. Please sync some orders first.');
      return;
    }

    console.log(`✅ Found ${testOrders.length} test orders`);

    // 3. Check SMTP configuration
    const smtpConfigured = !!(
      process.env.ETGB_SMTP_HOST && 
      process.env.ETGB_SMTP_USER && 
      process.env.ETGB_SMTP_PASS
    );
    
    console.log(`📧 SMTP configured: ${smtpConfigured ? '✅ Yes' : '❌ No'}`);
    
    if (!smtpConfigured) {
      console.log('⚠️  SMTP not configured. Add to .env.local:');
      console.log('   ETGB_SMTP_HOST=smtp.gmail.com');
      console.log('   ETGB_SMTP_PORT=587');
      console.log('   ETGB_SMTP_SECURE=false');
      console.log('   ETGB_SMTP_USER=your-email@gmail.com');
      console.log('   ETGB_SMTP_PASS=your-app-password');
      console.log();
    }

    // 4. Check user settings for ETGB email
    const userSettings = await prisma.user.findUnique({
      where: { id: testUser.id },
      select: { shippingSettings: true }
    });

    const settings = userSettings?.shippingSettings as any;
    const etgbEmail = settings?.etgbRecipientEmail;

    console.log(`📧 ETGB recipient email: ${etgbEmail || 'Not configured'}`);

    // 5. Initialize ETGB service
    const etgbService = new EtgbService();

    // 6. Process orders
    console.log('\n🚀 Processing ETGB batch...');
    
    const testEmailRecipient = process.env.ETGB_TEST_EMAIL || etgbEmail || 'test@example.com';
    console.log(`📬 Sending to: ${testEmailRecipient}`);
    
    const result = await etgbService.processOrderBatch(
      testOrders,
      testUser.id,
      testEmailRecipient
    );

    if (result.success) {
      console.log('✅ ETGB processing completed successfully!');
      console.log(`📁 Excel file: ${result.excelFile.fileName}`);
      console.log(`📧 Email status: ${result.emailResult.status}`);
      console.log(`🆔 Batch ID: ${result.batchId}`);
    } else {
      console.error('❌ ETGB processing failed:');
      console.error(result.errorMessage);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testEtgbFlow()
  .then(() => {
    console.log('\n🏁 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });