-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fedexMasterFormId" TEXT,
ADD COLUMN     "shipmentStatus" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippingLabelUrl" TEXT,
ADD COLUMN     "trackingNumber" TEXT;
