-- CreateTable
CREATE TABLE "SavedReply" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "platform" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReply_userId_usageCount_idx" ON "SavedReply"("userId", "usageCount");

-- CreateIndex
CREATE UNIQUE INDEX "SavedReply_userId_title_key" ON "SavedReply"("userId", "title");


-- AddForeignKey (relationMode = "prisma" does not emit FKs; added by hand like InboxThread)
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
