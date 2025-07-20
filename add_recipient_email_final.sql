-- Add recipient_email column back to OrderItem table
ALTER TABLE "OrderItem" ADD COLUMN "recipient_email" TEXT;