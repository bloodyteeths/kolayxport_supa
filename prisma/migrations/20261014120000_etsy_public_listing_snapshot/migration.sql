-- CreateTable
CREATE TABLE "EtsyPublicListingSnapshot" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopSoldCount" INTEGER,
    "shopReviewCount" INTEGER,
    "listingFavorites" INTEGER,
    "listingReviewCount" INTEGER,
    "listingViews" INTEGER,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "pageBoughtLast24h" INTEGER,
    "pageInCarts" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtsyPublicListingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtsyPublicListingSnapshot_listingId_capturedAt_idx" ON "EtsyPublicListingSnapshot"("listingId", "capturedAt");

-- CreateIndex
CREATE INDEX "EtsyPublicListingSnapshot_shopId_capturedAt_idx" ON "EtsyPublicListingSnapshot"("shopId", "capturedAt");

-- CreateIndex
CREATE INDEX "EtsyPublicListingSnapshot_capturedAt_idx" ON "EtsyPublicListingSnapshot"("capturedAt");
