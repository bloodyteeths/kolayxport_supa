/*
  Warnings:

  - You are about to drop the `UserIntegrationSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserIntegrationSettings" DROP CONSTRAINT "UserIntegrationSettings_userId_fkey";

-- DropTable
DROP TABLE "UserIntegrationSettings";

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "veeqoApiKey" TEXT,
    "shippoToken" TEXT,
    "fedexApiKey" TEXT,
    "fedexApiSecret" TEXT,
    "fedexAccountNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fedexMeterNumber" TEXT,
    "hepsiburadaApiKey" TEXT,
    "hepsiburadaMerchantId" TEXT,
    "trendyolApiKey" TEXT,
    "trendyolApiSecret" TEXT,
    "trendyolSupplierId" TEXT,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Credential_userId_key" ON "Credential"("userId");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
