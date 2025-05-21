/*
  Warnings:

  - You are about to drop the column `currency` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `customsValue` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `packagingType` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `serviceType` on the `Shipment` table. All the data in the column will be lost.
  - You are about to drop the column `weightKg` on the `Shipment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Shipment" DROP COLUMN "currency",
DROP COLUMN "customsValue",
DROP COLUMN "packagingType",
DROP COLUMN "serviceType",
DROP COLUMN "weightKg";
