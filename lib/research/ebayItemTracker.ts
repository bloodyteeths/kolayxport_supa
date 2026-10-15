// lib/research/ebayItemTracker.ts — eBay item readings for the Shop tracker (research.md §8; R3 port of the legacy eBay
// Product tracker). Server only (Prisma + eBay Browse API).
//
// The Shop tracker's eBay rows are measured from `EbayTrackedProduct` + `EbayPriceSnapshot`:
//   - an eBay seller watch sums Δ soldQuantity of the user's tracked items of that seller;
//   - "Watch an eBay item" (type `ebayItem`) is one tracked item: its price and sold count over time.
// Before this module only the legacy page's "Refresh all" (`refresh_tracked`) wrote snapshots, so seller watches never
// got a second reading. Now:
//   - `trackEbayItem` (POST /api/research/watches, type ebayItem) creates / re-activates the row + its first reading;
//   - `refreshTrackedEbayItems` (scheduler job `research-ebay-items`, daily) takes one reading per active item per UTC
//     day through `getItemByLegacyId` with the owner's eBay token (app token when not connected).
// Nothing is written to eBay. Notes / user tags / CSV of the legacy tracker are not carried over (no daily need).
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getEbayTokenFor } from '@/lib/integrations/ebayClient';
import { callEbayRateLimited } from '@/lib/integrations/ebayRateLimiter';

const EBAY_API_BASE = 'https://api.ebay.com';
const DAY_MS = 86_400_000;
/** Per run: the shared eBay Browse quota also serves research searches and the arbitrage index. */
export const MAX_ITEMS_PER_RUN = 2000;

export interface EbayItemDetails {
  legacyItemId: string;
  itemId: string | null;
  title: string;
  price: number | null;
  currency: string;
  condition: string | null;
  seller: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  categoryPath: string | null;
  itemWebUrl: string | null;
  soldQuantity: number | null;
  remainingQuantity: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
const https = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https:\/\//i.test(s) ? s : null;
};

/** Pure: a Browse `item` payload → the fields the tracker stores. A missing/zero price stays null (never 0). */
export function parseEbayItem(raw: unknown, legacyItemId: string): EbayItemDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;
  const title = str(r.title);
  if (!title) return null;
  const priceNum = Number(r.price?.value);
  const avail = Array.isArray(r.estimatedAvailabilities) ? r.estimatedAvailabilities[0] : null;
  return {
    legacyItemId,
    itemId: str(r.itemId),
    title: title.slice(0, 300),
    price: Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) / 100 : null,
    currency: /^[A-Z]{3}$/.test(String(r.price?.currency ?? '')) ? String(r.price.currency) : 'USD',
    condition: str(r.condition),
    seller: str(r.seller?.username),
    imageUrl: https(r.image?.imageUrl),
    categoryId: str(r.categoryId),
    categoryPath: str(r.categoryPath),
    itemWebUrl: https(r.itemWebUrl),
    soldQuantity: int(avail?.estimatedSoldQuantity),
    remainingQuantity: int(avail?.estimatedRemainingQuantity),
  };
}

/** Pure: an eBay item id is 9–15 digits (the `/itm/<id>` number). */
export function isEbayItemId(v: unknown): boolean {
  return typeof v === 'string' && /^\d{9,15}$/.test(v);
}

export class EbayItemNotFoundError extends Error {
  constructor(readonly legacyItemId: string) {
    super(`eBay item ${legacyItemId} not found`);
  }
}

/** True for the Browse API answers that mean "this item id does not exist / has ended". */
export function isItemGoneError(err: unknown): boolean {
  return /eBay API (400|404|410)\b/.test(String((err as Error)?.message ?? ''));
}

export async function fetchEbayItem(legacyItemId: string, token: string): Promise<EbayItemDetails> {
  let raw: unknown;
  try {
    raw = await callEbayRateLimited(`${EBAY_API_BASE}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(legacyItemId)}`, { token });
  } catch (err) {
    if (isItemGoneError(err)) throw new EbayItemNotFoundError(legacyItemId);
    throw err;
  }
  const item = parseEbayItem(raw, legacyItemId);
  if (!item) throw new EbayItemNotFoundError(legacyItemId);
  return item;
}

function rowData(d: EbayItemDetails, now: Date) {
  return {
    itemId: d.itemId,
    title: d.title,
    imageUrl: d.imageUrl,
    categoryId: d.categoryId,
    categoryPath: d.categoryPath,
    seller: d.seller,
    condition: d.condition,
    currentPrice: d.price,
    currency: d.currency,
    currentQuantity: d.remainingQuantity,
    totalSold: d.soldQuantity,
    itemWebUrl: d.itemWebUrl,
    lastCheckedAt: now,
  };
}

