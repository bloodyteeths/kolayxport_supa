/**
 * Official Amazon SP-API product signals for the Chrome extension overlay.
 *
 *   Catalog Items 2022-04-01  → Best Seller Rank (salesRanks.displayGroupRanks
 *                                = top-level BSR, classificationRanks = sub-ranks)
 *   Product Pricing v0         → competing offer counts + buy box price
 *                                (getCompetitivePricing, 20 ASINs per call)
 *
 * Both need the seller's own SP-API token and the matching app roles. When a
 * role is missing Amazon answers 403; we then stop calling that API for the
 * seller for 6 hours and report `access_denied` so the extension falls back to
 * page data instead of showing anything made up.
 */
import { callSpApiWithRetry, type AmazonRegion } from '../integrations/amazonClient';

export interface AmazonProductSignals {
  asin: string;
  /** Top-level Best Seller Rank (e.g. #1,234 in Home & Kitchen) */
  bsr: number | null;
  bsrCategory: string | null;
  subRanks: Array<{ rank: number; title: string }>;
  brand: string | null;
  /** Competing offers, condition New / Any */
  offerCountNew: number | null;
  offerCountAny: number | null;
  /** Buy box landed price (New) */
  buyBoxPrice: number | null;
  currency: string | null;
}

export type SignalsErrorCode = 'access_denied' | 'failed';

export interface SignalsResult {
  items: Record<string, AmazonProductSignals>;
  errors: { catalog?: SignalsErrorCode; pricing?: SignalsErrorCode };
}

function empty(asin: string): AmazonProductSignals {
  return {
    asin, bsr: null, bsrCategory: null, subRanks: [], brand: null,
    offerCountNew: null, offerCountAny: null, buyBoxPrice: null, currency: null,
  };
}

// ---------------------------------------------------------------------------
// Pure mappers (unit-tested with fixtures)
// ---------------------------------------------------------------------------

/** Catalog Items 2022-04-01 `items[]` → rank/brand per ASIN for one marketplace. */
export function mapCatalogItems(items: any[], marketplaceId: string): Record<string, Partial<AmazonProductSignals>> {
  const out: Record<string, Partial<AmazonProductSignals>> = {};
  for (const item of Array.isArray(items) ? items : []) {
    const asin = typeof item?.asin === 'string' ? item.asin.toUpperCase() : null;
    if (!asin) continue;
    const ranksAll: any[] = Array.isArray(item.salesRanks) ? item.salesRanks : [];
    const ranks = ranksAll.find((r) => r?.marketplaceId === marketplaceId) || null;
    const display: any[] = Array.isArray(ranks?.displayGroupRanks) ? ranks.displayGroupRanks : [];
    const classification: any[] = Array.isArray(ranks?.classificationRanks) ? ranks.classificationRanks : [];
    // The top-level (display group) rank is the "Best Sellers Rank" shown on
    // the page and the one BSR→sales curves are fitted on. If several exist,
    // the best (lowest) rank is the primary one.
    const top = display
      .filter((d) => Number.isFinite(Number(d?.rank)) && Number(d.rank) > 0)
      .sort((a, b) => Number(a.rank) - Number(b.rank))[0];
    const summaries: any[] = Array.isArray(item.summaries) ? item.summaries : [];
    const summary = summaries.find((s) => s?.marketplaceId === marketplaceId) || summaries[0];
    out[asin] = {
      bsr: top ? Number(top.rank) : null,
      bsrCategory: top?.title ?? null,
      subRanks: classification
        .filter((c) => Number.isFinite(Number(c?.rank)) && Number(c.rank) > 0)
        .map((c) => ({ rank: Number(c.rank), title: String(c.title ?? '') })),
      brand: summary?.brand ?? null,
    };
  }
  return out;
}

