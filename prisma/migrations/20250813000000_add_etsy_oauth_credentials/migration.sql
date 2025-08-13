-- Add Etsy OAuth credential fields to Credential table
ALTER TABLE "Credential" ADD COLUMN "etsyAccessToken" TEXT;
ALTER TABLE "Credential" ADD COLUMN "etsyRefreshToken" TEXT;
ALTER TABLE "Credential" ADD COLUMN "etsyShopId" TEXT;
ALTER TABLE "Credential" ADD COLUMN "etsyTokenExpiresAt" TIMESTAMP(3);