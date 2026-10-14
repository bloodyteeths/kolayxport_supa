/**
 * Per-listing daily stats (owner W3) — the data SEO experiments are evaluated on.
 *
 * writeDailyTotals: stores Etsy's lifetime counters (viewsTotal, favoritesTotal)
 *   for today plus the day's deltas. A delta is null when there is no row for
 *   the previous day or it would be negative (Etsy recount).
 * aggregateSalesForDay: units / orders / revenue per listing from our own
 *   orders: OrderItem.listingRef joined to Order (Etsy source, uiOrderDate,
 *   CANCELLED excluded). Orders whose items have no listingRef yet (before the
 *   W4 backfill) fall back to rawData.transactions.
 */
import prisma from '@/lib/prisma';

export type DailyTotalsRow = {
  listingId: bigint;
  views: number | null;
  favorites: number | null;
  state: string | null;
  taxonomyId: number | null;
  currency?: string | null;
};

/** UTC midnight of the given instant. */
export function utcDate(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Pure: delta between two lifetime counters (null when unknown or negative). */
export function computeDelta(prevTotal: number | null | undefined, total: number | null | undefined): number | null {
  if (prevTotal === null || prevTotal === undefined || total === null || total === undefined) return null;
  const d = Number(total) - Number(prevTotal);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

export async function writeDailyTotals(shopId: string, rows: DailyTotalsRow[], at: Date = new Date()): Promise<number> {
  if (!rows.length) return 0;
  const date = utcDate(at);
  const yesterday = new Date(date.getTime() - 24 * 60 * 60_000);
  const ids = rows.map((r) => r.listingId);
  const prev = await prisma.etsyListingDailyStat.findMany({
    where: { etsyShopId: shopId, date: yesterday, etsyListingId: { in: ids } },
    select: { etsyListingId: true, viewsTotal: true, favoritesTotal: true },
  });
  const prevMap = new Map(prev.map((p) => [String(p.etsyListingId), p]));
  let written = 0;
  // Chunked upserts; one row per listing per day.
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await prisma.$transaction(
      chunk.map((r) => {
        const p = prevMap.get(String(r.listingId));
        const views = computeDelta(p?.viewsTotal, r.views);
        const favorites = computeDelta(p?.favoritesTotal, r.favorites);
        return prisma.etsyListingDailyStat.upsert({
          where: { etsyShopId_etsyListingId_date: { etsyShopId: shopId, etsyListingId: r.listingId, date } },
          create: {
            etsyShopId: shopId,
            etsyListingId: r.listingId,
            date,
            viewsTotal: r.views,
            favoritesTotal: r.favorites,
            views,
            favorites,
            state: r.state,
            taxonomyId: r.taxonomyId,
            currency: r.currency ?? null,
          },
          update: {
            viewsTotal: r.views,
            favoritesTotal: r.favorites,
            views,
            favorites,
            state: r.state,
            taxonomyId: r.taxonomyId,
          },
        });
      }),
    );
    written += chunk.length;
  }
  return written;
}

/** Snapshot today's totals for every cached listing of a shop (no Etsy call). */
export async function writeDailyTotalsFromCache(shopId: string, at: Date = new Date()): Promise<number> {
  const listings = await prisma.etsyListing.findMany({
    where: { etsyShopId: shopId, state: 'active' },
    select: { etsyListingId: true, views: true, numFavorers: true, state: true, taxonomyId: true, priceCurrencyCode: true },
  });
  return writeDailyTotals(
    shopId,
    listings.map((l) => ({
      listingId: l.etsyListingId,
      views: l.views,
      favorites: l.numFavorers,
      state: l.state,
      taxonomyId: l.taxonomyId,
      currency: l.priceCurrencyCode,
    })),
    at,
  );
}

type SalesRow = { listing_id: string; units: bigint | number | null; orders: bigint | number | null; revenue: string | number | null };

/**
 * Write unitsSold / orders / revenueMinor for one UTC day for every listing of
 * the shop that sold that day. Returns listings touched.
 */
export async function aggregateSalesForDay(shopId: string, day: Date): Promise<number> {
  const shop = await prisma.etsyShop.findUnique({ where: { shopId }, select: { userId: true } });
  if (!shop) return 0;
  const start = utcDate(day);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  const rows = await prisma.$queryRaw<SalesRow[]>`
    WITH o AS (
      SELECT id, "rawData"::jsonb AS raw
      FROM "Order"
      WHERE "userId" = ${shop.userId}
        AND "uiOrderDate" >= ${start} AND "uiOrderDate" < ${end}
        AND COALESCE(status, '') <> 'CANCELLED'
        AND (source = 'etsy-api' OR "rawData"::jsonb ? 'receipt_id')
    ),
    items AS (
      SELECT o.id AS oid, oi."listingRef" AS lid, oi.quantity AS q,
             COALESCE(oi."totalPrice", oi."unitPrice" * oi.quantity, 0)::numeric AS amt
      FROM o JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE oi."listingRef" IS NOT NULL
      UNION ALL
      SELECT o.id, t->>'listing_id',
             COALESCE((t->>'quantity')::int, 1),
             COALESCE((t->'price'->>'amount')::numeric / NULLIF((t->'price'->>'divisor')::numeric, 0), 0)
               * COALESCE((t->>'quantity')::int, 1)
      FROM o, jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.raw->'transactions') = 'array' THEN o.raw->'transactions' ELSE '[]'::jsonb END
      ) t
      WHERE NOT EXISTS (SELECT 1 FROM "OrderItem" x WHERE x."orderId" = o.id AND x."listingRef" IS NOT NULL)
    )
    SELECT items.lid AS listing_id, SUM(items.q) AS units, COUNT(DISTINCT items.oid) AS orders, SUM(items.amt) AS revenue
    FROM items
    JOIN "EtsyListing" l ON l."etsyShopId" = ${shopId} AND l."etsyListingId"::text = items.lid
    GROUP BY items.lid`;
  let touched = 0;
  for (const r of rows) {
    let listingId: bigint;
    try {
      listingId = BigInt(r.listing_id);
    } catch {
      continue;
    }
    const unitsSold = Number(r.units || 0);
    const orders = Number(r.orders || 0);
    const revenueMinor = Math.round(Number(r.revenue || 0) * 100);
    await prisma.etsyListingDailyStat.upsert({
      where: { etsyShopId_etsyListingId_date: { etsyShopId: shopId, etsyListingId: listingId, date: start } },
      create: { etsyShopId: shopId, etsyListingId: listingId, date: start, unitsSold, orders, revenueMinor },
      update: { unitsSold, orders, revenueMinor },
    });
    touched++;
  }
  return touched;
}
