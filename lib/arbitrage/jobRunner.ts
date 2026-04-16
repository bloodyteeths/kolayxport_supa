import prisma from '../prisma';
import { logger } from '../logger';
import { getApplicationToken } from '../integrations/ebayClient';
import { scanCategory, getCachedExchangeRate } from './scanner';
import type { ArbitrageResult, ArbitrageScanJobStatus } from './types';

interface JobParams {
  shippingCostUsd: number;
  feeOverridePercent?: number;
  includeInternationalFee: boolean;
  highDefectRate?: boolean;
  exchangeRate?: number;
  minProfitUsd?: number;
  minRoiPercent?: number;
  maxProductsPerCategory?: number;
}

/**
 * Create a new background scan job and kick off background processing.
 * Returns immediately with the job ID — actual work runs detached.
 */
export async function startScanJob(
  userId: string,
  categorySlugs: string[],
  params: JobParams
): Promise<string> {
  const job = await prisma.arbitrageScanJob.create({
    data: {
      userId,
      status: 'pending',
      categorySlugs,
      params: params as any,
      processedSlugs: [],
      progress: 0,
      totalProducts: 0,
      resultsCount: 0,
    },
  });

  // Fire-and-forget: run in background, don't block the HTTP response
  void runJobInBackground(job.id);

  return job.id;
}

// In-memory guard to prevent duplicate background runners for same job
const runningJobs = new Set<string>();

/**
 * Run a scan job to completion in the background.
 * Processes chunks sequentially until all categories are done.
 * Designed for fire-and-forget invocation.
 */
export async function runJobInBackground(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) {
    logger.info(`[arbitrage] Job ${jobId} already running, skipping duplicate start`);
    return;
  }
  runningJobs.add(jobId);

  try {
    // Loop until job reaches a terminal state
    while (true) {
      const status = await processNextChunk(jobId);
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        logger.info(`[arbitrage] Job ${jobId} finished with status=${status.status}`);
        break;
      }
      // Small breath between chunks to avoid hammering downstreams
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    logger.error(`[arbitrage] Background runner crashed for job ${jobId}: ${String(err)}`);
    try {
      await prisma.arbitrageScanJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: String(err) },
      });
    } catch { /* swallow */ }
  } finally {
    runningJobs.delete(jobId);
  }
}

/**
 * Resume any jobs left in 'pending' or 'processing' state.
 * Called lazily once per process after a restart, so orphaned runners don't leave jobs hanging.
 */
let staleJobsResumed = false;
export async function resumeStaleJobsOnce(): Promise<void> {
  if (staleJobsResumed) return;
  staleJobsResumed = true;
  try {
    const stale = await prisma.arbitrageScanJob.findMany({
      where: { status: { in: ['pending', 'processing'] } },
      select: { id: true },
      take: 20,
    });
    for (const { id } of stale) {
      logger.info(`[arbitrage] Resuming stale job ${id} after restart`);
      void runJobInBackground(id);
    }
  } catch (err) {
    logger.warn('[arbitrage] Failed to resume stale jobs', { error: String(err) });
  }
}

/**
 * Read the current status of a scan job without doing any work.
 * Safe to call frequently for UI polling.
 */
export async function getJobStatus(jobId: string): Promise<ArbitrageScanJobStatus> {
  const job = await prisma.arbitrageScanJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return { jobId, status: 'failed', progress: 0, totalProducts: 0, resultsCount: 0, error: 'Job not found' };
  }

  // Only load full result set when job is terminal or has results to show
  const includeResults = job.status === 'completed' || job.resultsCount > 0;
  const results = includeResults ? await getJobResults(jobId) : undefined;

  return {
    jobId,
    status: job.status as any,
    progress: job.processedSlugs?.length || 0,
    totalProducts: job.categorySlugs.length,
    resultsCount: job.resultsCount,
    results,
    exchangeRate: job.exchangeRate || undefined,
    error: job.error || undefined,
    scanDurationMs: job.completedAt && job.startedAt
      ? job.completedAt.getTime() - job.startedAt.getTime()
      : job.startedAt
        ? Date.now() - job.startedAt.getTime()
        : undefined,
  };
}

