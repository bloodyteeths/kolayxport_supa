/*
  Warnings:

  - You are about to drop the column `commodityDesc` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `countryOfMfg` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `dimensionUnits` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexDutiesPaymentType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexMasterFormId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexPackagingType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexPickupType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexServiceType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `harmonizedCode` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `labelStockType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageHeight` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageLength` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageWidth` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packingEditedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packingStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `productionEditedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `productionNotes` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `sendCommercialInvoiceViaEtd` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shipmentStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingChargesPaymentType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `signatureType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `termsOfSale` on the `Order` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "commodityDesc",
DROP COLUMN "countryOfMfg",
DROP COLUMN "dimensionUnits",
DROP COLUMN "fedexDutiesPaymentType",
DROP COLUMN "fedexMasterFormId",
DROP COLUMN "fedexPackagingType",
DROP COLUMN "fedexPickupType",
DROP COLUMN "fedexServiceType",
DROP COLUMN "harmonizedCode",
DROP COLUMN "labelStockType",
DROP COLUMN "packageHeight",
DROP COLUMN "packageLength",
DROP COLUMN "packageWidth",
DROP COLUMN "packingEditedAt",
DROP COLUMN "packingStatus",
DROP COLUMN "productionEditedAt",
DROP COLUMN "productionNotes",
DROP COLUMN "sendCommercialInvoiceViaEtd",
DROP COLUMN "shipmentStatus",
DROP COLUMN "shippedAt",
DROP COLUMN "shippingChargesPaymentType",
DROP COLUMN "signatureType",
DROP COLUMN "termsOfSale",
ADD COLUMN     "packagingType" TEXT DEFAULT 'YOUR_PACKAGING',
ADD COLUMN     "serviceType" TEXT DEFAULT 'FEDEX_GROUND',
ADD COLUMN     "weightKg" DOUBLE PRECISION DEFAULT 0.5,
ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "countryOfMfg" TEXT,
ADD COLUMN     "harmonizedCode" TEXT,
ADD COLUMN     "weightKg" DOUBLE PRECISION DEFAULT 0.5,
ALTER COLUMN "quantity" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "ShipperProfile" ADD COLUMN     "defaultShippingChargesPaymentType" TEXT DEFAULT 'SENDER',
ALTER COLUMN "defaultCurrencyCode" SET DEFAULT 'USD',
ALTER COLUMN "dutiesPaymentType" SET DEFAULT 'SENDER';
