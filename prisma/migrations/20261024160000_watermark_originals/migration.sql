-- CreateTable
CREATE TABLE "WatermarkOriginal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatermarkOriginal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatermarkOriginal_userId_marketplace_listingId_idx" ON "WatermarkOriginal"("userId", "marketplace", "listingId");

-- AddForeignKey
ALTER TABLE "WatermarkOriginal" ADD CONSTRAINT "WatermarkOriginal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
