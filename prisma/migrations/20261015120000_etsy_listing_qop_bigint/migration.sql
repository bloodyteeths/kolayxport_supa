-- Etsy custom variation property ids (e.g. 52047899318) exceed INT4; widen to BIGINT[].
ALTER TABLE "EtsyListing" ALTER COLUMN "quantityOnProperty" DROP DEFAULT;
ALTER TABLE "EtsyListing" ALTER COLUMN "quantityOnProperty" SET DATA TYPE BIGINT[] USING "quantityOnProperty"::BIGINT[];
ALTER TABLE "EtsyListing" ALTER COLUMN "quantityOnProperty" SET DEFAULT ARRAY[]::BIGINT[];
