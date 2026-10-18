/**
 * Crowd market data intake (Trendyol, Hepsiburada).
 *
 * Sellers browse marketplace pages in their own browser; with their consent the KolayXport extension sends the
 * public facts those pages show (price, ratings, favorites, baskets, sellers, positions). Everything lands in shared
 * tables everyone's research reads. Rules:
 * - Data rows never carry a userId. Who contributed how much is counted separately (MarketContribution).
 * - Payloads are untrusted: every field is type-checked (marketSnapshot `parseSnapshot` for search pages,
 *   `parseProductPage` / `parseStorePage` here) and checked against the last known value (`guardAgainst`), so one
 *   bad or hostile payload cannot rewrite history.
 * - At most one observation per product per hour; the product row keeps the latest state.
 */
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { MKT_RULES, num, parseCompact, safeUrl, str, type MarketSnapshot, type SnapshotMkt, SNAPSHOT_MKTS } from '@/lib/research/marketSnapshot';
import { normalizeQuery } from '@/lib/research/etsySearch';

export type PageType = 'search' | 'product' | 'store';
export const PAGE_TYPES: readonly PageType[] = ['search', 'product', 'store'];

export interface Offer { sellerId: string; name: string | null; price: number | null; score: number | null }

export interface ProductPage {
  mkt: SnapshotMkt;
  id: string;
  title: string;
  brand: string | null;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  rating: number | null;
  ratingCount: number | null;
  reviewCount: number | null;
  favorites: number | null;
  basketCount: number | null;
  viewCount: number | null;
  orderBadge: string | null;
  ordersAtLeast: number | null;
  sellerId: string | null;
  sellerName: string | null;
  sellerScore: number | null;
  categoryId: string | null;
  categoryName: string | null;
  otherSellerCount: number | null;
  offers: Offer[];
}

export interface StorePage {
  mkt: SnapshotMkt;
  sellerId: string;
  name: string | null;
  score: number | null;
  followers: number | null;
  productCount: number | null;
}

export const hourBucket = (d: Date): Date => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
export const dayBucket = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const rating5 = (v: unknown): number | null => { const n = num(v); return n != null && n <= 5 ? n : null; };
const sellerIdOf = (v: unknown): string | null => (v != null ? str(String(v), 40) : null);
const count = (v: unknown): number | null => (typeof v === 'string' ? parseCompact(v) : num(v));

function isMkt(v: unknown): v is SnapshotMkt {
  return SNAPSHOT_MKTS.includes(v as SnapshotMkt);
}

/** Pure: validate a product page payload. */
export function parseProductPage(body: any): ProductPage | null {
  if (!body || typeof body !== 'object' || !isMkt(body.mkt)) return null;
  const rule = MKT_RULES[body.mkt];
  const p = body.product;
  if (!p || typeof p !== 'object') return null;
  const id = str(String(p.id ?? ''), 40);
  if (!id || !rule.id.test(id)) return null;
  const title = str(p.title, 300);
  if (!title) return null;
  const offers: Offer[] = (Array.isArray(p.offers) ? p.offers.slice(0, 50) : [])
    .map((o: any) => ({ sellerId: sellerIdOf(o?.sellerId), name: str(o?.name, 120), price: num(o?.price), score: num(o?.score) }))
    .filter((o: any): o is Offer => Boolean(o.sellerId) && (o.score == null || o.score <= 10));
  const orderBadge = str(p.orderBadge, 20);
  return {
    mkt: body.mkt,
    id,
    title,
    brand: str(p.brand, 80),
    url: safeUrl(p.url, rule.host, rule.base),
    imageUrl: safeUrl(p.imageUrl, rule.img, rule.base),
    price: num(p.price),
    originalPrice: num(p.originalPrice),
    rating: rating5(p.rating),
    ratingCount: count(p.ratingCount),
    reviewCount: count(p.reviewCount),
    favorites: count(p.favorites),
    basketCount: count(p.basketCount),
    viewCount: count(p.viewCount),
    orderBadge,
    ordersAtLeast: parseCompact(orderBadge),
    sellerId: sellerIdOf(p.sellerId),
    sellerName: str(p.sellerName, 120),
    sellerScore: num(p.sellerScore) != null && (num(p.sellerScore) as number) <= 10 ? num(p.sellerScore) : null,
    categoryId: p.categoryId != null ? str(String(p.categoryId), 30) : null,
    categoryName: str(p.categoryName, 120),
    otherSellerCount: num(p.otherSellerCount),
    offers,
  };
}