/** Product Pricing v0 getCompetitivePricing `payload[]` → offers + buy box per ASIN. */
export function mapCompetitivePricing(payload: any[]): Record<string, Partial<AmazonProductSignals>> {
  const out: Record<string, Partial<AmazonProductSignals>> = {};
  for (const entry of Array.isArray(payload) ? payload : []) {
    const asin = String(entry?.ASIN ?? entry?.Product?.Identifiers?.MarketplaceASIN?.ASIN ?? '').toUpperCase();
    if (!asin || entry?.status !== 'Success') continue;
    const cp = entry?.Product?.CompetitivePricing || {};
    const counts: any[] = Array.isArray(cp.NumberOfOfferListings) ? cp.NumberOfOfferListings : [];
    const countFor = (cond: string) => {
      const c = counts.find((x) => String(x?.condition).toLowerCase() === cond);
      const n = Number(c?.Count);
      return c && Number.isFinite(n) ? n : null;
    };
    const prices: any[] = Array.isArray(cp.CompetitivePrices) ? cp.CompetitivePrices : [];
    // CompetitivePriceId "1" = New buy box ("2" = Used buy box).
    const bb = prices.find((p) => String(p?.CompetitivePriceId) === '1') ||
      prices.find((p) => String(p?.condition).toLowerCase() === 'new');
    const landed = bb?.Price?.LandedPrice || bb?.Price?.ListingPrice || null;
    const amount = Number(landed?.Amount);
    const offerCountNew = countFor('new');
    let offerCountAny = countFor('any');
    if (offerCountAny == null && counts.length) {
      offerCountAny = counts.reduce((s, c) => s + (Number(c?.Count) || 0), 0);
    }
    out[asin] = {
      offerCountNew,
      offerCountAny,
      buyBoxPrice: Number.isFinite(amount) && amount > 0 ? amount : null,
      currency: landed?.CurrencyCode ?? null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching with per-seller 403 cooldown + short in-memory cache
// ---------------------------------------------------------------------------

const DENIED_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const deniedUntil = new Map<string, number>();
const cache = new Map<string, { at: number; data: AmazonProductSignals }>();

/** Test hook. */
export function resetSignalsState(): void {
  deniedUntil.clear();
  cache.clear();
}

function isDenied(key: string): boolean {
  const until = deniedUntil.get(key);
  if (!until) return false;
  if (until > Date.now()) return true;
  deniedUntil.delete(key);
  return false;
}

function classify(err: unknown): SignalsErrorCode {
  const msg = String((err as any)?.message || err || '');
  return /\b403\b|Unauthorized|AccessDenied/i.test(msg) ? 'access_denied' : 'failed';
}

type Fetcher = typeof callSpApiWithRetry;

export async function fetchProductSignals(params: {
  token: string;
  region: AmazonRegion;
  marketplaceId: string;
  asins: string[];
  sellerKey: string;
  fetcher?: Fetcher;
}): Promise<SignalsResult> {
  const { token, region, marketplaceId, sellerKey } = params;
  const fetcher = params.fetcher || callSpApiWithRetry;
  const asins = Array.from(new Set(params.asins.map((a) => a.toUpperCase())))
    .filter((a) => /^[A-Z0-9]{10}$/.test(a))
    .slice(0, 20);

  const items: Record<string, AmazonProductSignals> = {};
  const errors: SignalsResult['errors'] = {};
  const now = Date.now();
  const missing: string[] = [];
  for (const a of asins) {
    const hit = cache.get(`${marketplaceId}:${a}`);
    if (hit && now - hit.at < CACHE_TTL_MS) items[a] = hit.data;
    else missing.push(a);
  }
  if (!missing.length) return { items, errors };

  const merged: Record<string, AmazonProductSignals> = {};
  for (const a of missing) merged[a] = empty(a);
  let gotAny = false;

  const catalogKey = `catalog:${sellerKey}`;
  if (isDenied(catalogKey)) {
    errors.catalog = 'access_denied';
  } else {
    try {
      const resp = await fetcher(
        `/catalog/2022-04-01/items?identifiers=${missing.join(',')}&identifiersType=ASIN` +
          `&marketplaceIds=${marketplaceId}&includedData=salesRanks,summaries`,
        token, region, { method: 'GET' }, marketplaceId,
      );
      const mapped = mapCatalogItems((resp as any)?.items || [], marketplaceId);
      for (const [a, v] of Object.entries(mapped)) if (merged[a]) { Object.assign(merged[a], v); gotAny = true; }
    } catch (err) {
      errors.catalog = classify(err);
      if (errors.catalog === 'access_denied') deniedUntil.set(catalogKey, Date.now() + DENIED_COOLDOWN_MS);
    }
  }

  const pricingKey = `pricing:${sellerKey}`;
  if (isDenied(pricingKey)) {
    errors.pricing = 'access_denied';
  } else {
    try {
      const resp = await fetcher(
        `/products/pricing/v0/competitivePrice?MarketplaceId=${marketplaceId}` +
          `&Asins=${missing.join(',')}&ItemType=Asin`,
        token, region, { method: 'GET' }, marketplaceId,
      );
      const mapped = mapCompetitivePricing((resp as any)?.payload || []);
      for (const [a, v] of Object.entries(mapped)) if (merged[a]) { Object.assign(merged[a], v); gotAny = true; }
    } catch (err) {
      errors.pricing = classify(err);
      if (errors.pricing === 'access_denied') deniedUntil.set(pricingKey, Date.now() + DENIED_COOLDOWN_MS);
    }
  }

  if (gotAny) {
    for (const [a, v] of Object.entries(merged)) {
      const hasData = v.bsr != null || v.offerCountAny != null || v.buyBoxPrice != null;
      if (!hasData) continue;
      items[a] = v;
      // Only cache when both sources answered, so a transient pricing failure
      // does not pin a half-filled record for 6 hours.
      if (!errors.catalog && !errors.pricing) cache.set(`${marketplaceId}:${a}`, { at: now, data: v });
    }
  }
  return { items, errors };
}
