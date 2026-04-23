import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../../../lib/logger';
import { getAuthUser } from '../../../lib/auth';
import { getEbayTokenFor, getBrowseApiRateLimits } from '../../../lib/integrations/ebayClient';
import { fetchTrendyolCategoryProducts, TRENDYOL_CATEGORIES } from '../../../lib/integrations/trendyolSearch';
import { scanCategory, scanBatch, batchTranslateTitles, extractEnglishQuery, getCachedExchangeRate } from '../../../lib/arbitrage/scanner';
import { discoverTrendyolCategories, getCategoryMappings, syncCategoryMappings, mapToEbayCategory } from '../../../lib/arbitrage/categoryMapper';
import { startScanJob, getJobStatus, resumeStaleJobsOnce, getUserResults, getScanHistory, setTracked, recordPricePoint, getPriceHistory } from '../../../lib/arbitrage/jobRunner';
import { refreshFullEbayIndex, indexEbayCategory, getIndexStatus } from '../../../lib/arbitrage/ebayIndexer';
import { refreshFullTrendyolIndex, indexTrendyolCategory } from '../../../lib/arbitrage/trendyolIndexer';
import { matchAndCalculateCategory } from '../../../lib/arbitrage/matcher';
import type { ArbitrageResult, ArbitrageScanResponse } from '../../../lib/arbitrage/types';

export const config = { runtime: 'nodejs', maxDuration: 300 };

