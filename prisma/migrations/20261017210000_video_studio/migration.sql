-- Video Studio: direction, modes (first/last frame, references, extend, edit), variants, favourites, listing link.
ALTER TABLE "AiVideoJob" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'image';
ALTER TABLE "AiVideoJob" ADD COLUMN "direction" JSONB;
ALTER TABLE "AiVideoJob" ADD COLUMN "endUrl" TEXT;
ALTER TABLE "AiVideoJob" ADD COLUMN "referenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AiVideoJob" ADD COLUMN "resolution" TEXT NOT NULL DEFAULT '720p';
ALTER TABLE "AiVideoJob" ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'fast';
ALTER TABLE "AiVideoJob" ADD COLUMN "seed" INTEGER;
ALTER TABLE "AiVideoJob" ADD COLUMN "groupId" TEXT;
ALTER TABLE "AiVideoJob" ADD COLUMN "variantIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiVideoJob" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiVideoJob" ADD COLUMN "listingRef" TEXT;
ALTER TABLE "AiVideoJob" ADD COLUMN "title" TEXT;
CREATE INDEX "AiVideoJob_groupId_idx" ON "AiVideoJob"("groupId");
