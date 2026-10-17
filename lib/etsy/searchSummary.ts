/**
 * Market summary for the Chrome extension search bar (`/api/ext/research`, action
 * `search_enrich`), built from Etsy Open API v3 `findAllListingsActive` results.
 *
 * What the Etsy API gives us, and what it does not:
 * - `count`            -> total active listings matching the keywords (the "Results" figure).
 * - `price`            -> Money object {amount, divisor, currency_code}. This is the seller's
 *                         LIST price. Etsy does not expose sale/discount prices publicly, so
 *                         a listing shown on etsy.com as "$14.27 (50% off)" comes back as
 *                         $28.54. API prices are therefore labelled "list price" everywhere.
 * - `listing_type`     -> 'physical' | 'download' | 'both'. Keyword search mixes in digital
 *                         files (SVG/laser-cut templates at $2-5) for physical queries; we drop
 *                         'download' listings unless the query itself asks for digital items.
 * - `num_favorers`     -> lifetime favourites; heavily right-skewed, so we report the median.
 *
 * Prices are FX-normalised to USD and summarised with lib/research/stats (median, P25-P75,
 * Tukey-trimmed min/max). No arithmetic means.
 * Pure module: no I/O.
 */
import { summarizePrices, robustStats, type FxTable, type PriceSummary } from '@/lib/research/stats';

const DIGITAL_QUERY = /\b(svg|png|pdf|digital|download|printable|template|pattern|file|clipart|clip art|instant|editable|canva|mockup|font|laser\s*cut\s*file|cricut|dxf)\b/i;

export function queryWantsDigital(query: string): boolean {
  return DIGITAL_QUERY.test(query || '');
}

/** Money object -> number in major units. `amount` is an integer in minor units; never treat it as dollars. */
export function moneyToNumber(m: { amount?: unknown; divisor?: unknown } | null | undefined): number | null {
  if (!m) return null;
  const amount = Number(m.amount);
  const divisor = Number(m.divisor);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount / (Number.isFinite(divisor) && divisor > 0 ? divisor : 100);
}

export interface EtsySearchSummary {
  totalResults: number;
  /** Median list price (USD). Kept under the legacy name for pre-9.7 extensions. */
  avgPrice: number;
  medianPrice: number | null;
  p25Price: number | null;
  p75Price: number | null;
  /** Outlier-trimmed (Tukey) min/max — not the raw extremes. */
  minPrice: number;
  maxPrice: number;
  rawMinPrice: number | null;
  rawMaxPrice: number | null;
  currency: string;
  priceBasis: 'list_price';
  priceStats: PriceSummary;
  /** Legacy arithmetic mean (pre-9.7 extensions). */
  avgFavorites: number;
  medianFavorites: number | null;
  uniqueShops: number;
  competition: 'low' | 'medium' | 'high';
  sampled: number;
  /** Listings used after exclusions. */
  used: number;
  excludedDigital: number;
}

export function summarizeEtsySearch(
  searchData: { count?: number; results?: any[] } | null | undefined,
  opts: { query: string; fx?: FxTable },
): EtsySearchSummary {
  const all: any[] = Array.isArray(searchData?.results) ? searchData!.results! : [];
  const keepDigital = queryWantsDigital(opts.query);
  const items = keepDigital ? all : all.filter((i) => i?.listing_type !== 'download');
  // If the whole sample is digital the query is digital in practice; don't return an empty summary.
  const used = items.length === 0 ? all : items;
  const excludedDigital = all.length - used.length;

  const points = used.map((i) => ({ amount: moneyToNumber(i?.price), currency: i?.price?.currency_code || 'USD' }));
  const priceStats = summarizePrices(points, { currency: 'USD', fx: opts.fx || {}, kind: keepDigital ? 'digital' : 'physical' });
  const raw = robustStats(
    points
      .map((p) => (p.currency === 'USD' ? p.amount : p.amount != null && opts.fx?.[p.currency] ? p.amount * opts.fx[p.currency] : null))
      .filter((v): v is number => v != null),
    { trim: false },
  );

  const favs = used.map((i) => Number(i?.num_favorers)).filter((v) => Number.isFinite(v) && v >= 0);
  const favSorted = [...favs].sort((a, b) => a - b);
  const medianFavorites = favSorted.length
    ? Math.round(favSorted.length % 2 ? favSorted[(favSorted.length - 1) / 2] : (favSorted[favSorted.length / 2 - 1] + favSorted[favSorted.length / 2]) / 2)
    : null;
  const avgFav = favs.length ? favs.reduce((s, v) => s + v, 0) / favs.length : 0;

  const uniqueShops = new Set(used.map((i) => i?.shop_id).filter((v) => v != null)).size;
  // Shops among the top-N API results (max 100): many distinct sellers = fragmented, competitive.
  const competition = uniqueShops > 50 ? 'high' : uniqueShops > 20 ? 'medium' : 'low';

  return {
    totalResults: Number(searchData?.count) || 0,
    avgPrice: priceStats.median ?? 0,
    medianPrice: priceStats.median,
    p25Price: priceStats.p25,
    p75Price: priceStats.p75,
    minPrice: priceStats.min ?? 0,
    maxPrice: priceStats.max ?? 0,
    rawMinPrice: raw.min,
    rawMaxPrice: raw.max,
    currency: priceStats.currency,
    priceBasis: 'list_price',
    priceStats,
    avgFavorites: Math.round(avgFav),
    medianFavorites,
    uniqueShops,
    competition,
    sampled: all.length,
    used: used.length,
    excludedDigital,
  };
}
