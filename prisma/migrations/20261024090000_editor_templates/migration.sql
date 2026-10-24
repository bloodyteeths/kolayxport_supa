-- CreateTable
CREATE TABLE "EditorTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EditorTemplate_userId_marketplace_name_key" ON "EditorTemplate"("userId", "marketplace", "name");

-- CreateIndex
CREATE INDEX "EditorTemplate_userId_marketplace_idx" ON "EditorTemplate"("userId", "marketplace");

-- AddForeignKey
ALTER TABLE "EditorTemplate" ADD CONSTRAINT "EditorTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
