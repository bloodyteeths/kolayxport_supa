import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is called by Vercel Cron or internal job
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    
    // Find all users whose usage should be reset
    const usersToReset = await prisma.user.findMany({
      where: {
        AND: [
          { usageResetAt: { lte: now } },
          { subscriptionStatus: 'active' }
        ]
      }
    });

    console.log(`Found ${usersToReset.length} users to reset usage for`);

    // Reset usage for each user and set next reset date
    const resetPromises = usersToReset.map(async (user) => {
      const nextResetDate = new Date(now);
      
      // Set next reset based on billing interval
      if (user.billingInterval === 'month') {
        nextResetDate.setMonth(nextResetDate.getMonth() + 1);
      } else if (user.billingInterval === 'year') {
        nextResetDate.setFullYear(nextResetDate.getFullYear() + 1);
      } else {
        // Default to monthly for safety
        nextResetDate.setMonth(nextResetDate.getMonth() + 1);
      }

      return prisma.user.update({
        where: { id: user.id },
        data: {
          orderSyncCount: 0,
          labelCount: 0,
          usageResetAt: nextResetDate
        }
      });
    });

    await Promise.all(resetPromises);

    // Also check for expired trials
    const expiredTrials = await prisma.user.findMany({
      where: {
        AND: [
          { subscriptionStatus: 'trialing' },
          { trialExpiresAt: { lte: now } }
        ]
      }
    });

    console.log(`Found ${expiredTrials.length} expired trials`);

    // Update expired trials to canceled status
    if (expiredTrials.length > 0) {
      await prisma.user.updateMany({
        where: {
          id: { in: expiredTrials.map(u => u.id) }
        },
        data: {
          subscriptionStatus: 'canceled',
          subscriptionPlan: null
        }
      });
    }

    return res.status(200).json({
      success: true,
      usageReset: usersToReset.length,
      trialsExpired: expiredTrials.length
    });
  } catch (error: any) {
    console.error('Failed to reset usage:', error);
    return res.status(500).json({ 
      error: 'Failed to reset usage counters',
      details: error.message 
    });
  }
}