-- etsy_listing_intel (W0-contracts). Additive only: new tables, nullable/defaulted columns, indexes.
-- Generated with: prisma migrate diff --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script
-- AlterTable
ALTER TABLE "EtsyListing" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "hasVariations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inventorySyncedAt" TIMESTAMP(3),
ADD COLUMN     "lastRefreshAt" TIMESTAMP(3),
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "quantityOnProperty" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "stateChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EtsyListingOffering" (
    "id" TEXT NOT NULL,
    "etsyShopId" TEXT NOT NULL,
    "etsyListingId" BIGINT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "variantValueKey" TEXT NOT NULL,
    "productId" BIGINT,
    "offeringId" BIGINT,
    "sku" TEXT,
    "skuNormalized" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priceAmount" INTEGER,
    "priceDivisor" INTEGER,
    "propertyValues" JSONB NOT NULL DEFAULT '[]',
    "remoteUpdatedTs" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtsyListingOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtsyListingVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "etsyShopId" TEXT NOT NULL,
    "etsyListingId" BIGINT NOT NULL,
    "remoteUpdatedTs" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "draftId" TEXT,
    "syncAttemptId" TEXT,
    "stockPushId" TEXT,
    "webhookEventId" TEXT,
    "batchKey" TEXT,
    "contentHash" TEXT NOT NULL,
    "changedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diff" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,
    "state" TEXT,
    "isTombstone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EtsyListingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtsyListingDailyStat" (
    "id" TEXT NOT NULL,
    "etsyShopId" TEXT NOT NULL,
    "etsyListingId" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "viewsTotal" INTEGER,
    "favoritesTotal" INTEGER,
    "views" INTEGER,
    "favorites" INTEGER,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenueMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "state" TEXT,
    "taxonomyId" INTEGER,

    CONSTRAINT "EtsyListingDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoExperiment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "etsyShopId" TEXT NOT NULL,
    "cohortKey" TEXT NOT NULL,
    "listingIds" BIGINT[],
    "versionIds" TEXT[],
    "changeKinds" TEXT[],
    "changedAt" TIMESTAMP(3) NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 14,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "controlType" TEXT,
    "seasonal" BOOLEAN NOT NULL DEFAULT false,
    "evaluatedAt" TIMESTAMP(3),
    "metrics" JSONB,
    "verdict" TEXT,
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtsyListingOffering_etsyShopId_skuNormalized_idx" ON "EtsyListingOffering"("etsyShopId", "skuNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "EtsyListingOffering_etsyShopId_etsyListingId_variantKey_key" ON "EtsyListingOffering"("etsyShopId", "etsyListingId", "variantKey");

-- CreateIndex
CREATE INDEX "EtsyListingVersion_etsyShopId_etsyListingId_capturedAt_idx" ON "EtsyListingVersion"("etsyShopId", "etsyListingId", "capturedAt");

-- CreateIndex
CREATE INDEX "EtsyListingVersion_userId_capturedAt_idx" ON "EtsyListingVersion"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "EtsyListingVersion_batchKey_idx" ON "EtsyListingVersion"("batchKey");

-- CreateIndex
CREATE INDEX "EtsyListingDailyStat_etsyShopId_date_idx" ON "EtsyListingDailyStat"("etsyShopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EtsyListingDailyStat_etsyShopId_etsyListingId_date_key" ON "EtsyListingDailyStat"("etsyShopId", "etsyListingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SeoExperiment_cohortKey_key" ON "SeoExperiment"("cohortKey");

-- CreateIndex
CREATE INDEX "SeoExperiment_userId_status_idx" ON "SeoExperiment"("userId", "status");

-- CreateIndex
CREATE INDEX "SeoExperiment_etsyShopId_changedAt_idx" ON "SeoExperiment"("etsyShopId", "changedAt");

