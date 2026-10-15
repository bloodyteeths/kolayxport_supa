/**
 * Fire-and-forget listing health refresh with a per-store debounce (listings-grid §9.3).
 *
 * Callers on hot paths (webhook applyListingPayload, draft sync cache refresh) queue the
 * changed ids; one refreshHealth() call per store runs after DEBOUNCE_MS of quiet, or at once
 * when MAX_BATCH ids are pending. Never throws and never blocks the caller. Ids are lost on a
 * process restart, which is fine: the nightly reconcile and the backfill script rescore.
 */
import { logger } from '@/lib/logger';
import type { ListingScoreMarketplace } from '@/lib/listingScore';

const DEBOUNCE_MS = 2_000;
const MAX_BATCH = 500;

type Pending = { userId?: string; ids: Set<string>; timer: ReturnType<typeof setTimeout> | null };
const pending = new Map<string, Pending>();

function flush(key: string, marketplace: ListingScoreMarketplace, storeId: string) {
  const p = pending.get(key);
  if (!p) return;
  pending.delete(key);
  if (p.timer) clearTimeout(p.timer);
  const ids = Array.from(p.ids);
  if (ids.length === 0) return;
  void runHealthRefresh(marketplace, storeId, p.userId, ids);
}

/** Runs refreshHealth now, swallowing every error (logs a warning). */
export async function runHealthRefresh(
  marketplace: ListingScoreMarketplace,
  storeId: string,
  userId: string | undefined,
  ids?: string[],
): Promise<void> {
  try {
    const { refreshHealth } = await import('@/lib/listings/refreshHealth');
    const r = await refreshHealth(marketplace, { storeId, ...(userId ? { userId } : {}), ...(ids ? { ids } : {}) });
    if (r.error) logger.warn('listing health refresh failed', { marketplace, storeId, error: r.error });
  } catch (err: any) {
    logger.warn('listing health refresh threw', { marketplace, storeId, error: err?.message });
  }
}

/** Queue ids for a debounced, batched health refresh. Safe to call from any path. */
export function queueHealthRefresh(
  marketplace: ListingScoreMarketplace,
  storeId: string,
  userId: string | undefined,
  ids: Array<string | bigint | number>,
): void {
  try {
    if (!storeId || ids.length === 0) return;
    const key = `${marketplace}:${storeId}`;
    let p = pending.get(key);
    if (!p) {
      p = { userId, ids: new Set(), timer: null };
      pending.set(key, p);
    }
    if (userId && !p.userId) p.userId = userId;
    for (const id of ids) p.ids.add(String(id));
    if (p.timer) clearTimeout(p.timer);
    if (p.ids.size >= MAX_BATCH) {
      flush(key, marketplace, storeId);
      return;
    }
    p.timer = setTimeout(() => flush(key, marketplace, storeId), DEBOUNCE_MS);
    (p.timer as any)?.unref?.();
  } catch {
    // never affects the caller
  }
}
