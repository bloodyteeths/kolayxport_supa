/*
  Warnings:

  - A unique constraint covering the columns `[userId,orderNumber]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Order_userId_marketplace_marketplaceKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_orderNumber_key" ON "Order"("userId", "orderNumber");
