-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" INTEGER DEFAULT 0,
ADD COLUMN     "shippingSettings" JSONB;
