/*
  Warnings:

  - You are about to drop the column `commodityDesc` on the `OrderItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "commodityDesc";

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "iossNumber" TEXT,
ADD COLUMN     "isEdi" BOOLEAN DEFAULT true,
ADD COLUMN     "packageType" TEXT,
ADD COLUMN     "signatureOption" TEXT;
