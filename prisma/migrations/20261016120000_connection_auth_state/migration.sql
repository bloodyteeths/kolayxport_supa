-- Reconnect state for marketplace auth failures (lib/integrations/authFailures.ts). Additive only: new
-- ConnectionAuthState table (consecutive 401/403/invalid_grant count per connection + needsReconnect flag).

-- CreateTable
CREATE TABLE "ConnectionAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "needsReconnectAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectionAuthState_userId_needsReconnect_idx" ON "ConnectionAuthState"("userId", "needsReconnect");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionAuthState_userId_provider_accountId_key" ON "ConnectionAuthState"("userId", "provider", "accountId");