function snapshotData(trackedProductId: string, d: EbayItemDetails, now: Date) {
  // EbayPriceSnapshot.price is required: an item without a price gets no reading (never a fake 0).
  return d.price === null
    ? null
    : { trackedProductId, price: d.price, currency: d.currency, quantity: d.remainingQuantity, soldQuantity: d.soldQuantity, timestamp: now };
}

export interface TrackEbayItemResult {
  id: string;
  created: boolean;
}

/**
 * Track one eBay item for `userId` (create, or re-activate a removed one) and take its first reading. An item that is
 * already active is returned unchanged (`created: false`). Throws EbayItemNotFoundError for an unknown / ended item.
 */
export async function trackEbayItem(userId: string, legacyItemId: string, now = new Date()): Promise<TrackEbayItemResult> {
  const existing = await prisma.ebayTrackedProduct.findUnique({ where: { userId_legacyItemId: { userId, legacyItemId } } });
  if (existing?.isActive) return { id: existing.id, created: false };
  const { token } = await getEbayTokenFor(userId);
  const d = await fetchEbayItem(legacyItemId, token);
  const id = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.ebayTrackedProduct.update({ where: { id: existing.id }, data: { ...rowData(d, now), isActive: true } })
      : await tx.ebayTrackedProduct.create({ data: { userId, legacyItemId, tags: [], ...rowData(d, now) } });
    const snap = snapshotData(row.id, d, now);
    if (snap) await tx.ebayPriceSnapshot.create({ data: snap });
    return row.id;
  });
  return { id, created: true };
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Pure: does a tracked item still need today's reading? */
export function needsReading(lastCheckedAt: Date | string | null | undefined, nowMs: number): boolean {
  if (!lastCheckedAt) return true;
  const t = new Date(lastCheckedAt).getTime();
  return !Number.isFinite(t) || utcDay(t) !== utcDay(nowMs);
}

export interface EbayItemRunSummary {
  due: number;
  taken: number;
  alreadyToday: number;
  gone: number;
  failed: number;
  aborted: boolean;
}

/**
 * Daily: one reading per active tracked eBay item (every user), oldest check first, at most MAX_ITEMS_PER_RUN.
 * Idempotent per UTC day (an item checked today is skipped). Token per owner (their OAuth token, else the app token).
 */
export async function refreshTrackedEbayItems(opts: { signal?: AbortSignal; nowMs?: number; max?: number } = {}): Promise<EbayItemRunSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const summary: EbayItemRunSummary = { due: 0, taken: 0, alreadyToday: 0, gone: 0, failed: 0, aborted: false };
  const rows = await prisma.ebayTrackedProduct.findMany({
    where: { isActive: true },
    orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: opts.max ?? MAX_ITEMS_PER_RUN,
    select: { id: true, userId: true, legacyItemId: true, lastCheckedAt: true },
  });
  const tokens = new Map<string, Promise<string>>();
  const tokenFor = (userId: string) => {
    let p = tokens.get(userId);
    if (!p) {
      p = getEbayTokenFor(userId).then((t) => t.token);
      tokens.set(userId, p);
    }
    return p;
  };
  for (const r of rows) {
    if (!needsReading(r.lastCheckedAt, nowMs)) {
      summary.alreadyToday++;
      continue;
    }
    summary.due++;
    if (opts.signal?.aborted) {
      summary.aborted = true;
      break;
    }
    try {
      const d = await fetchEbayItem(r.legacyItemId, await tokenFor(r.userId));
      const now = new Date(nowMs);
      const snap = snapshotData(r.id, d, now);
      await prisma.$transaction([
        prisma.ebayTrackedProduct.update({ where: { id: r.id }, data: rowData(d, now) }),
        ...(snap ? [prisma.ebayPriceSnapshot.create({ data: snap })] : []),
      ]);
      summary.taken++;
    } catch (err) {
      if (err instanceof EbayItemNotFoundError) {
        // Ended / removed listing: mark it checked so it is not retried every run; the row and its history stay.
        summary.gone++;
        await prisma.ebayTrackedProduct.update({ where: { id: r.id }, data: { lastCheckedAt: new Date(nowMs) } }).catch(() => undefined);
        continue;
      }
      summary.failed++;
      logger.warn('[research-ebay-items] reading failed', { trackedProductId: r.id, error: (err as Error)?.message });
    }
  }
  return summary;
}

/** Readings kept for the panel chart window (31 days), shared with the watch adapter. */
export const ITEM_READ_WINDOW_MS = 31 * DAY_MS;
