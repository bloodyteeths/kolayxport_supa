-- AlterTable
ALTER TABLE "Credential" ADD COLUMN "amazonMarketplaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
