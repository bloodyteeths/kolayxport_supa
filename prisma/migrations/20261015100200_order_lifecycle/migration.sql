-- order_lifecycle (W0-contracts). Additive only: new tables, nullable/defaulted columns, indexes.
-- Generated with: prisma migrate diff --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "itemsHash" TEXT,
ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "lastRemoteCheckAt" TIMESTAMP(3),
ADD COLUMN     "orderHash" TEXT,
ADD COLUMN     "returnWindowEndsAt" TIMESTAMP(3),
ADD COLUMN     "shipByAt" TIMESTAMP(3),
ADD COLUMN     "shippedLate" BOOLEAN,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "listingRef" TEXT,
ADD COLUMN     "variantRef" TEXT,
ADD COLUMN     "variantValueKey" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "voidError" TEXT,
ADD COLUMN     "voidMethod" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrackingSubmission" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedReason" TEXT;

-- CreateTable
CREATE TABLE "OrderEffect" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "OrderEffect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderEffect_status_nextAttemptAt_idx" ON "OrderEffect"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEffect_orderId_effect_key" ON "OrderEffect"("orderId", "effect");

-- CreateIndex
CREATE INDEX "Order_userId_status_shipByAt_idx" ON "Order"("userId", "status", "shipByAt");

-- CreateIndex
CREATE INDEX "Order_userId_shippedAt_idx" ON "Order"("userId", "shippedAt");

-- CreateIndex
CREATE INDEX "Order_userId_source_idx" ON "Order"("userId", "source");

-- CreateIndex
CREATE INDEX "Order_userId_updatedAt_id_idx" ON "Order"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "OrderItem_listingRef_idx" ON "OrderItem"("listingRef");

