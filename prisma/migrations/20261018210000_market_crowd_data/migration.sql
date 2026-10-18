-- CreateTable
CREATE TABLE "MarketProduct" (
    "id" TEXT NOT NULL,
    "mkt" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER,
    "reviewCount" INTEGER,
    "favorites" INTEGER,
    "otherSellerCount" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketProductObservation" (
    "id" TEXT NOT NULL,
    "mkt" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "originalPrice" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER,
    "reviewCount" INTEGER,
    "favorites" INTEGER,
    "basketCount" INTEGER,
    "viewCount" INTEGER,
    "orderBadge" TEXT,
    "ordersAtLeast" INTEGER,
    "otherSellerCount" INTEGER,
    "buyboxSellerId" TEXT,
    "offers" JSONB,

    CONSTRAINT "MarketProductObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSearchObservation" (
    "id" TEXT NOT NULL,
    "mkt" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER,
    "page" INTEGER NOT NULL DEFAULT 1,
    "organicIds" JSONB NOT NULL,
    "sponsoredIds" JSONB NOT NULL,

    CONSTRAINT "MarketSearchObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSeller" (
    "id" TEXT NOT NULL,
    "mkt" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT,
    "score" DOUBLE PRECISION,
    "followers" INTEGER,
    "productCount" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketContribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "mkt" TEXT NOT NULL,
    "products" INTEGER NOT NULL DEFAULT 0,
    "pages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketIngestStat" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "mkt" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketIngestStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketProduct_mkt_sellerId_idx" ON "MarketProduct"("mkt", "sellerId");

-- CreateIndex
CREATE INDEX "MarketProduct_mkt_categoryId_idx" ON "MarketProduct"("mkt", "categoryId");

-- CreateIndex
CREATE INDEX "MarketProduct_lastSeenAt_idx" ON "MarketProduct"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketProduct_mkt_productId_key" ON "MarketProduct"("mkt", "productId");

-- CreateIndex
CREATE INDEX "MarketProductObservation_mkt_productId_observedAt_idx" ON "MarketProductObservation"("mkt", "productId", "observedAt");

-- CreateIndex
CREATE INDEX "MarketProductObservation_observedAt_idx" ON "MarketProductObservation"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketProductObservation_mkt_productId_hourBucket_key" ON "MarketProductObservation"("mkt", "productId", "hourBucket");

-- CreateIndex
CREATE INDEX "MarketSearchObservation_mkt_queryKey_observedAt_idx" ON "MarketSearchObservation"("mkt", "queryKey", "observedAt");

-- CreateIndex
CREATE INDEX "MarketSearchObservation_observedAt_idx" ON "MarketSearchObservation"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSearchObservation_mkt_queryKey_page_hourBucket_key" ON "MarketSearchObservation"("mkt", "queryKey", "page", "hourBucket");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSeller_mkt_sellerId_key" ON "MarketSeller"("mkt", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketContribution_userId_day_mkt_key" ON "MarketContribution"("userId", "day", "mkt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketIngestStat_day_mkt_pageType_parserVersion_key" ON "MarketIngestStat"("day", "mkt", "pageType", "parserVersion");

