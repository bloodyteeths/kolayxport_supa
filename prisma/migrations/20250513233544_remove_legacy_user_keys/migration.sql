/*
  Warnings:

  - You are about to drop the column `fedexAccountNumber` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `fedexApiKey` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `fedexApiSecret` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `fedexMeterNumber` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `hepsiburadaApiKey` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `hepsiburadaMerchantId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `shippoToken` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `trendyolApiKey` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `trendyolApiSecret` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `trendyolSupplierId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `veeqoApiKey` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "fedexAccountNumber",
DROP COLUMN "fedexApiKey",
DROP COLUMN "fedexApiSecret",
DROP COLUMN "fedexMeterNumber",
DROP COLUMN "hepsiburadaApiKey",
DROP COLUMN "hepsiburadaMerchantId",
DROP COLUMN "shippoToken",
DROP COLUMN "trendyolApiKey",
DROP COLUMN "trendyolApiSecret",
DROP COLUMN "trendyolSupplierId",
DROP COLUMN "veeqoApiKey";
