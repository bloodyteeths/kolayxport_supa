/**
 * Sales from crowd readings (Trendyol, Hepsiburada). The marketplaces publish no sales numbers, so:
 *
 * - MEASURED: rating growth. Two readings of a product's public rating count ≥ 3 days apart give new ratings per
 *   30 days. That is a fact about the page, not a guess.
 * - ESTIMATE: sales = rating growth × orders-per-rating. The ratio is calibrated from connected KolayXport stores
 *   (their real orders vs their products' public rating counts, aggregated; lib/market/calibration). Without a
 *   calibration there is no sales number, only the measured rating growth and the marketplace's own order badge.
 * - FLOOR: Trendyol's order badge ("100+") is the marketplace's own lower bound and is shown as such.
 */

export interface Reading { at: Date; ratingCount: number | null; reviewCount?: number | null; price: number | null; favorites?: number | null; basketCount?: number | null }

export interface Calibration { ordersPerRating: number; n: number; source: string; computedAt: string }

export interface SalesView {
  /** New ratings per 30 days (measured), null below 2 readings ≥ 3 days apart. */
  ratingsPer30d: number | null;
  spanDays: number | null;
  /** Estimated orders per 30 days (rating growth × calibration), null without both. */
  salesPer30d: number | null;
  revenuePer30d: number | null;
  /** Same estimate per day (30-day average), for the "per day" view sellers know from Etsy. */
  salesPerDay: number | null;
  revenuePerDay: number | null;
  /** Lifetime orders estimate from the rating count (× calibration), null without a calibration. */
  lifetimeSales: number | null;
  /** Order badge lower bound ("100+" → 100), the marketplace's own number. */
  ordersAtLeast: number | null;
  kind: 'measured' | 'estimate' | 'none';
  calibration: Calibration | null;
}

export const MIN_SPAN_DAYS = 3;
const DAY = 86_400_000;

/** Pure: first and last usable rating readings in the window (default 60 days back from the latest). */
export function ratingGrowth(readings: Reading[], windowDays = 60): { per30d: number; spanDays: number } | null {
  const rs = readings.filter((r) => r.ratingCount != null).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (rs.length < 2) return null;
  const last = rs[rs.length - 1];
  const from = last.at.getTime() - windowDays * DAY;
  const first = rs.find((r) => r.at.getTime() >= from) ?? rs[0];
  const spanDays = (last.at.getTime() - first.at.getTime()) / DAY;
  if (spanDays < MIN_SPAN_DAYS) return null;
  const delta = Math.max(0, (last.ratingCount as number) - (first.ratingCount as number));
  return { per30d: Math.round((delta / spanDays) * 30 * 10) / 10, spanDays: Math.round(spanDays) };
}

export function salesView(readings: Reading[], opts: { price: number | null; ratingCount: number | null; ordersAtLeast: number | null; calibration: Calibration | null }): SalesView {
  const g = ratingGrowth(readings);
  const cal = opts.calibration;
  const salesPer30d = g && cal ? Math.round(g.per30d * cal.ordersPerRating) : null;
  const revenuePer30d = salesPer30d != null && opts.price != null ? Math.round(salesPer30d * opts.price) : null;
  const lifetimeSales = cal && opts.ratingCount != null ? Math.round(opts.ratingCount * cal.ordersPerRating) : null;
  return {
    ratingsPer30d: g?.per30d ?? null,
    spanDays: g?.spanDays ?? null,
    salesPer30d,
    revenuePer30d,
    salesPerDay: salesPer30d != null ? Math.round((salesPer30d / 30) * 10) / 10 : null,
    revenuePerDay: revenuePer30d != null ? Math.round(revenuePer30d / 30) : null,
    lifetimeSales,
    ordersAtLeast: opts.ordersAtLeast,
    kind: salesPer30d != null || lifetimeSales != null ? 'estimate' : g ? 'measured' : 'none',
    calibration: cal,
  };
}

/** Pure: one point per day (last reading of the day) for price/rating/favorite charts. */
export function dailySeries(readings: Reading[]): Array<{ day: string; price: number | null; ratingCount: number | null; favorites: number | null; basketCount: number | null }> {
  const byDay = new Map<string, Reading>();
  for (const r of [...readings].sort((a, b) => a.at.getTime() - b.at.getTime())) byDay.set(r.at.toISOString().slice(0, 10), r);
  return [...byDay.entries()].map(([day, r]) => ({ day, price: r.price, ratingCount: r.ratingCount, favorites: r.favorites ?? null, basketCount: r.basketCount ?? null }));
}
