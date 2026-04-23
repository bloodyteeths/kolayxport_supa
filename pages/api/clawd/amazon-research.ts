import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { getAuthUser } from '../../../lib/auth';
import {
  callCreatorsApi,
  callSpApiWithRetry,
  getValidToken,
  getAutocomplete,
  alphabetSoupExpansion,
  AMAZON_MARKETPLACES,
  type AmazonRegion,
} from '../../../lib/integrations/amazonClient';
import {
  estimateMonthlySales,
  opportunityScore,
  demandScore,
  competitionScore,
} from '../../../lib/amazon/salesEstimator';
import { calculateFees, quickProfitEstimate } from '../../../lib/amazon/feeCalculator';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStringParam(req: NextApiRequest, key: string): string {
  const v = req.query[key];
  return typeof v === 'string' ? v : '';
}

function getNumberParam(req: NextApiRequest, key: string): number | undefined {
  const v = getStringParam(req, key);
  return v ? parseFloat(v) : undefined;
}

/**
 * Extract useful fields from a PA-API SearchItems result item.
 */
function mapCreatorsItem(item: any) {
  const info = item.ItemInfo || {};
  const offers = item.Offers?.Listings?.[0] || {};
  const browseNodes = item.BrowseNodeInfo?.BrowseNodes || [];
  const rootCategory = browseNodes.length > 0
    ? browseNodes[browseNodes.length - 1]
    : null;

  const price = offers.Price?.Amount ?? null;
  const salesRank = browseNodes[0]?.SalesRank ?? null;
  const reviewCount = item.CustomerReviews?.Count ?? null;
  const rating = item.CustomerReviews?.StarRating?.Value ?? null;

  const salesEstimate = salesRank
    ? estimateMonthlySales(salesRank, rootCategory?.Id, price ?? undefined)
    : null;

  return {
    asin: item.ASIN,
    title: info.Title?.DisplayValue ?? '',
    imageUrl: item.Images?.Primary?.Large?.URL ?? item.Images?.Primary?.Medium?.URL ?? null,
    price,
    currency: offers.Price?.Currency ?? 'USD',
    salesRank,
    reviewCount,
    rating,
    categoryId: rootCategory?.Id ?? null,
    categoryName: rootCategory?.DisplayName ?? null,
    seller: offers.MerchantInfo?.Name ?? null,
    isPrime: offers.DeliveryInfo?.IsPrimeEligible ?? false,
    url: item.DetailPageURL ?? null,
    salesEstimate,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

async function handleGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const action = getStringParam(req, 'action');
  const marketplace = getStringParam(req, 'marketplace') || 'US';

  switch (action) {
    // -----------------------------------------------------------------------
    // Product search via Creators API (no seller auth needed)
    // -----------------------------------------------------------------------
    case 'search_products': {
      const query = getStringParam(req, 'q');
      if (!query) return res.status(400).json({ error: 'q parameter required' });

      const sortBy = getStringParam(req, 'sort') || 'Relevance';
      const minPrice = getNumberParam(req, 'min_price');
      const maxPrice = getNumberParam(req, 'max_price');
      const category = getStringParam(req, 'category');

      const payload: any = {
        Keywords: query,
        SearchIndex: category || 'All',
        ItemCount: 10,
        SortBy: sortBy,
        Resources: [
          'ItemInfo.Title',
          'ItemInfo.Features',
          'Images.Primary.Large',
          'Images.Primary.Medium',
          'Offers.Listings.Price',
          'Offers.Listings.MerchantInfo',
          'Offers.Listings.DeliveryInfo.IsPrimeEligible',
          'BrowseNodeInfo.BrowseNodes',
          'BrowseNodeInfo.BrowseNodes.SalesRank',
          'CustomerReviews.Count',
          'CustomerReviews.StarRating',
        ],
      };

      if (minPrice || maxPrice) {
        payload.MinPrice = minPrice;
        payload.MaxPrice = maxPrice;
      }

      try {
        const data = await callCreatorsApi('SearchItems', payload, marketplace);
        const items = (data.SearchResult?.Items || []).map(mapCreatorsItem);

        // Compute aggregate stats
        const prices = items.map((i: any) => i.price).filter(Boolean) as number[];
        const ranks = items.map((i: any) => i.salesRank).filter(Boolean) as number[];
        const reviews = items.map((i: any) => i.reviewCount).filter(Boolean) as number[];

        const avgPrice = prices.length ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;
        const medianPrice = prices.length
          ? [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)]
          : 0;
        const avgBsr = ranks.length ? ranks.reduce((a: number, b: number) => a + b, 0) / ranks.length : 0;
        const avgReviews = reviews.length ? reviews.reduce((a: number, b: number) => a + b, 0) / reviews.length : 0;

        const opportunity = opportunityScore(
          avgBsr,
          avgReviews,
          data.SearchResult?.TotalResultCount || items.length,
        );

        // Extract top keywords from titles
        const wordFreq: Record<string, number> = {};
        items.forEach((item: any) => {
          const words = (item.title || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          words.forEach((w: string) => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
        });
        const topKeywords = Object.entries(wordFreq)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 20)
          .map(([keyword, count]) => ({ keyword, count, pct: Math.round((count / items.length) * 100) }));

        return res.json({
          items,
          totalResults: data.SearchResult?.TotalResultCount || items.length,
          stats: {
            avgPrice: Math.round(avgPrice * 100) / 100,
            medianPrice: Math.round(medianPrice * 100) / 100,
            minPrice: prices.length ? Math.min(...prices) : 0,
            maxPrice: prices.length ? Math.max(...prices) : 0,
            avgBsr: Math.round(avgBsr),
            avgReviews: Math.round(avgReviews),
          },
          opportunity,
          topKeywords,
        });
      } catch (err: any) {
        logger.error('Amazon search_products failed', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // ASIN lookup
    // -----------------------------------------------------------------------
    case 'get_product': {
      const asin = getStringParam(req, 'asin');
      if (!asin) return res.status(400).json({ error: 'asin parameter required' });

      try {
        const data = await callCreatorsApi('GetItems', {
          ItemIds: [asin],
          Resources: [
            'ItemInfo.Title',
            'ItemInfo.Features',
            'ItemInfo.ByLineInfo',
            'ItemInfo.ContentInfo',
            'ItemInfo.ProductInfo',
            'Images.Primary.Large',
            'Images.Variants.Large',
            'Offers.Listings.Price',
            'Offers.Listings.MerchantInfo',
            'Offers.Listings.DeliveryInfo.IsPrimeEligible',
            'Offers.Listings.Condition',
            'BrowseNodeInfo.BrowseNodes',
            'BrowseNodeInfo.BrowseNodes.SalesRank',
            'CustomerReviews.Count',
            'CustomerReviews.StarRating',
          ],
        }, marketplace);

        const item = data.ItemsResult?.Items?.[0];
        if (!item) return res.status(404).json({ error: 'ASIN not found' });

        const mapped = mapCreatorsItem(item);

        // Extract features
        const features = item.ItemInfo?.Features?.DisplayValues || [];

        // Fee estimate
        const fees = mapped.price
          ? calculateFees({
              price: mapped.price,
              category: mapped.categoryName || 'General',
              fulfillment: 'FBA',
            })
          : null;

        return res.json({ ...mapped, features, fees });
      } catch (err: any) {
        logger.error('Amazon get_product failed', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Autocomplete (Amazon search suggestions)
    // -----------------------------------------------------------------------
    case 'search_autocomplete': {
      const prefix = getStringParam(req, 'q');
      if (!prefix) return res.status(400).json({ error: 'q parameter required' });

      const expand = getStringParam(req, 'expand') === 'true';

      try {
        const suggestions = expand
          ? await alphabetSoupExpansion(prefix, marketplace)
          : await getAutocomplete(prefix, marketplace);

        return res.json({ suggestions, count: suggestions.length });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Niche analysis
    // -----------------------------------------------------------------------
    case 'niche_analyze': {
      const query = getStringParam(req, 'q');
      if (!query) return res.status(400).json({ error: 'q parameter required' });

      const category = getStringParam(req, 'category') || 'All';

      try {
        const data = await callCreatorsApi('SearchItems', {
          Keywords: query,
          SearchIndex: category,
          ItemCount: 10,
          SortBy: 'Relevance',
          Resources: [
            'ItemInfo.Title',
            'Offers.Listings.Price',
            'Offers.Listings.MerchantInfo',
            'BrowseNodeInfo.BrowseNodes',
            'BrowseNodeInfo.BrowseNodes.SalesRank',
            'CustomerReviews.Count',
            'CustomerReviews.StarRating',
          ],
        }, marketplace);

        const items = (data.SearchResult?.Items || []).map(mapCreatorsItem);
        const totalResults = data.SearchResult?.TotalResultCount || items.length;

        const prices = items.map((i: any) => i.price).filter(Boolean) as number[];
        const ranks = items.map((i: any) => i.salesRank).filter(Boolean) as number[];
        const reviews = items.map((i: any) => i.reviewCount).filter(Boolean) as number[];
        const ratings = items.map((i: any) => i.rating).filter(Boolean) as number[];

        const avgPrice = prices.length ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;
        const sortedPrices = [...prices].sort((a, b) => a - b);
        const medianPrice = sortedPrices.length
          ? sortedPrices[Math.floor(sortedPrices.length / 2)]
          : 0;
        const avgBsr = ranks.length ? ranks.reduce((a: number, b: number) => a + b, 0) / ranks.length : 0;
        const avgReviews = reviews.length ? reviews.reduce((a: number, b: number) => a + b, 0) / reviews.length : 0;
        const avgRating = ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0;

        // Price distribution (10 buckets)
        const priceDist: { range: string; count: number }[] = [];
        if (prices.length) {
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          const step = (max - min) / 10 || 1;
          for (let i = 0; i < 10; i++) {
            const lo = Math.round((min + step * i) * 100) / 100;
            const hi = Math.round((min + step * (i + 1)) * 100) / 100;
            priceDist.push({
              range: `$${lo}-$${hi}`,
              count: prices.filter(p => p >= lo && (i === 9 ? p <= hi : p < hi)).length,
            });
          }
        }

        // Seller concentration
        const sellerCounts: Record<string, number> = {};
        items.forEach((i: any) => {
          if (i.seller) sellerCounts[i.seller] = (sellerCounts[i.seller] || 0) + 1;
        });
        const uniqueSellers = Object.keys(sellerCounts).length;
        const topSellers = Object.entries(sellerCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([seller, count]) => ({ seller, listings: count }));

        const demand = demandScore(avgBsr, totalResults);
        const competition = competitionScore(avgReviews);
        const opportunity = opportunityScore(avgBsr, avgReviews, totalResults);

        // Revenue estimate for the niche
        const avgMonthlySales = ranks.length
          ? ranks.reduce((sum, bsr) => sum + estimateMonthlySales(bsr, undefined, avgPrice).monthlySales, 0) / ranks.length
          : 0;

        // Fee estimate at average price
        const avgFees = avgPrice
          ? calculateFees({ price: avgPrice, category: 'General', fulfillment: 'FBA' })
          : null;

        return res.json({
          query,
          category,
          marketplace,
          totalResults,
          items,
          stats: {
            avgPrice: Math.round(avgPrice * 100) / 100,
            medianPrice: Math.round(medianPrice * 100) / 100,
            minPrice: prices.length ? Math.min(...prices) : 0,
            maxPrice: prices.length ? Math.max(...prices) : 0,
            avgBsr: Math.round(avgBsr),
            avgReviews: Math.round(avgReviews),
            avgRating: Math.round(avgRating * 10) / 10,
            avgMonthlySales: Math.round(avgMonthlySales),
          },
          demand,
          competition,
          opportunity,
          priceDistribution: priceDist,
          sellerAnalysis: { uniqueSellers, topSellers },
          feeEstimate: avgFees,
        });
      } catch (err: any) {
        logger.error('Amazon niche_analyze failed', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Competitive pricing (requires seller auth via SP-API)
    // -----------------------------------------------------------------------
    case 'competitive_pricing': {
      const asin = getStringParam(req, 'asin');
      if (!asin) return res.status(400).json({ error: 'asin parameter required' });

      const credential = await prisma.credential.findUnique({ where: { userId } });
      if (!credential?.amazonAccessToken) {
        return res.status(400).json({ error: 'Amazon seller account not connected' });
      }

      const token = await getValidToken(credential, async (newToken, expiresAt) => {
        await prisma.credential.update({
          where: { userId },
          data: { amazonAccessToken: newToken, amazonTokenExpiresAt: expiresAt },
        });
      });

      if (!token) return res.status(400).json({ error: 'Failed to get Amazon token' });

      const region = (credential.amazonRegion || 'eu') as AmazonRegion;
      const mktId = credential.amazonMarketplaceId || 'ATVPDKIKX0DER';

      try {
        const data = await callSpApiWithRetry(
          `/products/pricing/v0/competitivePrice?Asin=${asin}&MarketplaceId=${mktId}`,
          token,
          region,
        );

        return res.json(data);
      } catch (err: any) {
        logger.error('Amazon competitive_pricing failed', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Browse categories
    // -----------------------------------------------------------------------
    case 'category_browse': {
      const browseNodeId = getStringParam(req, 'node_id');
      if (!browseNodeId) return res.status(400).json({ error: 'node_id parameter required' });

      try {
        const data = await callCreatorsApi('GetBrowseNodes', {
          BrowseNodeIds: [browseNodeId],
          Resources: [
            'BrowseNodes.Ancestor',
            'BrowseNodes.Children',
          ],
        }, marketplace);

        return res.json(data.BrowseNodesResult?.BrowseNodes || []);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Fee calculator
    // -----------------------------------------------------------------------
    case 'calculate_fees': {
      const price = getNumberParam(req, 'price');
      const category = getStringParam(req, 'category') || 'General';
      const cogs = getNumberParam(req, 'cogs');
      const shipping = getNumberParam(req, 'shipping');
      const weightLb = getNumberParam(req, 'weight_lb');

      if (!price) return res.status(400).json({ error: 'price parameter required' });

      const fba = calculateFees({
        price,
        category,
        fulfillment: 'FBA',
        cogs,
        shippingCost: shipping,
        weightLb,
      });

      const fbm = calculateFees({
        price,
        category,
        fulfillment: 'FBM',
        cogs,
        shippingCost: shipping,
        weightLb,
      });

      return res.json({ fba, fbm });
    }

    // -----------------------------------------------------------------------
    // Tracked products
    // -----------------------------------------------------------------------
    case 'tracked_products': {
      const products = await prisma.amazonTrackedProduct.findMany({
        where: { userId, isActive: true },
        include: {
          snapshots: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return res.json({ products });
    }

    // -----------------------------------------------------------------------
    // Price/rank history for a tracked product
    // -----------------------------------------------------------------------
    case 'price_history': {
      const productId = getStringParam(req, 'product_id');
      if (!productId) return res.status(400).json({ error: 'product_id required' });

      const snapshots = await prisma.amazonPriceSnapshot.findMany({
        where: { trackedProductId: productId, userId },
        orderBy: { timestamp: 'asc' },
      });

      return res.json({ snapshots });
    }

    // -----------------------------------------------------------------------
    // Saved niches
    // -----------------------------------------------------------------------
    case 'saved_niches': {
      const niches = await prisma.amazonNicheResearch.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ niches });
    }

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

async function handlePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const action = getStringParam(req, 'action');
  const body = req.body || {};

  switch (action) {
    // -----------------------------------------------------------------------
    // Track a product (ASIN)
    // -----------------------------------------------------------------------
    case 'track_product': {
      const { asin, title, imageUrl, categoryId, categoryName, seller, price, currency, salesRank, reviewCount, rating, notes, tags } = body;
      if (!asin) return res.status(400).json({ error: 'asin is required' });

      try {
        // Check if already tracked (reactivate if soft-deleted)
        const existing = await prisma.amazonTrackedProduct.findUnique({
          where: { userId_asin: { userId, asin } },
        });

        let product;
        if (existing) {
          product = await prisma.amazonTrackedProduct.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              title: title || existing.title,
              imageUrl: imageUrl || existing.imageUrl,
              currentPrice: price ?? existing.currentPrice,
              currentRank: salesRank ?? existing.currentRank,
              reviewCount: reviewCount ?? existing.reviewCount,
              rating: rating ?? existing.rating,
              notes: notes ?? existing.notes,
              lastCheckedAt: new Date(),
            },
          });
        } else {
          product = await prisma.amazonTrackedProduct.create({
            data: {
              userId,
              asin,
              title,
              imageUrl,
              categoryId,
              categoryName,
              seller,
              currentPrice: price,
              currency: currency || 'USD',
              currentRank: salesRank,
              reviewCount,
              rating,
              notes,
              tags: tags || [],
              lastCheckedAt: new Date(),
            },
          });
        }

        // Create initial snapshot
        if (price != null || salesRank != null) {
          await prisma.amazonPriceSnapshot.create({
            data: {
              trackedProductId: product.id,
              userId,
              price,
              currency: currency || 'USD',
              salesRank,
              reviewCount,
              rating,
            },
          });
        }

        return res.json({ product });
      } catch (err: any) {
        logger.error('Amazon track_product failed', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Refresh tracked products
    // -----------------------------------------------------------------------
    case 'refresh_tracked': {
      const products = await prisma.amazonTrackedProduct.findMany({
        where: { userId, isActive: true },
      });

      if (!products.length) {
        return res.json({ refreshed: 0 });
      }

      let refreshed = 0;
      const errors: string[] = [];

      // Batch by 10 ASINs (PA-API limit)
      for (let i = 0; i < products.length; i += 10) {
        const batch = products.slice(i, i + 10);
        const asins = batch.map(p => p.asin);

        try {
          const marketplace = 'US'; // TODO: use per-product marketplace
          const data = await callCreatorsApi('GetItems', {
            ItemIds: asins,
            Resources: [
              'Offers.Listings.Price',
              'BrowseNodeInfo.BrowseNodes.SalesRank',
              'CustomerReviews.Count',
              'CustomerReviews.StarRating',
            ],
          }, marketplace);

          const itemMap = new Map<string, any>();
          (data.ItemsResult?.Items || []).forEach((item: any) => {
            itemMap.set(item.ASIN, item);
          });

          for (const product of batch) {
            const item = itemMap.get(product.asin);
            if (!item) continue;

            const price = item.Offers?.Listings?.[0]?.Price?.Amount ?? null;
            const salesRank = item.BrowseNodeInfo?.BrowseNodes?.[0]?.SalesRank ?? null;
            const reviewCount = item.CustomerReviews?.Count ?? null;
            const rating = item.CustomerReviews?.StarRating?.Value ?? null;

            await prisma.amazonTrackedProduct.update({
              where: { id: product.id },
              data: {
                currentPrice: price ?? product.currentPrice,
                currentRank: salesRank ?? product.currentRank,
                reviewCount: reviewCount ?? product.reviewCount,
                rating: rating ?? product.rating,
                lastCheckedAt: new Date(),
              },
            });

            await prisma.amazonPriceSnapshot.create({
              data: {
                trackedProductId: product.id,
                userId,
                price,
                salesRank,
                reviewCount,
                rating,
              },
            });

            refreshed++;
          }
        } catch (err: any) {
          errors.push(`Batch ${i}: ${err.message}`);
        }

        // Delay between batches
        if (i + 10 < products.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return res.json({ refreshed, total: products.length, errors });
    }

    // -----------------------------------------------------------------------
    // Save niche research
    // -----------------------------------------------------------------------
    case 'save_niche': {
      const { query, categoryId, categoryName, marketplace: mp, totalResults, avgPrice, medianPrice, avgReviews, avgRating, demandScore: ds, competitionScore: cs, notes } = body;
      if (!query) return res.status(400).json({ error: 'query is required' });

      const niche = await prisma.amazonNicheResearch.create({
        data: {
          userId,
          query,
          categoryId,
          categoryName,
          marketplace: mp || 'amazon.com',
          totalResults,
          avgPrice,
          medianPrice,
          avgReviews,
          avgRating,
          demandScore: ds,
          competitionScore: cs,
          notes,
        },
      });

      return res.json({ niche });
    }

    // -----------------------------------------------------------------------
    // Update tracked product notes/tags
    // -----------------------------------------------------------------------
    case 'update_product': {
      const { productId, notes, tags } = body;
      if (!productId) return res.status(400).json({ error: 'productId required' });

      const product = await prisma.amazonTrackedProduct.update({
        where: { id: productId },
        data: {
          ...(notes !== undefined && { notes }),
          ...(tags !== undefined && { tags }),
        },
      });

      return res.json({ product });
    }

    // -----------------------------------------------------------------------
    // Untrack product (soft delete)
    // -----------------------------------------------------------------------
    case 'untrack_product': {
      const { productId } = body;
      if (!productId) return res.status(400).json({ error: 'productId required' });

      await prisma.amazonTrackedProduct.update({
        where: { id: productId },
        data: { isActive: false },
      });

      return res.json({ success: true });
    }

    // -----------------------------------------------------------------------
    // Delete saved niche
    // -----------------------------------------------------------------------
    case 'delete_niche': {
      const { nicheId } = body;
      if (!nicheId) return res.status(400).json({ error: 'nicheId required' });

      await prisma.amazonNicheResearch.delete({ where: { id: nicheId } });
      return res.json({ success: true });
    }

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth: API key or session
  let userId: string;
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;

  if (envApiKey && apiKey === envApiKey) {
    userId = (req.query.userId as string) || 'api-user';
  } else {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    userId = user.id;
  }

  try {
    if (req.method === 'GET') {
      return handleGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handlePost(req, res, userId);
    }
    if (req.method === 'DELETE') {
      // Alias DELETE to POST with untrack/delete actions
      return handlePost(req, res, userId);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    logger.error('Amazon research API error', err, { userId });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
