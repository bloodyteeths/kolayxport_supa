import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { getAuthUser } from '../../../lib/auth';
import { hasValidInternalApiKeyHeader } from '../../../lib/security/internalApiKey';
import { getEbayTokenFor } from '../../../lib/integrations/ebayClient';
import { callEbayRateLimited } from '../../../lib/integrations/ebayRateLimiter';
import { summarizePrices, buildFxTable, decodeEntities, type PriceSummary } from '../../../lib/research/stats';
import { convertCurrency } from '../../../lib/finance/fx';
import {
  isExtensionRequest, withResearchQuota, sendResearchOutcome, captureHandler, sharedCacheKey, RESEARCH_TTL,
} from '../../../lib/ext/researchQuota';

/**
 * R0 honesty patch: robust price summary for eBay search results in the
 * results' majority currency (the marketplace currency). Other currencies are
 * FX-converted or excluded; plausibility bounds are scaled from USD via FX.
 */
async function ebayPriceSummary(items: Array<Record<string, unknown>>): Promise<PriceSummary> {
  const points = items.map((item) => {
    const price = item.price as { value?: string; currency?: string } | undefined;
    return { amount: parseFloat(price?.value || '0'), currency: price?.currency || 'USD' };
  });
  const counts: Record<string, number> = {};
  for (const p of points) counts[p.currency] = (counts[p.currency] || 0) + 1;
  const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';
  const fx = await buildFxTable(points.map((p) => p.currency), currency, convertCurrency).catch(() => ({}));
  const usdToTarget = currency === 'USD' ? 1 : await convertCurrency(1, 'USD', currency).catch(() => null);
  return summarizePrices(points, { currency, fx, usdToTarget });
}

export const config = { runtime: 'nodejs' };

const EBAY_API_BASE = 'https://api.ebay.com';

// ---------------------------------------------------------------------------
// API caller — delegates to shared rate-limited caller so all eBay traffic
// (research, arbitrage, tracker, etc.) shares a single global queue + retry.
// ---------------------------------------------------------------------------

