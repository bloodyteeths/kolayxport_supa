/**
 * Reads over the crowd market tables for the extension overlays (Trendyol, Hepsiburada) and the app:
 * - cards: one compact line per product on a search/category/store grid
 * - product: the product panel (sales, history, buybox, keywords it ranks for)
 * - seller: the store bar (store totals over the products anyone has seen)
 * Every sales number follows lib/market/sales (measured rating growth; estimate only with a calibration).
 */
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { SnapshotMkt } from '@/lib/research/marketSnapshot';
import { readCalibration } from './calibration';
import { dailySeries, salesView, type Calibration, type Reading, type SalesView } from './sales';

const DAY = 86_400_000;

async function readingsFor(mkt: SnapshotMkt, ids: string[], days = 90): Promise<Map<string, Reading[]>> {
  const rows = await prisma.marketProductObservation.findMany({
    where: { mkt, productId: { in: ids }, observedAt: { gte: new Date(Date.now() - days * DAY) } },
    select: { productId: true, observedAt: true, ratingCount: true, reviewCount: true, price: true, favorites: true, basketCount: true, ordersAtLeast: true },
    orderBy: { observedAt: 'asc' },
  });
  const by = new Map<string, Reading[]>();
  for (const r of rows) {
    const list = by.get(r.productId) ?? [];
    list.push({ at: r.observedAt, ratingCount: r.ratingCount, reviewCount: r.reviewCount, price: r.price, favorites: r.favorites, basketCount: r.basketCount });
    by.set(r.productId, list);
  }
  return by;
}

async function latestOrdersAtLeast(mkt: SnapshotMkt, ids: string[]): Promise<Map<string, number>> {
  const rows = await prisma.marketProductObservation.findMany({
    where: { mkt, productId: { in: ids }, ordersAtLeast: { not: null } },
    select: { productId: true, ordersAtLeast: true, observedAt: true },
    orderBy: { observedAt: 'desc' },
  });
  const m = new Map<string, number>();
  for (const r of rows) if (!m.has(r.productId)) m.set(r.productId, r.ordersAtLeast as number);
  return m;
}

export interface CardView {
  id: string;
  known: boolean;
  firstSeenAt: string | null;
  readings: number;
  sales: SalesView;
  /** Price change over the readings (first → last), as a fraction. */
  priceChange: number | null;
}

/** Pure: price change between first and last priced reading. */
export function priceChange(rs: Reading[]): number | null {
  const ps = rs.filter((r) => r.price != null && (r.price as number) > 0);
  if (ps.length < 2) return null;
  const a = ps[0].price as number;
  const b = ps[ps.length - 1].price as number;
  return Math.round(((b - a) / a) * 1000) / 1000;
}

export async function readCards(mkt: SnapshotMkt, ids: string[], cal?: Calibration | null): Promise<CardView[]> {
  const uniq = [...new Set(ids)].slice(0, 120);
  const calibration = cal === undefined ? await readCalibration() : cal;
  const [products, readings, badges] = await Promise.all([
    prisma.marketProduct.findMany({ where: { mkt, productId: { in: uniq } }, select: { productId: true, price: true, ratingCount: true, firstSeenAt: true } }),
    readingsFor(mkt, uniq),
    latestOrdersAtLeast(mkt, uniq),
  ]);
  const byId = new Map(products.map((p) => [p.productId, p]));
  return uniq.map((id) => {
    const p = byId.get(id);
    const rs = readings.get(id) ?? [];
    return {
      id,
      known: Boolean(p),
      firstSeenAt: p?.firstSeenAt.toISOString() ?? null,
      readings: rs.length,
      sales: salesView(rs, { price: p?.price ?? null, ratingCount: p?.ratingCount ?? null, ordersAtLeast: badges.get(id) ?? null, calibration: mkt === 'trendyol' ? calibration : null }),
      priceChange: priceChange(rs),
    };
  });
}

export interface KeywordRank { query: string; rank: number; total: number | null; seenAt: string }

/** Keywords the product showed up for organically in the last 30 days (best rank per query). */
async function keywordRanks(mkt: SnapshotMkt, id: string): Promise<KeywordRank[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ query: string; page: number; pos: number; total: number | null; observedAt: Date }>>(
    `SELECT s.query, s.page, (e.ord - 1)::int AS pos, s.total, s."observedAt"
       FROM "MarketSearchObservation" s,
            LATERAL jsonb_array_elements_text(s."organicIds") WITH ORDINALITY AS e(pid, ord)
      WHERE s.mkt = $1 AND e.pid = $2 AND s."observedAt" > now() - interval '30 days' AND s."queryKey" NOT LIKE 's:%'
      ORDER BY s."observedAt" DESC
      LIMIT 200`,
    mkt, id,
  );
  const best = new Map<string, KeywordRank>();
  for (const r of rows) {
    // Organic positions per page: Trendyol shows ~24 organic results per page alongside ads.
    const rank = (r.page - 1) * 24 + r.pos + 1;
    const prev = best.get(r.query);
    if (!prev) best.set(r.query, { query: r.query, rank, total: r.total, seenAt: r.observedAt.toISOString() });
    else if (rank < prev.rank) best.set(r.query, { ...prev, rank });
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank).slice(0, 20);
}

