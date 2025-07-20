-- Add recipient_email column to OrderItem table
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "recipient_email" TEXT;