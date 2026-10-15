/**
 * GET /api/research/price-gap — Product finder "From Trendyol" / Price gap: Türkiye → abroad (research.md §9, R4, Pro).
 *
 * Query:
 *   from      `category` (default) | `mine` | `link`
 *   cat       Trendyol category slug (from=category; default = the indexed category with the most products)
 *   url       Trendyol product link or id (from=link)
 * 200 → ResearchResponse<PriceGapData> (lib/research/priceGap.ts). Prices are `PriceSummary` (median, p25–p75, n; no
 *       means). Landed cost / margin are computed on the client from `rows`, `fx` and `shipping` (pure `rowMargin`)
 *       so a typed shipping cost re-prices instantly.
 * 400 { error:'bad_request', key } · 401 · 402 featureLocked body (lib/billing/requireFeature) · 405 · 500.
 *
 * Gate: `requireFeature(userId, 'arbitrage')` (server first; the UI FeatureGate is presentation only).
 * Read-only: DB + the shared research cache + one FX rate. No eBay, Etsy, Trendyol or AI calls, no scan jobs, and
 * nothing is written to a marketplace. Data: TrendyolProductIndex / TrendyolProduct (own catalog), ArbitrageMatch
 * (offline AI matcher; own products joined to the storefront id by barcode via the index), EbayProductIndex (US active listings), ArbitrageResultRecord.translatedQuery (English query),
 * ResearchCache `__public__` Etsy searches (cached only), Order.manualShippingCost + latest live Shipment.carrier (own labels; default-weight orders excluded).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isFeatureLockedError, requireFeature } from '@/lib/billing/requireFeature';
import { convertCurrency } from '@/lib/finance/fx';
import { TRENDYOL_CATEGORIES } from '@/lib/integrations/trendyolSearch';
import { buildFxTable, decodeEntities, summarizePrices } from '@/lib/research/stats';
import { SHARED_CACHE_USER, firstParam, readShared, searchCacheKey, writeShared, type EtsySearchResult } from '@/lib/research/etsySearch';
import { countryFromAddress } from '@/lib/research/seasons';
import {
  confidenceTier,
  isGapFrom,
  isUsableMatch,
  parseTrendyolProductId,
  shippingOptions,
  type GapCategory,
  type GapEbayMatch,
  type GapFrom,
  type MatchType,
  type PriceGapData,
  type PriceGapRow,
  type ShippingOption,
  type ShippingSample,
} from '@/lib/research/priceGap';
import type { Confidence, ResearchErrorBody, ResearchResponse, ResearchSectionError } from '@/lib/research/types';

export const MAX_ROWS = { category: 100, mine: 200, link: 1 } as const;
const SHIPPING_TTL_MS = 6 * 3_600_000;
const SHIPPING_LOOKBACK_DAYS = 365;

type TrendyolSource = {
  productId: number;
  name: string;
  brand: string | null;
  priceTry: number | null;
  url: string | null;
  images: string[];
  categorySlug: string | null;
  categoryName: string | null;
  fetchedAt: Date | null;
};

const https = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//i.test(u.trim());

/** `TrendyolProduct.images` JSON (`[{url}]` or `string[]`) → https URLs. */
export function imagesFromJson(raw: unknown, thumb?: string | null): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const it of raw) {
      const u = typeof it === 'string' ? it : it && typeof it === 'object' ? (it as { url?: unknown }).url : null;
      if (https(u) && !out.includes(u.trim())) out.push(u.trim());
    }
  }
  if (https(thumb) && !out.includes(thumb.trim())) out.unshift(thumb.trim());
  return out.slice(0, 12);
}

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : v && typeof v === 'object' && 'toString' in v ? Number(String(v)) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ─── Categories ────────────────────────────────────────────────────────────

export async function loadCategories(now = new Date()): Promise<GapCategory[]> {
  const groups = await prisma.trendyolProductIndex.groupBy({
    by: ['categorySlug'],
    where: { expiresAt: { gt: now } },
    _count: { _all: true },
  });
  const known = new Map(TRENDYOL_CATEGORIES.map((c) => [c.slug, c]));
  return groups
    .map((g) => {
      const meta = known.get(g.categorySlug);
      return { slug: g.categorySlug, label: meta?.label ?? g.categorySlug, labelTr: meta?.labelTr ?? g.categorySlug, products: g._count._all };
    })
    .filter((c) => c.products > 0)
    .sort((a, b) => b.products - a.products || a.slug.localeCompare(b.slug));
}

