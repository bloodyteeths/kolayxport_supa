// lib/research/priceGap.ts — research R4 "Price gap: Türkiye → abroad" (research.md §9, RR Job 6).
// Shared by `pages/api/research/price-gap.ts` (server) and `components/domain/research/products/PriceGapTable.tsx`
// (client). Pure: no React, no Prisma, no fetch.
//
// Honesty rules (research.md §3.1, founder decisions):
// - eBay/Etsy prices are `PriceSummary` from lib/research/stats (median / p25–p75, n). No means anywhere.
// - Shipping = median of the user's OWN label costs (Order.manualShippingCost, carrier from Shipment) per carrier and
//   weight band, international only. Below MIN_SAMPLE labels it is not shown (no rate-card guess); the user may
//   type their own number instead (kind `user`).
// - Landed cost and margin are always `estimate`; they are only computed when every input is known.
// - Match confidence comes from the offline AI matcher (`ArbitrageMatch.confidence` + `matchType`).
import { calculateEbayFees } from '@/lib/arbitrage/categoryFees';
import { MIN_SAMPLE, SMALL_SAMPLE, robustStats, type PriceSummary } from './stats';
import type { Confidence, Guarded, MetricKind, SourceNoteProps } from './types';

export type { PriceSummary };

// ─── Sources ────────────────────────────────────────────────────────────────

