#!/usr/bin/env tsx

/**
 * Test Paraşüt invoice flow end-to-end
 * Usage: tsx scripts/test-parasut-flow.ts
 */

import { InvoiceService } from '../lib/services/invoiceService';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function testParasutFlow() {
  console.log('🧪 Testing Paraşüt Invoice Flow...\n');

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

    // 2. Check if user has Paraşüt credentials
    const credential = await prisma.credential.findFirst({
      where: { userId: testUser.id },
      select: {
        parasutClientId: true,
        parasutClientSecret: true,
        parasutUsername: true,
        parasutPassword: true,
        parasutCompanyId: true
      }
    });

    if (!credential || !credential.parasutClientId || !credential.parasutClientSecret || 
        !credential.parasutUsername || !credential.parasutPassword || !credential.parasutCompanyId) {
      console.log('⚠️  No Paraşüt credentials found for user');
      console.log('📋 To test Paraşüt integration:');
      console.log('   1. Sign up for Paraşüt developer account: https://www.parasut.com/developers');
      console.log('   2. Get your credentials:');
      console.log('      - Client ID');
      console.log('      - Client Secret');
      console.log('      - Username');
      console.log('      - Password');
      console.log('      - Company ID (from URL after login)');
      console.log('   3. Add them to your credential record in database');
      console.log();
      console.log('🔧 Example SQL to add credentials:');
      console.log(`UPDATE "Credential" SET`);
      console.log(`  "parasutClientId" = 'your-client-id',`);
      console.log(`  "parasutClientSecret" = 'your-client-secret',`);
      console.log(`  "parasutUsername" = 'your-username',`);
      console.log(`  "parasutPassword" = 'your-password',`);
      console.log(`  "parasutCompanyId" = 'your-company-id'`);
      console.log(`WHERE "userId" = '${testUser.id}';`);
      console.log();
      console.log('💡 For sandbox testing, use sandbox.parasut.com credentials');
      return;
    }

    console.log('✅ Found Paraşüt credentials');

    // 3. Create test order data
    const testOrder = {
      id: 'test-order-123',
      userId: testUser.id,
      marketplace: 'test',
      marketplaceKey: 'test-order-123',
      customerName: 'Test Customer',
      status: 'pending',
      currency: 'TRL',
      totalPrice: 150.00,
      createdAt: new Date(),
      updatedAt: new Date(),
      orderNumber: 'TEST-001',
      shippingAddress: {
        name: 'Ahmet Test',
        email: 'test@example.com',
        phone: '+90 555 123 4567',
        address1: '123 Test Sokak',
        address2: 'Test Mahallesi',
        city: 'Istanbul',
        state: 'Istanbul',
        country: 'Türkiye',
        country_code: 'TR',
        postal_code: '34000'
      },
      commodityDesc: 'Test Product',
      items: [
        {
          id: 'item-1',
          orderId: 'test-order-123',
          productName: 'Test Product 1',
          sku: 'TEST-001',
          quantity: 2,
          unitPrice: 50.00,
          totalPrice: 100.00
        },
        {
          id: 'item-2',
          orderId: 'test-order-123',
          productName: 'Test Product 2',
          sku: 'TEST-002',
          quantity: 1,
          unitPrice: 50.00,
          totalPrice: 50.00
        }
      ]
    } as any;

    console.log('📦 Test order created with 2 items, total: ₺150.00');

    // 4. Initialize invoice service
    const invoiceService = new InvoiceService();

    // 5. Generate invoice
    console.log('\n🧾 Generating Paraşüt invoice...');
    
    const result = await invoiceService.generateInvoicesForOrders([testOrder], testUser.id);

    if (result.success && result.invoices.length > 0) {
      console.log('✅ Invoice generated successfully!');
      
      result.invoices.forEach((invoice, index) => {
        console.log(`\n📋 Invoice ${index + 1}:`);
        console.log(`   Invoice ID: ${invoice.invoiceId}`);
        console.log(`   Invoice No: ${invoice.invoiceNo}`);
        console.log(`   PDF URL: ${invoice.pdfUrl || 'Not available'}`);
        console.log(`   UBL URL: ${invoice.ublUrl || 'Not available'}`);
        
        if (invoice.localPdfPath) {
          console.log(`   Local PDF: ${invoice.localPdfPath}`);
        }
      });

      console.log(`\n📎 Attachments ready: ${result.attachments.length}`);
      result.attachments.forEach((att, index) => {
        console.log(`   ${index + 1}. ${att.filename} (${att.contentType})`);
      });

      console.log('\n✅ Test completed successfully!');
      console.log('💡 Check your Paraşüt dashboard to see the generated invoice');
      
    } else {
      console.error('❌ Invoice generation failed:');
      console.error(result.errorMessage);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testParasutFlow()
  .then(() => {
    console.log('\n🏁 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });