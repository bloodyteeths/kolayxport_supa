/**
 * eBay `estimatedSoldQuantity` enrichment for search results (product_database).
 *
 * The Browse search (item_summary) does not carry sold counts; each one costs a
 * get_item_by_legacy_id call. The extension overlay used to wait for 20 of them, which
 * the serial eBay queue turned into ~20 s. Here:
 *
 * - only `max` items are looked up (the extension sends the ids in the first viewport,
 *   default EXT_ENRICH_DEFAULT), with bounded concurrency;
 * - per-item results are kept in the shared research cache for 24 h
 *   (`ext:v1:ebay:item:<marketplace>:<legacyId>`), reused across searches and users;
 * - with `deadline` the caller gets whatever is ready by then. Unfinished items come back
 *   as `enrichPending: true` (+ `pendingIds`); their lookups keep running and land in the
 *   per-item cache, so a re-poll (a shared-cache hit, merged by `mergeCachedItemDetails`)
 *   fills them without another eBay call.
 */
import { readSharedMany, writeShared, sharedCacheKey, RESEARCH_TTL } from '@/lib/ext/researchQuota';

/** Items the extension enriches per search (≈ the first viewport of eBay search cards). */
export const EXT_ENRICH_DEFAULT = 8;
export const ENRICH_MAX = 20;
/** The extension's product_database answer is time-boxed to this (from the request start). */
export const EXT_TIME_BOX_MS = 4000;
export const ENRICH_CONCURRENCY = 4;

export interface SoldDetails {
  soldQuantity: number;
  remainingQuantity: number;
}

interface CachedSoldDetails extends SoldDetails {
  at: string;
}

export function itemCacheKey(marketplaceId: string, legacyId: string): string {
  return sharedCacheKey('ebay', 'item', marketplaceId || 'EBAY_US', String(legacyId));
}

export interface EnrichOptions {
  marketplaceId: string;
  /** How many items to look up (0..ENRICH_MAX). */
  max: number;
  /** Look these legacy ids up first (the cards in the shopper's first viewport). */
  priorityIds?: string[];
  concurrency?: number;
  /** Epoch ms: return what is ready by then; the rest is marked pending. No deadline = wait for all. */
  deadline?: number;
  /** Read/write the shared per-item cache (24 h). */
  useCache?: boolean;
  fetchDetails: (legacyId: string) => Promise<SoldDetails>;
}

export interface EnrichResult {
  items: Array<Record<string, unknown>>;
  /** eBay item calls this request started (they all complete, possibly after the deadline). */
  apiCalls: number;
  pendingIds: string[];
  cachedIds: string[];
  timedOut: boolean;
}

const legacyIdOf = (item: Record<string, unknown>): string | null => {
  const v = item?.legacyItemId;
  return v !== undefined && v !== null && /^\d{1,20}$/.test(String(v)) ? String(v) : null;
};

function applyDetails(item: Record<string, unknown>, d: SoldDetails, source: 'live' | 'cache') {
  const out: Record<string, unknown> = {
    ...item,
    enriched: true,
    estimatedSoldQuantity: d.soldQuantity,
    estimatedRemainingQuantity: d.remainingQuantity,
    enrichSource: source,
  };
  delete out.enrichPending;
  return out;
}

/** Choose up to `max` legacy ids: priority ids present in the results first, then result order. */
export function pickEnrichIds(items: Array<Record<string, unknown>>, max: number, priorityIds: string[] = []): string[] {
  const n = Math.max(0, Math.min(ENRICH_MAX, Math.floor(max)));
  if (!n) return [];
  const present = new Set(items.map(legacyIdOf).filter((v): v is string => !!v));
  const out: string[] = [];
  const add = (id: string | null) => {
    if (id && present.has(id) && !out.includes(id) && out.length < n) out.push(id);
  };
  priorityIds.forEach((id) => add(String(id)));
  items.forEach((it) => add(legacyIdOf(it)));
  return out;
}

