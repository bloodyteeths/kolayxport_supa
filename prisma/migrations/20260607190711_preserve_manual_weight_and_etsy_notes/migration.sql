-- AlterTable
ALTER TABLE "Order" ADD COLUMN "weightEditedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "giftMessage" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerNote" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "weightEditedAt" TIMESTAMP(3);
