-- AI product videos (Veo): long-running jobs + follow-up versions (parentId).
CREATE TABLE "AiVideoJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'gemini',
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "prompt" TEXT NOT NULL,
  "instruction" TEXT,
  "sourceUrl" TEXT,
  "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
  "durationSec" INTEGER NOT NULL DEFAULT 8,
  "operation" TEXT,
  "filePath" TEXT,
  "errorKey" TEXT,
  "errorDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiVideoJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiVideoJob_userId_createdAt_idx" ON "AiVideoJob"("userId", "createdAt");
ALTER TABLE "AiVideoJob" ADD CONSTRAINT "AiVideoJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