/** Pure: validate a store page payload (its product grid comes as a search-style `items` list). */
export function parseStorePage(body: any): StorePage | null {
  if (!body || typeof body !== 'object' || !isMkt(body.mkt)) return null;
  const s = body.store;
  if (!s || typeof s !== 'object') return null;
  const sellerId = sellerIdOf(s.sellerId);
  if (!sellerId) return null;
  const score = num(s.score);
  return { mkt: body.mkt, sellerId, name: str(s.name, 120), score: score != null && score <= 10 ? score : null, followers: count(s.followers), productCount: count(s.productCount) };
}

export interface Counters { price: number | null; ratingCount: number | null; reviewCount?: number | null; favorites: number | null }

/**
 * Pure: drop values that contradict the last known state. Rating/review counts only grow (a >5 % drop is a bad
 * read); favorites can shrink a little (>30 % drop rejected); a price more than 10x off is a bad read.
 */
export function guardAgainst<T extends Counters>(prev: Counters | null, next: T): T {
  if (!prev) return next;
  const out = { ...next };
  if (prev.ratingCount != null && out.ratingCount != null && out.ratingCount < prev.ratingCount * 0.95) out.ratingCount = null;
  if (prev.reviewCount != null && out.reviewCount != null && out.reviewCount < prev.reviewCount * 0.95) out.reviewCount = null;
  if (prev.favorites != null && out.favorites != null && out.favorites < prev.favorites * 0.7) out.favorites = null;
  if (prev.price != null && prev.price > 0 && out.price != null && (out.price > prev.price * 10 || out.price < prev.price / 10)) out.price = null;
  return out;
}

/** Keep the old value where the new read has none (a null never erases a known fact). */
const keep = <V>(next: V | null | undefined, prev: V | null | undefined): V | null => (next ?? prev ?? null);

export interface IngestResult { products: number; observations: number }

/** Search/category/store grid: products + one observation each + the ordered result list. */
export async function ingestSearch(snap: MarketSnapshot, opts: { page?: number; queryKey?: string; source?: 'search' | 'store'; now?: Date } = {}): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const hb = hourBucket(now);
  const ids = snap.items.map((i) => i.id);
  const prevRows = await prisma.marketProduct.findMany({ where: { mkt: snap.mkt, productId: { in: ids } } });
  const prev = new Map(prevRows.map((r) => [r.productId, r]));

  const observations: Prisma.MarketProductObservationCreateManyInput[] = [];
  for (const raw of snap.items) {
    const p = prev.get(raw.id) ?? null;
    const it = guardAgainst(p, { ...raw, reviewCount: null });
    const data = {
      title: it.title || p?.title || '',
      brand: keep(it.brand, p?.brand),
      sellerId: keep(it.sellerId, p?.sellerId),
      categoryId: keep(it.categoryId, p?.categoryId),
      categoryName: keep(it.category, p?.categoryName),
      url: keep(it.url, p?.url),
      imageUrl: keep(it.thumbUrl, p?.imageUrl),
      price: keep(it.price, p?.price),
      rating: keep(it.rating, p?.rating),
      ratingCount: keep(it.ratingCount, p?.ratingCount),
      favorites: keep(it.favorites, p?.favorites),
      lastSeenAt: now,
    };
    if (p) await prisma.marketProduct.update({ where: { id: p.id }, data });
    else await prisma.marketProduct.create({ data: { mkt: snap.mkt, productId: it.id, firstSeenAt: now, ...data } });
    observations.push({
      mkt: snap.mkt, productId: it.id, hourBucket: hb, observedAt: now, source: opts.source ?? 'search',
      price: it.price, rating: it.rating, ratingCount: it.ratingCount, favorites: it.favorites,
      orderBadge: it.orderBadge, ordersAtLeast: it.ordersAtLeast,
    });
  }
  const created = await prisma.marketProductObservation.createMany({ data: observations, skipDuplicates: true });

  const queryKey = opts.queryKey ?? normalizeQuery(snap.query);
  if (queryKey) {
    await prisma.marketSearchObservation.createMany({
      data: [{
        mkt: snap.mkt, queryKey, query: snap.query, hourBucket: hb, observedAt: now, total: snap.total, page: opts.page ?? 1,
        organicIds: snap.items.filter((i) => !i.sponsored).map((i) => i.id),
        sponsoredIds: snap.items.filter((i) => i.sponsored).map((i) => i.id),
      }],
      skipDuplicates: true,
    });
  }
  return { products: snap.items.length, observations: created.count };
}

