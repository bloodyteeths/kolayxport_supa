-- AlterTable
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "ebayAccessToken" TEXT;
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "ebayRefreshToken" TEXT;
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "ebayTokenExpiresAt" TIMESTAMP(3);
