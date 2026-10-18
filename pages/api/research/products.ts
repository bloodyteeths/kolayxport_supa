/**
 * GET /api/research/products — Product finder (research.md §5, §10).
 *
 * Query: `q` (repeat ≤ 3 for compare) · `mkt` = etsy | ebay | amazon | trendyol (default etsy) · `country` (US) ·
 *        `taxonomyId?` (Etsy) · `sort?` = relevance | price.asc | price.desc | favorites | newest (top listings) ·
 *        `locale?` (en | tr, for formatted fact params).
 * 200 → ResearchResponse<ProductsData> (lib/research/types.ts). `data: null` + `errors[{ section: 'marketplace' }]`
 *       when the marketplace cannot be researched here (Amazon without eligibility, Trendyol before R4).
 * Budget breaker (85 % of the Etsy daily quota) → cached rows only + `errors[{ section: 'all', key: 'research.error.budget' }]`;
 * nothing cached → 200 with `data: null` and the same error (the UI shows the budget banner, not an error page).
 *
 * Read-only: never writes to a marketplace. Session or extension Bearer auth.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getApplicationToken } from '@/lib/integrations/ebayClient';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';
import {
  allParams, buildEvidence, buyerWords, cachedLive, currencyForCountry, demandSignal, draftTagsFrom, engagementPerMonth,
  etsyBudgetLimited, fetchAutocompleteSources, fetchTrendsMean, firstParam, formattersFor, getEtsyListingDetails, getEtsyShops,
  isBudgetError, modeTaxonomy, newcomerShare, normalizeQuery, priceSummaryFor, requestLocale, searchEtsy, sha1, toTopListings,
  top5Share, userRateLimit, TOP_N, type EtsySearchItem, type Formatters,
} from '@/lib/research/etsySearch';
import { buildFxTable, decodeEntities } from '@/lib/research/stats';
import { convertCurrency } from '@/lib/finance/fx';
import { readShared } from '@/lib/research/etsySearch';
import { snapshotKey, snapshotResult, type MarketSnapshot } from '@/lib/research/marketSnapshot';
import {
  isResearchMkt, type Guarded, type ProductsData, type ProductsResult, type ResearchErrorBody, type ResearchMkt,
  type ResearchResponse, type ResearchSectionError, type SourceNoteProps, type TopListing,
} from '@/lib/research/types';

export const MAX_COMPARE = 3;
export const MAX_QUERY_LEN = 120;
const SORTS = ['relevance', 'price.asc', 'price.desc', 'favorites', 'newest'] as const;
type TopSort = (typeof SORTS)[number];

const ok = (value: number): Guarded<number> => ({ value, kind: 'measured', guard: { ok: true } });
const no = (reasonKey: string): Guarded<number> => ({ value: null, kind: 'measured', guard: { ok: false, reasonKey } });

export function sortTop(top: TopListing[], sort: TopSort): TopListing[] {
  if (sort === 'relevance') return top;
  const s = [...top];
  const price = (t: TopListing) => t.priceConverted?.amount ?? t.price?.amount ?? null;
  const cmp = (a: number | null, b: number | null, dir: 1 | -1) => (a == null ? 1 : b == null ? -1 : (a - b) * dir);
  if (sort === 'price.asc') s.sort((a, b) => cmp(price(a), price(b), 1));
  if (sort === 'price.desc') s.sort((a, b) => cmp(price(a), price(b), -1));
  if (sort === 'favorites') s.sort((a, b) => cmp(a.favorites, b.favorites, -1));
  if (sort === 'newest') s.sort((a, b) => cmp(a.ageDays, b.ageDays, 1));
  return s;
}

/** Pure: add `priceConverted` (in `currency`) to listings priced in another currency, from an FX table (1 unit → rate). */
export function withConvertedPrices(top: TopListing[], currency: string, fx: Record<string, number>): TopListing[] {
  const target = currency.toUpperCase();
  return top.map((t) => {
    if (!t.price) return t;
    const from = t.price.currency.toUpperCase() === 'TL' ? 'TRY' : t.price.currency.toUpperCase();
    if (from === target) return t;
    const rate = fx[from];
    return { ...t, priceConverted: rate ? { amount: Math.round(t.price.amount * rate * 100) / 100, currency: target } : null };
  });
}

/** Converted copies of `top` in the summary currency (best effort: no rate → unchanged). */
export async function convertTop(top: TopListing[], currency: string): Promise<TopListing[]> {
  const fx = await buildFxTable(top.map((t) => t.price?.currency), currency, convertCurrency).catch(() => ({}));
  return withConvertedPrices(top, currency, fx);
}

