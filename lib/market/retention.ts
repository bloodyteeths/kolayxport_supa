/**
 * Crowd market data retention: hourly readings are kept 90 days, then thinned to the first reading of each day
 * (enough for sales deltas and price history). Search/position readings are thinned the same way after 90 days.
 * Scheduler job 'market-retention' (daily).
 */
import prisma from '@/lib/prisma';

export async function runMarketRetention(): Promise<{ products: number; searches: number }> {
  const products = await prisma.$executeRawUnsafe(`
    DELETE FROM "MarketProductObservation" o
    USING (
      SELECT id, row_number() OVER (PARTITION BY mkt, "productId", date_trunc('day', "hourBucket") ORDER BY "hourBucket") AS rn
      FROM "MarketProductObservation" WHERE "hourBucket" < now() - interval '90 days'
    ) x
    WHERE o.id = x.id AND x.rn > 1`);
  const searches = await prisma.$executeRawUnsafe(`
    DELETE FROM "MarketSearchObservation" o
    USING (
      SELECT id, row_number() OVER (PARTITION BY mkt, "queryKey", page, date_trunc('day', "hourBucket") ORDER BY "hourBucket") AS rn
      FROM "MarketSearchObservation" WHERE "hourBucket" < now() - interval '90 days'
    ) x
    WHERE o.id = x.id AND x.rn > 1`);
  return { products, searches };
}