export async function enrichSoldQuantities(
  items: Array<Record<string, unknown>>,
  opts: EnrichOptions,
): Promise<EnrichResult> {
  const chosen = pickEnrichIds(items, opts.max, opts.priorityIds);
  const details = new Map<string, { d: SoldDetails; source: 'live' | 'cache' }>();

  // 1. Shared per-item cache: any result item, not only the chosen ones (free).
  const cachedIds: string[] = [];
  if (opts.useCache) {
    const ids = [...new Set(items.map(legacyIdOf).filter((v): v is string => !!v))];
    const hits = await readSharedMany<CachedSoldDetails>(ids.map((id) => itemCacheKey(opts.marketplaceId, id)));
    for (const id of ids) {
      const hit = hits[itemCacheKey(opts.marketplaceId, id)];
      if (hit && Number.isFinite(hit.soldQuantity)) {
        details.set(id, { d: { soldQuantity: hit.soldQuantity, remainingQuantity: hit.remainingQuantity }, source: 'cache' });
        cachedIds.push(id);
      }
    }
  }

  // 2. Live lookups, bounded concurrency. They outlive the deadline and still fill the cache.
  const toFetch = chosen.filter((id) => !details.has(id));
  const failed = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < toFetch.length) {
      const id = toFetch[next++];
      try {
        const d = await opts.fetchDetails(id);
        details.set(id, { d, source: 'live' });
        if (opts.useCache) {
          await writeShared(itemCacheKey(opts.marketplaceId, id), { ...d, at: new Date().toISOString() }, RESEARCH_TTL.detail);
        }
      } catch {
        failed.add(id);
      }
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(opts.concurrency ?? ENRICH_CONCURRENCY, toFetch.length) }, worker));
  all.catch(() => {}); // workers never throw; keep a late rejection from going unhandled

  let timedOut = false;
  if (toFetch.length) {
    if (opts.deadline === undefined) {
      await all;
    } else {
      const wait = Math.max(0, opts.deadline - Date.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const box = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), wait); });
      const winner = await Promise.race([all.then(() => 'done' as const), box]);
      if (timer) clearTimeout(timer);
      timedOut = winner === 'timeout';
    }
  }

  const pendingIds: string[] = [];
  const out = items.map((item) => {
    const id = legacyIdOf(item);
    if (!id) return item;
    const got = details.get(id);
    if (got) return applyDetails(item, got.d, got.source);
    if (chosen.includes(id)) {
      if (failed.has(id)) return { ...item, enriched: false };
      pendingIds.push(id);
      return { ...item, enriched: false, enrichPending: true };
    }
    return item;
  });

  return { items: out, apiCalls: toFetch.length, pendingIds, cachedIds, timedOut };
}

/**
 * A cached product_database body whose items were still pending: fill them from the
 * per-item cache (lookups that finished after the answer was cached). No eBay call.
 */
export async function mergeCachedItemDetails<T extends { items?: unknown; pendingIds?: unknown }>(
  body: T,
  marketplaceId: string,
): Promise<T> {
  const pending = Array.isArray(body?.pendingIds) ? (body.pendingIds as unknown[]).map(String) : [];
  if (!pending.length || !Array.isArray(body.items)) return body;
  const hits = await readSharedMany<CachedSoldDetails>(pending.map((id) => itemCacheKey(marketplaceId, id)));
  const filled = new Set<string>();
  const items = (body.items as Array<Record<string, unknown>>).map((item) => {
    const id = legacyIdOf(item);
    const hit = id ? hits[itemCacheKey(marketplaceId, id)] : undefined;
    if (!id || !hit || !Number.isFinite(hit.soldQuantity)) return item;
    filled.add(id);
    return applyDetails(item, hit, 'cache');
  });
  if (!filled.size) return body;
  return { ...body, items, pendingIds: pending.filter((id) => !filled.has(id)) };
}
