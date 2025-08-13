-- Add Etsy OAuth credential fields to Credential table (safe version)
-- Uses IF NOT EXISTS to avoid conflicts if columns already exist

DO $$
BEGIN
  -- Add etsyAccessToken column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Credential' AND column_name = 'etsyAccessToken'
  ) THEN
    ALTER TABLE "Credential" ADD COLUMN "etsyAccessToken" TEXT;
  END IF;

  -- Add etsyRefreshToken column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Credential' AND column_name = 'etsyRefreshToken'
  ) THEN
    ALTER TABLE "Credential" ADD COLUMN "etsyRefreshToken" TEXT;
  END IF;

  -- Add etsyShopId column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Credential' AND column_name = 'etsyShopId'
  ) THEN
    ALTER TABLE "Credential" ADD COLUMN "etsyShopId" TEXT;
  END IF;

  -- Add etsyTokenExpiresAt column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Credential' AND column_name = 'etsyTokenExpiresAt'
  ) THEN
    ALTER TABLE "Credential" ADD COLUMN "etsyTokenExpiresAt" TIMESTAMP(3);
  END IF;
END $$;