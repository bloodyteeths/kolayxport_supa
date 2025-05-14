-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "packingEditedAt" TIMESTAMP(3),
ADD COLUMN     "productionEditedAt" TIMESTAMP(3),
ADD COLUMN     "rawData" JSONB,
ADD COLUMN     "rawFetchedAt" TIMESTAMP(3),
ALTER COLUMN "packingStatus" DROP DEFAULT;
