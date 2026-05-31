-- CreateTable
CREATE TABLE "CronLock" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronLock_jobName_bucket_key" ON "CronLock"("jobName", "bucket");

-- CreateIndex
CREATE INDEX "CronLock_jobName_bucket_idx" ON "CronLock"("jobName", "bucket");

-- CreateIndex
CREATE INDEX "CronLock_createdAt_idx" ON "CronLock"("createdAt");
