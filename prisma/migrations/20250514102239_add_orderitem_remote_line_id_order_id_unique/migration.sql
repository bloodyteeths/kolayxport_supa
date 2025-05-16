/*
  Warnings:

  - A unique constraint covering the columns `[remoteLineId,orderId]` on the table `OrderItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_remoteLineId_orderId_key" ON "OrderItem"("remoteLineId", "orderId");