/** SourceNote for a price sample: "287 of 300 listings used · 13 excluded (no FX rate)". */
export function priceSource(source: string, fetchedAt: string, price: ProductsResult['price'], sampleTotal: number): SourceNoteProps {
  const excludedCount = price.excludedNoFx + price.excludedImplausible + price.trimmed;
  return {
    source,
    fetchedAt,
    sample: price.n,
    sampleTotal,
    sampleUnit: 'listings',
    ...(excludedCount > 0
      ? { excluded: { count: excludedCount, reasonKey: price.excludedNoFx >= excludedCount / 2 ? 'research.guard.noFx' : 'research.guard.outliers' } }
      : {}),
    kind: 'measured',
  };
}

// ─── Etsy ───────────────────────────────────────────────────────────────────

export async function researchEtsy(
  q: string,
  opts: { country: string; taxonomyId: number | null; sort: TopSort; fmt: Formatters; nowMs?: number },
): Promise<{ result: ProductsResult; source: SourceNoteProps; errors: ResearchSectionError[] }> {
  const nowMs = opts.nowMs ?? Date.now();
  const errors: ResearchSectionError[] = [];
  const served = await searchEtsy({ q, country: opts.country, taxonomyId: opts.taxonomyId });
  if (served.budgetLimited) errors.push({ section: 'all', key: 'research.error.budget' });
  else if (served.stale) errors.push({ section: 'all', key: 'research.error.stale' });

  const items = served.data.items;
  const top: EtsySearchItem[] = items.slice(0, TOP_N);
  const currency = currencyForCountry(opts.country);

  const [price, shops, details, trendsMean, autocompleteSources] = await Promise.all([
    priceSummaryFor(items, currency),
    getEtsyShops(top.map((i) => i.shopId).filter((s): s is string => !!s)),
    getEtsyListingDetails(top.map((i) => i.listingId), opts.country).then((d) => d.data).catch(() => ({})),
    fetchTrendsMean(q),
    fetchAutocompleteSources(q),
  ]);

  const total = ok(served.data.total);
  const newcomers = newcomerShare(top, shops, nowMs);
  if (!newcomers.guard.ok && etsyBudgetLimited()) errors.push({ section: 'newcomers', key: 'research.error.budget' });
  const engagement = engagementPerMonth(top, nowMs);
  const demand = demandSignal({ trendsMean, autocompleteSources, engagement: engagement.value });
  const words = buyerWords(top, 30);
  const evidence = buildEvidence({ price, total, newcomers, demand, money: opts.fmt.money, percent: opts.fmt.percent, count: opts.fmt.count, noVolume: true });

  const result: ProductsResult = {
    query: served.data.query,
    mkt: 'etsy',
    country: opts.country,
    evidence,
    price,
    competition: { total, top5Share: top5Share(top) },
    demand,
    newcomers,
    buyerWords: words,
    top: sortTop(await convertTop(toTopListings(top, shops, details, nowMs), price.currency), opts.sort),
    categoryHint: modeTaxonomy(top),
    draftTags: draftTagsFrom(words),
    fetchedAt: served.fetchedAt,
    cached: served.cached,
  };
  return { result, source: priceSource('research.sourceName.etsySearch', served.fetchedAt, price, items.length), errors };
}

// ─── eBay (Browse API, application token; active listings only) ────────────

const EBAY_MARKETPLACE: Record<string, string> = { US: 'EBAY_US', GB: 'EBAY_GB', DE: 'EBAY_DE', CA: 'EBAY_CA', AU: 'EBAY_AU' };
let ebayToken: { token: string; exp: number } | null = null;

async function ebayAppToken(): Promise<string> {
  if (ebayToken && ebayToken.exp > Date.now()) return ebayToken.token;
  const token = await getApplicationToken();
  ebayToken = { token, exp: Date.now() + 90 * 60_000 };
  return token;
}

export interface EbaySearchItem {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  url: string | null;
  thumbUrl: string | null;
  seller: string | null;
  categoryId: string | null;
  /** Seconds. */
  createdAt: number | null;
}