/**
 * Process the next chunk of work for a scan job.
 * Called on each poll — does ~15-25s of work per call.
 * Returns current status including partial results.
 */
export async function processNextChunk(jobId: string): Promise<ArbitrageScanJobStatus> {
  const job = await prisma.arbitrageScanJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return { jobId, status: 'failed', progress: 0, totalProducts: 0, resultsCount: 0, error: 'Job not found' };
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    // Job is done — return results
    const results = await getJobResults(jobId);
    return {
      jobId,
      status: job.status as any,
      progress: job.progress,
      totalProducts: job.totalProducts,
      resultsCount: job.resultsCount,
      results,
      exchangeRate: job.exchangeRate || undefined,
      scanDurationMs: job.completedAt && job.startedAt
        ? job.completedAt.getTime() - job.startedAt.getTime()
        : undefined,
    };
  }

  // Mark as processing if pending
  if (job.status === 'pending') {
    await prisma.arbitrageScanJob.update({
      where: { id: jobId },
      data: { status: 'processing', startedAt: new Date() },
    });
  }

  const params = job.params as unknown as JobParams;
  const processedSlugs = job.processedSlugs || [];
  const remainingSlugs = job.categorySlugs.filter(s => !processedSlugs.includes(s));

  if (remainingSlugs.length === 0) {
    // All done
    const results = await getJobResults(jobId);
    await prisma.arbitrageScanJob.update({
      where: { id: jobId },
      data: { status: 'completed', completedAt: new Date() },
    });
    return {
      jobId,
      status: 'completed',
      progress: job.totalProducts,
      totalProducts: job.totalProducts,
      resultsCount: job.resultsCount,
      results,
      exchangeRate: job.exchangeRate || undefined,
      scanDurationMs: job.startedAt
        ? Date.now() - job.startedAt.getTime()
        : undefined,
    };
  }

  // Process next chunk — 4 categories in parallel. Trendyol fetch + Gemini translate
  // run concurrently; eBay API calls are globally serialised by the rate limiter.
  // Each category commits its own results + append to processedSlugs atomically via
  // Postgres array_append so the progress bar moves per-category, not per-chunk.
  const chunkSize = Math.min(4, remainingSlugs.length);
  const chunk = remainingSlugs.slice(0, chunkSize);

  try {
    const appToken = await getApplicationToken();
    const exchangeRate = params.exchangeRate || await getCachedExchangeRate();

    const processOne = async (slug: string): Promise<{ productsScanned: number; resultsCount: number }> => {
      try {
        const { results, productsScanned } = await scanCategory(slug, { ...params, exchangeRate }, appToken);
        let resultsCount = 0;

        for (const r of results) {
          try {
            await prisma.arbitrageResultRecord.upsert({
              where: {
                userId_trendyolProductId: {
                  userId: job.userId,
                  trendyolProductId: r.trendyol.id,
                },
              },
              create: {
                scanJobId: jobId,
                userId: job.userId,
                trendyolProductId: r.trendyol.id,
                trendyolName: r.trendyol.name,
                trendyolBrand: r.trendyol.brand,
                trendyolPriceTry: r.trendyol.priceTry,
                trendyolImageUrl: r.trendyol.imageUrl,
                trendyolUrl: r.trendyol.url,
                trendyolCategory: r.trendyol.categoryName,
                ebayMedianPrice: r.ebay.medianPrice,
                ebayAvgPrice: r.ebay.avgPrice,
                ebayListingCount: r.ebay.totalListings,
                ebayAvgSold: r.ebay.avgSold,
                ebayCategoryId: r.ebay.categoryId,
                ebayCategoryName: r.ebay.categoryName,
                ebayTopItems: r.ebay.topItems as any,
                translatedQuery: r.translatedQuery,
                matchTier: r.matchTier,
                profitUsd: r.financials.profitUsd,
                roiPercent: r.financials.roiPercent,
                marginPercent: r.financials.marginPercent,
                totalCostUsd: r.financials.totalCostUsd,
                score: r.score,
                verdict: r.verdict,
                financials: r.financials as any,
                exchangeRate,
              },
              update: {
                scanJobId: jobId,
                trendyolPriceTry: r.trendyol.priceTry,
                ebayMedianPrice: r.ebay.medianPrice,
                ebayAvgPrice: r.ebay.avgPrice,
                ebayListingCount: r.ebay.totalListings,
                ebayAvgSold: r.ebay.avgSold,
                ebayCategoryId: r.ebay.categoryId,
                ebayCategoryName: r.ebay.categoryName,
                ebayTopItems: r.ebay.topItems as any,
                translatedQuery: r.translatedQuery,
                matchTier: r.matchTier,
                profitUsd: r.financials.profitUsd,
                roiPercent: r.financials.roiPercent,
                marginPercent: r.financials.marginPercent,
                totalCostUsd: r.financials.totalCostUsd,
                score: r.score,
                verdict: r.verdict,
                financials: r.financials as any,
                exchangeRate,
                updatedAt: new Date(),
              },
            });
            resultsCount++;
          } catch (err) {
            logger.warn(`Failed to persist result for product ${r.trendyol.id} (category ${slug})`, { error: String(err) });
          }
        }

        // Atomically append this slug to processedSlugs and bump counters so the
        // UI progress bar moves for every finished category (not just every chunk).
        await prisma.$executeRaw`
          UPDATE "ArbitrageScanJob"
          SET "processedSlugs" = "processedSlugs" || ${slug}::text,
              "progress" = "progress" + ${productsScanned}::int,
              "totalProducts" = "totalProducts" + ${productsScanned}::int,
              "resultsCount" = "resultsCount" + ${resultsCount}::int,
              "exchangeRate" = ${exchangeRate}::double precision,
              "updatedAt" = NOW()
          WHERE id = ${jobId}
        `;

        return { productsScanned, resultsCount };
      } catch (err) {
        logger.warn(`[arbitrage] scanCategory failed for ${slug}: ${String(err)}`);
        // Still mark as processed so we don't re-scan a broken category forever
        await prisma.$executeRaw`
          UPDATE "ArbitrageScanJob"
          SET "processedSlugs" = "processedSlugs" || ${slug}::text,
              "updatedAt" = NOW()
          WHERE id = ${jobId}
        `;
        return { productsScanned: 0, resultsCount: 0 };
      }
    };

    await Promise.all(chunk.map(processOne));

    // Re-read job to check completion against the freshly-appended processedSlugs
    const refreshed = await prisma.arbitrageScanJob.findUnique({ where: { id: jobId } });
    const newProcessedCount = refreshed?.processedSlugs?.length || 0;
    const isComplete = newProcessedCount >= job.categorySlugs.length;

    if (isComplete) {
      await prisma.arbitrageScanJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date() },
      });
    }

    const allResults = await getJobResults(jobId);

    return {
      jobId,
      status: isComplete ? 'completed' : 'processing',
      progress: newProcessedCount,
      totalProducts: job.categorySlugs.length,
      resultsCount: allResults.length,
      results: allResults,
      exchangeRate,
      scanDurationMs: job.startedAt ? Date.now() - job.startedAt.getTime() : undefined,
    };
  } catch (err: any) {
    await prisma.arbitrageScanJob.update({
      where: { id: jobId },
      data: { status: 'failed', error: err.message },
    });

    return {
      jobId,
      status: 'failed',
      progress: processedSlugs.length,
      totalProducts: job.categorySlugs.length,
      resultsCount: job.resultsCount,
      error: err.message,
    };
  }
}

