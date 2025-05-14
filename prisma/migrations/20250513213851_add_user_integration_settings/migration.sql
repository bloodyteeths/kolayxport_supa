-- CreateTable
CREATE TABLE "UserIntegrationSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "veeqoApiKey" TEXT,
    "shippoToken" TEXT,
    "fedexApiKey" TEXT,
    "fedexApiSecret" TEXT,
    "fedexAccountNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegrationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegrationSettings_userId_key" ON "UserIntegrationSettings"("userId");

-- AddForeignKey
ALTER TABLE "UserIntegrationSettings" ADD CONSTRAINT "UserIntegrationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