async function callEbayAPI(
  endpoint: string,
  token: string,
  options: RequestInit = {},
  marketplaceId?: string
) {
  const url = endpoint.startsWith('http') ? endpoint : `${EBAY_API_BASE}${endpoint}`;
  try {
    return await callEbayRateLimited(url, { token, marketplaceId, options });
  } catch (err) {
    logger.error('eBay API error', err as Error, { endpoint });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getItemDetails(legacyItemId: string, appToken: string, marketplaceId?: string) {
  const item = await callEbayAPI(
    `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyItemId}`,
    appToken,
    {},
    marketplaceId
  );
  return {
    title: item.title as string,
    price: parseFloat(item.price?.value || '0'),
    currency: (item.price?.currency || 'USD') as string,
    condition: item.condition as string | undefined,
    seller: item.seller?.username as string | undefined,
    imageUrl: item.image?.imageUrl as string | undefined,
    categoryId: item.categoryId as string | undefined,
    categoryPath: item.categoryPath as string | undefined,
    itemWebUrl: item.itemWebUrl as string | undefined,
    itemId: item.itemId as string | undefined,
    soldQuantity:
      (item.estimatedAvailabilities?.[0]?.estimatedSoldQuantity as number) || 0,
    remainingQuantity:
      (item.estimatedAvailabilities?.[0]?.estimatedRemainingQuantity as number) || 0,
    totalQuantity:
      ((item.estimatedAvailabilities?.[0]?.estimatedSoldQuantity as number) || 0) +
      ((item.estimatedAvailabilities?.[0]?.estimatedRemainingQuantity as number) || 0),
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Chrome-extension research calls (background-simple.js sends `X-KX-Client: ext/<version>`)
 * go through the research quota (lib/ext/researchQuota.ts): shared cross-user cache, the
 * global eBay brake and the per-plan daily lookups. The web app's research hub (no header)
 * and the internal API-key path keep the unchanged handler below.
 * One search = 1 Browse search + up to 20 item-detail calls.
 */
const EXT_QUOTA_ACTIONS = new Set(['product_database', 'niche_analyze']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = String(req.query.action || '');
  if (req.method === 'GET' && EXT_QUOTA_ACTIONS.has(action) && isExtensionRequest(req) && !hasValidInternalApiKeyHeader(req)) {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication' });
    const q = req.query;
    const site = String(q.marketplace_id || 'EBAY_US');
    const cacheKey = action === 'product_database'
      ? sharedCacheKey('ebay', action, site, q.q as string, q.category_id as string, q.min_price as string, q.max_price as string,
        q.condition as string, (q.sort as string) || 'newlyListed', (q.limit as string) || '50', (q.offset as string) || '0')
      : sharedCacheKey('ebay', action, site, q.q as string, q.category_id as string);
    const outcome = await withResearchQuota(
      { req, userId: user.id, marketplace: 'ebay', cacheKey, ttl: RESEARCH_TTL.search, apiCallsEstimate: 21 },
      () => captureHandler(ebayResearchHandler, req, res),
    );
    return sendResearchOutcome(res, outcome);
  }
  return ebayResearchHandler(req, res);
}

async function ebayResearchHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 1. Authenticate — accept API key OR session auth
  // Header-only since Sprint 5 (query-string keys leak via CDN/proxy logs).
  let authenticated = false;
  let viaApiKey = false;
  let sessionUserId: string | null = null;

  // Try API key auth first (constant-time compare)
  if (hasValidInternalApiKeyHeader(req)) {
    authenticated = true;
    viaApiKey = true;
  }

  // Fall back to session auth
  if (!authenticated) {
    const user = await getAuthUser(req, res);
    if (user) {
      authenticated = true;
      sessionUserId = user.id;
    }
  }

  if (!authenticated) {
    return res
      .status(401)
      .json({ error: 'Unauthorized: Invalid or missing authentication' });
  }

  // Get userId from query param or session
  // A client-supplied userId/user_id is honored ONLY for the internal API-key path.
  // Session/Bearer callers always act as themselves.
  const userId = viaApiKey
    ? ((req.query.userId as string) || (req.query.user_id as string) || null)
    : sessionUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const marketplaceId = (req.query.marketplace_id as string) || 'EBAY_US';
  const action = req.query.action as string;

  if (!action) {
    return res.status(400).json({ error: 'action query parameter is required' });
  }

  try {
    // =====================================================================
    // GET actions
    // =====================================================================
    if (req.method === 'GET') {
      switch (action) {
        // -----------------------------------------------------------------
        // tracked_products — Get all tracked products for user
        // -----------------------------------------------------------------
        case 'tracked_products': {
          const products = await prisma.ebayTrackedProduct.findMany({
            where: { userId, isActive: true },
            include: {
              snapshots: {
                orderBy: { timestamp: 'desc' },
                take: 30,
              },
            },
            orderBy: { updatedAt: 'desc' },
          });

          return res.status(200).json({ products });
        }

        // -----------------------------------------------------------------
        // price_history — Get price history for a product
        // -----------------------------------------------------------------
        case 'price_history': {
          const productId = req.query.product_id as string;
          if (!productId) {
            return res.status(400).json({ error: 'product_id is required' });
          }

          // Verify the product belongs to this user
          const product = await prisma.ebayTrackedProduct.findFirst({
            where: { id: productId, userId },
          });
          if (!product) {
            return res.status(404).json({ error: 'Tracked product not found' });
          }

          const snapshots = await prisma.ebayPriceSnapshot.findMany({
            where: { trackedProductId: productId },
            orderBy: { timestamp: 'asc' },
          });

          return res.status(200).json({ product, snapshots });
        }

        // -----------------------------------------------------------------
        // tracked_sellers — Get all tracked sellers
        // -----------------------------------------------------------------
        case 'tracked_sellers': {
          const sellers = await prisma.ebayTrackedSeller.findMany({
            where: { userId, isActive: true },
            orderBy: { updatedAt: 'desc' },
          });

          return res.status(200).json({ sellers });
        }

        // -----------------------------------------------------------------
        // saved_niches — Get saved niche research sessions
        // -----------------------------------------------------------------
        case 'saved_niches': {
          const niches = await prisma.ebayNicheResearch.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
          });

          return res.status(200).json({ niches });
        }

        // -----------------------------------------------------------------
        // product_database — Advanced product search with filters
        // -----------------------------------------------------------------
        case 'product_database': {
          const q = req.query.q as string;
          const categoryId = req.query.category_id as string;
          const minPrice = req.query.min_price as string;
          const maxPrice = req.query.max_price as string;
          const condition = req.query.condition as string;
          const sort = (req.query.sort as string) || 'newlyListed';
          const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
          const offset = parseInt((req.query.offset as string) || '0', 10);

          if (!q && !categoryId) {
            return res
              .status(400)
              .json({ error: 'Either q or category_id is required' });
          }

          // Build filter string
          const filters: string[] = [];
          if (minPrice || maxPrice) {
            const priceFilter = `price:[${minPrice || '*'}..${maxPrice || '*'}]`;
            filters.push(priceFilter);
          }
          if (condition) {
            filters.push(`conditionIds:{${condition}}`);
          }

          // Build sort string
          let sortParam = '';
          switch (sort) {
            case 'price':
              sortParam = 'price';
              break;
            case '-price':
              sortParam = '-price';
              break;
            case 'newlyListed':
              sortParam = 'newlyListed';
              break;
            case 'bestMatch':
              // Browse API default order (no sort param) = eBay Best Match, the
              // order a shopper sees on the search page. The extension overlay
              // uses this so its sample matches the cards on screen.
              sortParam = '';
              break;
            default:
              sortParam = 'newlyListed';
          }

          // Build search URL
          const params = new URLSearchParams();
          if (q) params.set('q', q);
          if (categoryId) params.set('category_ids', categoryId);
          if (filters.length > 0) params.set('filter', filters.join(','));
          if (sortParam) params.set('sort', sortParam);
          params.set('limit', String(limit));
          params.set('offset', String(offset));

          const { token: appToken } = await getEbayTokenFor(userId);
          const searchResult = await callEbayAPI(
            `/buy/browse/v1/item_summary/search?${params.toString()}`,
            appToken,
            {},
            marketplaceId
          );

          const items = searchResult.itemSummaries || [];
          const totalCount = searchResult.total || 0;

          // R0: robust price stats (median, P25–P75, trimmed min/max, n). No mean.
          const priceStats = { ...(await ebayPriceSummary(items)), totalResults: totalCount };

          // Keyword analysis: top words from titles
          const wordCounts: Record<string, number> = {};
          items.forEach((item: Record<string, unknown>) => {
            const title = (item.title as string) || '';
            title
              .toLowerCase()
              .split(/\s+/)
              .filter((w: string) => w.length > 2)
              .forEach((word: string) => {
                wordCounts[word] = (wordCounts[word] || 0) + 1;
              });
          });
          const topKeywords = Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([word, count]) => ({ word, count }));

          // Enrich first 20 items with sold quantity
          const enrichCount = Math.min(items.length, 20);
          const enrichedItems = await Promise.allSettled(
            items.slice(0, enrichCount).map(async (item: Record<string, unknown>) => {
              const legacyId = item.legacyItemId as string | undefined;
              if (!legacyId) return { ...item, enriched: false };
              try {
                const details = await getItemDetails(legacyId, appToken, marketplaceId);
                return {
                  ...item,
                  enriched: true,
                  estimatedSoldQuantity: details.soldQuantity,
                  estimatedRemainingQuantity: details.remainingQuantity,
                };
              } catch {
                return { ...item, enriched: false };
              }
            })
          );

          const enrichedResults = enrichedItems.map((r) =>
            r.status === 'fulfilled' ? r.value : null
          );
          // Merge enriched into items
          const finalItems = items.map(
            (item: Record<string, unknown>, i: number) =>
              i < enrichCount && enrichedResults[i]
                ? enrichedResults[i]
                : item
          );

          return res.status(200).json({
            items: finalItems,
            total: totalCount,
            priceStats,
            topKeywords,
            offset,
            limit,
          });
        }

        // -----------------------------------------------------------------
        // niche_analyze — Deep niche analysis
        // -----------------------------------------------------------------
        case 'niche_analyze': {
          const q = req.query.q as string;
          const categoryId = req.query.category_id as string;

          if (!q && !categoryId) {
            return res
              .status(400)
              .json({ error: 'Either q or category_id is required' });
          }

          const { token: appToken } = await getEbayTokenFor(userId);

          const params = new URLSearchParams();
          if (q) params.set('q', q);
          if (categoryId) params.set('category_ids', categoryId);
          params.set('limit', '200');

          const searchResult = await callEbayAPI(
            `/buy/browse/v1/item_summary/search?${params.toString()}`,
            appToken,
            {},
            marketplaceId
          );

          const items = searchResult.itemSummaries || [];
          const totalResults = searchResult.total || 0;

          // Price analysis (R0: robust summary; no arithmetic mean)
          const priceSummary = await ebayPriceSummary(items);
          const medianPrice = priceSummary.median ?? 0;
          const priceSpread = { min: priceSummary.min ?? 0, max: priceSummary.max ?? 0 };
          // Distribution over the trimmed range, in the summary currency only.
          const prices: number[] = items
            .map((item: Record<string, unknown>) => {
              const price = item.price as { value?: string; currency?: string } | undefined;
              return (price?.currency || 'USD') === priceSummary.currency ? parseFloat(price?.value || '0') : 0;
            })
            .filter((p: number) => p > 0 && p >= priceSpread.min && p <= priceSpread.max);

          // Price distribution buckets
          const priceBuckets: { range: string; count: number; min: number; max: number }[] = [];
          if (prices.length > 0) {
            const bucketSize = Math.max(Math.ceil((priceSpread.max - priceSpread.min) / 10), 1);
            for (let i = 0; i < 10; i++) {
              const bucketMin = priceSpread.min + i * bucketSize;
              const bucketMax = bucketMin + bucketSize;
              const count = prices.filter(p => p >= bucketMin && (i === 9 ? p <= bucketMax : p < bucketMax)).length;
              priceBuckets.push({
                range: `${Math.round(bucketMin)}-${Math.round(bucketMax)} ${priceSummary.currency}`,
                count,
                min: bucketMin,
                max: bucketMax,
              });
            }
          }

          // Seller analysis
          const sellerMap: Record<string, number> = {};
          items.forEach((item: Record<string, unknown>) => {
            const seller = item.seller as { username?: string } | undefined;
            const username = seller?.username;
            if (username) {
              sellerMap[username] = (sellerMap[username] || 0) + 1;
            }
          });
          const uniqueSellers = Object.keys(sellerMap).length;
          const topSellers = Object.entries(sellerMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([username, listings]) => ({ username, listings }));

          // Seller concentration: top 3 sellers' share
          const totalListings = items.length;
          const top3Listings = topSellers
            .slice(0, 3)
            .reduce((sum, s) => sum + s.listings, 0);
          const sellerConcentration =
            totalListings > 0 ? (top3Listings / totalListings) * 100 : 0;

          // Shipping analysis
          let freeShippingCount = 0;
          items.forEach((item: Record<string, unknown>) => {
            const shippingOptions = item.shippingOptions as
              | Array<{ shippingCost?: { value?: string } }>
              | undefined;
            if (shippingOptions && shippingOptions.length > 0) {
              const cost = parseFloat(
                shippingOptions[0].shippingCost?.value || '0'
              );
              if (cost === 0) freeShippingCount++;
            }
          });
          const freeShippingPct =
            totalListings > 0
              ? (freeShippingCount / totalListings) * 100
              : 0;

          // Condition breakdown
          const conditionCounts: Record<string, number> = {};
          items.forEach((item: Record<string, unknown>) => {
            const cond = (item.condition as string) || 'Unknown';
            conditionCounts[cond] = (conditionCounts[cond] || 0) + 1;
          });

          // Aspect distributions (top item specifics)
          const aspectCounts: Record<string, Record<string, number>> = {};
          items.forEach((item: Record<string, unknown>) => {
            const aspects = item.itemAffinity as
              | Array<{ localizedAspectName?: string; localizedAspectValue?: string }>
              | undefined;
            if (!aspects) return;
            aspects.forEach((asp) => {
              const name = asp.localizedAspectName;
              const value = asp.localizedAspectValue;
              if (name && value) {
                if (!aspectCounts[name]) aspectCounts[name] = {};
                aspectCounts[name][value] =
                  (aspectCounts[name][value] || 0) + 1;
              }
            });
          });

          // Enrich top 20 items with sold quantities
          const enrichCount = Math.min(items.length, 20);
          let totalEnrichedSold = 0;
          let enrichedCount = 0;

          const enrichedItems = await Promise.allSettled(
            items.slice(0, enrichCount).map(async (item: Record<string, unknown>) => {
              const legacyId = item.legacyItemId as string | undefined;
              if (!legacyId) return null;
              try {
                const details = await getItemDetails(legacyId, appToken, marketplaceId);
                totalEnrichedSold += details.soldQuantity;
                enrichedCount++;
                return {
                  legacyItemId: legacyId,
                  title: details.title,
                  price: details.price,
                  soldQuantity: details.soldQuantity,
                  remainingQuantity: details.remainingQuantity,
                  seller: details.seller,
                };
              } catch {
                return null;
              }
            })
          );

          const topProducts = enrichedItems
            .map((r) => (r.status === 'fulfilled' ? r.value : null))
            .filter(Boolean);

          // Calculate demand score (0-100)
          // Better demand: weight by sell-through (sold/listed ratio), not just raw volume
          const avgSold =
            enrichedCount > 0 ? totalEnrichedSold / enrichedCount : 0;
          const sellThroughRate = enrichedCount > 0 && items.length > 0
            ? Math.min(avgSold / Math.max(items.length / enrichedCount, 1), 1)
            : 0;
          const demandScore = Math.min(100, Math.round(
            Math.min(Math.log10(Math.max(totalResults, 1)) / 5, 1) * 25 + // 0-25 for market size (log scale)
            Math.min(avgSold, 50) * 1.0 + // 0-50 for avg sold per item
            sellThroughRate * 25 // 0-25 for sell-through rate
          ));

          // Calculate competition score (0-100)
          // Higher = more competitive, lower = easier entry
          const listingsPerSeller = uniqueSellers > 0 ? totalResults / uniqueSellers : 0;
          const competitionScore = Math.min(100, Math.round(
            Math.min(uniqueSellers, 500) * 0.1 + // 0-50 for seller count
            Math.min(listingsPerSeller, 20) * 1.5 + // 0-30 for listings density
            (sellerConcentration > 50 ? 20 : sellerConcentration > 30 ? 10 : 0) // 0-20 for dominance
          ));

          // Opportunity = high demand + low competition = good opportunity
          const opportunityScore = Math.min(100, Math.max(0, Math.round(
            demandScore * 0.6 + (100 - competitionScore) * 0.4
          )));

          // Score explanations are localized client-side from the score
          // (research.ebayNiche.*); the API returns no hardcoded Turkish text.

          logger.info('Niche analysis completed', {
            userId,
            query: q,
            categoryId,
            totalResults,
            uniqueSellers,
            demandScore,
            competitionScore,
            opportunityScore,
          });

          return res.status(200).json({
            query: q,
            categoryId,
            marketplace: marketplaceId,
            totalResults,
            medianPrice: Math.round(medianPrice * 100) / 100,
            // Legacy field read by ListingEditorDrawer/ListingCreatorDialog/ebay-listings; carries the median, never a mean.
            avgPrice: priceSummary.median != null ? Math.round(priceSummary.median * 100) / 100 : null,
            priceStats: priceSummary,
            priceSpread,
            priceDistribution: priceBuckets,
            uniqueSellers,
            sellerConcentration: Math.round(sellerConcentration * 10) / 10,
            topSellers,
            freeShippingPct: Math.round(freeShippingPct * 10) / 10,
            conditionBreakdown: conditionCounts,
            aspectDistributions: aspectCounts,
            topProducts,
            demandScore,
            competitionScore,
            opportunityScore,
            sellThroughRate: Math.round(sellThroughRate * 1000) / 10,
            avgSoldPerItem: Math.round(avgSold * 10) / 10,
            listingsPerSeller: Math.round(listingsPerSeller * 10) / 10,
          });
        }

        default:
          return res.status(400).json({ error: `Unknown GET action: ${action}` });
      }
    }

    // =====================================================================
    // POST actions
    // =====================================================================
    if (req.method === 'POST') {
      const body = req.body || {};

      switch (action) {
        // -----------------------------------------------------------------
        // track_product — Add a product to tracker
        // -----------------------------------------------------------------
        case 'track_product': {
          const { legacyItemId: rawLegacyId, itemId: altItemId, title, notes, tags } = body as {
            legacyItemId?: string;
            itemId?: string;
            title?: string;
            notes?: string;
            tags?: string[];
          };

          const legacyItemId = rawLegacyId || altItemId;
          if (!legacyItemId) {
            return res.status(400).json({ error: 'legacyItemId or itemId is required' });
          }

          // Check if already tracked
          const existing = await prisma.ebayTrackedProduct.findUnique({
            where: { userId_legacyItemId: { userId, legacyItemId } },
          });

          if (existing && existing.isActive) {
            return res
              .status(409)
              .json({ error: 'Product is already being tracked', product: existing });
          }

          // Fetch full details from eBay
          const { token: appToken } = await getEbayTokenFor(userId);
          const details = await getItemDetails(legacyItemId, appToken, marketplaceId);

          // Create or reactivate tracked product + initial snapshot in a transaction
          const product = await prisma.$transaction(async (tx) => {
            let trackedProduct;

            if (existing) {
              // Reactivate previously soft-deleted product
              trackedProduct = await tx.ebayTrackedProduct.update({
                where: { id: existing.id },
                data: {
                  isActive: true,
                  title: title || details.title,
                  imageUrl: details.imageUrl,
                  categoryId: details.categoryId,
                  categoryPath: details.categoryPath,
                  seller: details.seller,
                  condition: details.condition,
                  currentPrice: details.price,
                  currency: details.currency,
                  currentQuantity: details.remainingQuantity,
                  totalSold: details.soldQuantity,
                  itemWebUrl: details.itemWebUrl,
                  itemId: details.itemId,
                  notes: notes ?? existing.notes,
                  tags: tags ?? existing.tags,
                  lastCheckedAt: new Date(),
                },
              });
            } else {
              trackedProduct = await tx.ebayTrackedProduct.create({
                data: {
                  userId,
                  legacyItemId,
                  itemId: details.itemId,
                  title: title || details.title,
                  imageUrl: details.imageUrl,
                  categoryId: details.categoryId,
                  categoryPath: details.categoryPath,
                  seller: details.seller,
                  condition: details.condition,
                  currentPrice: details.price,
                  currency: details.currency,
                  currentQuantity: details.remainingQuantity,
                  totalSold: details.soldQuantity,
                  itemWebUrl: details.itemWebUrl,
                  notes: notes || null,
                  tags: tags || [],
                  lastCheckedAt: new Date(),
                },
              });
            }

            // Create initial snapshot
            await tx.ebayPriceSnapshot.create({
              data: {
                trackedProductId: trackedProduct.id,
                price: details.price,
                currency: details.currency,
                quantity: details.remainingQuantity,
                soldQuantity: details.soldQuantity,
              },
            });

            return trackedProduct;
          });

          logger.info('Product tracked', {
            userId,
            legacyItemId,
            productId: product.id,
          });

          return res.status(201).json({ product });
        }

        // -----------------------------------------------------------------
        // refresh_tracked — Refresh all tracked products' prices
        // -----------------------------------------------------------------
        case 'refresh_tracked': {
          const trackedProducts = await prisma.ebayTrackedProduct.findMany({
            where: { userId, isActive: true },
          });

          if (trackedProducts.length === 0) {
            return res.status(200).json({ message: 'No tracked products to refresh', updated: 0 });
          }

          const { token: appToken } = await getEbayTokenFor(userId);
          const results: Array<{
            id: string;
            legacyItemId: string;
            success: boolean;
            error?: string;
          }> = [];

          for (const product of trackedProducts) {
            try {
              const details = await getItemDetails(
                product.legacyItemId,
                appToken,
                marketplaceId
              );

              await prisma.$transaction([
                prisma.ebayTrackedProduct.update({
                  where: { id: product.id },
                  data: {
                    currentPrice: details.price,
                    currentQuantity: details.remainingQuantity,
                    totalSold: details.soldQuantity,
                    lastCheckedAt: new Date(),
                  },
                }),
                prisma.ebayPriceSnapshot.create({
                  data: {
                    trackedProductId: product.id,
                    price: details.price,
                    currency: details.currency,
                    quantity: details.remainingQuantity,
                    soldQuantity: details.soldQuantity,
                  },
                }),
              ]);

              results.push({
                id: product.id,
                legacyItemId: product.legacyItemId,
                success: true,
              });
            } catch (err) {
              results.push({
                id: product.id,
                legacyItemId: product.legacyItemId,
                success: false,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          }

          const successCount = results.filter((r) => r.success).length;

          logger.info('Tracked products refreshed', {
            userId,
            total: trackedProducts.length,
            success: successCount,
            failed: trackedProducts.length - successCount,
          });

          return res.status(200).json({
            updated: successCount,
            failed: trackedProducts.length - successCount,
            total: trackedProducts.length,
            results,
          });
        }

        // -----------------------------------------------------------------
        // track_seller — Add seller to tracker
        // -----------------------------------------------------------------
        // -----------------------------------------------------------------
        // update_product — Update notes/tags on a tracked product
        // -----------------------------------------------------------------
        case 'update_product': {
          const { id, notes, tags } = body as {
            id?: string;
            notes?: string;
            tags?: string[];
          };
          if (!id) {
            return res.status(400).json({ error: 'id is required' });
          }
          const product = await prisma.ebayTrackedProduct.findFirst({
            where: { id, userId },
          });
          if (!product) {
            return res.status(404).json({ error: 'Tracked product not found' });
          }
          const updateData: Record<string, unknown> = {};
          if (notes !== undefined) updateData.notes = notes;
          if (tags !== undefined) updateData.tags = tags;
          const updated = await prisma.ebayTrackedProduct.update({
            where: { id },
            data: updateData,
          });
          return res.status(200).json({ product: updated });
        }

        // -----------------------------------------------------------------
        // update_seller — Update notes on a tracked seller
        // -----------------------------------------------------------------
        case 'update_seller': {
          const { id: sellerId2, notes: sellerNotes } = body as {
            id?: string;
            notes?: string;
          };
          if (!sellerId2) {
            return res.status(400).json({ error: 'id is required' });
          }
          const sellerRec = await prisma.ebayTrackedSeller.findFirst({
            where: { id: sellerId2, userId },
          });
          if (!sellerRec) {
            return res.status(404).json({ error: 'Tracked seller not found' });
          }
          const updatedSeller = await prisma.ebayTrackedSeller.update({
            where: { id: sellerId2 },
            data: { notes: sellerNotes ?? null },
          });
          return res.status(200).json({ seller: updatedSeller });
        }

        case 'track_seller': {
          const { sellerUsername: rawUsername, username: altUsername, notes } = body as {
            sellerUsername?: string;
            username?: string;
            notes?: string;
          };

          const sellerUsername = rawUsername || altUsername;
          if (!sellerUsername) {
            return res.status(400).json({ error: 'sellerUsername or username is required' });
          }

          // Check if already tracked
          const existing = await prisma.ebayTrackedSeller.findUnique({
            where: {
              userId_sellerUsername: { userId, sellerUsername },
            },
          });

          if (existing && existing.isActive) {
            return res
              .status(409)
              .json({ error: 'Seller is already being tracked', seller: existing });
          }

          let seller;
          if (existing) {
            // Reactivate
            seller = await prisma.ebayTrackedSeller.update({
              where: { id: existing.id },
              data: {
                isActive: true,
                notes: notes ?? existing.notes,
              },
            });
          } else {
            seller = await prisma.ebayTrackedSeller.create({
              data: {
                userId,
                sellerUsername,
                notes: notes || null,
              },
            });
          }

          logger.info('Seller tracked', { userId, sellerUsername, sellerId: seller.id });

          return res.status(201).json({ seller });
        }

        // -----------------------------------------------------------------
        // save_niche — Save a niche research session
        // -----------------------------------------------------------------
        // -----------------------------------------------------------------
        // untrack_product (via POST) — Soft delete tracked product
        // -----------------------------------------------------------------
        case 'untrack_product': {
          const { id: prodId } = body as { id?: string };
          if (!prodId) {
            return res.status(400).json({ error: 'id is required' });
          }
          const prodRec = await prisma.ebayTrackedProduct.findFirst({
            where: { id: prodId, userId },
          });
          if (!prodRec) {
            return res.status(404).json({ error: 'Tracked product not found' });
          }
          await prisma.ebayTrackedProduct.update({
            where: { id: prodId },
            data: { isActive: false },
          });
          return res.status(200).json({ success: true, productId: prodId });
        }

        // -----------------------------------------------------------------
        // untrack_seller (via POST) — Soft delete tracked seller
        // -----------------------------------------------------------------
        case 'untrack_seller': {
          const { id: selId } = body as { id?: string };
          if (!selId) {
            return res.status(400).json({ error: 'id is required' });
          }
          const selRec = await prisma.ebayTrackedSeller.findFirst({
            where: { id: selId, userId },
          });
          if (!selRec) {
            return res.status(404).json({ error: 'Tracked seller not found' });
          }
          await prisma.ebayTrackedSeller.update({
            where: { id: selId },
            data: { isActive: false },
          });
          return res.status(200).json({ success: true, sellerId: selId });
        }

        // -----------------------------------------------------------------
        // delete_niche (via POST) — Hard delete saved niche
        // -----------------------------------------------------------------
        case 'delete_niche': {
          const { id: nicheId2 } = body as { id?: string };
          if (!nicheId2) {
            return res.status(400).json({ error: 'id is required' });
          }
          const nicheRec = await prisma.ebayNicheResearch.findFirst({
            where: { id: nicheId2, userId },
          });
          if (!nicheRec) {
            return res.status(404).json({ error: 'Saved niche not found' });
          }
          await prisma.ebayNicheResearch.delete({ where: { id: nicheId2 } });
          return res.status(200).json({ success: true, nicheId: nicheId2 });
        }

        case 'save_niche': {
          const {
            query,
            categoryId,
            categoryName,
            marketplace,
            totalResults,
            avgPrice,
            medianPrice,
            uniqueSellers,
            demandScore,
            competitionScore,
            notes,
          } = body as {
            query?: string;
            categoryId?: string;
            categoryName?: string;
            marketplace?: string;
            totalResults?: number;
            avgPrice?: number;
            medianPrice?: number;
            uniqueSellers?: number;
            demandScore?: number;
            competitionScore?: number;
            notes?: string;
          };

          if (!query) {
            return res.status(400).json({ error: 'query is required' });
          }

          const niche = await prisma.ebayNicheResearch.create({
            data: {
              userId,
              query,
              categoryId: categoryId || null,
              categoryName: categoryName || null,
              marketplace: marketplace || 'EBAY_US',
              totalResults: totalResults ?? null,
              avgPrice: avgPrice ?? null,
              medianPrice: medianPrice ?? null,
              uniqueSellers: uniqueSellers ?? null,
              demandScore: demandScore ?? null,
              competitionScore: competitionScore ?? null,
              notes: notes || null,
            },
          });

          logger.info('Niche research saved', { userId, nicheId: niche.id, query });

          return res.status(201).json({ niche });
        }

        default:
          return res.status(400).json({ error: `Unknown POST action: ${action}` });
      }
    }

    // =====================================================================
    // DELETE actions
    // =====================================================================
    if (req.method === 'DELETE') {
      switch (action) {
        // -----------------------------------------------------------------
        // untrack_product — Soft delete tracked product
        // -----------------------------------------------------------------
        case 'untrack_product': {
          const productId = req.query.product_id as string;
          if (!productId) {
            return res.status(400).json({ error: 'product_id is required' });
          }

          const product = await prisma.ebayTrackedProduct.findFirst({
            where: { id: productId, userId },
          });
          if (!product) {
            return res.status(404).json({ error: 'Tracked product not found' });
          }

          await prisma.ebayTrackedProduct.update({
            where: { id: productId },
            data: { isActive: false },
          });

          logger.info('Product untracked', { userId, productId });

          return res.status(200).json({ success: true, productId });
        }

        // -----------------------------------------------------------------
        // untrack_seller — Soft delete tracked seller
        // -----------------------------------------------------------------
        case 'untrack_seller': {
          const sellerId = req.query.seller_id as string;
          if (!sellerId) {
            return res.status(400).json({ error: 'seller_id is required' });
          }

          const seller = await prisma.ebayTrackedSeller.findFirst({
            where: { id: sellerId, userId },
          });
          if (!seller) {
            return res.status(404).json({ error: 'Tracked seller not found' });
          }

          await prisma.ebayTrackedSeller.update({
            where: { id: sellerId },
            data: { isActive: false },
          });

          logger.info('Seller untracked', { userId, sellerId });

          return res.status(200).json({ success: true, sellerId });
        }

        // -----------------------------------------------------------------
        // delete_niche — Hard delete saved niche
        // -----------------------------------------------------------------
        case 'delete_niche': {
          const nicheId = req.query.niche_id as string;
          if (!nicheId) {
            return res.status(400).json({ error: 'niche_id is required' });
          }

          const niche = await prisma.ebayNicheResearch.findFirst({
            where: { id: nicheId, userId },
          });
          if (!niche) {
            return res.status(404).json({ error: 'Saved niche not found' });
          }

          await prisma.ebayNicheResearch.delete({
            where: { id: nicheId },
          });

          logger.info('Niche research deleted', { userId, nicheId });

          return res.status(200).json({ success: true, nicheId });
        }

        default:
          return res.status(400).json({ error: `Unknown DELETE action: ${action}` });
      }
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    logger.error('ebay-research API error', error instanceof Error ? error : new Error(message), {
      action,
      userId,
      method: req.method,
    });
    return res.status(500).json({ error: message });
  }
}
