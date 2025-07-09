/*
  Warnings:

  - You are about to drop the column `channel` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `fedexMasterFormId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `Order` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "channel",
DROP COLUMN "fedexMasterFormId",
DROP COLUMN "source";
