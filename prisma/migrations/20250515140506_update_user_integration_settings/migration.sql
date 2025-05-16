-- DropIndex
DROP INDEX "OrderItem_remoteLineId_key";

-- AlterTable
ALTER TABLE "UserIntegrationSettings" ADD COLUMN     "fedexMeterNumber" TEXT,
ADD COLUMN     "hepsiburadaApiKey" TEXT,
ADD COLUMN     "hepsiburadaMerchantId" TEXT,
ADD COLUMN     "trendyolApiKey" TEXT,
ADD COLUMN     "trendyolApiSecret" TEXT,
ADD COLUMN     "trendyolSupplierId" TEXT;