/** Product page: the richest read (baskets, views, buybox offers, review count). */
export async function ingestProduct(pp: ProductPage, now = new Date()): Promise<IngestResult> {
  const p = await prisma.marketProduct.findUnique({ where: { mkt_productId: { mkt: pp.mkt, productId: pp.id } } });
  const it = guardAgainst(p, pp);
  const data = {
    title: it.title,
    brand: keep(it.brand, p?.brand),
    sellerId: keep(it.sellerId, p?.sellerId),
    sellerName: keep(it.sellerName, p?.sellerName),
    categoryId: keep(it.categoryId, p?.categoryId),
    categoryName: keep(it.categoryName, p?.categoryName),
    url: keep(it.url, p?.url),
    imageUrl: keep(it.imageUrl, p?.imageUrl),
    price: keep(it.price, p?.price),
    rating: keep(it.rating, p?.rating),
    ratingCount: keep(it.ratingCount, p?.ratingCount),
    reviewCount: keep(it.reviewCount, p?.reviewCount),
    favorites: keep(it.favorites, p?.favorites),
    otherSellerCount: keep(it.otherSellerCount, p?.otherSellerCount),
    lastSeenAt: now,
  };
  if (p) await prisma.marketProduct.update({ where: { id: p.id }, data });
  else await prisma.marketProduct.create({ data: { mkt: pp.mkt, productId: pp.id, firstSeenAt: now, ...data } });

  // A product page beats a search card read in the same hour: replace it.
  const where = { mkt_productId_hourBucket: { mkt: pp.mkt, productId: pp.id, hourBucket: hourBucket(now) } };
  const obs = {
    observedAt: now, source: 'product', price: it.price, originalPrice: it.originalPrice, rating: it.rating,
    ratingCount: it.ratingCount, reviewCount: it.reviewCount, favorites: it.favorites, basketCount: it.basketCount,
    viewCount: it.viewCount, orderBadge: it.orderBadge, ordersAtLeast: it.ordersAtLeast, otherSellerCount: it.otherSellerCount,
    buyboxSellerId: it.sellerId, offers: it.offers.length ? (it.offers as unknown as object) : undefined,
  };
  await prisma.marketProductObservation.upsert({ where, update: obs, create: { mkt: pp.mkt, productId: pp.id, hourBucket: hourBucket(now), ...obs } });

  if (it.sellerId) await upsertSeller({ mkt: pp.mkt, sellerId: it.sellerId, name: it.sellerName, score: it.sellerScore, followers: null, productCount: null }, now);
  for (const o of it.offers) {
    if (o.sellerId !== it.sellerId) await upsertSeller({ mkt: pp.mkt, sellerId: o.sellerId, name: o.name, score: o.score, followers: null, productCount: null }, now);
  }
  return { products: 1, observations: 1 };
}

export async function upsertSeller(s: StorePage, now = new Date()): Promise<void> {
  const prev = await prisma.marketSeller.findUnique({ where: { mkt_sellerId: { mkt: s.mkt, sellerId: s.sellerId } } });
  const data = { name: keep(s.name, prev?.name), score: keep(s.score, prev?.score), followers: keep(s.followers, prev?.followers), productCount: keep(s.productCount, prev?.productCount), lastSeenAt: now };
  if (prev) await prisma.marketSeller.update({ where: { id: prev.id }, data });
  else await prisma.marketSeller.create({ data: { mkt: s.mkt, sellerId: s.sellerId, firstSeenAt: now, ...data } });
}

/** Contribution tally (separate from the data) + reader health. Never throws: intake must not fail on bookkeeping. */
export async function recordContribution(userId: string, mkt: SnapshotMkt, products: number, now = new Date()): Promise<void> {
  try {
    const day = dayBucket(now);
    await prisma.marketContribution.upsert({
      where: { userId_day_mkt: { userId, day, mkt } },
      update: { products: { increment: products }, pages: { increment: 1 } },
      create: { userId, day, mkt, products, pages: 1 },
    });
  } catch { /* bookkeeping only */ }
}

export async function recordIngestStat(mkt: string, pageType: string, parserVersion: string, ok: boolean, now = new Date()): Promise<void> {
  try {
    const day = dayBucket(now);
    const pv = parserVersion.slice(0, 40) || 'unknown';
    const m = isMkt(mkt) ? mkt : 'other';
    const pt = PAGE_TYPES.includes(pageType as PageType) ? pageType : 'other';
    await prisma.marketIngestStat.upsert({
      where: { day_mkt_pageType_parserVersion: { day, mkt: m, pageType: pt, parserVersion: pv } },
      update: ok ? { accepted: { increment: 1 } } : { rejected: { increment: 1 } },
      create: { day, mkt: m, pageType: pt, parserVersion: pv, accepted: ok ? 1 : 0, rejected: ok ? 0 : 1 },
    });
  } catch { /* bookkeeping only */ }
}
