-- CreateTable
CREATE TABLE "HepsiburadaListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "hbSku" TEXT NOT NULL,
    "merchantSku" TEXT,
    "listingId" TEXT,
    "productId" TEXT,
    "barcode" TEXT,
    "title" TEXT,
    "brand" TEXT,
    "categoryId" INTEGER,
    "categoryName" TEXT,
    "images" JSONB,
    "thumbnailUrl" TEXT,
    "price" DECIMAL(12,2),
    "availableStock" INTEGER NOT NULL DEFAULT 0,
    "dispatchTime" INTEGER,
    "maximumPurchasableQuantity" INTEGER,
    "cargoCompanies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSalable" BOOLEAN NOT NULL DEFAULT false,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "isFulfilledByHB" BOOLEAN NOT NULL DEFAULT false,
    "deactivationReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HepsiburadaListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HepsiburadaUploadBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT,
    "sourceRef" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB,
    "errors" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HepsiburadaUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HepsiburadaListing_userId_merchantId_idx" ON "HepsiburadaListing"("userId", "merchantId");

-- CreateIndex
CREATE INDEX "HepsiburadaListing_userId_merchantSku_idx" ON "HepsiburadaListing"("userId", "merchantSku");

-- CreateIndex
CREATE INDEX "HepsiburadaListing_userId_barcode_idx" ON "HepsiburadaListing"("userId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "HepsiburadaListing_userId_merchantId_hbSku_key" ON "HepsiburadaListing"("userId", "merchantId", "hbSku");

-- CreateIndex
CREATE INDEX "HepsiburadaUploadBatch_status_createdAt_idx" ON "HepsiburadaUploadBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HepsiburadaUploadBatch_userId_status_idx" ON "HepsiburadaUploadBatch"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HepsiburadaUploadBatch_userId_kind_uploadId_key" ON "HepsiburadaUploadBatch"("userId", "kind", "uploadId");

