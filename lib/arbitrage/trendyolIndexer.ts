/**
 * Trendyol Product Indexer — scrapes Trendyol categories and stores in shared TrendyolProductIndex.
 *
 * Free — uses HTML scraping (no API key needed, no rate limits).
 * Products are refreshed every 6 hours.
 */
import prisma from '../prisma';
import { logger } from '../logger';
import { fetchTrendyolCategoryProducts, TRENDYOL_CATEGORIES } from '../integrations/trendyolSearch';
import type { TrendyolProduct } from './types';

const INDEX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Index a single Trendyol category (pages 1-2 = ~48 products).
 */
export async function indexTrendyolCategory(slug: string): Promise<{ slug: string; indexed: number; error?: string }> {
  try {
    const products: TrendyolProduct[] = [];

    for (const page of [1, 2]) {
      try {
        const result = await fetchTrendyolCategoryProducts(slug, page);
        products.push(...result.products);
      } catch (err) {
        if (page === 1) throw err; // If page 1 fails, the category is broken
        // Page 2 failure is OK — just means fewer products
      }
      // Small delay between pages to be polite
      if (page === 1) await new Promise(r => setTimeout(r, 500));
    }

    if (products.length === 0) {
      return { slug, indexed: 0, error: 'No products found' };
    }

    const stored = await storeTrendyolProducts(products, slug);
    return { slug, indexed: stored };
  } catch (err) {
    return { slug, indexed: 0, error: String(err) };
  }
}

/**
 * Full index refresh — sweep all categories.
 */
export async function refreshFullTrendyolIndex(): Promise<{
  categories: number;
  totalIndexed: number;
  errors: string[];
  durationMs: number;
}> {
  const start = Date.now();
  let totalIndexed = 0;
  const errors: string[] = [];

  // Clean expired entries first
  await cleanExpiredEntries();

  for (const cat of TRENDYOL_CATEGORIES) {
    const r = await indexTrendyolCategory(cat.slug);
    totalIndexed += r.indexed;
    if (r.error) errors.push(`${cat.slug}: ${r.error}`);
    // Delay between categories to avoid Cloudflare blocking
    await new Promise(r => setTimeout(r, 1000));
  }

  return {
    categories: TRENDYOL_CATEGORIES.length,
    totalIndexed,
    errors,
    durationMs: Date.now() - start,
  };
}

/**
 * Get indexed Trendyol products for a category (used by matcher).
 */
export async function getTrendyolIndexForCategory(slug: string): Promise<Array<{
  productId: number;
  name: string;
  brand: string;
  priceTry: number;
  originalPriceTry: number;
  imageUrl: string | null;
  url: string | null;
  categorySlug: string;
  categoryName: string | null;
  ratingScore: number;
  ratingCount: number;
  merchantName: string | null;
  barcode: string | null;
  favoriteCount: string | null;
  orderCount: string | null;
}>> {
  return prisma.trendyolProductIndex.findMany({
    where: {
      categorySlug: slug,
      expiresAt: { gt: new Date() },
    },
    select: {
      productId: true,
      name: true,
      brand: true,
      priceTry: true,
      originalPriceTry: true,
      imageUrl: true,
      url: true,
      categorySlug: true,
      categoryName: true,
      ratingScore: true,
      ratingCount: true,
      merchantName: true,
      barcode: true,
      favoriteCount: true,
      orderCount: true,
    },
    orderBy: { priceTry: 'asc' },
  });
}

/**
 * Check if a category's index is fresh.
 */
export async function isCategoryFresh(slug: string): Promise<boolean> {
  const count = await prisma.trendyolProductIndex.count({
    where: {
      categorySlug: slug,
      expiresAt: { gt: new Date() },
    },
  });
  return count > 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function storeTrendyolProducts(products: TrendyolProduct[], slug: string): Promise<number> {
  const expiresAt = new Date(Date.now() + INDEX_TTL_MS);
  const categoryLabel = TRENDYOL_CATEGORIES.find(c => c.slug === slug)?.label || null;
  let stored = 0;

  for (const p of products) {
    try {
      await prisma.trendyolProductIndex.upsert({
        where: { productId: p.id },
        create: {
          productId: p.id,
          name: p.name,
          brand: p.brand,
          priceTry: p.priceTry,
          originalPriceTry: p.originalPriceTry,
          imageUrl: p.imageUrl || null,
          url: p.url || null,
          categorySlug: slug,
          categoryName: categoryLabel,
          ratingScore: p.ratingScore || 0,
          ratingCount: p.ratingCount || 0,
          merchantName: p.merchantName || null,
          barcode: p.barcode || null,
          favoriteCount: p.favoriteCount || null,
          orderCount: p.orderCount || null,
          expiresAt,
        },
        update: {
          name: p.name,
          brand: p.brand,
          priceTry: p.priceTry,
          originalPriceTry: p.originalPriceTry,
          imageUrl: p.imageUrl || null,
          url: p.url || null,
          ratingScore: p.ratingScore || 0,
          ratingCount: p.ratingCount || 0,
          merchantName: p.merchantName || null,
          barcode: p.barcode || null,
          favoriteCount: p.favoriteCount || null,
          orderCount: p.orderCount || null,
          expiresAt,
        },
      });
      stored++;
    } catch {
      // Upsert race — non-fatal
    }
  }

  return stored;
}

async function cleanExpiredEntries(): Promise<number> {
  try {
    const result = await prisma.trendyolProductIndex.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  } catch {
    return 0;
  }
}
