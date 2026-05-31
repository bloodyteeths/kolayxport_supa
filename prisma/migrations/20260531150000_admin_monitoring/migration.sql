-- AlterTable: extend SyncLog
ALTER TABLE "SyncLog" ADD COLUMN "category" TEXT;

-- CreateIndex on SyncLog
CREATE INDEX "SyncLog_category_idx" ON "SyncLog"("category");
CREATE INDEX "SyncLog_level_timestamp_idx" ON "SyncLog"("level", "timestamp");

-- AlterTable: extend WebhookEvent (all nullable for backward compatibility)
ALTER TABLE "WebhookEvent" ADD COLUMN "provider" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "eventType" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "status" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "userId" TEXT;

-- CreateIndex on WebhookEvent
CREATE INDEX "WebhookEvent_provider_eventType_idx" ON "WebhookEvent"("provider", "eventType");
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");
CREATE INDEX "WebhookEvent_userId_idx" ON "WebhookEvent"("userId");

-- CreateTable: AdminAuditLog
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on AdminAuditLog
CREATE INDEX "AdminAuditLog_adminUserId_idx" ON "AdminAuditLog"("adminUserId");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
