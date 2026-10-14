-- AlterTable: WebhookEvent becomes a small processing queue for Etsy webhooks.
-- Additive only: every new column is nullable or has a default.
ALTER TABLE "WebhookEvent" ADD COLUMN "payload" JSONB;
ALTER TABLE "WebhookEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookEvent" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "WebhookEvent" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "WebhookEvent" ADD COLUMN "shopId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "resourceKey" TEXT;

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_nextAttemptAt_idx" ON "WebhookEvent"("provider", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_shopId_resourceKey_idx" ON "WebhookEvent"("provider", "shopId", "resourceKey");
