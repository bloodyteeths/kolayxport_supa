-- Add shipByDate and orderDate fields to EtsyAddress table
ALTER TABLE "EtsyAddress" ADD COLUMN "shipByDate" TEXT;
ALTER TABLE "EtsyAddress" ADD COLUMN "orderDate" TEXT;