-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderNumber" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "uniqueLineKey" TEXT;