/** Raw Browse `itemSummaries[]` entry → item. Pure. */
export function mapEbayItem(i: any): EbaySearchItem {
  const v = Number(i?.price?.value);
  const created = i?.itemCreationDate ? Date.parse(i.itemCreationDate) : NaN;
  return {
    id: String(i?.itemId ?? ''),
    title: decodeEntities(i?.title || ''),
    price: Number.isFinite(v) && v > 0 ? v : null,
    currency: String(i?.price?.currency || 'USD').toUpperCase(),
    url: typeof i?.itemWebUrl === 'string' ? i.itemWebUrl : null,
    thumbUrl: i?.image?.imageUrl || i?.thumbnailImages?.[0]?.imageUrl || null,
    seller: typeof i?.seller?.username === 'string' ? i.seller.username : null,
    categoryId: i?.categories?.[0]?.categoryId ? String(i.categories[0].categoryId) : null,
    createdAt: Number.isFinite(created) ? Math.floor(created / 1000) : null,
  };
}

export async function researchEbay(
  q: string,
  opts: { country: string; sort: TopSort; fmt: Formatters; nowMs?: number },
): Promise<{ result: ProductsResult; source: SourceNoteProps; errors: ResearchSectionError[] }> {
  const nowMs = opts.nowMs ?? Date.now();
  const marketplaceId = EBAY_MARKETPLACE[opts.country] ?? 'EBAY_US';
  const key = `public:ebay:search:${sha1(`${normalizeQuery(q)}|${marketplaceId}`)}`;
  const served = await cachedLive(key, 24 * 3_600_000, async () => {
    const token = await ebayAppToken();
    const params = new URLSearchParams({ q, limit: '200', filter: 'buyingOptions:{FIXED_PRICE}' });
    const data = await callEbayRateLimited<any>(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, { token, marketplaceId });
    return { total: Number(data?.total) || 0, items: (Array.isArray(data?.itemSummaries) ? data.itemSummaries : []).map(mapEbayItem).filter((i: EbaySearchItem) => i.id) as EbaySearchItem[] };
  }, { budgetAware: false });
  const errors: ResearchSectionError[] = served.stale ? [{ section: 'all', key: 'research.error.stale' }] : [];
  const items = served.data.items;
  const top = items.slice(0, TOP_N);
  const currency = currencyForCountry(opts.country);
  const [price, trendsMean, autocompleteSources] = await Promise.all([
    priceSummaryFor(items.map((i) => ({ price: i.price, currency: i.currency })), currency),
    fetchTrendsMean(q),
    fetchAutocompleteSources(q),
  ]);
  const total = ok(Math.max(served.data.total, items.length));
  const newcomers = no('research.guard.notAvailableEbay');
  const demand = demandSignal({ trendsMean, autocompleteSources, engagement: null });
  const evidence = buildEvidence({ price, total, newcomers, demand, money: opts.fmt.money, percent: opts.fmt.percent, count: opts.fmt.count, noVolume: true, basisKey: 'research.evidence.basisEbay' });
  const catCounts = new Map<string, number>();
  for (const i of top) if (i.categoryId) catCounts.set(i.categoryId, (catCounts.get(i.categoryId) ?? 0) + 1);
  const categoryHint = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topListings: TopListing[] = top.map((i) => ({
    id: i.id,
    title: i.title,
    url: i.url,
    thumbUrl: i.thumbUrl,
    price: i.price != null ? { amount: i.price, currency: i.currency } : null,
    favorites: null,
    ageDays: i.createdAt ? Math.max(0, Math.floor((nowMs - i.createdAt * 1000) / 86_400_000)) : null,
    shop: { id: i.seller, name: i.seller, url: i.seller ? `https://www.ebay.com/usr/${encodeURIComponent(i.seller)}` : null },
    tags: [],
  }));
  const result: ProductsResult = {
    query: q,
    mkt: 'ebay',
    country: opts.country,
    evidence,
    price,
    competition: { total, top5Share: top5Share(top.map((i) => ({ shopId: i.seller }))) },
    demand,
    newcomers,
    buyerWords: [],
    top: sortTop(await convertTop(topListings, price.currency), opts.sort),
    categoryHint,
    draftTags: [],
    fetchedAt: served.fetchedAt,
    cached: served.cached,
  };
  return { result, source: priceSource('research.sourceName.ebayBrowse', served.fetchedAt, price, items.length), errors };
}

// ─── Trendyol (from the extension's browser snapshot) ───────────────────────

/** Thrown when no snapshot exists yet: the UI offers "Search on Trendyol" (the extension then captures it). */
export class NoSnapshotError extends Error {
  constructor() { super('no_snapshot'); }
}

