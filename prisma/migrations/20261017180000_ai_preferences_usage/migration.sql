-- AI preferences per seller (+ marketplace override) and an AI usage log (cost tracking, credits).
CREATE TABLE "AiPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "marketplace" TEXT NOT NULL DEFAULT 'all',
  "tone" TEXT,
  "include" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "avoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "brand" TEXT,
  "notes" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiPreference_userId_marketplace_key" ON "AiPreference"("userId", "marketplace");
ALTER TABLE "AiPreference" ADD CONSTRAINT "AiPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "feature" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
  "images" INTEGER NOT NULL DEFAULT 0,
  "ms" INTEGER NOT NULL DEFAULT 0,
  "refine" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");
CREATE INDEX "AiUsage_feature_createdAt_idx" ON "AiUsage"("feature", "createdAt");
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