// ─── Trendyol products per source ─────────────────────────────────────────

async function indexRows(where: Record<string, unknown>, take: number, now: Date): Promise<TrendyolSource[]> {
  const rows = await prisma.trendyolProductIndex.findMany({
    where: { ...where, expiresAt: { gt: now } },
    orderBy: [{ ratingCount: 'desc' }, { productId: 'asc' }],
    take,
    select: { productId: true, name: true, brand: true, priceTry: true, imageUrl: true, url: true, categorySlug: true, categoryName: true, fetchedAt: true },
  });
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    brand: r.brand || null,
    priceTry: toNum(r.priceTry),
    url: r.url,
    images: https(r.imageUrl) ? [r.imageUrl.trim()] : [],
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    fetchedAt: r.fetchedAt,
  }));
}

/**
 * Own catalog → storefront product ids. `TrendyolProduct.trendyolId` is the Supplier/Integration API product `id`,
 * NOT the storefront product-content id that `TrendyolProductIndex.productId`, `ArbitrageMatch.trendyolId` and the
 * `-p-<id>` URL use (pages/api/trendyol/url.ts). The only reliable join today is the barcode: the URL resolver and the
 * index scraper store `TrendyolProductIndex.barcode` next to the storefront id + URL. Products whose barcode is not in
 * the index are counted as `unresolved` and left out (never guessed, never linked by the supplier id).
 */
export async function ownRows(userId: string, take: number): Promise<{ sources: TrendyolSource[]; unresolved: number }> {
  const rows = await prisma.trendyolProduct.findMany({
    where: { userId, archived: false },
    orderBy: [{ onSale: 'desc' }, { updatedAt: 'desc' }],
    take,
    select: { barcode: true, title: true, brandName: true, salePrice: true, listPrice: true, images: true, thumbnailUrl: true, categoryName: true, syncedAt: true },
  });
  const barcodes = Array.from(new Set(rows.map((r) => (r.barcode || '').trim()).filter(Boolean)));
  const index = barcodes.length
    ? await prisma.trendyolProductIndex.findMany({
        where: { barcode: { in: barcodes } },
        orderBy: { fetchedAt: 'desc' },
        select: { productId: true, barcode: true, url: true, categorySlug: true },
      })
    : [];
  const byBarcode = new Map<string, { productId: number; url: string | null; categorySlug: string | null }>();
  for (const i of index) {
    const b = (i.barcode || '').trim();
    if (b && !byBarcode.has(b) && Number.isInteger(i.productId) && i.productId > 0) byBarcode.set(b, { productId: i.productId, url: i.url, categorySlug: i.categorySlug || null });
  }
  const out: TrendyolSource[] = [];
  const seen = new Set<number>();
  let unresolved = 0;
  for (const r of rows) {
    const hit = byBarcode.get((r.barcode || '').trim());
    if (!hit) {
      unresolved++;
      continue;
    }
    if (seen.has(hit.productId)) continue;
    seen.add(hit.productId);
    out.push({
      productId: hit.productId,
      name: r.title,
      brand: r.brandName ?? null,
      priceTry: toNum(r.salePrice) ?? toNum(r.listPrice),
      url: https(hit.url) ? hit.url.trim() : null,
      images: imagesFromJson(r.images, r.thumbnailUrl),
      categorySlug: hit.categorySlug,
      categoryName: r.categoryName ?? null,
      fetchedAt: r.syncedAt,
    });
  }
  return { sources: out, unresolved };
}

// ─── Own label costs (shipping) ───────────────────────────────────────────

export interface ShippingStats {
  options: ShippingOption[];
  excluded: number;
  /** Labels on orders that still carry the schema default weight (0.5 kg, never edited): weight unknown. */
  excludedDefaultWeight: number;
  fetchedAt: string;
}

/** `Order.weightKg` is `Float? @default(0.5)`: 0.5 without a manual edit is the default, not a measured weight. */
export const ORDER_DEFAULT_WEIGHT_KG = 0.5;
export function knownOrderWeight(o: { weightKg: number | null; weightEditedAt: Date | null }): number | null {
  if (typeof o.weightKg !== 'number' || !Number.isFinite(o.weightKg) || o.weightKg <= 0) return null;
  if (o.weightKg === ORDER_DEFAULT_WEIGHT_KG && !o.weightEditedAt) return null;
  return o.weightKg;
}

