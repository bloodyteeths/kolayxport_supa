-- CreateTable
CREATE TABLE "ActivationEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivationEmail_userId_step_key" ON "ActivationEmail"("userId", "step");

-- CreateIndex
CREATE INDEX "ActivationEmail_userId_idx" ON "ActivationEmail"("userId");
