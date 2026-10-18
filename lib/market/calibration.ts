/**
 * Orders-per-rating calibration (Trendyol) from connected KolayXport stores — the honest bridge from a public
 * rating count to a sales estimate (lib/market/sales).
 *
 * For each connected store, products are linked by Trendyol's public id (TrendyolProduct.productContentId, filled by
 * the product sync) to the crowd readings (MarketProductObservation). Over the same window we take the store's real
 * orders of those products (OrderItem quantity, Order.uiOrderDate) and the growth of their public rating counts.
 * ratio = Σ orders / Σ new ratings, pooled over all stores. Only aggregates leave this module: no store, order or
 * buyer detail is stored, only { ordersPerRating, n (new ratings counted), stores }.
 *
 * Needs ≥ MIN_RATINGS new ratings in the pool; otherwise there is no calibration and Trendyol shows rating growth
 * (measured) without a sales number. Daily job 'market-calibration'; stored in the shared research cache.
 */
import prisma from '@/lib/prisma';
import { readShared, writeShared } from '@/lib/research/etsySearch';
import type { Calibration } from './sales';

export const CALIBRATION_KEY = 'public:market:calibration:trendyol';
export const MIN_RATINGS = 30;
const WINDOW_DAYS = 60;
const DAY = 86_400_000;
/** Plausible range: below 2 or above 400 orders per rating means a linking or data problem, not a market fact. */
const MIN_RATIO = 2;
const MAX_RATIO = 400;

export interface StorePool { orders: number; newRatings: number }

/** Pure: pooled ratio, or null when the pool is too small or implausible. */
export function poolRatio(pools: StorePool[]): { ordersPerRating: number; n: number; stores: number } | null {
  const used = pools.filter((p) => p.newRatings > 0 && p.orders > 0);
  const orders = used.reduce((s, p) => s + p.orders, 0);
  const ratings = used.reduce((s, p) => s + p.newRatings, 0);
  if (ratings < MIN_RATINGS) return null;
  const ratio = orders / ratings;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return null;
  return { ordersPerRating: Math.round(ratio * 10) / 10, n: ratings, stores: used.length };
}

/** One store: rating growth of its products in the crowd readings vs its real orders in the same span. */
async function storePool(userId: string, since: Date): Promise<StorePool> {
  const products = await prisma.trendyolProduct.findMany({
    where: { userId, productContentId: { not: null } },
    select: { barcode: true, productContentId: true },
  });
  if (products.length === 0) return { orders: 0, newRatings: 0 };
  const byContent = new Map<string, string[]>();
  for (const p of products) {
    const list = byContent.get(p.productContentId as string) ?? [];
    list.push(p.barcode);
    byContent.set(p.productContentId as string, list);
  }
  const obs = await prisma.marketProductObservation.findMany({
    where: { mkt: 'trendyol', productId: { in: [...byContent.keys()] }, observedAt: { gte: since }, ratingCount: { not: null } },
    select: { productId: true, observedAt: true, ratingCount: true },
    orderBy: { observedAt: 'asc' },
  });
  // Per product: first and last reading in the window; the span's orders are counted between those two moments.
  const span = new Map<string, { from: Date; to: Date; first: number; last: number }>();
  for (const o of obs) {
    const s = span.get(o.productId);
    if (!s) span.set(o.productId, { from: o.observedAt, to: o.observedAt, first: o.ratingCount as number, last: o.ratingCount as number });
    else { s.to = o.observedAt; s.last = o.ratingCount as number; }
  }
  let orders = 0;
  let newRatings = 0;
  for (const [contentId, s] of span) {
    if (s.to.getTime() - s.from.getTime() < 7 * DAY) continue;
    const growth = Math.max(0, s.last - s.first);
    const barcodes = byContent.get(contentId) ?? [];
    const agg = await prisma.orderItem.aggregate({
      _sum: { quantity: true },
      where: { sku: { in: barcodes }, order: { userId, source: 'trendyol', uiOrderDate: { gte: s.from, lte: s.to } } },
    });
    orders += agg._sum.quantity ?? 0;
    newRatings += growth;
  }
  return { orders, newRatings };
}

export async function runMarketCalibration(): Promise<{ calibrated: boolean; n: number; stores: number }> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY);
  const users = await prisma.trendyolProduct.findMany({ where: { productContentId: { not: null } }, distinct: ['userId'], select: { userId: true } });
  const pools: StorePool[] = [];
  for (const u of users) pools.push(await storePool(u.userId, since));
  const r = poolRatio(pools);
  if (!r) return { calibrated: false, n: pools.reduce((s, p) => s + p.newRatings, 0), stores: pools.filter((p) => p.newRatings > 0).length };
  const cal: Calibration = { ordersPerRating: r.ordersPerRating, n: r.n, source: `${r.stores} store${r.stores === 1 ? '' : 's'}`, computedAt: new Date().toISOString() };
  await writeShared(CALIBRATION_KEY, cal, 3 * DAY);
  return { calibrated: true, n: r.n, stores: r.stores };
}

export async function readCalibration(): Promise<Calibration | null> {
  try {
    const hit = await readShared<Calibration>(CALIBRATION_KEY);
    return hit?.data ?? null;
  } catch {
    return null;
  }
}
