/*
  Warnings:

  - A unique constraint covering the columns `[userId,orderNumber]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,marketplaceKey]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_orderNumber_key" ON "Order"("userId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_marketplaceKey_key" ON "Order"("userId", "marketplaceKey");
