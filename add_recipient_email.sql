-- Add recipient_email column to Order table (snake_case for Supabase)
ALTER TABLE "Order" ADD COLUMN "recipient_email" TEXT;