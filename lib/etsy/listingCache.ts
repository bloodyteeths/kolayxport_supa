/**
 * Always-fresh Etsy listing cache (owner W3).
 *
 *  refreshListingFull      two Etsy calls (getListing includes=Images,Videos + getListingInventory;
 *                          separate-endpoint fallback), timestamp-guarded upsert
 *                          (`WHERE etsyUpdatedTimestamp <= incoming`), offering
 *                          cache keyed by variantKey, versioning with attribution,
 *                          SEO cohort upsert. A 404 returns { deleted: true }
 *                          (removal side effects are the caller's job).
 *  handleEtsyListingEvent  webhook handler for listing:* resources (dispatched by
 *                          the W1 worker): refresh -> draft conflicts -> alerts ->
 *                          W2 observeEtsyOfferings -> live event.
 *  ensureListingsCached    fills cache holes (e.g. listing ids referenced by orders).
 *  reconcileShopListings   nightly / manual / initial full pass (lib/etsy/listingReconcile.ts).
 *
 * Never throws for alert/live/SEO side effects; Etsy/DB failures of the refresh
 * itself do throw (the worker retries). EtsyDeferError is thrown for
 * min-interval and stock lock-busy defers (no attempt consumed).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { EtsyEventContext, HandlerOutcome } from './webhooks/types';
import { EtsyDeferError } from './webhooks/types';
import type { EtsyOfferingObservation } from '@/lib/stock/types';
import { etsyFetch, etsyAuthHeaders } from './http';
import {
  buildOfferingRows,
  buildSnapshot,
  contentHash,
  extractImages,
  extractInventory,
  extractVideos,
  fillMissingParts,
  hasVariationsFromInventory,
  listingRowFromEtsy,
  offeringObservations,
  quantityOnPropertyFromInventory,
  type ListingSnapshot,
  type OfferingRow,
} from './listingNormalize';
import { attributeChange, type Attribution } from './attribution';
import { captureVersion, captureTombstone, getLatestVersion } from './listingHistory';
import { checkDraftConflicts, hasOpenDraft, markOpenDraftsConflict } from './draftConflicts';
import {
  decideListingAlerts,
  emitListingAlerts,
  emitListingDeleted,
  hasRecentOrderForListing,
  liveKindFor,
  publishListingLive,
  wasDeletedByKolayxport,
} from './listingAlerts';
import { upsertSeoCohort } from './seoExperiments';
import { queueHealthRefresh } from '@/lib/listings/healthQueue';
import { ETSY_OPENAPI_BASE } from '@/lib/etsy/apiBase';

export type RefreshListingSource = 'webhook' | 'reconcile' | 'draft_sync' | 'initial' | 'manual_refresh';

export type RefreshListingResult = {
  listing: any | null;
  deleted: boolean;
  /** true when the cached row was newer than the fetched one (timestamp guard). */
  stale: boolean;
  versionId: string | null;
  offerings: EtsyOfferingObservation[] | null;
  remoteUpdatedTs: number | null;
};

export const ETSY_API_BASE = ETSY_OPENAPI_BASE;
/** Refreshes of one listing are at least this far apart (webhook path). */
export const MIN_REFRESH_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Etsy fetch
// ---------------------------------------------------------------------------

