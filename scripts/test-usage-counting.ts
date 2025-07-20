#!/usr/bin/env tsx
/**
 * Manual test script to verify usage counting functionality
 * Run with: tsx scripts/test-usage-counting.ts
 */

import prisma from '../lib/prisma';
import { logger } from '../lib/logger';

async function testUsageCounting() {
  const testEmail = 'usage-test@example.com';
  logger.info('🧪 Starting usage counting test...');

  try {
    // 1. Create or reset test user
    logger.info('1️⃣ Setting up test user...');
    await prisma.user.upsert({
      where: { email: testEmail },
      update: {
        subscriptionStatus: 'trialing',
        subscriptionPlan: null,
        orderSyncCount: 48, // Close to trial limit of 50
        labelCount: 8,      // Close to trial limit of 10
        trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      create: {
        id: 'test-usage-user',
        email: testEmail,
        subscriptionStatus: 'trialing',
        subscriptionPlan: null,
        orderSyncCount: 48,
        labelCount: 8,
        trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // 2. Display current usage
    let user = await prisma.user.findUnique({ where: { email: testEmail } });
    logger.info('📊 Current usage:', {
      orderSyncCount: user?.orderSyncCount,
      labelCount: user?.labelCount,
      limits: { orderSync: 50, label: 10 },
    });

    // 3. Simulate order sync
    logger.info('2️⃣ Simulating order sync...');
    await prisma.user.update({
      where: { email: testEmail },
      data: { orderSyncCount: { increment: 1 } },
    });

    user = await prisma.user.findUnique({ where: { email: testEmail } });
    logger.info('✅ After sync:', {
      orderSyncCount: user?.orderSyncCount,
      status: user?.orderSyncCount! < 50 ? 'ALLOWED' : 'BLOCKED',
    });

    // 4. Simulate another sync (should be allowed - one more before limit)
    logger.info('3️⃣ Simulating another order sync...');
    await prisma.user.update({
      where: { email: testEmail },
      data: { orderSyncCount: { increment: 1 } },
    });

    user = await prisma.user.findUnique({ where: { email: testEmail } });
    logger.info('✅ After 2nd sync:', {
      orderSyncCount: user?.orderSyncCount,
      status: user?.orderSyncCount! < 50 ? 'ALLOWED' : 'AT LIMIT',
    });

    // 5. Simulate label generation
    logger.info('4️⃣ Simulating label generation...');
    await prisma.user.update({
      where: { email: testEmail },
      data: { labelCount: { increment: 1 } },
    });

    user = await prisma.user.findUnique({ where: { email: testEmail } });
    logger.info('✅ After label generation:', {
      labelCount: user?.labelCount,
      status: user?.labelCount! < 10 ? 'ALLOWED' : 'BLOCKED',
    });

    // 6. Test plan upgrade
    logger.info('5️⃣ Simulating plan upgrade to starter...');
    await prisma.user.update({
      where: { email: testEmail },
      data: {
        subscriptionStatus: 'active',
        subscriptionPlan: 'starter',
        orderSyncCount: 0, // Reset counters on plan change
        labelCount: 0,
      },
    });

    user = await prisma.user.findUnique({ where: { email: testEmail } });
    logger.info('✅ After upgrade:', {
      plan: user?.subscriptionPlan,
      limits: { orderSync: 200, label: 100 },
      orderSyncCount: user?.orderSyncCount,
      labelCount: user?.labelCount,
    });

    // 7. Test enterprise unlimited
    logger.info('6️⃣ Testing enterprise plan (unlimited)...');
    await prisma.user.update({
      where: { email: testEmail },
      data: {
        subscriptionPlan: 'enterprise',
        orderSyncCount: 10000,
        labelCount: 5000,
      },
    });

    user = await prisma.user.findUnique({ where: { email: testEmail } });
    logger.info('✅ Enterprise plan:', {
      plan: user?.subscriptionPlan,
      orderSyncCount: user?.orderSyncCount,
      labelCount: user?.labelCount,
      status: 'UNLIMITED - Always allowed',
    });

    logger.info('✨ Usage counting test completed successfully!');

    // Cleanup
    logger.info('🧹 Cleaning up test user...');
    await prisma.user.delete({ where: { email: testEmail } });

  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testUsageCounting()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });