-- BR-4 inbox_threads (design/surfaces/messages.md §6.2). Additive only: new InboxThread table.

-- CreateTable
CREATE TABLE "InboxThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "contactId" TEXT,
    "customerName" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "lastFromCustomer" BOOLEAN,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "messageCount" INTEGER,
    "contactActivityAt" TIMESTAMP(3),
    "lastOrderNumber" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxThread_userId_needsReply_lastMessageAt_idx" ON "InboxThread"("userId", "needsReply", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxThread_userId_platform_externalId_key" ON "InboxThread"("userId", "platform", "externalId");


-- AddForeignKey (relationMode = prisma emits none; matches the Notification migration)
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