/**
 * Get all results for a scan job, reconstructed as ArbitrageResult objects.
 */
async function getJobResults(jobId: string): Promise<ArbitrageResult[]> {
  const records = await prisma.arbitrageResultRecord.findMany({
    where: { scanJobId: jobId },
    orderBy: { score: 'desc' },
  });

  return records.map(recordToResult);
}

/**
 * Get all results for a user, optionally filtered.
 */
export async function getUserResults(
  userId: string,
  filters?: { verdict?: string; isTracked?: boolean; minScore?: number },
  pagination?: { page: number; perPage: number }
): Promise<{ results: ArbitrageResult[]; total: number }> {
  const where: any = { userId };
  if (filters?.verdict) where.verdict = filters.verdict;
  if (filters?.isTracked !== undefined) where.isTracked = filters.isTracked;
  if (filters?.minScore) where.score = { gte: filters.minScore };

  const total = await prisma.arbitrageResultRecord.count({ where });

  const records = await prisma.arbitrageResultRecord.findMany({
    where,
    orderBy: { score: 'desc' },
    skip: pagination ? (pagination.page - 1) * pagination.perPage : 0,
    take: pagination?.perPage || 100,
  });

  return { results: records.map(recordToResult), total };
}

/**
 * Get scan job history for a user.
 */
