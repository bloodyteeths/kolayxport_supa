-- CreateTable
CREATE TABLE "ShipperProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shipperName" TEXT,
    "shipperPersonName" TEXT,
    "shipperPhoneNumber" TEXT,
    "shipperStreet1" TEXT,
    "shipperStreet2" TEXT,
    "shipperCity" TEXT,
    "shipperStateCode" TEXT,
    "shipperPostalCode" TEXT,
    "shipperCountryCode" TEXT,
    "shipperTinNumber" TEXT,
    "importerOfRecord" TEXT,
    "fedexFolderId" TEXT,
    "defaultCurrencyCode" TEXT,
    "dutiesPaymentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipperProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipperProfile_userId_key" ON "ShipperProfile"("userId");

-- AddForeignKey
ALTER TABLE "ShipperProfile" ADD CONSTRAINT "ShipperProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
