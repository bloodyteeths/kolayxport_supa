import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function initializeSubscriptionData() {
  console.log('Initializing subscription data for existing users...');
  
  try {
    // Find users without subscription data
    const usersWithoutSubscription = await prisma.user.findMany({
      where: {
        OR: [
          { subscriptionPlan: null },
          { subscriptionStatus: null },
          { usageResetAt: null }
        ]
      }
    });

    console.log(`Found ${usersWithoutSubscription.length} users needing subscription initialization`);

    // Initialize them with trial status
    for (const user of usersWithoutSubscription) {
      const trialExpiresAt = new Date();
      trialExpiresAt.setDate(trialExpiresAt.getDate() + 30); // 30 days from now

      const usageResetAt = new Date();
      usageResetAt.setMonth(usageResetAt.getMonth() + 1); // 1 month from now

      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionPlan: 'trial',
          subscriptionStatus: 'trialing',
          billingInterval: null,
          orderSyncCount: user.orderSyncCount || 0,
          labelCount: user.labelCount || 0,
          trialExpiresAt: trialExpiresAt,
          usageResetAt: usageResetAt,
        }
      });

      console.log(`Initialized subscription data for user ${user.id} (${user.email})`);
    }

    console.log('Subscription data initialization completed!');
  } catch (error) {
    console.error('Error initializing subscription data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

initializeSubscriptionData();