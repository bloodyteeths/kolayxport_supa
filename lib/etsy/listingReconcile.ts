/**
 * Full listing reconcile for one Etsy shop (owner W3).
 *
 * Used by the nightly job (mode 'nightly', P2 Reconcile), the manual
 * "Sync listings" button (mode 'full', P3 Interactive — clawd sync_listings)
 * and the post-connect import (mode 'initial').
 *
 *  - pages every state (active, draft, inactive, sold_out, expired) with
 *    includes=Images,Inventory, limit 100, collecting seen ids;
 *  - writes only rows whose updated_timestamp is newer (or never hashed),
 *    through the same timestamp-guarded path as webhooks (source reconcile);
 *  - NEVER observes stock: when an offering quantity / isEnabled differs from
 *    the cache it enqueues a synthetic 'reconcile.changed' event for
 *    'listing:<id>' so the webhook worker refreshes + observes it;
 *  - deletion safeguard: cached ids not seen are re-checked with an individual
 *    GET (max 200 per run) — 404 means tombstone, 200 means upsert. Skipped
 *    entirely when any page failed;
 *  - lastListingReconcileAt / lastListingSyncAt only move when every page succeeded;
 *  - writes today's daily stat totals from the active pages;
 *  - no shopName refresh.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { EtsyPriority, canSpend, withEtsyBudget } from './rateBudget';
import { enqueueSyntheticEtsyEvent } from './webhooks/queueOps';
import { etsyFetch, etsyAuthHeaders } from './http';
import { applyListingPayload, ETSY_API_BASE, handleListingRemoved, refreshListingDetailed } from './listingCache';
import { buildOfferingRows, extractImages, extractInventory, offeringsStockDiffer } from './listingNormalize';
import { decideListingAlerts, emitListingAlerts, publishListingLive } from './listingAlerts';
import { writeDailyTotals, type DailyTotalsRow } from './listingStatsDaily';
import { publishLive } from '@/lib/live/publish';

export const RECONCILE_STATES = ['active', 'draft', 'inactive', 'sold_out', 'expired'] as const;
export const RECONCILE_PAGE_LIMIT = 100;
export const MAX_DELETION_CHECKS = 200;
/** Live 'sync' event scope of listing reconciles (listings page refetches from the DB on it). */
export const LISTINGS_LIVE_SCOPE = 'listings:etsy';
const PROGRESS_LIVE_MS = 3_000;

export type ReconcileMode = 'nightly' | 'full' | 'initial';

export type ReconcileResult = {
  success: boolean;
  partial: boolean;
  synced: number;
  fetched: number;
  errors: string[];
  removed: number;
  lastSyncAt: string | null;
};

export type ReconcileStats = ReconcileResult & {
  lostWebhookChanges: number;
  enqueued: number;
  deletionChecks: number;
};

/** Pure: may stale rows be deleted / sync timestamps be advanced? */
export function reconcileComplete(s: { pageFailed: boolean; writeErrors: number; budgetStopped: boolean }): boolean {
  return !s.pageFailed && s.writeErrors === 0 && !s.budgetStopped;
}

/** Pure: cached ids that the paged scan did not return (deletion candidates). */
export function unseenIds(cachedIds: Array<string | bigint>, seen: Set<string>, max = MAX_DELETION_CHECKS): string[] {
  return cachedIds.map(String).filter((id) => !seen.has(id)).slice(0, max);
}

/** Pure: 'initial' (silent import) only for a never-imported or re-owned shop. */
export function postConnectListingMode(a: { ownerChanged: boolean; lastListingSyncAt: Date | null; cachedCount: number }): 'initial' | 'nightly' {
  if (a.ownerChanged) return 'initial';
  if (a.lastListingSyncAt || a.cachedCount > 0) return 'nightly';
  return 'initial';
}

/**
 * Maps a reconcile result to an HTTP failure for the manual Sync button, or
 * null when the run should answer 200 (complete, or partial with data).
 */
