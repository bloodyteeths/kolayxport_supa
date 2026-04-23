-- CreateTable: Shared eBay product index for arbitrage v2
CREATE TABLE "EbayProductIndex" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "condition" TEXT,
    "imageUrl" TEXT,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "sellerName" TEXT,
    "itemUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "searchQuery" TEXT NOT NULL,

    CONSTRAINT "EbayProductIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Shared Trendyol product index for arbitrage v2
CREATE TABLE "TrendyolProductIndex" (
    "id" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "priceTry" DOUBLE PRECISION NOT NULL,
    "originalPriceTry" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "url" TEXT,
    "categorySlug" TEXT NOT NULL,
    "categoryName" TEXT,
    "ratingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "merchantName" TEXT,
    "barcode" TEXT,
    "favoriteCount" TEXT,
    "orderCount" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendyolProductIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AI-matched product pairs
CREATE TABLE "ArbitrageMatch" (
    "id" TEXT NOT NULL,
    "trendyolId" INTEGER NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchReason" TEXT,
    "matchType" TEXT NOT NULL,
    "profitUsd" DOUBLE PRECISION,
    "roiPercent" DOUBLE PRECISION,
    "score" INTEGER,
    "verdict" TEXT,
    "categorySlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArbitrageMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayProductIndex_itemId_key" ON "EbayProductIndex"("itemId");
CREATE INDEX "EbayProductIndex_categoryId_idx" ON "EbayProductIndex"("categoryId");
CREATE INDEX "EbayProductIndex_expiresAt_idx" ON "EbayProductIndex"("expiresAt");
CREATE INDEX "EbayProductIndex_searchQuery_idx" ON "EbayProductIndex"("searchQuery");

-- CreateIndex
CREATE UNIQUE INDEX "TrendyolProductIndex_productId_key" ON "TrendyolProductIndex"("productId");
CREATE INDEX "TrendyolProductIndex_categorySlug_idx" ON "TrendyolProductIndex"("categorySlug");
CREATE INDEX "TrendyolProductIndex_expiresAt_idx" ON "TrendyolProductIndex"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArbitrageMatch_trendyolId_ebayItemId_key" ON "ArbitrageMatch"("trendyolId", "ebayItemId");
CREATE INDEX "ArbitrageMatch_categorySlug_idx" ON "ArbitrageMatch"("categorySlug");
CREATE INDEX "ArbitrageMatch_score_idx" ON "ArbitrageMatch"("score");
CREATE INDEX "ArbitrageMatch_expiresAt_idx" ON "ArbitrageMatch"("expiresAt");
