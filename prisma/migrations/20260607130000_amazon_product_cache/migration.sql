-- CreateTable
CREATE TABLE "AmazonProductCache" (
    "id" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "weightKg" DOUBLE PRECISION,
    "countryOfOrigin" TEXT,
    "brand" TEXT,
    "title" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonProductCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonProductCache_asin_marketplaceId_key" ON "AmazonProductCache"("asin", "marketplaceId");

-- CreateIndex
CREATE INDEX "AmazonProductCache_fetchedAt_idx" ON "AmazonProductCache"("fetchedAt");
