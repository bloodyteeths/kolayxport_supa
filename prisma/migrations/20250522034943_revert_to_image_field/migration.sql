/*
  Warnings:

  - A unique constraint covering the columns `[orderId]` on the table `Shipment` will be added. If there are existing duplicate values, this will fail.
  - Made the column `image` on table `OrderItem` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "image" SET NOT NULL,
ALTER COLUMN "image" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");
