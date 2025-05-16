/*
  Warnings:

  - You are about to drop the column `billingAddress` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `commodityDesc` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `countryOfMfg` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `dimensionUnits` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexMasterFormId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `harmonizedCode` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `images` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `labelStockType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageHeight` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageLength` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packageWidth` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packingEditedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `packingStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `productionEditedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `productionNotes` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `rawData` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `rawFetchedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `sendCommercialInvoiceViaEtd` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shipmentStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingAddress` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingChargesPaymentType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingLabelUrl` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `signatureType` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `syncStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `syncedAt` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `termsOfSale` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `trackingNumber` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `remoteLineId` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `OrderItem` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "LabelJob" DROP CONSTRAINT "LabelJob_orderItemId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- DropIndex
DROP INDEX "OrderItem_productId_idx";

-- DropIndex
DROP INDEX "OrderItem_remoteLineId_orderId_key";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "billingAddress",
DROP COLUMN "commodityDesc",
DROP COLUMN "countryOfMfg",
DROP COLUMN "dimensionUnits",
DROP COLUMN "fedexMasterFormId",
DROP COLUMN "harmonizedCode",
DROP COLUMN "images",
DROP COLUMN "labelStockType",
DROP COLUMN "packageHeight",
DROP COLUMN "packageLength",
DROP COLUMN "packageWidth",
DROP COLUMN "packingEditedAt",
DROP COLUMN "packingStatus",
DROP COLUMN "productionEditedAt",
DROP COLUMN "productionNotes",
DROP COLUMN "rawData",
DROP COLUMN "rawFetchedAt",
DROP COLUMN "sendCommercialInvoiceViaEtd",
DROP COLUMN "shipmentStatus",
DROP COLUMN "shippedAt",
DROP COLUMN "shippingAddress",
DROP COLUMN "shippingChargesPaymentType",
DROP COLUMN "shippingLabelUrl",
DROP COLUMN "signatureType",
DROP COLUMN "syncStatus",
DROP COLUMN "syncedAt",
DROP COLUMN "termsOfSale",
DROP COLUMN "trackingNumber",
ALTER COLUMN "notes" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "createdAt",
DROP COLUMN "productId",
DROP COLUMN "remoteLineId",
DROP COLUMN "updatedAt";
