import prisma from '../prisma';
import { TRENDYOL_CATEGORIES } from '../integrations/trendyolSearch';
import { getCached, setCache, cacheKey, TTL } from './cache';
import { logger } from '../logger';
import type { TrendyolCategoryNode } from './types';

/**
 * Discover Trendyol categories.
 * Strategy 1: Use Trendyol public API (no auth needed)
 * Strategy 2: Fall back to expanded hardcoded list
 */
export async function discoverTrendyolCategories(): Promise<TrendyolCategoryNode[]> {
  // Check cache first
  const cached = await getCached<TrendyolCategoryNode[]>(cacheKey.categoryTree());
  if (cached) return cached;

  let categories: TrendyolCategoryNode[] = [];

  // Public API - no auth needed
  try {
    const res = await fetch('https://apigw.trendyol.com/integration/product/product-categories', {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data: any = await res.json();
      const catArray = data?.categories;
      if (Array.isArray(catArray) && catArray.length > 0) {
        categories = flattenCategoryTree(catArray);
      }
    }
  } catch (err) {
    logger.warn('Trendyol categories API failed, using hardcoded list', { error: String(err) });
  }

  // Fallback to hardcoded categories
  if (categories.length === 0) {
    categories = TRENDYOL_CATEGORIES.map(cat => ({
      id: parseInt(cat.slug.split('-x-c')[1] || '0'),
      name: cat.label,
      slug: cat.slug,
      parentPath: getCategoryGroup(cat.slug),
      isMapped: false,
    }));
  }

  await setCache(cacheKey.categoryTree(), categories, TTL.CATEGORY_TREE);
  return categories;
}

function flattenCategoryTree(nodes: any[], parentPath = ''): TrendyolCategoryNode[] {
  const result: TrendyolCategoryNode[] = [];

  for (const node of nodes) {
    const path = parentPath ? `${parentPath} > ${node.name}` : node.name;
    const slug = buildSlug(node.name, node.id);

    // Only add leaf categories (no subcategories) or categories with products
    const hasChildren = node.subCategories?.length > 0;

    if (!hasChildren) {
      result.push({
        id: node.id,
        name: node.name,
        slug,
        parentId: node.parentId,
        parentPath: path,
        isMapped: false,
      });
    }

    if (hasChildren) {
      result.push(...flattenCategoryTree(node.subCategories, path));
    }
  }

  return result;
}

function buildSlug(name: string, id: number): string {
  const slugified = name
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slugified}-x-c${id}`;
}

function getCategoryGroup(slug: string): string {
  const groups: Record<string, string[]> = {
    'Ev & Dekor': ['havlu', 'pestemal', 'yastik', 'bornoz', 'kilim', 'lamba', 'mum', 'perde', 'hali', 'nevresim', 'yatak', 'masa-ortusu'],
    'Mutfak': ['seramik-tabak', 'seramik-kase', 'cam-bardak', 'cay-bardagi', 'bakir-cezve', 'turk-kahvesi', 'fincan', 'sahan', 'tencere', 'tepsi'],
    'Takı & Aksesuar': ['nazar-boncugu', 'taki-seti', 'halhal', 'kolye', 'bileklik', 'yuzuk', 'kupe', 'bros'],
    'Tekstil': ['deri-canta', 'el-yapimi', 'ipek', 'pamuk', 'atkı', 'sal', 'fular'],
    'Yiyecek': ['lokum', 'baharat', 'zeytinyagi', 'kuru-meyve', 'baklava', 'helva', 'pestil', 'cay', 'kahve'],
    'Kozmetik & Bakım': ['sabun', 'argan', 'gul-suyu', 'kese', 'hamam', 'dogal-bakim'],
    'Hediyelik': ['magnet', 'anahtar-ligi', 'hatira', 'ottoman', 'osmanlı'],
  };

  for (const [group, keywords] of Object.entries(groups)) {
    if (keywords.some(kw => slug.includes(kw))) return group;
  }
  return 'Diğer';
}

/**
 * Map a Trendyol category to an eBay category using the eBay category_suggestions API.
 */
export async function mapToEbayCategory(
  query: string,
  appToken: string
): Promise<{ categoryId: string; categoryName: string; feeRate?: number } | null> {
  const cached = await getCached<any>(cacheKey.categorySuggestions(query));
  if (cached) return cached;

  try {
    const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return null;

    const data: any = await res.json();
    const suggestion = data?.categorySuggestions?.[0];
    if (!suggestion) return null;

    const result = {
      categoryId: suggestion.category?.categoryId || '',
      categoryName: suggestion.category?.categoryName || '',
    };

    await setCache(cacheKey.categorySuggestions(query), result, TTL.CATEGORY_SUGGESTIONS);
    return result;
  } catch {
    return null;
  }
}

/**
 * Sync all category mappings to the database.
 * Persists Trendyol → eBay mappings in TrendyolCategoryMap table.
 */
export async function syncCategoryMappings(categories: TrendyolCategoryNode[]): Promise<number> {
  let synced = 0;

  for (const cat of categories) {
    try {
      await prisma.trendyolCategoryMap.upsert({
        where: { trendyolCategoryId: String(cat.id) },
        create: {
          trendyolCategoryId: String(cat.id),
          trendyolSlug: cat.slug,
          trendyolLabel: cat.name,
          trendyolParentPath: cat.parentPath,
          ebayCategoryId: cat.ebayCategoryId,
          ebayCategoryName: cat.ebayCategoryName,
          ebayFeeRate: cat.ebayFeeRate,
          productCount: cat.productCount || 0,
          isActive: true,
        },
        update: {
          trendyolLabel: cat.name,
          trendyolParentPath: cat.parentPath,
          ebayCategoryId: cat.ebayCategoryId,
          ebayCategoryName: cat.ebayCategoryName,
          ebayFeeRate: cat.ebayFeeRate,
          productCount: cat.productCount || 0,
          updatedAt: new Date(),
        },
      });
      synced++;
    } catch (err) {
      logger.warn(`Failed to sync category ${cat.id}`, { error: String(err) });
    }
  }

  return synced;
}

/**
 * Get stored category mappings from database.
 */
export async function getCategoryMappings(filters?: {
  isActive?: boolean;
  isMapped?: boolean;
}): Promise<any[]> {
  const where: any = {};
  if (filters?.isActive !== undefined) where.isActive = filters.isActive;
  if (filters?.isMapped) where.ebayCategoryId = { not: null };

  return prisma.trendyolCategoryMap.findMany({
    where,
    orderBy: { trendyolLabel: 'asc' },
  });
}
