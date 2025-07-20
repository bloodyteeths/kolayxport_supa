-- Remove recipient_email column from OrderItem table to fix schema mismatch
ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "recipient_email";