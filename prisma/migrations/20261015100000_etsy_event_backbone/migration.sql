-- etsy_event_backbone (W0-contracts). Additive only: new tables, nullable/defaulted columns, indexes.
-- Generated with: prisma migrate diff --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script
-- AlterTable
ALTER TABLE "EtsyShop" ADD COLUMN     "lastListingReconcileAt" TIMESTAMP(3),
ADD COLUMN     "lastOrderPollAt" TIMESTAMP(3),
ADD COLUMN     "lastOrderReconcileAt" TIMESTAMP(3),
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "needsReauth" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsReauthAt" TIMESTAMP(3),
ADD COLUMN     "orderPollCursor" INTEGER,
ADD COLUMN     "orderPollFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokenRefreshLeaseUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EtsyDraftSyncAttempt" ADD COLUMN     "etsyListingId" BIGINT,
ADD COLUMN     "remoteUpdatedTimestamp" INTEGER;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "deferrals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "firstReceivedAt" TIMESTAMP(3),
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "processingStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EtsyApiUsage" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "shopId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "throttled" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtsyApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtsyApiQuota" (
    "day" DATE NOT NULL,
    "limitPerDay" INTEGER,
    "remainingToday" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtsyApiQuota_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "owner" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtsyApiUsage_day_idx" ON "EtsyApiUsage"("day");

-- CreateIndex
CREATE UNIQUE INDEX "EtsyApiUsage_day_shopId_priority_key" ON "EtsyApiUsage"("day", "shopId", "priority");

-- CreateIndex
CREATE INDEX "JobRun_jobName_status_finishedAt_idx" ON "JobRun"("jobName", "status", "finishedAt");

-- CreateIndex
CREATE INDEX "JobRun_startedAt_idx" ON "JobRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_jobName_bucket_key" ON "JobRun"("jobName", "bucket");

-- CreateIndex
CREATE INDEX "EtsyDraftSyncAttempt_etsyListingId_startedAt_idx" ON "EtsyDraftSyncAttempt"("etsyListingId", "startedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_priority_nextAttemptAt_idx" ON "WebhookEvent"("provider", "status", "priority", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_shopId_status_idx" ON "WebhookEvent"("provider", "shopId", "status");

