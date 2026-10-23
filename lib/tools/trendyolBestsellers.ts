// lib/tools/trendyolBestsellers.ts — the public teaser under the Trendyol profit calculator (orchestrator decision
// 2026-10-23: teaser, not republishing). Per category: the top 3 products by estimated daily sales from our crowd
// readings (lib/market/sales: rating growth × calibration), title shortened, no store name, no image, no URL,
// plus how many more there are. The rest stays behind a free signup and is never sent to the browser.
import prisma from '@/lib/prisma';
import { readCards } from '@/lib/market/read';
import { readCalibration } from '@/lib/market/calibration';

const DAY = 86_400_000;
const TTL = 6 * 3600_000;
export const TEASER_COUNT = 3;
const MIN_PRODUCTS = 15;

export interface TeaserItem { title: string; price: number | null; salesPerDay: number }
export interface Teaser { categoryName: string; top: TeaserItem[]; more: number }

/** Pure: shorten a product title to whole words (no brand-level detail needed for the teaser). */
export function shortTitle(t: string, max = 42): string {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).trim()}…`;
}

let catCache: { at: number; list: Array<{ id: string; name: string; count: number }> } | null = null;
const teaserCache = new Map<string, { at: number; v: Teaser | null }>();

export async function teaserCategories() {
  if (catCache && Date.now() - catCache.at < TTL) return catCache.list;
  const rows = await prisma.marketProduct.groupBy({
    by: ['categoryId', 'categoryName'],
    where: { mkt: 'trendyol', categoryId: { not: null }, categoryName: { not: null }, lastSeenAt: { gte: new Date(Date.now() - 30 * DAY) } },
    _count: { _all: true },
  });
  const list = rows
    .filter((r) => r._count._all >= MIN_PRODUCTS)
    .map((r) => ({ id: r.categoryId!, name: r.categoryName!, count: r._count._all }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  catCache = { at: Date.now(), list };
  return list;
}

export async function categoryTeaser(categoryId: string): Promise<Teaser | null> {
  const hit = teaserCache.get(categoryId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const products = await prisma.marketProduct.findMany({
    where: { mkt: 'trendyol', categoryId, lastSeenAt: { gte: new Date(Date.now() - 30 * DAY) } },
    select: { productId: true, title: true, price: true, categoryName: true },
    orderBy: { ratingCount: 'desc' },
    take: 120,
  });
  if (products.length < MIN_PRODUCTS) { teaserCache.set(categoryId, { at: Date.now(), v: null }); return null; }
  const cards = await readCards('trendyol', products.map((p) => p.productId), await readCalibration());
  const byId = new Map(products.map((p) => [p.productId, p]));
  const ranked = cards
    .filter((c) => (c.sales.salesPerDay ?? 0) > 0)
    .sort((a, b) => (b.sales.salesPerDay ?? 0) - (a.sales.salesPerDay ?? 0));
  const v: Teaser | null = ranked.length
    ? {
        categoryName: products[0].categoryName ?? '',
        top: ranked.slice(0, TEASER_COUNT).map((c) => ({ title: shortTitle(byId.get(c.id)?.title ?? ''), price: byId.get(c.id)?.price ?? null, salesPerDay: c.sales.salesPerDay as number })),
        more: Math.max(0, ranked.length - TEASER_COUNT),
      }
    : null;
  teaserCache.set(categoryId, { at: Date.now(), v });
  return v;
}
