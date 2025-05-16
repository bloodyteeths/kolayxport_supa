/*
  Warnings:

  - A unique constraint covering the columns `[remoteLineId]` on the table `OrderItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "marketplaceKey" TEXT,
ADD COLUMN     "shipBy" TIMESTAMP(3),
ALTER COLUMN "productName" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_remoteLineId_key" ON "OrderItem"("remoteLineId");
