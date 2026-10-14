-- Etsy shop_section_id values exceed INT4 (e.g. 52047899318); widen to BIGINT.
ALTER TABLE "EtsyListing" ALTER COLUMN "shopSectionId" SET DATA TYPE BIGINT;
