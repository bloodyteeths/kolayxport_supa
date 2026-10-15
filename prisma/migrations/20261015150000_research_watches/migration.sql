-- BR-1c research_watches (design/surfaces/research.md §8, RESEARCH_REDESIGN §4.3). Additive only: new ResearchWatch and
-- ResearchSnapshot tables. ResearchSnapshot is shared across users: one reading per (type, marketplace, refId, UTC day).

-- CreateTable
CREATE TABLE "ResearchWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "alertRules" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSnapshot" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "ResearchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchWatch_userId_isActive_createdAt_idx" ON "ResearchWatch"("userId", "isActive", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchWatch_isActive_type_marketplace_refId_idx" ON "ResearchWatch"("isActive", "type", "marketplace", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchWatch_userId_type_marketplace_refId_key" ON "ResearchWatch"("userId", "type", "marketplace", "refId");

-- CreateIndex
CREATE INDEX "ResearchSnapshot_type_marketplace_refId_takenAt_idx" ON "ResearchSnapshot"("type", "marketplace", "refId", "takenAt");

-- CreateIndex
CREATE INDEX "ResearchSnapshot_takenAt_idx" ON "ResearchSnapshot"("takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSnapshot_type_marketplace_refId_day_key" ON "ResearchSnapshot"("type", "marketplace", "refId", "day");



-- AddForeignKey (relationMode = prisma emits none; matches the Notification / InboxThread migrations)
ALTER TABLE "ResearchWatch" ADD CONSTRAINT "ResearchWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
