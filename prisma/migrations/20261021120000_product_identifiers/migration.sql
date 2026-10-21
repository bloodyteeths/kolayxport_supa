-- CreateTable
CREATE TABLE "ProductIdentifier" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "gtin" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductIdentifier_userId_idx" ON "ProductIdentifier"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductIdentifier_userId_key_key" ON "ProductIdentifier"("userId", "key");

