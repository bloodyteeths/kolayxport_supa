-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingInterval" TEXT,
ADD COLUMN     "labelCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderSyncCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "subscriptionPlan" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT,
ADD COLUMN     "trialExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId"); 