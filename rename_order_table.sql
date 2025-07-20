-- Rename Order table to orders to avoid PostgreSQL reserved word conflicts
ALTER TABLE "Order" RENAME TO "orders";

-- Add the recipient_email column to the renamed table
ALTER TABLE "orders" ADD COLUMN "recipient_email" TEXT;