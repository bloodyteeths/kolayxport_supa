-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "stripeRecipientId" TEXT,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "PartnerCommission" ADD COLUMN     "earnedMinor" INTEGER,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'stripe',
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "PartnerPayout" ADD COLUMN     "error" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'created';

-- CreateTable
CREATE TABLE "PartnerPaymentEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "planKey" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPaymentEvent_objectId_key" ON "PartnerPaymentEvent"("objectId");

-- CreateIndex
CREATE INDEX "PartnerPaymentEvent_userId_paidAt_idx" ON "PartnerPaymentEvent"("userId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_userId_key" ON "Partner"("userId");

