/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `marketplaceLineId` on the `OrderItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "images" TEXT[],
ADD COLUMN     "notes" JSONB,
ADD COLUMN     "syncStatus" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "imageUrl",
DROP COLUMN "marketplaceLineId",
ADD COLUMN     "image" TEXT,
ADD COLUMN     "remoteLineId" TEXT;
