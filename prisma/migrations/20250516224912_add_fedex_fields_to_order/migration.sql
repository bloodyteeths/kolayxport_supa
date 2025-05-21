-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fedexDutiesPaymentType" TEXT,
ADD COLUMN     "fedexPackagingType" TEXT,
ADD COLUMN     "fedexPickupType" TEXT,
ADD COLUMN     "fedexServiceType" TEXT;
