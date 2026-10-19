-- CreateTable
CREATE TABLE "BillingModule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "provider" TEXT NOT NULL DEFAULT 'admin',
    "externalId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingModule_userId_idx" ON "BillingModule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingModule_userId_module_key" ON "BillingModule"("userId", "module");

