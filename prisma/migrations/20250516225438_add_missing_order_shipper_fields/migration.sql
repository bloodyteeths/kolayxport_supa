-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commodityDesc" TEXT,
ADD COLUMN     "countryOfMfg" TEXT,
ADD COLUMN     "dimensionUnits" TEXT,
ADD COLUMN     "harmonizedCode" TEXT,
ADD COLUMN     "labelStockType" TEXT,
ADD COLUMN     "packageHeight" DOUBLE PRECISION,
ADD COLUMN     "packageLength" DOUBLE PRECISION,
ADD COLUMN     "packageWidth" DOUBLE PRECISION,
ADD COLUMN     "sendCommercialInvoiceViaEtd" BOOLEAN,
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "shippingChargesPaymentType" TEXT,
ADD COLUMN     "signatureType" TEXT,
ADD COLUMN     "termsOfSale" TEXT;

-- AlterTable
ALTER TABLE "ShipperProfile" ADD COLUMN     "shipperTinType" TEXT;
