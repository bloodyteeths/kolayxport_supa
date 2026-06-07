-- One-shot backfill: normalize raw Trendyol order statuses already persisted
-- in the Order table to the app-wide enum used by orders-page filters,
-- financial dashboard breakdowns, and canceled-order strikethrough.
--
-- Trendyol returns its own English vocabulary (Created, Picking, Invoiced,
-- Shipped, Delivered, Cancelled, UnPacked, UnSupplied, Returned, ...).
-- New writes go through `mapTrendyolStatus` in lib/mappers/trendyol.ts, but
-- existing rows still hold the raw value. Run this DML once on prod against
-- the local Postgres on the Hetzner VPS:
--
--   psql "$DATABASE_URL" -f scripts/backfill-trendyol-status.sql
--
-- Idempotent: the WHERE clause limits the update to the raw Trendyol values,
-- so re-running after the fix lands does nothing.

UPDATE "Order"
SET status = CASE
  WHEN status IN ('Shipped') THEN 'SHIPPED'
  WHEN status IN ('Delivered') THEN 'DELIVERED'
  WHEN status IN ('Cancelled','Returned') THEN 'CANCELLED'
  WHEN status IN ('Created','Picking','Invoiced','UnPacked','UnSupplied') THEN 'AWAITING_FULFILLMENT'
  ELSE status
END
WHERE marketplace = 'Trendyol'
  AND status IN ('Created','Picking','Invoiced','UnPacked','UnSupplied','Shipped','Delivered','Cancelled','Returned');