function getUserId(req: NextApiRequest, res: NextApiResponse): { userId: string; authenticated: boolean } {
  // Try API key first
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;
  if (envApiKey && apiKey === envApiKey) {
    return { userId: 'api-user', authenticated: true };
  }
  return { userId: '', authenticated: false };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Resume any orphaned jobs from before the last restart (idempotent, fires once per process)
  void resumeStaleJobsOnce();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  let authenticated = false;
  let userId = '';

  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;

  if (envApiKey && apiKey === envApiKey) {
    authenticated = true;
    userId = 'api-user';
  }

  if (!authenticated) {
    const authUser = await getAuthUser(req, res);
    if (authUser?.id) {
      authenticated = true;
      userId = authUser.id;
    }
  }

  if (!authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.body;

  try {
    switch (action) {
      // ================================================================
      // QUICK SCAN — synchronous, for 1-5 categories (backward compatible)
      // ================================================================
      case 'scan': {
        const startTime = Date.now();
        const {
          categories = [],
          minProfitUsd = 5,
          minRoiPercent = 20,
          shippingCostUsd = 15,
          feeOverridePercent,
          includeInternationalFee = true,
          maxTrendyolResults = 30,
          highDefectRate = false,
        } = req.body;

        if (!categories.length) {
          return res.status(400).json({ error: 'At least one category is required' });
        }

        const exchangeRate = req.body.exchangeRate || await getCachedExchangeRate();
        const { token: appToken, kind: tokenKind } = await getEbayTokenFor(userId);

        // Pre-flight quota check — estimate ~1 Browse call per product (enrichment removed).
        // Fail-open if the analytics endpoint doesn't return a usable bucket.
        const estimatedCost = categories.length * maxTrendyolResults;
        const quota = await getBrowseApiRateLimits(appToken, tokenKind);
        if (quota && quota.remaining < estimatedCost * 0.6) {
          return res.status(429).json({
            error: 'QUOTA_EXHAUSTED',
            message: `eBay daily quota too low for this scan (need ~${estimatedCost}, have ${quota.remaining}/${quota.limit}). Resets at ${quota.resetAt}.`,
            remaining: quota.remaining,
            limit: quota.limit,
            resetAt: quota.resetAt,
            tokenKind,
          });
        }

        const allResults: ArbitrageResult[] = [];
        let totalScanned = 0;
        const perCategoryLimit = Math.ceil(maxTrendyolResults / categories.length);

        for (const slug of categories) {
          try {
            const { results, productsScanned } = await scanCategory(slug, {
              shippingCostUsd,
              feeOverridePercent,
              includeInternationalFee,
              highDefectRate,
              exchangeRate,
            }, appToken);

            allResults.push(...results.slice(0, perCategoryLimit));
            totalScanned += productsScanned;
          } catch (err) {
            logger.warn(`Scan failed for "${slug}"`, { error: String(err) });
          }
        }

        const sorted = allResults.sort((a, b) => b.score - a.score).slice(0, maxTrendyolResults);
        const profitable = sorted.filter(
          r => r.financials.profitUsd >= minProfitUsd && r.financials.roiPercent >= minRoiPercent
        );

        return res.json({
          results: sorted,
          exchangeRate,
          totalScanned,
          profitable: profitable.length,
          scanDurationMs: Date.now() - startTime,
        } as ArbitrageScanResponse);
      }

      // ================================================================
      // BACKGROUND SCAN — for large category sets (5+ categories)
      // ================================================================
      case 'start_scan': {
        const { categories = [], ...scanParams } = req.body;
        if (!categories.length) {
          return res.status(400).json({ error: 'At least one category is required' });
        }

        const result = await startScanJob(userId, categories, {
          shippingCostUsd: scanParams.shippingCostUsd || 15,
          feeOverridePercent: scanParams.feeOverridePercent,
          includeInternationalFee: scanParams.includeInternationalFee ?? true,
          highDefectRate: scanParams.highDefectRate || false,
          exchangeRate: scanParams.exchangeRate,
          minProfitUsd: scanParams.minProfitUsd || 5,
          minRoiPercent: scanParams.minRoiPercent || 20,
          maxProductsPerCategory: scanParams.maxTrendyolResults
            ? Math.ceil(scanParams.maxTrendyolResults / categories.length)
            : 30,
        });

        if (!result.ok) {
          return res.status(429).json({
            error: result.errorCode,
            message: result.message,
            remaining: result.remaining,
            limit: result.limit,
            resetAt: result.resetAt,
            tokenKind: result.tokenKind,
          });
        }

        return res.json({ jobId: result.jobId, status: 'pending' });
      }

      case 'job_status': {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ error: 'jobId is required' });

        // Pure read — background runner does the work separately
        const status = await getJobStatus(jobId);
        return res.json(status);
      }

      // ================================================================
      // CATEGORIES
      // ================================================================
      case 'categories': {
        return res.json({ categories: TRENDYOL_CATEGORIES });
      }

      case 'discover_categories': {
        const categories = await discoverTrendyolCategories();
        return res.json({ categories, total: categories.length });
      }

      case 'category_mappings': {
        const mappings = await getCategoryMappings({
          isActive: true,
          isMapped: req.body.mappedOnly || false,
        });
        return res.json({ mappings });
      }

      case 'map_category': {
        const { trendyolCategoryName, sampleTitle } = req.body;
        if (!trendyolCategoryName) {
          return res.status(400).json({ error: 'trendyolCategoryName is required' });
        }
        const { token: appToken } = await getEbayTokenFor(userId);
        const mapping = await mapToEbayCategory(
          sampleTitle || trendyolCategoryName,
          appToken
        );
        return res.json({ mapping });
      }

      // ================================================================
      // RESULTS & TRACKING
      // ================================================================
      case 'results': {
        const { verdict, isTracked, minScore, page = 1, perPage = 50 } = req.body;
        const data = await getUserResults(userId, { verdict, isTracked, minScore }, { page, perPage });
        return res.json(data);
      }

      case 'track_result': {
        const { trendyolProductId, tracked = true } = req.body;
        if (!trendyolProductId) return res.status(400).json({ error: 'trendyolProductId required' });
        await setTracked(userId, trendyolProductId, tracked);
        return res.json({ success: true });
      }

      case 'price_history': {
        const { resultId, limit = 30 } = req.body;
        if (!resultId) return res.status(400).json({ error: 'resultId required' });
        const history = await getPriceHistory(resultId, limit);
        return res.json({ history });
      }

      case 'scan_history': {
        const history = await getScanHistory(userId, req.body.limit || 20);
        return res.json({ history });
      }

      // ================================================================
      // UTILITIES
      // ================================================================
      case 'exchange_rate': {
        const rate = await getCachedExchangeRate();
        return res.json({ rate, source: 'open.er-api.com' });
      }

      // ================================================================
      // INDEX MANAGEMENT (v2 — shared product indexes)
      // ================================================================
      case 'refresh_index': {
        const { token: appToken } = await getEbayTokenFor(userId);
        const target = req.body.target || 'all'; // 'all' | 'ebay' | 'trendyol' | specific slug

        if (target === 'trendyol') {
          const trendyolResult = await refreshFullTrendyolIndex();
          return res.json({ trendyol: trendyolResult });
        }

        if (target === 'ebay') {
          const ebayResult = await refreshFullEbayIndex(appToken);
          return res.json({ ebay: ebayResult });
        }

        if (target !== 'all') {
          // Specific category slug
          const [tResult, eResult] = await Promise.all([
            indexTrendyolCategory(target),
            indexEbayCategory(target, appToken),
          ]);
          return res.json({ trendyol: tResult, ebay: eResult });
        }

        // target === 'all': full refresh both
        const [trendyolResult, ebayResult] = await Promise.all([
          refreshFullTrendyolIndex(),
          refreshFullEbayIndex(appToken),
        ]);

        return res.json({
          trendyol: trendyolResult,
          ebay: ebayResult,
        });
      }

      case 'index_status': {
        const status = await getIndexStatus();
        const totalProducts = status.reduce((sum, s) => sum + s.productCount, 0);
        const staleCategories = status.filter(s => s.isStale).length;
        return res.json({
          categories: status,
          summary: {
            totalCategories: status.length,
            totalProducts,
            staleCategories,
            freshCategories: status.length - staleCategories,
          },
        });
      }

      case 'match_category': {
        const { slug: matchSlug, ...matchParams } = req.body;
        if (!matchSlug) return res.status(400).json({ error: 'slug is required' });

        const { results, productsScanned, matchStats } = await matchAndCalculateCategory(
          matchSlug,
          {
            shippingCostUsd: matchParams.shippingCostUsd || 15,
            includeInternationalFee: matchParams.includeInternationalFee ?? true,
            feeOverridePercent: matchParams.feeOverridePercent,
            highDefectRate: matchParams.highDefectRate || false,
            exchangeRate: matchParams.exchangeRate,
          },
        );

        return res.json({
          results: results.sort((a, b) => b.score - a.score),
          productsScanned,
          matchStats,
          profitable: results.filter(r => r.financials.profitUsd > 0).length,
        });
      }

      case 'test_trendyol': {
        const slug = req.body.slug || 'havlu-x-c104073';
        try {
          const result = await fetchTrendyolCategoryProducts(slug);
          const translations = await batchTranslateTitles(result.products.slice(0, 3));
          return res.json({
            success: true,
            parsedCount: result.products.length,
            products: result.products.slice(0, 5).map(p => ({
              id: p.id, name: p.name, brand: p.brand,
              priceTry: p.priceTry, imageUrl: p.imageUrl,
              ebayQuery: translations.get(p.id) || extractEnglishQuery(p),
            })),
          });
        } catch (err: any) {
          return res.json({ success: false, error: err.message });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    logger.error('Arbitrage API error', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
