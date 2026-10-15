-- BR-1a listings_grid (design/surfaces/listings-grid.md §9.3). Additive only:
-- health columns on the five listing caches, scheduledSendAt on Etsy/eBay drafts, new CatalogDraft.

-- AlterTable
ALTER TABLE "EtsyListing" ADD COLUMN     "healthChecksTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthChecksUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthFails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "healthScore" INTEGER;

-- AlterTable
ALTER TABLE "EtsyListingDraft" ADD COLUMN     "scheduledSendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EbayListingDraft" ADD COLUMN     "scheduledSendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EbayListing" ADD COLUMN     "healthChecksTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthChecksUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthFails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "healthScore" INTEGER;

-- AlterTable
ALTER TABLE "TrendyolProduct" ADD COLUMN     "healthChecksTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthChecksUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthFails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "healthScore" INTEGER;

-- AlterTable
ALTER TABLE "WixProduct" ADD COLUMN     "healthChecksTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthChecksUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthFails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "healthScore" INTEGER;

-- AlterTable
ALTER TABLE "ShopifyProduct" ADD COLUMN     "healthChecksTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthChecksUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "healthFails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "healthScore" INTEGER;

-- CreateTable
CREATE TABLE "CatalogDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "baseUpdatedAt" TIMESTAMP(3),
    "baseSnapshot" JSONB NOT NULL DEFAULT '{}',
    "fieldPatch" JSONB NOT NULL DEFAULT '{}',
    "queuedActions" JSONB NOT NULL DEFAULT '[]',
    "batchRequestId" TEXT,
    "lastSyncError" TEXT,
    "scheduledSendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogDraft_userId_marketplace_storeId_idx" ON "CatalogDraft"("userId", "marketplace", "storeId");

-- CreateIndex
CREATE INDEX "CatalogDraft_status_idx" ON "CatalogDraft"("status");

-- CreateIndex
CREATE INDEX "CatalogDraft_scheduledSendAt_idx" ON "CatalogDraft"("scheduledSendAt");

-- CreateIndex
CREATE INDEX "EtsyListing_etsyShopId_healthScore_idx" ON "EtsyListing"("etsyShopId", "healthScore");

-- CreateIndex
CREATE INDEX "EtsyListingDraft_scheduledSendAt_idx" ON "EtsyListingDraft"("scheduledSendAt");

-- CreateIndex
CREATE INDEX "EbayListingDraft_scheduledSendAt_idx" ON "EbayListingDraft"("scheduledSendAt");

-- CreateIndex
CREATE INDEX "EbayListing_userId_healthScore_idx" ON "EbayListing"("userId", "healthScore");

-- CreateIndex
CREATE INDEX "TrendyolProduct_supplierId_healthScore_idx" ON "TrendyolProduct"("supplierId", "healthScore");

-- CreateIndex
CREATE INDEX "WixProduct_wixSiteId_healthScore_idx" ON "WixProduct"("wixSiteId", "healthScore");

-- CreateIndex
CREATE INDEX "ShopifyProduct_shopifyShopId_healthScore_idx" ON "ShopifyProduct"("shopifyShopId", "healthScore");


-- AddForeignKey (relationMode = prisma emits none; matches the Notification migration)
ALTER TABLE "CatalogDraft" ADD CONSTRAINT "CatalogDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