/** International own labels with a recorded carrier cost → USD samples (TRY via `usdPerTry`, others via FX). */
export async function loadShipping(userId: string, usdPerTry: number | null, now = new Date()): Promise<ShippingStats> {
  const key = 'research:gap:shipping:v2';
  const hit = await readShared<ShippingStats>(key, userId);
  if (hit && hit.fresh) return hit.data;
  const orders = await prisma.order.findMany({
    where: { userId, manualShippingCost: { not: null }, createdAt: { gte: new Date(now.getTime() - SHIPPING_LOOKBACK_DAYS * 86_400_000) } },
    select: {
      manualShippingCost: true,
      manualShippingCostCurrency: true,
      weightKg: true,
      weightEditedAt: true,
      shippingAddress: true,
      // Latest live label decides the carrier (re-labels / voids excluded).
      shipments: { where: { status: { notIn: ['voided', 'void_requested', 'failed'] } }, orderBy: { createdAt: 'desc' }, take: 1, select: { carrier: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 3000,
  });
  const currencies = orders.map((o) => (o.manualShippingCostCurrency || '').toUpperCase()).filter((c) => c && c !== 'USD' && c !== 'TRY' && c !== 'TL');
  const fx: Record<string, number> = currencies.length ? await buildFxTable(currencies, 'USD', convertCurrency).catch(() => ({} as Record<string, number>)) : {};
  const samples: ShippingSample[] = [];
  let excluded = 0;
  let excludedDefaultWeight = 0;
  let missingRate = false;
  for (const o of orders) {
    const country = countryFromAddress(o.shippingAddress);
    if (country === 'TR') continue; // domestic label: not a "to abroad" cost
    const carrier = o.shipments[0]?.carrier;
    const amount = toNum(o.manualShippingCost);
    const cur = (o.manualShippingCostCurrency || '').toUpperCase();
    let usd: number | null = null;
    if (amount !== null) {
      if (cur === 'USD') usd = amount;
      else if ((cur === 'TRY' || cur === 'TL') && usdPerTry) usd = amount * usdPerTry;
      else if (cur && fx[cur]) usd = amount * fx[cur];
      else if (cur && cur !== 'USD' && cur !== 'TRY' && cur !== 'TL') missingRate = true;
    }
    if (!country || !carrier || usd === null) {
      excluded++;
      continue;
    }
    const weightKg = knownOrderWeight(o);
    if (weightKg === null) {
      excludedDefaultWeight++;
      continue;
    }
    samples.push({ carrier, weightKg, costUsd: usd });
  }
  const stats: ShippingStats = { options: shippingOptions(samples), excluded, excludedDefaultWeight, fetchedAt: new Date().toISOString() };
  // Labels excluded only for a missing FX rate (TRY or another currency) are a transient gap: do not cache that.
  if (usdPerTry && !missingRate) await writeShared(key, stats, SHIPPING_TTL_MS, stats.fetchedAt, userId);
  return stats;
}

// ─── Etsy (shared cache only) ─────────────────────────────────────────────

interface Envelope<T> { v: 1; fetchedAt: string; data: T }

async function etsyCached(queries: string[]): Promise<Map<string, { items: EtsySearchResult['items']; fetchedAt: string }>> {
  const byKey = new Map<string, string>();
  for (const q of queries) byKey.set(searchCacheKey(q, 'US'), q);
  const out = new Map<string, { items: EtsySearchResult['items']; fetchedAt: string }>();
  if (!byKey.size) return out;
  const rows = await prisma.researchCache.findMany({
    where: { userId: SHARED_CACHE_USER, cacheKey: { in: Array.from(byKey.keys()) } },
    select: { cacheKey: true, data: true },
  });
  for (const r of rows) {
    const env = r.data as unknown as Envelope<EtsySearchResult> | null;
    const q = byKey.get(r.cacheKey);
    if (!q || !env || env.v !== 1 || !Array.isArray(env.data?.items)) continue;
    out.set(q, { items: env.data.items, fetchedAt: env.fetchedAt });
  }
  return out;
}

// ─── Assembly ─────────────────────────────────────────────────────────────

type EbayIndexItem = {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  itemUrl: string | null;
  soldQuantity: number;
  categoryId: string;
};

const BEST: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export async function buildPriceGap(
  userId: string,
  opts: { from: GapFrom; cat?: string | null; productId?: number | null },
  now = new Date(),
): Promise<{ data: PriceGapData; errors: ResearchSectionError[]; fetchedAt: string }> {
  const errors: ResearchSectionError[] = [];
  const [categories, rate, profile] = await Promise.all([
    loadCategories(now),
    convertCurrency(1, 'TRY', 'USD').catch(() => null),
    prisma.shipperProfile.findUnique({ where: { userId }, select: { defaultWeightKg: true } }).catch(() => null),
  ]);
  const usdPerTry = rate !== null && Number.isFinite(rate) && rate > 0 ? rate : null;
  if (usdPerTry === null) errors.push({ section: 'fx', key: 'research.gap.guard.noFx' });

  let category: string | null = null;
  let sources: TrendyolSource[] = [];
  let unresolved = 0;
  if (opts.from === 'category') {
    category = opts.cat && categories.some((c) => c.slug === opts.cat) ? opts.cat : categories[0]?.slug ?? null;
    if (opts.cat && category !== opts.cat) errors.push({ section: 'source', key: 'research.gap.error.categoryNotIndexed' });
    sources = category ? await indexRows({ categorySlug: category }, MAX_ROWS.category, now) : [];
  } else if (opts.from === 'mine') {
    ({ sources, unresolved } = await ownRows(userId, MAX_ROWS.mine));
  } else if (opts.productId) {
    sources = await indexRows({ productId: opts.productId }, 1, now);
    if (!sources.length) errors.push({ section: 'source', key: 'research.gap.error.notIndexed' });
  }

  const ids = sources.map((s) => s.productId);
  const matches = ids.length
    ? await prisma.arbitrageMatch.findMany({
        where: { trendyolId: { in: ids }, expiresAt: { gt: now } },
        select: { trendyolId: true, ebayItemId: true, confidence: true, matchType: true },
      })
    : [];
  const usable = matches.filter(isUsableMatch);
  const ebayIds = Array.from(new Set(usable.map((m) => m.ebayItemId)));
  const [ebayItems, translations] = await Promise.all([
    ebayIds.length
      ? prisma.ebayProductIndex.findMany({
          where: { itemId: { in: ebayIds }, expiresAt: { gt: now } },
          select: { itemId: true, title: true, price: true, currency: true, imageUrl: true, itemUrl: true, soldQuantity: true, categoryId: true },
        })
      : Promise.resolve([] as EbayIndexItem[]),
    ids.length
      ? prisma.arbitrageResultRecord.findMany({ where: { userId, trendyolProductId: { in: ids } }, select: { trendyolProductId: true, translatedQuery: true } })
      : Promise.resolve([] as Array<{ trendyolProductId: number; translatedQuery: string | null }>),
  ]);
  const ebayById = new Map(ebayItems.map((e) => [e.itemId, e]));
  const english = new Map<number, string>();
  for (const t of translations) if (t.translatedQuery && t.translatedQuery.trim()) english.set(t.trendyolProductId, decodeEntities(t.translatedQuery).trim());
  const etsy = await etsyCached(Array.from(new Set(english.values())));
  const etsyFx = await buildFxTable(
    Array.from(etsy.values()).flatMap((e) => e.items.map((i) => i.currency)),
    'USD',
    convertCurrency,
  ).catch(() => ({} as Record<string, number>));
  const ebayFx = await buildFxTable(ebayItems.map((e) => e.currency), 'USD', convertCurrency).catch(() => ({} as Record<string, number>));

  const rows: PriceGapRow[] = [];
  let unmatched = 0;
  for (const s of sources) {
    const mine = usable
      .filter((m) => m.trendyolId === s.productId && ebayById.has(m.ebayItemId))
      .sort((a, b) => b.confidence - a.confidence);
    const tiers = mine.map((m) => confidenceTier(m.confidence, m.matchType));
    const confidence = tiers.reduce<Confidence | null>((best, t) => (!best || BEST[t] > BEST[best] ? t : best), null);
    if (!confidence) unmatched++;
    if (!confidence && opts.from === 'category') continue;
    const items = mine.map((m) => ebayById.get(m.ebayItemId)!);
    const gapMatches: GapEbayMatch[] = mine.map((m) => {
      const e = ebayById.get(m.ebayItemId)!;
      return {
        itemId: e.itemId,
        title: decodeEntities(e.title),
        price: e.price,
        currency: (e.currency || 'USD').toUpperCase(),
        soldAllTime: Number.isFinite(e.soldQuantity) && e.soldQuantity > 0 ? e.soldQuantity : null,
        url: https(e.itemUrl) ? e.itemUrl : null,
        imageUrl: https(e.imageUrl) ? e.imageUrl : null,
        confidence: Math.round(m.confidence * 100) / 100,
        matchType: (['exact', 'equivalent', 'similar'].includes(m.matchType) ? m.matchType : 'similar') as MatchType,
      };
    });
    const catCounts = new Map<string, number>();
    for (const it of items) if (it.categoryId) catCounts.set(it.categoryId, (catCounts.get(it.categoryId) ?? 0) + 1);
    const ebayCategoryId = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const q = english.get(s.productId) ?? null;
    const etsyHit = q ? etsy.get(q) : undefined;
    rows.push({
      id: String(s.productId),
      title: decodeEntities(s.name),
      brand: s.brand ? decodeEntities(s.brand) : null,
      url: s.url,
      imageUrl: s.images[0] ?? null,
      images: s.images,
      trPriceTry: s.priceTry,
      category: { slug: s.categorySlug, name: s.categoryName ? decodeEntities(s.categoryName) : null },
      confidence,
      ebay: items.length ? summarizePrices(items.map((i) => ({ amount: i.price, currency: i.currency })), { currency: 'USD', fx: ebayFx }) : null,
      ebayCategoryId,
      matches: gapMatches,
      etsy: etsyHit
        ? { ...summarizePrices(etsyHit.items.map((i) => ({ amount: i.price, currency: i.currency })), { currency: 'USD', fx: etsyFx }), fetchedAt: etsyHit.fetchedAt }
        : null,
      englishQuery: q,
      fetchedAt: s.fetchedAt ? s.fetchedAt.toISOString() : null,
    });
  }

  const shipping = await loadShipping(userId, usdPerTry, now).catch((err) => {
    logger.warn('[research/price-gap] shipping stats failed', { error: (err as Error)?.message });
    errors.push({ section: 'shipping', key: 'research.gap.error.shipping' });
    return { options: [], excluded: 0, excludedDefaultWeight: 0, fetchedAt: now.toISOString() } as ShippingStats;
  });

  // Oldest data timestamp (never "now" for cached index data).
  const times = rows.map((r) => r.fetchedAt).filter((t): t is string => Boolean(t)).sort();
  const fetchedAt = times[0] ?? now.toISOString();

  return {
    data: {
      from: opts.from,
      category,
      categories,
      fx: { usdPerTry, source: 'exchangerate-api.com', fetchedAt: now.toISOString() },
      shipping: shipping.options,
      shippingExcluded: shipping.excluded,
      shippingExcludedDefaultWeight: shipping.excludedDefaultWeight,
      defaultWeightKg: typeof profile?.defaultWeightKg === 'number' && profile.defaultWeightKg > 0 ? profile.defaultWeightKg : null,
      rows,
      unmatched,
      unresolved,
    },
    errors,
    fetchedAt,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);

  try {
    await requireFeature(user.id, 'arbitrage');
  } catch (err) {
    if (isFeatureLockedError(err)) return res.status(402).json(err.body());
    logger.error('[research/price-gap] feature check failed', err as Error);
    return res.status(500).json({ error: 'server_error' } satisfies ResearchErrorBody);
  }

  const fromRaw = firstParam(req.query.from) ?? 'category';
  if (!isGapFrom(fromRaw)) return res.status(400).json({ error: 'bad_request', key: 'research.gap.error.badSource' } satisfies ResearchErrorBody);
  const cat = firstParam(req.query.cat)?.trim().slice(0, 120) || null;
  let productId: number | null = null;
  if (fromRaw === 'link') {
    productId = parseTrendyolProductId(firstParam(req.query.url));
    if (!productId) return res.status(400).json({ error: 'bad_request', key: 'research.gap.error.badLink' } satisfies ResearchErrorBody);
  }

  try {
    const { data, errors, fetchedAt } = await buildPriceGap(user.id, { from: fromRaw, cat, productId });
    const body: ResearchResponse<PriceGapData> = {
      data,
      source: {
        source: 'research.sourceName.priceGap',
        fetchedAt,
        sample: data.rows.length,
        sampleUnit: 'items',
        kind: 'measured',
      },
      ...(errors.length ? { errors } : {}),
    };
    return res.status(200).json(body);
  } catch (err) {
    logger.error('[research/price-gap] failed', err as Error);
    return res.status(500).json({ error: 'server_error', key: 'research.gap.error.generic' } satisfies ResearchErrorBody);
  }
}
