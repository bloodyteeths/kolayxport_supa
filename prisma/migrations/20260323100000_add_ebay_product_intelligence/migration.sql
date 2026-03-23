-- CreateTable
CREATE TABLE IF NOT EXISTS "EbayTrackedProduct" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacyItemId" TEXT NOT NULL,
    "itemId" TEXT,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "categoryId" TEXT,
    "categoryPath" TEXT,
    "seller" TEXT,
    "condition" TEXT,
    "currentPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currentQuantity" INTEGER,
    "totalSold" INTEGER,
    "itemWebUrl" TEXT,
    "notes" TEXT,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "EbayTrackedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EbayPriceSnapshot" (
    "id" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quantity" INTEGER,
    "soldQuantity" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EbayPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EbayTrackedSeller" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sellerUsername" TEXT NOT NULL,
    "feedbackScore" INTEGER,
    "feedbackPct" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "EbayTrackedSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EbayNicheResearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "marketplace" TEXT NOT NULL DEFAULT 'EBAY_US',
    "totalResults" INTEGER,
    "avgPrice" DOUBLE PRECISION,
    "medianPrice" DOUBLE PRECISION,
    "uniqueSellers" INTEGER,
    "demandScore" INTEGER,
    "competitionScore" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayNicheResearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EbayTrackedProduct_userId_legacyItemId_key" ON "EbayTrackedProduct"("userId", "legacyItemId");
CREATE INDEX IF NOT EXISTS "EbayTrackedProduct_userId_idx" ON "EbayTrackedProduct"("userId");
CREATE INDEX IF NOT EXISTS "EbayTrackedProduct_userId_isActive_idx" ON "EbayTrackedProduct"("userId", "isActive");

CREATE INDEX IF NOT EXISTS "EbayPriceSnapshot_trackedProductId_idx" ON "EbayPriceSnapshot"("trackedProductId");
CREATE INDEX IF NOT EXISTS "EbayPriceSnapshot_trackedProductId_timestamp_idx" ON "EbayPriceSnapshot"("trackedProductId", "timestamp");

CREATE UNIQUE INDEX IF NOT EXISTS "EbayTrackedSeller_userId_sellerUsername_key" ON "EbayTrackedSeller"("userId", "sellerUsername");
CREATE INDEX IF NOT EXISTS "EbayTrackedSeller_userId_idx" ON "EbayTrackedSeller"("userId");

CREATE INDEX IF NOT EXISTS "EbayNicheResearch_userId_idx" ON "EbayNicheResearch"("userId");
CREATE INDEX IF NOT EXISTS "EbayNicheResearch_userId_createdAt_idx" ON "EbayNicheResearch"("userId", "createdAt");