export async function researchTrendyol(
  q: string,
  opts: { fmt: Formatters },
): Promise<{ result: ProductsResult; source: SourceNoteProps; errors: ResearchSectionError[] }> {
  const hit = await readShared<MarketSnapshot>(snapshotKey('trendyol', q));
  if (!hit) throw new NoSnapshotError();
  const [trendsMean, autocompleteSources] = await Promise.all([fetchTrendsMean(q), fetchAutocompleteSources(q)]);
  const demand = demandSignal({ trendsMean, autocompleteSources, engagement: null });
  const result = snapshotResult(hit.data, {
    demand,
    cached: true,
    evidence: (p) => buildEvidence({ ...p, money: opts.fmt.money, percent: opts.fmt.percent, count: opts.fmt.count, noVolume: true, basisKey: 'research.evidence.basisTrendyol' }),
  });
  const errors: ResearchSectionError[] = hit.fresh ? [] : [{ section: 'all', key: 'research.error.stale' }];
  return { result, source: priceSource('research.sourceName.trendyolSnapshot', hit.fetchedAt, result.price, hit.data.items.length), errors };
}

// ─── Handler ────────────────────────────────────────────────────────────────

function unavailable(res: NextApiResponse, mkt: ResearchMkt, key: string) {
  const body: ResearchResponse<ProductsData> = {
    data: null,
    source: { source: `research.sourceName.${mkt}`, fetchedAt: new Date().toISOString(), kind: 'measured' },
    errors: [{ section: 'marketplace', key }],
  };
  return res.status(200).json(body);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);

  const queries = Array.from(new Set(allParams(req.query.q).map((s) => s.slice(0, MAX_QUERY_LEN)))).slice(0, MAX_COMPARE);
  if (queries.length === 0) return res.status(400).json({ error: 'bad_request', key: 'research.empty.products' } satisfies ResearchErrorBody);
  const mktRaw = firstParam(req.query.mkt) ?? 'etsy';
  if (!isResearchMkt(mktRaw)) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  const mkt: ResearchMkt = mktRaw;
  const countryRaw = (firstParam(req.query.country) ?? 'US').toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : 'US';
  const taxRaw = Number(firstParam(req.query.taxonomyId));
  const taxonomyId = Number.isInteger(taxRaw) && taxRaw > 0 ? taxRaw : null;
  const sortRaw = firstParam(req.query.sort) ?? 'relevance';
  const sort: TopSort = (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as TopSort) : 'relevance';
  const fmt = formattersFor(requestLocale(req));

  if (mkt === 'amazon') return unavailable(res, mkt, 'research.mkt.amazonIneligible');

  if (!userRateLimit(user.id, 'research:products', 20)) {
    return res.status(429).json({ error: 'rate_limited' } satisfies ResearchErrorBody);
  }

  try {
    const runs = await Promise.all(queries.map(async (q) => {
      try {
        if (mkt === 'trendyol') return await researchTrendyol(q, { fmt });
        return mkt === 'ebay'
          ? await researchEbay(q, { country, sort, fmt })
          : await researchEtsy(q, { country, taxonomyId, sort, fmt });
      } catch (err) {
        if (err instanceof NoSnapshotError) return { noSnapshot: true as const };
        if (isBudgetError(err)) return { budget: true as const };
        throw err;
      }
    }));
    // Trendyol with no browser snapshot yet: the UI offers "Search on Trendyol" (the extension captures the page).
    if (mkt === 'trendyol' && runs.every((r) => 'noSnapshot' in r)) return unavailable(res, mkt, 'research.products.trendyolOpen');
    const done = runs.filter((r): r is Exclude<typeof r, { budget: true } | { noSnapshot: true }> => !('budget' in r) && !('noSnapshot' in r));
    if (done.length === 0) {
      const body: ResearchResponse<ProductsData> = {
        data: null,
        source: { source: 'research.sourceName.etsySearch', fetchedAt: new Date().toISOString(), kind: 'measured' },
        errors: [{ section: 'all', key: 'research.error.budget' }],
      };
      return res.status(200).json(body);
    }
    const errors = done.flatMap((r) => r.errors);
    if (done.length < runs.length) errors.push({ section: 'compare', key: 'research.error.budget' });
    const dedup = Array.from(new Map(errors.map((e) => [`${e.section}|${e.key}`, e])).values());
    const data: ProductsData = queries.length > 1 ? { ...done[0].result, compare: done.map((r) => r.result) } : done[0].result;
    const body: ResearchResponse<ProductsData> = { data, source: done[0].source, ...(dedup.length ? { errors: dedup } : {}) };
    return res.status(200).json(body);
  } catch (err) {
    logger.error('[research/products] failed', err as Error, { mkt });
    const key = mkt === 'ebay' ? 'research.error.ebay' : mkt === 'trendyol' ? 'research.error.trendyol' : 'research.error.etsy';
    return res.status(502).json({ error: 'server_error', key } satisfies ResearchErrorBody);
  }
}
