-- stock_sync (W0-contracts). Additive only: new tables, nullable/defaulted columns, indexes.
-- Generated with: prisma migrate diff --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script
-- CreateTable
CREATE TABLE "StockSettings" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "enabledAt" TIMESTAMP(3),
    "goLiveAt" TIMESTAMP(3),
    "restockOnCancel" BOOLEAN NOT NULL DEFAULT true,
    "autoFixDrift" BOOLEAN NOT NULL DEFAULT false,
    "etsyZeroStockAction" TEXT NOT NULL DEFAULT 'disable_variation',
    "seedPolicy" TEXT NOT NULL DEFAULT 'min',
    "seedSubtractReserved" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shopifyLocationId" TEXT,
    "orderScanCursorAt" TIMESTAMP(3),
    "orderScanCursorId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "displaySku" TEXT NOT NULL,
    "title" TEXT,
    "imageUrl" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "safetyBuffer" INTEGER NOT NULL DEFAULT 0,
    "tracking" TEXT NOT NULL DEFAULT 'tracked',
    "status" TEXT NOT NULL DEFAULT 'active',
    "seededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "variantRef" TEXT NOT NULL DEFAULT '',
    "variantValueKey" TEXT,
    "locationRef" TEXT,
    "remoteSku" TEXT,
    "title" TEXT,
    "matchType" TEXT NOT NULL DEFAULT 'auto_exact',
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "statusReason" TEXT,
    "unitsPerSale" INTEGER NOT NULL DEFAULT 1,
    "buffer" INTEGER NOT NULL DEFAULT 0,
    "maxListedQty" INTEGER,
    "lastSeenRemoteQty" INTEGER,
    "lastSeenRemoteTs" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "unattributedDrop" INTEGER NOT NULL DEFAULT 0,
    "unattributedDropSince" TIMESTAMP(3),
    "deactivatedByStock" BOOLEAN NOT NULL DEFAULT false,
    "deactivatedAt" TIMESTAMP(3),
    "lastPushedQty" INTEGER,
    "lastPushedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "qtyAfter" INTEGER NOT NULL,
    "channel" TEXT,
    "linkId" TEXT,
    "orderId" TEXT,
    "orderKey" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPush" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "pendingKey" TEXT,
    "reason" TEXT NOT NULL,
    "targetQty" INTEGER NOT NULL,
    "freshRemoteQty" INTEGER,
    "sentQty" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "remoteQtyAfter" INTEGER,
    "externalRef" TEXT,
    "lastError" TEXT,
    "ledgerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "stockItemId" TEXT,
    "remoteQty" INTEGER NOT NULL,
    "prevSeenQty" INTEGER,
    "delta" INTEGER,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT,
    "remoteUpdatedTs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'go_live',
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockItem_userId_status_idx" ON "StockItem"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_userId_sku_key" ON "StockItem"("userId", "sku");

-- CreateIndex
CREATE INDEX "StockLink_stockItemId_idx" ON "StockLink"("stockItemId");

-- CreateIndex
CREATE INDEX "StockLink_userId_channel_status_idx" ON "StockLink"("userId", "channel", "status");

-- CreateIndex
CREATE INDEX "StockLink_channel_accountRef_externalId_idx" ON "StockLink"("channel", "accountRef", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLink_userId_channel_accountRef_externalId_variantRef_key" ON "StockLink"("userId", "channel", "accountRef", "externalId", "variantRef");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedger_idempotencyKey_key" ON "StockLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockLedger_userId_createdAt_idx" ON "StockLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedger_stockItemId_createdAt_idx" ON "StockLedger"("stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedger_orderKey_stockItemId_idx" ON "StockLedger"("orderKey", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockPush_pendingKey_key" ON "StockPush"("pendingKey");

-- CreateIndex
CREATE INDEX "StockPush_status_nextAttemptAt_idx" ON "StockPush"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "StockPush_linkId_status_idx" ON "StockPush"("linkId", "status");

-- CreateIndex
CREATE INDEX "StockPush_userId_createdAt_idx" ON "StockPush"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StockObservation_linkId_createdAt_idx" ON "StockObservation"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "StockObservation_userId_createdAt_idx" ON "StockObservation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StockSnapshot_userId_takenAt_idx" ON "StockSnapshot"("userId", "takenAt");

