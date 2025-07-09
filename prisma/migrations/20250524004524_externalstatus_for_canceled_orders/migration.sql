-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";

-- DropForeignKey
ALTER TABLE "Credential" DROP CONSTRAINT "Credential_userId_fkey";

-- DropForeignKey
ALTER TABLE "Inventory" DROP CONSTRAINT "Inventory_productId_fkey";

-- DropForeignKey
ALTER TABLE "LabelJob" DROP CONSTRAINT "LabelJob_orderItemId_fkey";

-- DropForeignKey
ALTER TABLE "MarketplaceConfig" DROP CONSTRAINT "MarketplaceConfig_userId_fkey";

-- DropForeignKey
ALTER TABLE "MarketplaceProduct" DROP CONSTRAINT "MarketplaceProduct_productId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "OrderShipping" DROP CONSTRAINT "OrderShipping_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropForeignKey
ALTER TABLE "Shipment" DROP CONSTRAINT "Shipment_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Shipment" DROP CONSTRAINT "Shipment_orderItemId_fkey";

-- DropForeignKey
ALTER TABLE "ShipperProfile" DROP CONSTRAINT "ShipperProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "SyncLog" DROP CONSTRAINT "SyncLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "SyncOperation" DROP CONSTRAINT "SyncOperation_retryOf_fkey";

-- DropForeignKey
ALTER TABLE "SyncOperation" DROP CONSTRAINT "SyncOperation_userId_fkey";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "externalStatus" TEXT;