export async function getScanHistory(userId: string, limit = 20) {
  return prisma.arbitrageScanJob.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      categorySlugs: true,
      progress: true,
      totalProducts: true,
      resultsCount: true,
      exchangeRate: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Track/untrack an arbitrage result.
 */
export async function setTracked(userId: string, trendyolProductId: number, tracked: boolean) {
  return prisma.arbitrageResultRecord.update({
    where: {
      userId_trendyolProductId: { userId, trendyolProductId },
    },
    data: { isTracked: tracked },
  });
}

/**
 * Record a price point for a tracked result.
 */
export async function recordPricePoint(resultId: string, data: {
  trendyolPriceTry: number;
  ebayMedianPrice: number;
  exchangeRate: number;
  profitUsd: number;
  roiPercent: number;
  score: number;
}) {
  return prisma.arbitragePricePoint.create({
    data: { arbitrageResultId: resultId, ...data },
  });
}

/**
 * Get price history for a tracked result.
 */
export async function getPriceHistory(resultId: string, limit = 30) {
  return prisma.arbitragePricePoint.findMany({
    where: { arbitrageResultId: resultId },
    orderBy: { checkedAt: 'desc' },
    take: limit,
  });
}

// Convert DB record back to ArbitrageResult
function recordToResult(r: any): ArbitrageResult {
  return {
    trendyol: {
      id: r.trendyolProductId,
      name: r.trendyolName,
      brand: r.trendyolBrand,
      priceTry: r.trendyolPriceTry,
      originalPriceTry: r.trendyolPriceTry,
      imageUrl: r.trendyolImageUrl || '',
      url: r.trendyolUrl || '',
      categoryName: r.trendyolCategory || '',
      ratingScore: 0,
      ratingCount: 0,
      merchantName: '',
      freeShipping: false,
    },
    ebay: {
      avgPrice: r.ebayAvgPrice,
      medianPrice: r.ebayMedianPrice,
      minPrice: 0,
      maxPrice: 0,
      totalListings: r.ebayListingCount,
      avgSold: r.ebayAvgSold,
      topItems: r.ebayTopItems || [],
      categoryId: r.ebayCategoryId || '',
      categoryName: r.ebayCategoryName || '',
    },
    financials: r.financials || {
      costTry: r.trendyolPriceTry,
      costUsd: 0,
      shippingUsd: 0,
      suggestedPriceUsd: r.ebayMedianPrice,
      ebayFeePercent: 13.25,
      ebayFeeName: '',
      ebayFeeUsd: 0,
      paymentFeeUsd: 0,
      internationalFeeUsd: 0,
      totalCostUsd: r.totalCostUsd,
      profitUsd: r.profitUsd,
      roiPercent: r.roiPercent,
      marginPercent: r.marginPercent,
    },
    exchangeRate: r.exchangeRate,
    score: r.score,
    verdict: r.verdict,
    matchTier: r.matchTier,
    translatedQuery: r.translatedQuery,
  };
}