export async function readProduct(mkt: SnapshotMkt, id: string) {
  const p = await prisma.marketProduct.findUnique({ where: { mkt_productId: { mkt, productId: id } } });
  if (!p) return null;
  const calibration = mkt === 'trendyol' ? await readCalibration() : null;
  const [readings, badges, offersRow, keywords, seller] = await Promise.all([
    readingsFor(mkt, [id]),
    latestOrdersAtLeast(mkt, [id]),
    prisma.marketProductObservation.findFirst({ where: { mkt, productId: id, offers: { not: Prisma.AnyNull } }, orderBy: { observedAt: 'desc' }, select: { offers: true, observedAt: true, otherSellerCount: true } }),
    keywordRanks(mkt, id),
    p.sellerId ? prisma.marketSeller.findUnique({ where: { mkt_sellerId: { mkt, sellerId: p.sellerId } } }) : Promise.resolve(null),
  ]);
  const rs = readings.get(id) ?? [];
  return {
    product: {
      id: p.productId, title: p.title, brand: p.brand, url: p.url, imageUrl: p.imageUrl, price: p.price, currency: p.currency,
      rating: p.rating, ratingCount: p.ratingCount, reviewCount: p.reviewCount, favorites: p.favorites,
      otherSellerCount: p.otherSellerCount, categoryName: p.categoryName, firstSeenAt: p.firstSeenAt.toISOString(), lastSeenAt: p.lastSeenAt.toISOString(),
    },
    sales: salesView(rs, { price: p.price, ratingCount: p.ratingCount, ordersAtLeast: badges.get(id) ?? null, calibration }),
    series: dailySeries(rs),
    priceChange: priceChange(rs),
    buybox: offersRow ? { offers: offersRow.offers, seenAt: offersRow.observedAt.toISOString(), otherSellerCount: offersRow.otherSellerCount } : null,
    seller: seller ? { id: seller.sellerId, name: seller.name, score: seller.score, followers: seller.followers, productCount: seller.productCount } : null,
    keywords,
  };
}

export async function readSeller(mkt: SnapshotMkt, sellerId: string) {
  const s = await prisma.marketSeller.findUnique({ where: { mkt_sellerId: { mkt, sellerId } } });
  const products = await prisma.marketProduct.findMany({
    where: { mkt, sellerId },
    select: { productId: true, title: true, price: true, ratingCount: true, favorites: true, url: true, imageUrl: true },
    take: 500,
  });
  if (!s && products.length === 0) return null;
  const cards = await readCards(mkt, products.map((p) => p.productId));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rows = products.map((p) => ({ ...p, sales: byId.get(p.productId)?.sales ?? null }));
  const sum = (f: (r: (typeof rows)[number]) => number | null | undefined) => {
    const vals = rows.map(f).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const top = [...rows].sort((a, b) => (b.sales?.salesPer30d ?? b.sales?.ratingsPer30d ?? -1) - (a.sales?.salesPer30d ?? a.sales?.ratingsPer30d ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0)).slice(0, 10);
  const prices = rows.map((r) => r.price).filter((v): v is number => v != null).sort((a, b) => a - b);
  return {
    seller: s ? { id: s.sellerId, name: s.name, score: s.score, followers: s.followers, productCount: s.productCount, firstSeenAt: s.firstSeenAt.toISOString() } : { id: sellerId, name: null, score: null, followers: null, productCount: null, firstSeenAt: null },
    productsSeen: rows.length,
    ratingsPer30d: sum((r) => r.sales?.ratingsPer30d),
    salesPer30d: sum((r) => r.sales?.salesPer30d),
    revenuePer30d: sum((r) => r.sales?.revenuePer30d),
    salesPerDay: sum((r) => r.sales?.salesPerDay),
    revenuePerDay: sum((r) => r.sales?.revenuePerDay),
    totalRatings: sum((r) => r.ratingCount),
    priceRange: prices.length ? { min: prices[0], max: prices[prices.length - 1], median: prices[Math.floor(prices.length / 2)] } : null,
    top: top.map((r) => ({ id: r.productId, title: r.title, price: r.price, ratingCount: r.ratingCount, url: r.url, imageUrl: r.imageUrl, sales: r.sales })),
  };
}

/** Give-to-get: full crowd reads for sellers who contributed in the last 30 days. */
export async function hasContributed(userId: string): Promise<boolean> {
  const row = await prisma.marketContribution.findFirst({ where: { userId, day: { gte: new Date(Date.now() - 30 * DAY) }, products: { gt: 0 } }, select: { id: true } });
  return Boolean(row);
}
