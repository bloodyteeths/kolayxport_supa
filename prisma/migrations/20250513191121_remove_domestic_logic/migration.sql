/*
  Warnings:

  - Added the required column `termsOfSale` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commodityDesc" TEXT,
ADD COLUMN     "countryOfMfg" TEXT,
ADD COLUMN     "dimensionUnits" TEXT,
ADD COLUMN     "fedexMasterFormId" TEXT,
ADD COLUMN     "harmonizedCode" TEXT,
ADD COLUMN     "labelStockType" TEXT,
ADD COLUMN     "packageHeight" DOUBLE PRECISION,
ADD COLUMN     "packageLength" DOUBLE PRECISION,
ADD COLUMN     "packageWidth" DOUBLE PRECISION,
ADD COLUMN     "sendCommercialInvoiceViaEtd" BOOLEAN DEFAULT true,
ADD COLUMN     "shipmentStatus" TEXT,
ADD COLUMN     "shippingChargesPaymentType" TEXT,
ADD COLUMN     "shippingLabelUrl" TEXT,
ADD COLUMN     "signatureType" TEXT,
ADD COLUMN     "termsOfSale" TEXT NOT NULL,
ADD COLUMN     "trackingNumber" TEXT;
