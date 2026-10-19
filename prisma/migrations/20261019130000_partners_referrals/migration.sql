-- Referral partners + first-touch signup attribution (docs/gtm/referral-spec.md). Additive only.
-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rate" DECIMAL(5,4) NOT NULL DEFAULT 0.30,
    "tierRate" DECIMAL(5,4) NOT NULL DEFAULT 0.35,
    "tierThreshold" INTEGER NOT NULL DEFAULT 10,
    "months" INTEGER NOT NULL DEFAULT 12,
    "stripePromotionCode" TEXT,
    "promoCodeText" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAcquisition" (
    "userId" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "landing" TEXT,
    "refCode" TEXT,
    "partnerId" TEXT,
    "via" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAcquisition_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PartnerCommission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeObjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payableAt" TIMESTAMP(3) NOT NULL,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPayout" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "fxNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_stripePromotionCode_key" ON "Partner"("stripePromotionCode");

-- CreateIndex
CREATE INDEX "UserAcquisition_partnerId_idx" ON "UserAcquisition"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCommission_stripeObjectId_key" ON "PartnerCommission"("stripeObjectId");

-- CreateIndex
CREATE INDEX "PartnerCommission_partnerId_status_idx" ON "PartnerCommission"("partnerId", "status");

-- CreateIndex
CREATE INDEX "PartnerPayout_partnerId_idx" ON "PartnerPayout"("partnerId");

