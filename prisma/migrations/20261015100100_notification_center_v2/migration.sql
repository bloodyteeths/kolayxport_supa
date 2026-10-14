-- notification_center_v2 (W0-contracts). Additive only: new tables, nullable/defaulted columns, indexes.
-- Generated with: prisma migrate diff --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script
-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "badge" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "raiseCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "raiseSeq" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "telegram" BOOLEAN NOT NULL DEFAULT false,
    "emailMode" TEXT NOT NULL DEFAULT 'instant',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "userId" TEXT NOT NULL,
    "locale" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "preset" TEXT NOT NULL DEFAULT 'recommended',
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" INTEGER DEFAULT 23,
    "quietHoursEnd" INTEGER DEFAULT 8,
    "digestHour" INTEGER NOT NULL DEFAULT 8,
    "lastDigestAt" TIMESTAMP(3),
    "telegramChatId" TEXT,
    "telegramLinkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_raiseSeq_key" ON "NotificationDelivery"("notificationId", "channel", "raiseSeq");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE INDEX "Notification_userId_badge_readAt_resolvedAt_idx" ON "Notification"("userId", "badge", "readAt", "resolvedAt");

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");