export function syncListingsFailure(r: { success: boolean; fetched: number; errors: string[] }): { status: number; code: string; error: string } | null {
  if (r.success) return null;
  if (r.errors.includes('needs_reauth')) {
    return { status: 409, code: 'ETSY_REAUTH', error: 'Etsy connection expired. Reconnect the shop in Settings.' };
  }
  if (r.errors.includes('shop_not_found')) {
    return { status: 404, code: 'ETSY_SHOP_NOT_FOUND', error: 'Etsy shop not found or inactive.' };
  }
  const throttled = r.errors.some((e) => e === 'budget' || e === 'aborted' || e.startsWith('deferred:'));
  if (throttled && r.fetched === 0) {
    return { status: 503, code: 'ETSY_RATE_LIMITED', error: 'Etsy is busy right now. Try again in a minute.' };
  }
  if (r.fetched === 0) {
    return { status: 502, code: 'ETSY_SYNC_FAILED', error: 'Could not read listings from Etsy.' };
  }
  return null;
}

async function fetchPage(shopId: string, accessToken: string, state: string, offset: number): Promise<any[]> {
  const url = `${ETSY_API_BASE}/shops/${shopId}/listings?state=${state}&limit=${RECONCILE_PAGE_LIMIT}&offset=${offset}&includes=Images,Inventory`;
  const res = await etsyFetch(url, { method: 'GET', headers: etsyAuthHeaders(accessToken) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Etsy API error: ${res.status} - ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

export async function reconcileShopListings(shopId: string, opts: { mode: ReconcileMode; signal?: AbortSignal }): Promise<ReconcileResult> {
  const r = await reconcileShopListingsDetailed(shopId, opts);
  return {
    success: r.success,
    partial: r.partial,
    synced: r.synced,
    fetched: r.fetched,
    errors: r.errors,
    removed: r.removed,
    lastSyncAt: r.lastSyncAt,
  };
}

export async function reconcileShopListingsDetailed(shopId: string, opts: { mode: ReconcileMode; signal?: AbortSignal }): Promise<ReconcileStats> {
  const shop = await prisma.etsyShop.findUnique({
    where: { shopId },
    select: { userId: true, isActive: true, needsReauth: true, lastListingSyncAt: true },
  });
  const empty = (errors: string[]): ReconcileStats => ({
    success: false,
    partial: false,
    synced: 0,
    fetched: 0,
    errors,
    removed: 0,
    lastSyncAt: shop?.lastListingSyncAt?.toISOString() ?? null,
    lostWebhookChanges: 0,
    enqueued: 0,
    deletionChecks: 0,
  });
  if (!shop || !shop.isActive) return empty(['shop_not_found']);
  if (shop.needsReauth) return empty(['needs_reauth']);
  const priority = opts.mode === 'full' ? EtsyPriority.Interactive : EtsyPriority.Reconcile;
  return withEtsyBudget({ shopId, userId: shop.userId, priority }, () => run(shopId, shop.userId, shop.lastListingSyncAt, opts, priority));
}

async function run(
  shopId: string,
  userId: string,
  previousSyncAt: Date | null,
  opts: { mode: ReconcileMode; signal?: AbortSignal },
  priority: EtsyPriority,
): Promise<ReconcileStats> {
  const { getEtsyAccessToken } = await import('./etsyToken');
  const accessToken = await getEtsyAccessToken(shopId, userId);
  const source = opts.mode === 'initial' ? 'initial' : 'reconcile';
  const startedAt = new Date();

  const cachedRows = await prisma.etsyListing.findMany({
    where: { etsyShopId: shopId },
    select: {
      id: true,
      etsyListingId: true,
      etsyUpdatedTimestamp: true,
      contentHash: true,
      state: true,
      title: true,
      lastRefreshAt: true,
      views: true,
      numFavorers: true,
      inventorySyncedAt: true,
    },
  });
  const cached = new Map(cachedRows.map((r) => [String(r.etsyListingId), r]));
  const offeringRows = await prisma.etsyListingOffering.findMany({
    where: { etsyShopId: shopId },
    select: { etsyListingId: true, variantKey: true, quantity: true, isEnabled: true },
  });
  const cachedOfferings = new Map<string, Array<{ variantKey: string; quantity: number; isEnabled: boolean }>>();
  for (const o of offeringRows) {
    const k = String(o.etsyListingId);
    const list = cachedOfferings.get(k) || [];
    list.push({ variantKey: o.variantKey, quantity: o.quantity, isEnabled: o.isEnabled });
    cachedOfferings.set(k, list);
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const dailyRows: DailyTotalsRow[] = [];
  let pageFailed = false;
  let budgetStopped = false;
  let writeErrors = 0;
  let fetched = 0;
  let synced = 0;
  let lostWebhookChanges = 0;
  let enqueued = 0;
  // Live progress: the reconcile writes through applyListingPayload directly
  // (no per-row listing events), so open listing pages refetch from the DB on
  // 'sync.progress' / 'sync.finished' (scope 'listings:etsy'). Throttled: at
  // most one progress event per PROGRESS_LIVE_MS, only when rows were written.
  let lastProgressAt = 0;
  let syncedAtLastProgress = 0;
  publishLive(userId, { type: 'sync', kind: 'started', scope: LISTINGS_LIVE_SCOPE, processed: 0 });

  outer: for (const state of RECONCILE_STATES) {
    let offset = 0;
    for (;;) {
      if (opts.signal?.aborted) {
        budgetStopped = true;
        errors.push('aborted');
        break outer;
      }
      if (opts.mode !== 'full') {
        const gate = canSpend(shopId, priority, 1);
        if (!gate.ok) {
          budgetStopped = true;
          errors.push('budget');
          break outer;
        }
      }
      let raw: any[];
      try {
        raw = await fetchPage(shopId, accessToken, state, offset);
      } catch (err: any) {
        if (err?.name === 'EtsyDeferError' || err?.name === 'EtsyRateLimitedError') {
          budgetStopped = true;
          errors.push(`deferred:${state}:${offset}`);
          break outer;
        }
        pageFailed = true;
        errors.push(`fetch:${state}:${offset}:${String(err?.message || err).slice(0, 120)}`);
        logger.error(`Listing reconcile page failed state=${state} offset=${offset}`, err);
        break;
      }
      if (raw.length === 0) break;
      const results = raw.filter((l: any) => l?.state === state);
      for (const l of results) {
        let listingId: bigint;
        try {
          listingId = BigInt(String(l.listing_id));
        } catch {
          continue;
        }
        const key = String(listingId);
        seen.add(key);
        fetched++;
        const prev = cached.get(key) || null;
        const incomingTs = Number(l.updated_timestamp || 0);
        const inventory = extractInventory(l);
        const remoteOfferings = inventory ? buildOfferingRows(inventory) : null;
        const prevOfferings = cachedOfferings.get(key);
        const offeringsDiffer =
          !!prev && !!prev.inventorySyncedAt && !!remoteOfferings && !!prevOfferings && offeringsStockDiffer(prevOfferings, remoteOfferings);
        const needsWrite = !prev || !prev.contentHash || incomingTs > (prev.etsyUpdatedTimestamp || 0);

        if (needsWrite) {
          try {
            const applied = await applyListingPayload({
              userId,
              shopId,
              listingId,
              fetched: { listing: l, images: extractImages(l), inventory, videos: null },
              source,
              existing: prev
                ? {
                    id: prev.id,
                    etsyUpdatedTimestamp: prev.etsyUpdatedTimestamp,
                    contentHash: prev.contentHash,
                    state: prev.state,
                    title: prev.title,
                    lastRefreshAt: prev.lastRefreshAt,
                  }
                : null,
            });
            if (!applied.stale) {
              synced++;
              if (prev && prev.contentHash && incomingTs > (prev.etsyUpdatedTimestamp || 0)) lostWebhookChanges++;
              if (prev && opts.mode !== 'initial' && applied.prevState !== applied.newState) {
                const alerts = decideListingAlerts({
                  prevState: applied.prevState,
                  newState: applied.newState,
                  attribution: applied.attribution || 'unknown',
                  source,
                  changedKeys: applied.changedKeys,
                  eventTypes: new Set(),
                  // A nightly scan cannot tell; deactivations right after a sale are rare.
                  recentOrderForListing: false,
                  hasOpenDraft: false,
                  stockManaged: false,
                });
                await emitListingAlerts({
                  userId,
                  shopId,
                  listingId,
                  title: applied.title,
                  alerts,
                  newState: applied.newState,
                  prevState: applied.prevState,
                  changedKeys: applied.changedKeys,
                });
                if (alerts.length) {
                  publishListingLive(userId, {
                    kind: alerts.includes('listingDeactivated') ? 'deactivated' : alerts.includes('listingExpired') ? 'expired' : 'updated',
                    shopId,
                    listingId,
                    title: applied.title,
                    state: applied.newState,
                    attribution: applied.attribution,
                    versionId: applied.versionId,
                  });
                }
              }
            }
          } catch (err: any) {
            writeErrors++;
            errors.push(`write:${key}:${String(err?.message || err).slice(0, 120)}`);
            logger.error(`Listing reconcile write failed for ${key}`, err);
          }
        } else if (prev && (prev.views !== Number(l.views || 0) || prev.numFavorers !== Number(l.num_favorers || 0))) {
          await prisma.etsyListing
            .updateMany({
              where: { id: prev.id },
              data: { views: Number(l.views || 0), numFavorers: Number(l.num_favorers || 0) },
            })
            .catch(() => undefined);
        }

        if (offeringsDiffer) {
          try {
            await enqueueSyntheticEtsyEvent({ shopId, userId, resourceKey: `listing:${key}`, eventType: 'reconcile.changed', priority: 2 });
            enqueued++;
          } catch (err: any) {
            logger.warn('enqueueSyntheticEtsyEvent failed', { shopId, listingId: key, error: err?.message });
          }
        }

        if (state === 'active') {
          dailyRows.push({
            listingId,
            views: l.views != null ? Number(l.views) : null,
            favorites: l.num_favorers != null ? Number(l.num_favorers) : null,
            state,
            taxonomyId: l.taxonomy_id != null ? Number(l.taxonomy_id) : null,
            currency: l.price?.currency_code ?? null,
          });
        }
      }
      if (synced > syncedAtLastProgress && Date.now() - lastProgressAt >= PROGRESS_LIVE_MS) {
        lastProgressAt = Date.now();
        syncedAtLastProgress = synced;
        publishLive(userId, { type: 'sync', kind: 'progress', scope: LISTINGS_LIVE_SCOPE, processed: fetched });
      }
      offset += RECONCILE_PAGE_LIMIT;
      if (raw.length < RECONCILE_PAGE_LIMIT) break;
    }
  }

  const complete = reconcileComplete({ pageFailed, writeErrors, budgetStopped });
  let removed = 0;
  let deletionChecks = 0;
  if (complete) {
    const candidates = unseenIds(Array.from(cached.keys()), seen);
    for (const id of candidates) {
      if (opts.signal?.aborted) break;
      deletionChecks++;
      const listingId = BigInt(id);
      try {
        const r = await refreshListingDetailed({ userId, shopId, listingId, accessToken, source: 'reconcile' });
        if (r.deleted || r.newState === 'removed') {
          // Cache/tombstone/drafts/alert now; stock observation goes through the
          // webhook worker (its 404 path observes 'removed'), never from here.
          await handleListingRemoved({ userId, shopId, listingId, source: 'reconcile', observeStock: false });
          removed++;
          try {
            await enqueueSyntheticEtsyEvent({ shopId, userId, resourceKey: `listing:${id}`, eventType: 'reconcile.changed', priority: 2 });
            enqueued++;
          } catch (err: any) {
            logger.warn('enqueueSyntheticEtsyEvent (removed) failed', { shopId, listingId: id, error: err?.message });
          }
        }
      } catch (err: any) {
        // Unknown: keep the row (never delete on doubt).
        errors.push(`check:${id}:${String(err?.message || err).slice(0, 120)}`);
        logger.warn('Listing reconcile deletion check failed', { shopId, listingId: id, error: err?.message });
      }
    }
  }

  let lastSyncAt: string | null = previousSyncAt?.toISOString() ?? null;
  if (complete) {
    await prisma.etsyShop.updateMany({
      where: { shopId, userId },
      data: { lastListingReconcileAt: startedAt, lastListingSyncAt: startedAt },
    });
    lastSyncAt = startedAt.toISOString();
  }

  if (dailyRows.length) {
    try {
      await writeDailyTotals(shopId, dailyRows, startedAt);
    } catch (err: any) {
      logger.warn('writeDailyTotals failed', { shopId, error: err?.message });
    }
  }

  logger.info('Etsy listing reconcile finished', {
    shopId,
    mode: opts.mode,
    fetched,
    synced,
    removed,
    lostWebhookChanges,
    enqueued,
    deletionChecks,
    pageFailed,
    budgetStopped,
    writeErrors,
  });
  publishLive(userId, { type: 'sync', kind: complete ? 'finished' : 'failed', scope: LISTINGS_LIVE_SCOPE, processed: fetched });

  return {
    success: complete,
    partial: !complete,
    synced,
    fetched,
    errors: errors.slice(0, 50),
    removed,
    lastSyncAt,
    lostWebhookChanges,
    enqueued,
    deletionChecks,
  };
}
