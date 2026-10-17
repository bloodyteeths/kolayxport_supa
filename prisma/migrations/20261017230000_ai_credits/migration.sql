-- AI kredisi ledger + video job credits / quality check
CREATE TABLE "AiCreditEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "period" TEXT,
    "feature" TEXT,
    "ref" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCreditEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiCreditEntry_kind_bucket_ref_key" ON "AiCreditEntry"("kind", "bucket", "ref");
CREATE INDEX "AiCreditEntry_userId_createdAt_idx" ON "AiCreditEntry"("userId", "createdAt");
CREATE INDEX "AiCreditEntry_userId_bucket_period_idx" ON "AiCreditEntry"("userId", "bucket", "period");
ALTER TABLE "AiCreditEntry" ADD CONSTRAINT "AiCreditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiVideoJob" ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiVideoJob" ADD COLUMN "qa" JSONB;
