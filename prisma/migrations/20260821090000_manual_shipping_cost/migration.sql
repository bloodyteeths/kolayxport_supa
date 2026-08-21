-- Manual carrier cost per order, entered from the carrier invoice.
ALTER TABLE "Order" ADD COLUMN "manualShippingCost" DECIMAL(10,2);
ALTER TABLE "Order" ADD COLUMN "manualShippingCostCurrency" TEXT;