class EtsyHttpError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Etsy API error: ${status} - ${body.slice(0, 300)}`);
    this.status = status;
  }
}

async function etsyGet(path: string, accessToken: string): Promise<any | null> {
  const res = await etsyFetch(`${ETSY_API_BASE}${path}`, { method: 'GET', headers: etsyAuthHeaders(accessToken) });
  if (res.status === 404 || res.status === 410) {
    await res.text().catch(() => undefined);
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new EtsyHttpError(res.status, text);
  }
  return res.json();
}

let fallbackLogged = false;

export type FetchedListing = { listing: any; images: any[] | null; inventory: any | null; videos: any[] | null };

/** One call normally; separate endpoints when includes did not come back. null = 404. */
export async function fetchListingFull(listingId: bigint | string, accessToken: string): Promise<FetchedListing | null> {
  // getListing's includes enum has no Inventory (Etsy 400s on it); inventory
  // always comes from its own endpoint below.
  const listing = await etsyGet(`/listings/${listingId}?includes=Images,Videos`, accessToken);
  if (!listing) return null;
  let images = extractImages(listing);
  let inventory = extractInventory(listing);
  const videos = extractVideos(listing);
  if (images === null || inventory === null) {
    if (images === null && !fallbackLogged) {
      fallbackLogged = true;
      logger.warn('Etsy getListing includes missing; using separate image/inventory endpoints', {
        listingId: String(listingId),
        hasImages: images !== null,
        hasInventory: inventory !== null,
      });
    }
    if (images === null) {
      try {
        const r = await etsyGet(`/listings/${listingId}/images`, accessToken);
        images = Array.isArray(r?.results) ? r.results : null;
      } catch (err: any) {
        logger.warn('Etsy image fetch fallback failed', { listingId: String(listingId), error: err?.message });
      }
    }
    if (inventory === null) {
      try {
        const r = await etsyGet(`/listings/${listingId}/inventory`, accessToken);
        inventory = r && Array.isArray(r.products) ? r : null;
      } catch (err: any) {
        logger.warn('Etsy inventory fetch fallback failed', { listingId: String(listingId), error: err?.message });
      }
    }
  }
  return { listing, images, inventory, videos };
}

// ---------------------------------------------------------------------------
// Guarded write
// ---------------------------------------------------------------------------

type ExistingRow = {
  id: string;
  etsyUpdatedTimestamp: number;
  contentHash: string | null;
  state: string;
  title: string;
  lastRefreshAt: Date | null;
};

const EXISTING_SELECT = {
  id: true,
  etsyUpdatedTimestamp: true,
  contentHash: true,
  state: true,
  title: true,
  lastRefreshAt: true,
} as const;

export type ApplyResult = {
  stale: boolean;
  created: boolean;
  prevState: string | null;
  newState: string;
  title: string;
  remoteUpdatedTs: number;
  attribution: Attribution | null;
  versionId: string | null;
  changedKeys: string[];
  baseline: boolean;
  offeringRows: OfferingRow[] | null;
  /** remote change seen (newer updated_timestamp or new content) */
  changed: boolean;
};

async function getExisting(shopId: string, listingId: bigint): Promise<ExistingRow | null> {
  return prisma.etsyListing.findUnique({
    where: { etsyShopId_etsyListingId: { etsyShopId: shopId, etsyListingId: listingId } },
    select: EXISTING_SELECT,
  });
}

async function writeOfferings(shopId: string, listingId: bigint, rows: OfferingRow[], remoteUpdatedTs: number) {
  const now = new Date();
  const keys = rows.map((r) => r.variantKey);
  const ops: any[] = rows.map((r) => {
    const data = {
      variantValueKey: r.variantValueKey,
      productId: r.productId ? BigInt(r.productId) : null,
      offeringId: r.offeringId ? BigInt(r.offeringId) : null,
      sku: r.sku,
      skuNormalized: r.skuNormalized,
      quantity: r.quantity,
      isEnabled: r.isEnabled,
      priceAmount: r.priceAmount,
      priceDivisor: r.priceDivisor,
      propertyValues: r.propertyValues as any,
      remoteUpdatedTs,
      syncedAt: now,
    };
    return prisma.etsyListingOffering.upsert({
      where: { etsyShopId_etsyListingId_variantKey: { etsyShopId: shopId, etsyListingId: listingId, variantKey: r.variantKey } },
      create: { etsyShopId: shopId, etsyListingId: listingId, variantKey: r.variantKey, ...data },
      update: data,
    });
  });
  ops.push(
    prisma.etsyListingOffering.deleteMany({
      where: { etsyShopId: shopId, etsyListingId: listingId, ...(keys.length ? { variantKey: { notIn: keys } } : {}) },
    }),
  );
  // Chunk very large variation matrices.
  for (let i = 0; i < ops.length; i += 200) await prisma.$transaction(ops.slice(i, i + 200));
}

/**
 * Write one fetched listing through the timestamp guard, then offerings,
 * attribution and versioning. Shared by refresh (webhook/draft/manual) and the
 * reconcile pass.
 */
export async function applyListingPayload(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  fetched: FetchedListing;
  source: RefreshListingSource;
  draftId?: string;
  syncAttemptId?: string;
  webhookEventId?: string;
  existing?: ExistingRow | null;
}): Promise<ApplyResult> {
  const { listing, images, inventory, videos } = a.fetched;
  const existing = a.existing !== undefined ? a.existing : await getExisting(a.shopId, a.listingId);
  const row = listingRowFromEtsy(listing, images);
  const incomingTs = row.etsyUpdatedTimestamp;
  const now = new Date();

  // The latest recorded version is the source of truth for history + alerts,
  // not the cache row: the guarded update below commits contentHash/state
  // before offerings/version/alerts run, so a retry after a crash in between
  // must still see the change (prev = last version, not the already-updated row).
  const latest = await getLatestVersion(a.shopId, a.listingId);
  let snapshot: ListingSnapshot = buildSnapshot(listing, images, inventory, videos);
  if (snapshot.images === null || snapshot.offerings === null || snapshot.videoIds === null) {
    snapshot = fillMissingParts(snapshot, (latest?.snapshot as unknown as ListingSnapshot) || null);
  }
  const hash = contentHash(snapshot);

  const data: Record<string, any> = {
    ...row,
    contentHash: hash,
    lastRefreshAt: now,
    syncedAt: now,
    ...(inventory
      ? {
          hasVariations: hasVariationsFromInventory(inventory),
          quantityOnProperty: quantityOnPropertyFromInventory(inventory),
          inventorySyncedAt: now,
        }
      : {}),
    ...(a.source === 'webhook' ? { lastWebhookAt: now } : {}),
  };

  let created = false;
  let current = existing;
  if (!current) {
    try {
      await prisma.etsyListing.create({
        data: { etsyShopId: a.shopId, etsyListingId: a.listingId, ...(data as any) },
      });
      created = true;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      current = await getExisting(a.shopId, a.listingId); // raced with another writer
    }
  }
  if (!created && current) {
    if (current.state !== row.state) data.stateChangedAt = now;
    const res = await prisma.etsyListing.updateMany({
      where: { etsyShopId: a.shopId, etsyListingId: a.listingId, etsyUpdatedTimestamp: { lte: incomingTs } },
      data: data as any,
    });
    if (res.count === 0) {
      return {
        stale: true,
        created: false,
        prevState: current.state,
        newState: current.state,
        title: current.title,
        remoteUpdatedTs: incomingTs,
        attribution: null,
        versionId: null,
        changedKeys: [],
        baseline: false,
        offeringRows: null,
        changed: false,
      };
    }
  }

  const offeringRows = inventory ? buildOfferingRows(inventory) : null;
  if (offeringRows) await writeOfferings(a.shopId, a.listingId, offeringRows, incomingTs);

  // versionBehind: the cache row already carries this hash but the version /
  // alerts for it were never recorded (side effects interrupted on a prior try).
  const versionBehind = !!current && !!latest && latest.contentHash !== hash;
  const hashChanged = !current || current.contentHash !== hash || versionBehind;
  const tsAdvanced = !current || incomingTs > (current.etsyUpdatedTimestamp || 0);
  // prevState for alerts: the state of the last version when it lags the row.
  const prevState: string | null = current ? (versionBehind && latest?.state ? latest.state : current.state) : null;
  let att: Awaited<ReturnType<typeof attributeChange>> | null = null;
  if (hashChanged || tsAdvanced || a.draftId) {
    att = await attributeChange(a.shopId, a.listingId, incomingTs, {
      source: a.source,
      draftId: a.draftId,
      syncAttemptId: a.syncAttemptId,
    });
  }
  const attribution: Attribution | null = att?.attribution ?? null;

  let versionId: string | null = null;
  let changedKeys: string[] = [];
  let baseline = false;
  if (hashChanged && att) {
    // History must never fail (and endlessly retry) the cache refresh itself.
    const v = await captureVersion({
      userId: a.userId,
      shopId: a.shopId,
      listingId: a.listingId,
      // Diff against the last recorded version (falls back to the row hash only
      // when the listing has no version yet).
      prevHash: latest?.contentHash ?? current?.contentHash ?? null,
      // 'created' only for a listing that appears through a live event.
      isNewListing: created && (a.source === 'webhook' || a.source === 'draft_sync'),
      snapshot,
      hash,
      remoteUpdatedTs: incomingTs,
      source: a.source,
      attribution: att.attribution,
      draftId: att.draftId ?? a.draftId ?? null,
      syncAttemptId: att.syncAttemptId ?? a.syncAttemptId ?? null,
      stockPushId: att.stockPushId ?? null,
      webhookEventId: a.webhookEventId ?? null,
    }).catch((err: any) => {
      logger.warn('captureVersion failed', { shopId: a.shopId, listingId: String(a.listingId), error: err?.message });
      return null;
    });
    if (v) {
      versionId = v.versionId;
      changedKeys = v.changedKeys;
      baseline = v.baseline;
      if (!v.baseline && a.source !== 'initial') {
        await upsertSeoCohort({
          userId: a.userId,
          shopId: a.shopId,
          listingId: a.listingId,
          versionId: v.versionId,
          changedKeys: v.changedKeys,
          batchKey: v.batchKey,
          changedAt: incomingTs ? new Date(incomingTs * 1000) : now,
          state: row.state,
        });
      }
    }
  }

  // Listing health (listings-grid §9.3). Reconcile/initial batch their own ids at the end of the run.
  if (a.source !== 'reconcile' && a.source !== 'initial' && (hashChanged || tsAdvanced || created)) {
    queueHealthRefresh('etsy', a.shopId, a.userId, [a.listingId]);
  }

  return {
    stale: false,
    created,
    prevState,
    newState: row.state,
    title: row.title,
    remoteUpdatedTs: incomingTs,
    attribution,
    versionId,
    changedKeys,
    baseline,
    offeringRows,
    changed: hashChanged || tsAdvanced,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type DetailedRefresh = ApplyResult & { deleted: boolean; listing: any | null };

export async function refreshListingDetailed(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  accessToken: string;
  source: RefreshListingSource;
  draftId?: string;
  syncAttemptId?: string;
  webhookEventId?: string;
}): Promise<DetailedRefresh> {
  const existing = await getExisting(a.shopId, a.listingId);
  if ((a.source === 'webhook' || a.source === 'reconcile') && existing?.lastRefreshAt) {
    const since = Date.now() - existing.lastRefreshAt.getTime();
    if (since >= 0 && since < MIN_REFRESH_INTERVAL_MS && a.source === 'webhook') {
      throw new EtsyDeferError('min_interval', MIN_REFRESH_INTERVAL_MS - since);
    }
  }
  const fetched = await fetchListingFull(a.listingId, a.accessToken);
  if (!fetched) {
    return {
      deleted: true,
      listing: null,
      stale: false,
      created: false,
      prevState: existing?.state ?? null,
      newState: 'removed',
      title: existing?.title ?? '',
      remoteUpdatedTs: 0,
      attribution: null,
      versionId: null,
      changedKeys: [],
      baseline: false,
      offeringRows: null,
      changed: true,
    };
  }
  const remoteShop = fetched.listing?.shop_id;
  if (remoteShop !== undefined && remoteShop !== null && String(remoteShop) !== String(a.shopId)) {
    // Not this shop's listing (e.g. an order line from another connected shop): never cache it here.
    logger.warn('refreshListing: listing belongs to another shop', { shopId: a.shopId, listingId: String(a.listingId) });
    return {
      deleted: false,
      listing: fetched.listing,
      stale: true,
      created: false,
      prevState: existing?.state ?? null,
      newState: existing?.state ?? 'unknown',
      title: existing?.title ?? '',
      remoteUpdatedTs: 0,
      attribution: null,
      versionId: null,
      changedKeys: [],
      baseline: false,
      offeringRows: null,
      changed: false,
    };
  }
  const applied = await applyListingPayload({ ...a, fetched, existing });
  return { ...applied, deleted: false, listing: fetched.listing };
}

export async function refreshListingFull(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  accessToken: string;
  source: RefreshListingSource;
  draftId?: string;
  syncAttemptId?: string;
  webhookEventId?: string;
}): Promise<RefreshListingResult> {
  const r = await refreshListingDetailed(a);
  if (r.deleted) {
    return { listing: null, deleted: true, stale: false, versionId: null, offerings: null, remoteUpdatedTs: null };
  }
  const offerings = r.offeringRows ? offeringObservations(r.offeringRows) : null;
  if (!r.stale && a.source !== 'webhook') {
    // Webhook callers (handleEtsyListingEvent) publish their own, more specific event.
    publishListingLive(a.userId, {
      kind: r.created ? 'created' : 'updated',
      shopId: a.shopId,
      listingId: a.listingId,
      title: r.title,
      state: r.newState,
      attribution: r.attribution,
      versionId: r.versionId,
    });
  }
  if (!r.stale && a.source === 'draft_sync' && offerings) {
    // Our own inventory write: let stock sync see it (echo detection). Disabled no-op unless live.
    try {
      const { observeEtsyOfferings } = await import('@/lib/stock/hooks');
      await observeEtsyOfferings({
        userId: a.userId,
        shopId: a.shopId,
        listingId: String(a.listingId),
        listingState: r.newState,
        remoteUpdatedTs: r.remoteUpdatedTs,
        offerings,
        source: 'draft_sync',
      });
    } catch (err: any) {
      logger.warn('observeEtsyOfferings(draft_sync) failed', { shopId: a.shopId, listingId: String(a.listingId), error: err?.message });
    }
  }
  return {
    listing: r.listing,
    deleted: false,
    stale: r.stale,
    versionId: r.versionId,
    offerings,
    remoteUpdatedTs: r.remoteUpdatedTs || null,
  };
}

/**
 * Removal side effects for a listing that is gone on Etsy (delete event or 404):
 * tombstone version, cache rows deleted, open drafts conflicted, stock observes
 * 'removed', listingDeleted alert (unless KolayXport deleted it), live event.
 */
export async function handleListingRemoved(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  source: RefreshListingSource;
  webhookEventId?: string;
  /**
   * false = do not call W2 observeEtsyOfferings here. The reconcile/initial
   * passes never observe stock (spec T7); they enqueue a synthetic
   * 'reconcile.changed' event instead and the webhook worker's 404 path
   * observes 'removed'.
   */
  observeStock?: boolean;
}): Promise<{ draftsConflicted: number; hadCache: boolean }> {
  const cached = await prisma.etsyListing.findUnique({
    where: { etsyShopId_etsyListingId: { etsyShopId: a.shopId, etsyListingId: a.listingId } },
    select: { title: true, state: true },
  });
  const ours = await wasDeletedByKolayxport(a.shopId, a.listingId);
  const priorVersions = cached ? 1 : await prisma.etsyListingVersion.count({ where: { etsyShopId: a.shopId, etsyListingId: a.listingId } });
  if (cached || priorVersions > 0) {
    await captureTombstone({
      userId: a.userId,
      shopId: a.shopId,
      listingId: a.listingId,
      source: a.source,
      attribution: ours ? 'kolayxport_draft' : a.source === 'reconcile' || a.source === 'initial' ? 'unknown' : 'external',
      title: cached?.title ?? null,
      webhookEventId: a.webhookEventId ?? null,
    });
  }
  await prisma.etsyListingOffering.deleteMany({ where: { etsyShopId: a.shopId, etsyListingId: a.listingId } });
  await prisma.etsyListing.deleteMany({ where: { etsyShopId: a.shopId, etsyListingId: a.listingId } });
  const draftsConflicted = await markOpenDraftsConflict(a.shopId, a.listingId, 'etsy.draftSync.deletedOnEtsy');
  const observeStock = a.observeStock ?? !(a.source === 'reconcile' || a.source === 'initial');
  if (observeStock) {
    try {
      const { observeEtsyOfferings } = await import('@/lib/stock/hooks');
      await observeEtsyOfferings({
        userId: a.userId,
        shopId: a.shopId,
        listingId: String(a.listingId),
        listingState: 'removed',
        remoteUpdatedTs: Math.floor(Date.now() / 1000),
        offerings: [],
        source: 'webhook',
        eventId: a.webhookEventId,
      });
    } catch (err: any) {
      logger.warn('observeEtsyOfferings(removed) failed', { shopId: a.shopId, listingId: String(a.listingId), error: err?.message });
    }
  }
  if (cached) {
    await emitListingDeleted({ userId: a.userId, shopId: a.shopId, listingId: a.listingId, title: cached.title, suppress: ours });
  }
  publishListingLive(a.userId, { kind: 'deleted', shopId: a.shopId, listingId: a.listingId, title: cached?.title ?? null, state: 'removed' });
  return { draftsConflicted, hadCache: !!cached };
}

const CONFLICT_EVENT_TYPES = ['listing.created', 'listing.updated', 'reconcile.changed'];

export async function handleEtsyListingEvent(ctx: EtsyEventContext & { listingId: bigint }): Promise<HandlerOutcome> {
  const { userId, shopId, listingId } = ctx;
  const types = ctx.eventTypes || new Set<string>();

  if (types.has('listing.deleted')) {
    const r = await handleListingRemoved({ userId, shopId, listingId, source: 'webhook', webhookEventId: ctx.eventId });
    return { outcome: 'done', note: `deleted${r.draftsConflicted ? `,drafts_conflicted=${r.draftsConflicted}` : ''}` };
  }

  const { getEtsyAccessToken } = await import('./etsyToken');
  const accessToken = await getEtsyAccessToken(shopId, userId);
  const r = await refreshListingDetailed({ userId, shopId, listingId, accessToken, source: 'webhook', webhookEventId: ctx.eventId });

  if (r.deleted) {
    const rem = await handleListingRemoved({ userId, shopId, listingId, source: 'webhook', webhookEventId: ctx.eventId });
    return { outcome: 'done', note: `gone_404${rem.draftsConflicted ? `,drafts_conflicted=${rem.draftsConflicted}` : ''}` };
  }
  if (r.stale) return { outcome: 'done', note: 'stale' };

  const notes: string[] = [];
  if (r.attribution) notes.push(`attr=${r.attribution}`);
  if (r.versionId) notes.push(`version`);

  // Draft conflicts (only for listing-level events, like the old processor:
  // a sale's inventory.updated alone must not conflict drafts).
  if (CONFLICT_EVENT_TYPES.some((t) => types.has(t)) || r.changedKeys.length > 0) {
    try {
      const n = await checkDraftConflicts(shopId, listingId, r.listing, { attribution: r.attribution });
      if (n) notes.push(`drafts_conflicted=${n}`);
    } catch (err: any) {
      logger.warn('checkDraftConflicts failed', { shopId, listingId: String(listingId), error: err?.message });
    }
  }

  // Alerts
  let alerts: ReturnType<typeof decideListingAlerts> = [];
  try {
    const transitionToInactive = r.prevState === 'active' && r.newState === 'inactive';
    const externalEdit = r.attribution === 'external' && r.changedKeys.length > 0;
    const oos = types.has('inventory.out_of_stock');
    const [recentOrder, openDraft, managed] = await Promise.all([
      transitionToInactive ? hasRecentOrderForListing(userId, listingId) : Promise.resolve(false),
      externalEdit ? hasOpenDraft(shopId, listingId) : Promise.resolve(false),
      oos
        ? import('@/lib/stock/hooks').then((m) => m.isListingStockManaged(userId, shopId, String(listingId))).catch(() => false)
        : Promise.resolve(false),
    ]);
    alerts = decideListingAlerts({
      prevState: r.created ? null : r.prevState,
      newState: r.newState,
      attribution: r.attribution || 'unknown',
      source: 'webhook',
      changedKeys: r.changedKeys,
      eventTypes: types,
      recentOrderForListing: recentOrder,
      hasOpenDraft: openDraft,
      stockManaged: managed,
    });
    if (alerts.length || (r.prevState && r.prevState !== r.newState)) {
      await emitListingAlerts({
        userId,
        shopId,
        listingId,
        title: r.title,
        alerts,
        newState: r.newState,
        prevState: r.prevState,
        changedKeys: r.changedKeys,
        outOfStockSku: oos
          ? (r.offeringRows || [])
              .filter((o) => o.quantity <= 0 && o.sku)
              .map((o) => o.sku as string)
              .slice(0, 3)
              .join(', ') || null
          : null,
      });
      if (alerts.length) notes.push(`alerts=${alerts.join('+')}`);
    }
  } catch (err: any) {
    logger.warn('listing alerts failed', { shopId, listingId: String(listingId), error: err?.message });
  }

  publishListingLive(userId, {
    kind: r.created ? 'created' : liveKindFor(alerts, 'updated'),
    shopId,
    listingId,
    title: r.title,
    state: r.newState,
    attribution: r.attribution,
    versionId: r.versionId,
  });

  // Stock observation last: a lock-busy defer re-runs the (cheap, idempotent) event.
  if (r.offeringRows) {
    const { observeEtsyOfferings } = await import('@/lib/stock/hooks');
    const obs = await observeEtsyOfferings({
      userId,
      shopId,
      listingId: String(listingId),
      listingState: r.newState,
      remoteUpdatedTs: r.remoteUpdatedTs,
      offerings: offeringObservations(r.offeringRows),
      source: 'webhook',
      eventId: ctx.eventId,
    });
    if (obs.deferMs && obs.deferMs > 0) throw new EtsyDeferError('lock_busy', obs.deferMs, 'stock observation deferred');
    if (obs.observed) notes.push(`stock_observed=${obs.observed}`);
  }

  return { outcome: 'done', note: notes.join(',').slice(0, 180) || undefined };
}

const MISSING_MEMO_MS = 24 * 60 * 60_000;
const missingMemo = new Map<string, number>();

/**
 * Cache listings referenced elsewhere (orders) but missing from EtsyListing.
 * Returns how many were fetched and cached.
 */
export async function ensureListingsCached(shopId: string, ids: bigint[], opts?: { max?: number }): Promise<number> {
  const unique = Array.from(new Set(ids.map((i) => String(i)))).map((s) => BigInt(s));
  if (!unique.length) return 0;
  const shop = await prisma.etsyShop.findUnique({ where: { shopId }, select: { userId: true, isActive: true, needsReauth: true } });
  if (!shop || !shop.isActive || shop.needsReauth) return 0;
  const present = await prisma.etsyListing.findMany({
    where: { etsyShopId: shopId, etsyListingId: { in: unique } },
    select: { etsyListingId: true },
  });
  const have = new Set(present.map((p) => String(p.etsyListingId)));
  const now = Date.now();
  const missing = unique
    .filter((id) => !have.has(String(id)) && !(now - (missingMemo.get(`${shopId}:${id}`) || 0) < MISSING_MEMO_MS))
    .slice(0, Math.max(1, Math.min(opts?.max ?? 20, 100)));
  if (!missing.length) return 0;
  const { getEtsyAccessToken } = await import('./etsyToken');
  const accessToken = await getEtsyAccessToken(shopId, shop.userId);
  let cached = 0;
  for (const listingId of missing) {
    try {
      const r = await refreshListingDetailed({ userId: shop.userId, shopId, listingId, accessToken, source: 'reconcile' });
      if (!r.deleted && !r.stale) cached++;
      else {
        if (missingMemo.size > 5000) missingMemo.clear();
        missingMemo.set(`${shopId}:${listingId}`, Date.now()); // deleted / other shop: do not re-ask for a day
      }
    } catch (err: any) {
      if (err?.name === 'EtsyDeferError') throw err;
      logger.warn('ensureListingsCached: refresh failed', { shopId, listingId: String(listingId), error: err?.message });
    }
  }
  return cached;
}

export { reconcileShopListings } from './listingReconcile';
