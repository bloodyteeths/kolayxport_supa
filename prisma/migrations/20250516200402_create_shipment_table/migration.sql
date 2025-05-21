/*
  Warnings:

  - A unique constraint covering the columns `[userId,orderNumber]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ShipperProfile" ADD COLUMN     "defaultCountryOfMfg" TEXT,
ADD COLUMN     "defaultHarmonizedCode" TEXT,
ADD COLUMN     "defaultPackagingType" TEXT,
ADD COLUMN     "defaultServiceType" TEXT,
ADD COLUMN     "defaultWeightKg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "carrier" TEXT NOT NULL,
    "serviceType" TEXT,
    "packagingType" TEXT,
    "weightKg" DOUBLE PRECISION,
    "customsValue" DECIMAL(10,2),
    "currency" TEXT,
    "status" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "trackingNumber" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_orderItemId_idx" ON "Shipment"("orderItemId");

-- CreateIndex
CREATE INDEX "LabelJob_orderItemId_idx" ON "LabelJob"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_orderNumber_key" ON "Order"("userId", "orderNumber");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelJob" ADD CONSTRAINT "LabelJob_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