/** Product finder `?source=` (research.md §2.1). `trendyol` = Price gap (Pro). */
export const PRODUCT_SOURCES = ['search', 'trendyol'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

/** Price gap source picker: Trendyol category bestsellers · My Trendyol products · Paste a Trendyol link. */
export const GAP_FROM = ['category', 'mine', 'link'] as const;
export type GapFrom = (typeof GAP_FROM)[number];
export function isGapFrom(v: unknown): v is GapFrom {
  return typeof v === 'string' && (GAP_FROM as readonly string[]).includes(v);
}

/** Trendyol product id from a product link (`…-p-123456789`, optional query/hash), or null. */
export function parseTrendyolProductId(input: string | null | undefined): number | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/^\d{5,12}$/.test(s)) return Number(s);
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host !== 'trendyol.com' && !host.endsWith('.trendyol.com')) return null;
  const m = s.match(/-p-(\d{5,12})(?:[/?#]|$)/i);
  return m ? Number(m[1]) : null;
}

// ─── Weight bands and shipping ─────────────────────────────────────────────

export const WEIGHT_BANDS = ['0.5', '1', '2', '5', '5+'] as const;
export type WeightBand = (typeof WEIGHT_BANDS)[number];
const BAND_MAX: Record<WeightBand, number> = { '0.5': 0.5, '1': 1, '2': 2, '5': 5, '5+': Number.POSITIVE_INFINITY };
const BAND_MIN: Record<WeightBand, number> = { '0.5': 0, '1': 0.5, '2': 1, '5': 2, '5+': 5 };

export function isWeightBand(v: unknown): v is WeightBand {
  return typeof v === 'string' && (WEIGHT_BANDS as readonly string[]).includes(v);
}

/** kg → band (upper bound inclusive). Missing / invalid weight → null (the sample is not used). */
export function weightBand(kg: number | null | undefined): WeightBand | null {
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return null;
  for (const b of WEIGHT_BANDS) if (kg <= BAND_MAX[b]) return b;
  return '5+';
}

/** Band bounds for the label ("0.5–1 kg"). */
export function bandBounds(b: WeightBand): { min: number; max: number | null } {
  return { min: BAND_MIN[b], max: Number.isFinite(BAND_MAX[b]) ? BAND_MAX[b] : null };
}

/** Carrier names as stored on `Shipment.carrier` → stable lower-case key. */
export function carrierKey(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('fedex')) return 'fedex';
  if (s.includes('ups')) return 'ups';
  if (s.includes('dhl')) return 'dhl';
  if (s.includes('shippo')) return 'shippo';
  if (s.includes('aras')) return 'aras';
  if (s.includes('mng')) return 'mng';
  if (s.includes('ptt')) return 'ptt';
  return s.replace(/[^a-z0-9]+/g, '-').slice(0, 24) || null;
}

/** One own label: carrier, package weight and the carrier's final cost already converted to USD. */
export interface ShippingSample {
  carrier: string;
  weightKg: number | null;
  costUsd: number;
}

/** Median own label cost for one carrier × weight band (international labels only). */
export interface ShippingOption {
  carrier: string;
  band: WeightBand;
  /** Labels used after trimming. */
  n: number;
  /** null below MIN_SAMPLE labels. */
  medianUsd: number | null;
  p25Usd: number | null;
  p75Usd: number | null;
  quality: 'ok' | 'small' | 'insufficient';
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Group own labels by carrier × band; robust median (Tukey-trimmed). Sorted by carrier, then band order. */
export function shippingOptions(samples: ShippingSample[]): ShippingOption[] {
  const groups = new Map<string, { carrier: string; band: WeightBand; costs: number[] }>();
  for (const s of samples) {
    const carrier = carrierKey(s.carrier);
    const band = weightBand(s.weightKg);
    if (!carrier || !band || !Number.isFinite(s.costUsd) || s.costUsd <= 0) continue;
    const key = `${carrier}|${band}`;
    const g = groups.get(key) ?? { carrier, band, costs: [] };
    g.costs.push(s.costUsd);
    groups.set(key, g);
  }
  const out: ShippingOption[] = [];
  groups.forEach((g) => {
    const st = robustStats(g.costs);
    const quality = st.n < MIN_SAMPLE ? 'insufficient' : st.n < SMALL_SAMPLE ? 'small' : 'ok';
    out.push({
      carrier: g.carrier,
      band: g.band,
      n: st.n,
      medianUsd: quality === 'insufficient' ? null : st.median,
      p25Usd: quality === 'insufficient' ? null : st.p25,
      p75Usd: quality === 'insufficient' ? null : st.p75,
      quality,
    });
  });
  return out.sort((a, b) => a.carrier.localeCompare(b.carrier) || WEIGHT_BANDS.indexOf(a.band) - WEIGHT_BANDS.indexOf(b.band));
}

/**
 * The shipping option to use. With a requested carrier that has labels, it stays on that carrier: the requested band
 * when present; otherwise the band of `defaultKg` (0.5 kg when unknown) if it is usable, else that carrier's band
 * closest to it (usable first). Without a carrier: the carrier with the most usable labels in the band, else the most-used usable option.
 */
export function pickShipping(
  options: ShippingOption[],
  want: { carrier?: string | null; band?: WeightBand | null; defaultKg?: number | null } = {},
): ShippingOption | null {
  if (!options.length) return null;
  const band = want.band ?? weightBand(want.defaultKg ?? 0.5) ?? '0.5';
  const usable = (o: ShippingOption) => o.medianUsd !== null;
  const own = want.carrier ? options.filter((o) => o.carrier === want.carrier) : [];
  if (own.length) {
    const exact = own.find((o) => o.band === band);
    if (exact && (want.band || usable(exact))) return exact;
    const at = WEIGHT_BANDS.indexOf(band);
    const dist = (o: ShippingOption) => Math.abs(WEIGHT_BANDS.indexOf(o.band) - at);
    return [...own].sort((a, b) => Number(usable(b)) - Number(usable(a)) || dist(a) - dist(b) || b.n - a.n)[0];
  }
  const inBand = options.filter((o) => o.band === band);
  const best = [...inBand].sort((a, b) => Number(usable(b)) - Number(usable(a)) || b.n - a.n)[0];
  if (best) return best;
  const any = [...options].filter(usable).sort((a, b) => b.n - a.n)[0];
  return any ?? null;
}

/** Weight bands offered for a carrier (all bands with labels when no carrier is chosen). */
export function bandsForCarrier(options: ShippingOption[], carrier: string | null | undefined): WeightBand[] {
  return WEIGHT_BANDS.filter((b) => options.some((o) => o.band === b && (!carrier || o.carrier === carrier)));
}

// ─── Match confidence ─────────────────────────────────────────────────────

export type MatchType = 'exact' | 'equivalent' | 'similar';

/** Matcher rule: `none` and confidence < 0.5 are not matches (lib/arbitrage/matcher.ts). */
export const MIN_MATCH_CONFIDENCE = 0.5;

/** AI confidence (0–1) + match type → tier. Exact/equivalent ≥ 0.85 = high; any type ≥ 0.7 = medium; else low. */
export function confidenceTier(confidence: number, matchType: string): Confidence {
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c >= 0.85 && (matchType === 'exact' || matchType === 'equivalent')) return 'high';
  if (c >= 0.7) return 'medium';
  return 'low';
}

export function isUsableMatch(m: { confidence: number; matchType: string }): boolean {
  return m.matchType !== 'none' && Number.isFinite(m.confidence) && m.confidence >= MIN_MATCH_CONFIDENCE;
}

// ─── API contract (`GET /api/research/price-gap`) ─────────────────────────

export interface GapEbayMatch {
  itemId: string;
  /** Entity-decoded. */
  title: string;
  price: number;
  currency: string;
  /** `estimatedSoldQuantity` style lifetime counter: shown as "(all time)", never as a rate. */
  soldAllTime: number | null;
  url: string | null;
  imageUrl: string | null;
  confidence: number;
  matchType: MatchType;
}

export interface PriceGapRow {
  /** Trendyol product id. */
  id: string;
  /** Entity-decoded Trendyol (Turkish) title. Never copied into an English listing title. */
  title: string;
  brand: string | null;
  url: string | null;
  imageUrl: string | null;
  /** https image URLs (Trendyol CDN). Only the seller's own products (`from=mine`) send them as listing photos. */
  images: string[];
  /** Trendyol price in TRY (Measured, scraped / own catalog). */
  trPriceTry: number | null;
  category: { slug: string | null; name: string | null };
  /** Best match tier; null = no eBay match yet. */
  confidence: Confidence | null;
  /** US eBay active listings matched to this product, in USD (median over the matched items). */
  ebay: PriceSummary | null;
  ebayCategoryId: string | null;
  matches: GapEbayMatch[];
  /** Etsy US prices from the shared research cache only (no live Etsy call here). null = not checked yet. */
  etsy: (PriceSummary & { fetchedAt: string }) | null;
  /** English search phrase (offline matcher translation) used for the Etsy cache lookup and the prefill. */
  englishQuery: string | null;
  /** Amazon is only ever filled with confirmed Creators API eligibility (research.md §3.2); never in v1. */
  amazon?: PriceSummary | null;
  /** When the Trendyol data was fetched (ISO). */
  fetchedAt: string | null;
}

export interface GapCategory {
  slug: string;
  /** Data label (category names from the Trendyol index / category table), not a UI string. */
  label: string;
  labelTr: string;
  products: number;
}

export interface GapFx {
  /** USD for 1 TRY; null = no rate today (landed cost and margin are not computed). */
  usdPerTry: number | null;
  source: 'exchangerate-api.com';
  fetchedAt: string;
}

export interface PriceGapData {
  from: GapFrom;
  category: string | null;
  categories: GapCategory[];
  fx: GapFx;
  /** Own international label costs per carrier × weight band (empty = no label costs recorded). */
  shipping: ShippingOption[];
  /** International labels with a cost that were left out (no currency rate, no carrier). */
  shippingExcluded: number;
  /**
   * International labels left out because the order still has the schema default weight (`Order.weightKg` 0.5,
   * never edited): the real package weight is unknown, so the label cannot be put in a weight band honestly.
   */
  shippingExcludedDefaultWeight: number;
  /** Default package weight from the shipper profile (kg), for the default band. */
  defaultWeightKg: number | null;
  rows: PriceGapRow[];
  /** Products in the source that have no eBay match yet (not in `rows` when `from=category`). */
  unmatched: number;
  /**
   * `from=mine`: own products whose storefront product id is unknown (barcode not in the Trendyol index yet), so they
   * cannot be matched or linked. Not in `rows`.
   */
  unresolved: number;
}

export type { SourceNoteProps };

// ─── Margin (MarginBox) ───────────────────────────────────────────────────

export interface ShippingInput {
  usd: number | null;
  kind: Extract<MetricKind, 'measured' | 'user'>;
  /** Labels behind a measured value. */
  n?: number;
  carrier?: string;
  band?: WeightBand;
}

export interface MarginBreakdown {
  sellUsd: number;
  costUsd: number;
  shippingUsd: number;
  feeRatePct: number;
  finalValueFeeUsd: number;
  paymentFeeUsd: number;
  internationalFeeUsd: number;
  feesUsd: number;
  /** cost + shipping. */
  landedUsd: number;
  profitUsd: number;
  /** profit / sell price, as a fraction (0.2 = 20 %). */
  marginFraction: number;
}

export interface RowMargin {
  landed: Guarded<number>;
  margin: Guarded<number>;
  /** Only when every input is known. */
  breakdown: MarginBreakdown | null;
}

/** Pure eBay US landed-margin math (fee table from lib/arbitrage/categoryFees, international fee included). */
export function computeMargin(input: { trPriceTry: number; usdPerTry: number; shippingUsd: number; sellUsd: number; ebayCategoryId?: string | null }): MarginBreakdown {
  const costUsd = input.trPriceTry * input.usdPerTry;
  const fees = calculateEbayFees(input.sellUsd, input.ebayCategoryId ?? '', { includeInternational: true });
  const landedUsd = costUsd + input.shippingUsd;
  const profitUsd = input.sellUsd - landedUsd - fees.totalFees;
  return {
    sellUsd: round2(input.sellUsd),
    costUsd: round2(costUsd),
    shippingUsd: round2(input.shippingUsd),
    feeRatePct: fees.feeRate,
    finalValueFeeUsd: round2(fees.finalValueFee),
    paymentFeeUsd: round2(fees.paymentFee),
    internationalFeeUsd: round2(fees.internationalFee),
    feesUsd: round2(fees.totalFees),
    landedUsd: round2(landedUsd),
    profitUsd: round2(profitUsd),
    marginFraction: input.sellUsd > 0 ? Math.round((profitUsd / input.sellUsd) * 1000) / 1000 : 0,
  };
}

/** Sell price used for the margin: the eBay median, only when the sample is not "insufficient"/"implausible". */
export function sellPrice(ebay: PriceSummary | null): number | null {
  if (!ebay || ebay.median === null) return null;
  if (ebay.quality === 'insufficient' || ebay.quality === 'implausible') return null;
  return ebay.median;
}

/** Landed cost + margin for one row as guarded estimates (reason keys under `research.gap.guard`). */
export function rowMargin(row: Pick<PriceGapRow, 'trPriceTry' | 'ebay' | 'ebayCategoryId'>, fx: Pick<GapFx, 'usdPerTry'>, ship: ShippingInput | null): RowMargin {
  const fail = (reasonKey: string, reasonParams?: Record<string, string | number>): Guarded<number> => ({
    value: null,
    kind: 'estimate',
    guard: { ok: false, reasonKey, reasonParams },
  });
  const ok = (value: number): Guarded<number> => ({ value, kind: 'estimate', guard: { ok: true } });

  let landedErr: Guarded<number> | null = null;
  if (row.trPriceTry === null || !(row.trPriceTry > 0)) landedErr = fail('research.gap.guard.noTrPrice');
  else if (fx.usdPerTry === null || !(fx.usdPerTry > 0)) landedErr = fail('research.gap.guard.noFx');
  else if (!ship || ship.usd === null || !(ship.usd >= 0)) landedErr = fail('research.gap.guard.noShipping', { min: MIN_SAMPLE });

  if (landedErr) return { landed: landedErr, margin: landedErr, breakdown: null };

  const costUsd = (row.trPriceTry as number) * (fx.usdPerTry as number);
  const landed = ok(round2(costUsd + (ship!.usd as number)));
  const sell = sellPrice(row.ebay);
  if (sell === null) {
    const n = row.ebay?.n ?? 0;
    return {
      landed,
      margin: row.ebay ? fail('research.gap.guard.ebaySample', { n, min: MIN_SAMPLE }) : fail('research.gap.guard.noMatch'),
      breakdown: null,
    };
  }
  const b = computeMargin({ trPriceTry: row.trPriceTry as number, usdPerTry: fx.usdPerTry as number, shippingUsd: ship!.usd as number, sellUsd: sell, ebayCategoryId: row.ebayCategoryId });
  return { landed, margin: ok(b.profitUsd), breakdown: b };
}

// ─── Rows ─────────────────────────────────────────────────────────────────

/** Split rows: shown by default (high/medium) vs collapsed ("Show N low-confidence matches") vs unmatched. */
export function splitByConfidence<T extends Pick<PriceGapRow, 'confidence'>>(rows: T[]): { main: T[]; low: T[]; none: T[] } {
  const main: T[] = [];
  const low: T[] = [];
  const none: T[] = [];
  for (const r of rows) {
    if (r.confidence === 'high' || r.confidence === 'medium') main.push(r);
    else if (r.confidence === 'low') low.push(r);
    else none.push(r);
  }
  return { main, low, none };
}

const CONF_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** Default order: computed margins first (highest profit), then by confidence, then title. Stable, pure. */
export function sortGapRows<T extends PriceGapRow>(rows: T[], marginOf: (r: T) => number | null): T[] {
  return rows
    .map((r, i) => ({ r, i, m: marginOf(r) }))
    .sort((a, b) => {
      if (a.m !== null && b.m === null) return -1;
      if (a.m === null && b.m !== null) return 1;
      if (a.m !== null && b.m !== null && a.m !== b.m) return b.m - a.m;
      const ca = a.r.confidence ? CONF_ORDER[a.r.confidence] : 3;
      const cb = b.r.confidence ? CONF_ORDER[b.r.confidence] : 3;
      if (ca !== cb) return ca - cb;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

// ─── Prefill ("List on eBay") ─────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'new', 'set', 'of', 'in', 'to', 'a', 'an', 'by', 'on']);

/** English keywords from the matched eBay titles + the English query (never the Turkish title). */
export function englishKeywords(row: Pick<PriceGapRow, 'englishQuery' | 'matches'>, max = 13): string[] {
  const text = [row.englishQuery ?? '', ...row.matches.slice(0, 3).map((m) => m.title)].join(' ').toLowerCase();
  const out: string[] = [];
  for (const raw of text.split(/[\s,|/()\-–—]+/)) {
    const w = raw.replace(/[^a-z0-9'&]/g, '');
    if (w.length < 3 || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * `writeListingPrefill` payload for "List on eBay" (research.md §9, RR Job 6). Opens the creator only: nothing is
 * published, the seller reviews everything. Title is left to the creator's AI (English); price = eBay median only
 * when the sample is usable.
 *
 * Images: research.md §9 asks for HMAC-signed rehosted images; no rehost endpoint exists yet (integrator need). Until
 * then only the seller's OWN product photos (`from=mine`) are sent as listing photos. Category bestsellers and pasted
 * links are other sellers' photos: they travel as `research.referenceImageUrls` only, never as listing images.
 */
export function ebayPrefill(row: PriceGapRow, margin: RowMargin, from: GapFrom = 'category') {
  const sell = sellPrice(row.ebay);
  const images = row.images.filter((u) => /^https:\/\//i.test(u)).slice(0, 12);
  const own = from === 'mine';
  return {
    target: 'ebay' as const,
    source: 'arbitrage' as const,
    title: undefined,
    keywords: englishKeywords(row),
    price: sell ?? undefined,
    currency: sell !== null ? 'USD' : undefined,
    imageUrls: own ? images : [],
    categoryHint: row.ebayCategoryId ?? undefined,
    research: {
      tool: 'price-gap',
      from: 'research-hub',
      source: from,
      trendyolId: row.id,
      trendyolUrl: row.url,
      trPriceTry: row.trPriceTry,
      ebay: row.ebay ? { median: row.ebay.median, p25: row.ebay.p25, p75: row.ebay.p75, n: row.ebay.n, currency: row.ebay.currency } : null,
      landedUsd: margin.landed.value,
      profitUsd: margin.margin.value,
      comparables: row.matches.slice(0, 5).map((m) => ({ title: m.title, price: m.price, currency: m.currency })),
      referenceImageUrls: own ? [] : images.slice(0, 4),
      fetchedAt: row.fetchedAt,
    },
  };
}

// ─── Index freshness ("Prices updated {date}" · Refresh prices) ──────────────────────────────────────

/** A manual refresh within this window of the newest Trendyol read is pointless (server: same cooldown). */
export const GAP_REFRESH_COOLDOWN_MS = 3_600_000;

/** Newest Trendyol read among the rows (ISO), or null when no row carries one. */
export function gapIndexUpdatedAt(rows: ReadonlyArray<Pick<PriceGapRow, 'fetchedAt'>>): string | null {
  let best: number | null = null;
  for (const r of rows) {
    const t = r.fetchedAt ? Date.parse(r.fetchedAt) : Number.NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** True when "Refresh prices" can do something: no read yet, or the newest read is older than the cooldown. */
export function canRefreshGapIndex(updatedAt: string | null, nowMs: number): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  return !Number.isFinite(t) || nowMs - t >= GAP_REFRESH_COOLDOWN_MS;
}
