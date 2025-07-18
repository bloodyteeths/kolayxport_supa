import { User as PrismaUser } from '@prisma/client';

declare global {
  namespace Express {
    interface User extends PrismaUser {
      stripeCustomerId?: string | null;
      subscriptionPlan?: string | null;
      billingInterval?: string | null;
      subscriptionStatus?: string | null;
      orderSyncCount?: number;
      labelCount?: number;
      trialExpiresAt?: Date | null;
    }
  }
} 