/*
  Warnings:

  - You are about to drop the column `commodityDesc` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `countryOfMfg` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `dimensionUnits` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexDutiesPaymentType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexPackagingType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexPickupType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexServiceType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `harmonizedCode` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `labelStockType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `marketplaceCreatedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageHeight` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageLength` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageWidth` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packagingType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `sendCommercialInvoiceViaEtd` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `serviceType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shipByDate` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shipmentStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingLabelUrl` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `signatureType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `termsOfSale` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `trackingNumber` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `weightKg` on the `Order` table. All the data in the column will be lost.
  - You are about to alter the column `totalPrice` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,2)` to `DoublePrecision`.
  - Made the column `orderNumber` on table `Order` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "commodityDesc",
DROP COLUMN "countryOfMfg",
DROP COLUMN "dimensionUnits",
DROP COLUMN "fedexDutiesPaymentType",
DROP COLUMN "fedexPackagingType",
DROP COLUMN "fedexPickupType",
DROP COLUMN "fedexServiceType",
DROP COLUMN "harmonizedCode",
DROP COLUMN "labelStockType",
DROP COLUMN "marketplaceCreatedAt",
DROP COLUMN "notes",
DROP COLUMN "packageHeight",
DROP COLUMN "packageLength",
DROP COLUMN "packageWidth",
DROP COLUMN "packagingType",
DROP COLUMN "sendCommercialInvoiceViaEtd",
DROP COLUMN "serviceType",
DROP COLUMN "shipByDate",
DROP COLUMN "shipmentStatus",
DROP COLUMN "shippedAt",
DROP COLUMN "shippingLabelUrl",
DROP COLUMN "signatureType",
DROP COLUMN "termsOfSale",
DROP COLUMN "trackingNumber",
DROP COLUMN "weightKg",
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "totalPrice" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "orderNumber" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_marketplace_marketplaceKey_idx" ON "Order"("marketplace", "marketplaceKey");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
