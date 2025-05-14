-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "packingStatus" TEXT DEFAULT 'Pending',
ADD COLUMN     "productionNotes" TEXT;
