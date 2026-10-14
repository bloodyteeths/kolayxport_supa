import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logIntegrationEvent } from '@/lib/admin/events';
import { getEtsyAccessToken } from '@/lib/etsy/etsyToken';
import { refreshListingCache, remoteChangedKeys } from '@/lib/etsy/draftService';
import { fetchSingleEtsyReceipt } from '@/lib/integrations/etsyOrderSync';
import { sendEmail } from '@/lib/auth/email';
import enMessages from '@/messages/en.json';
import trMessages from '@/messages/tr.json';

/**
 * Etsy webhook queue processor.
 *
 * Events are stored by /api/webhooks/etsy as WebhookEvent rows
 * (provider='etsy', status='received'). This module drains them, either kicked
 * in-process right after receipt (debounced) or by the
 * /api/cron/process-etsy-webhooks sweeper.
 *
 * Lifecycle: received -> processing -> done | ignored | failed
 *            (failure with attempts left -> received + nextAttemptAt backoff)
 *
 * Etsy delivers at-least-once and unordered; dedupe happens at insert time on
 * the webhook-id. Bursts for the same listing/receipt are coalesced here: only
 * the newest due event per (shop, resourceKey) is processed, older ones are
 * closed as 'done' with a "coalesced" note.
 */

export const ETSY_WEBHOOK_PROVIDER = 'etsy';
export const MAX_ATTEMPTS = 6;
/** Delay before attempt N+1 (index = attempts already made, 1-based). */
const BACKOFF_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
/** A 'processing' row older than this was orphaned by a restart. */
const STALE_PROCESSING_MS = 10 * 60_000;
/** Our own draft sync finishing within this window explains a listing.updated. */
const OWN_SYNC_WINDOW_MS = 90_000;
/** At most one out-of-stock email per listing within this window. */
const OUT_OF_STOCK_NOTIFY_WINDOW_MS = 6 * 60 * 60_000;
const OPEN_DRAFT_STATUSES = ['draft', 'failed'];

export const LISTING_EVENTS = new Set(['listing.created', 'listing.updated', 'listing.deleted']);
export const INVENTORY_EVENTS = new Set(['inventory.created', 'inventory.updated', 'inventory.deleted', 'inventory.out_of_stock']);
export const ORDER_EVENTS = new Set(['order.paid', 'order.canceled', 'order.shipped', 'order.delivered']);

export function isSupportedEtsyEvent(eventType: string): boolean {
  return LISTING_EVENTS.has(eventType) || INVENTORY_EVENTS.has(eventType) || ORDER_EVENTS.has(eventType);
}

function digits(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  return null;
}

export function receiptIdFromPayload(payload: any): string | null {
  const direct = digits(payload?.receipt_id);
  if (direct) return direct;
  const url = typeof payload?.resource_url === 'string' ? payload.resource_url : '';
  const m = url.match(/\/receipts\/(\d+)/);
  return m ? m[1] : null;
}

export function listingIdFromPayload(payload: any): string | null {
  const direct = digits(payload?.listing_id);
  if (direct) return direct;
  const url = typeof payload?.resource_url === 'string' ? payload.resource_url : '';
  const m = url.match(/\/listings\/(\d+)/);
  return m ? m[1] : null;
}

/** Coalescing key: listing + inventory events share one per listing. */
export function resourceKeyFor(eventType: string, payload: any): string | null {
  if (LISTING_EVENTS.has(eventType) || INVENTORY_EVENTS.has(eventType)) {
    const id = listingIdFromPayload(payload);
    return id ? `listing:${id}` : null;
  }
  if (ORDER_EVENTS.has(eventType)) {
    const id = receiptIdFromPayload(payload);
    return id ? `receipt:${id}` : null;
  }
  return null;
}

class IgnoreEvent extends Error {}

function isEtsy404(err: any) {
  return /Etsy API error: 404/.test(String(err?.message || ''));
}

type EventRow = {
  id: string;
  eventType: string | null;
  shopId: string | null;
  resourceKey: string | null;
  payload: Prisma.JsonValue;
  attempts: number;
  createdAt: Date;
};

type RunContext = {
  /** Users whose Etsy order sync already ran in this pass (new-order path). */
  orderSyncedUsers: Set<string>;
};

export type ProcessResult = {
  claimed: number;
  done: number;
  ignored: number;
  retried: number;
  failed: number;
  coalesced: number;
  recovered: number;
};

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function markOpenDraftsConflict(shopId: string, listingId: bigint, reasonKey: string, draftIds?: string[]) {
  const res = await prisma.etsyListingDraft.updateMany({
    where: {
      etsyShopId: shopId,
      etsyListingId: listingId,
      status: { in: OPEN_DRAFT_STATUSES },
      ...(draftIds ? { id: { in: draftIds } } : {}),
    },
    data: { status: 'conflict', lastSyncError: reasonKey },
  });
  return res.count;
}

function isEmptyJson(v: any) {
  return v == null || (typeof v === 'object' && Object.keys(v).length === 0);
}

/**
 * After a remote listing change: flag open drafts whose base is older than the
 * live listing, unless our own sync explains the change or the remote change
 * provably doesn't touch anything the draft edits.
 */
async function checkDraftConflicts(shopId: string, listingId: bigint, remote: any, emittedAt: Date) {
  const remoteUpdated = Number(remote?.updated_timestamp || 0);
  if (!remoteUpdated) return 0;

  const drafts = await prisma.etsyListingDraft.findMany({
    where: { etsyShopId: shopId, etsyListingId: listingId, status: { in: OPEN_DRAFT_STATUSES } },
    include: { _count: { select: { media: true } } },
  });
  if (drafts.length === 0) return 0;

  // Our own sync (running now, or finished just before/after Etsy emitted the
  // event) changed the listing — not a third-party edit.
  const ownSync = await prisma.etsyDraftSyncAttempt.findFirst({
    where: {
      draft: { etsyShopId: shopId, etsyListingId: listingId },
      OR: [
        { status: 'running', startedAt: { gte: new Date(Date.now() - STALE_PROCESSING_MS) } },
        { finishedAt: { gte: new Date(emittedAt.getTime() - OWN_SYNC_WINDOW_MS) } },
      ],
    },
    select: { id: true },
  });
  if (ownSync) return 0;

  const conflicted: string[] = [];
  for (const draft of drafts) {
    const base = draft.baseEtsyUpdatedTimestamp || 0;
    if (!base || remoteUpdated <= base) continue;

    const queued = Array.isArray(draft.queuedActions) ? (draft.queuedActions as any[]) : [];
    const otherPatchesEmpty = isEmptyJson(draft.taxonomyPatch) && isEmptyJson(draft.inventoryPatch)
      && isEmptyJson(draft.personalizationPatch) && isEmptyJson(draft.variationImagesPatch) && queued.length === 0;
    const fieldKeys = Object.keys((draft.fieldPatch as any) || {});

    // Media-only drafts: the sync engine validates live media ids and skips
    // the conflict check — mirror that.
    if (otherPatchesEmpty && fieldKeys.length === 0 && draft._count.media > 0) continue;

    // Field-only drafts: a sale bumps updated_timestamp without touching the
    // fields this draft edits — the sync engine would just re-base.
    if (otherPatchesEmpty && fieldKeys.length > 0) {
      const changed = remoteChangedKeys(draft.baseSnapshot, remote, fieldKeys);
      if (changed && changed.length === 0) continue;
    }
    conflicted.push(draft.id);
  }
  if (conflicted.length === 0) return 0;
  return markOpenDraftsConflict(shopId, listingId, 'etsy.draftSync.remoteChanged', conflicted);
}

async function handleListingDeleted(shopId: string, listingId: bigint) {
  await prisma.etsyListing.deleteMany({ where: { etsyShopId: shopId, etsyListingId: listingId } });
  return markOpenDraftsConflict(shopId, listingId, 'etsy.draftSync.deletedOnEtsy');
}

function t(messages: any, key: 'outOfStockSubject' | 'outOfStockBody', vars: Record<string, string>): string {
  const template: string = messages?.etsy?.webhooks?.[key] || '';
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

async function notifyOutOfStock(userId: string, shopId: string, listingId: bigint, resourceKey: string, eventId: string) {
  const recent = await prisma.webhookEvent.findFirst({
    where: {
      provider: ETSY_WEBHOOK_PROVIDER,
      shopId,
      resourceKey,
      errorMessage: 'note:out_of_stock_notified',
      processedAt: { gte: new Date(Date.now() - OUT_OF_STOCK_NOTIFY_WINDOW_MS) },
      NOT: { id: eventId },
    },
    select: { id: true },
  });
  if (recent) return false;

  const [user, listing] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.etsyListing.findUnique({
      where: { etsyShopId_etsyListingId: { etsyShopId: shopId, etsyListingId: listingId } },
      select: { title: true, url: true },
    }),
  ]);
  if (!user?.email) return false;

  // No per-user locale is stored, so the email carries Turkish then English.
  const vars = {
    title: (listing?.title || `#${listingId}`).slice(0, 120),
    url: listing?.url || `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`,
  };
  const subject = `${t(trMessages, 'outOfStockSubject', vars)} / ${t(enMessages, 'outOfStockSubject', vars)}`.slice(0, 200);
  const textBody = `${t(trMessages, 'outOfStockBody', vars)}\n\n---\n\n${t(enMessages, 'outOfStockBody', vars)}`;
  const result = await sendEmail({ to: user.email, subject, textBody });
  return result.sent;
}

async function handleListingGroup(
  row: EventRow,
  userId: string,
  shopId: string,
  groupTypes: Set<string>,
): Promise<{ note?: string }> {
  const listingIdStr = listingIdFromPayload(row.payload);
  if (!listingIdStr) throw new IgnoreEvent('no listing_id');
  const listingId = BigInt(listingIdStr);
  const eventType = row.eventType || '';

  if (eventType === 'listing.deleted') {
    const n = await handleListingDeleted(shopId, listingId);
    return { note: n ? `note:deleted,drafts_conflicted=${n}` : 'note:deleted' };
  }

  const accessToken = await getEtsyAccessToken(shopId, userId);
  let remote: any;
  try {
    remote = await refreshListingCache(shopId, listingId, accessToken);
  } catch (err) {
    if (isEtsy404(err)) {
      // Gone on Etsy (deleted, or the delete event was lost/out of order).
      const n = await handleListingDeleted(shopId, listingId);
      return { note: n ? `note:gone_404,drafts_conflicted=${n}` : 'note:gone_404' };
    }
    throw err;
  }

  let note: string | undefined;
  if (groupTypes.has('listing.created') || groupTypes.has('listing.updated')) {
    const n = await checkDraftConflicts(shopId, listingId, remote, emittedAtOf(row));
    if (n) note = `note:drafts_conflicted=${n}`;
  }

  if (groupTypes.has('inventory.out_of_stock')) {
    try {
      const sent = await notifyOutOfStock(userId, shopId, listingId, row.resourceKey || `listing:${listingIdStr}`, row.id);
      if (sent) note = 'note:out_of_stock_notified';
    } catch (err) {
      // Notification failure must not fail (and re-run) the cache refresh.
      logIntegrationEvent('warn', {
        message: 'Etsy out-of-stock notification failed',
        operation: 'etsy.webhook.notify_failed',
        userId,
        details: { eventId: row.id },
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
  return { note };
}

async function handleOrder(row: EventRow, userId: string, shopId: string, ctx: RunContext): Promise<{ note?: string }> {
  const receiptId = receiptIdFromPayload(row.payload);
  if (!receiptId) throw new IgnoreEvent('no receipt id');

  const order = await fetchSingleEtsyReceipt(userId, shopId, receiptId);
  if (!order) throw new IgnoreEvent('receipt not found');

  const existing = await prisma.order.findFirst({
    where: { userId, marketplaceKey: order.marketplaceKey },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    // Mirror the fields the bulk sync writes for an existing order. Address /
    // customer name are deliberately not touched: Etsy withholds buyer PII and
    // the Chrome extension enriches them locally.
    const data: Prisma.OrderUpdateInput = {
      status: order.status,
      externalStatus: order.externalStatus,
      currency: order.currency,
      totalPrice: order.totalPrice,
      rawData: order.rawData ? (order.rawData as any) : Prisma.JsonNull,
      updatedAt: new Date(),
    };
    if (order.giftMessage) (data as any).giftMessage = order.giftMessage;
    if (order.customerNote) (data as any).customerNote = order.customerNote;
    if (order.trackingNumber && !existing.trackingNumber) data.trackingNumber = order.trackingNumber;
    await prisma.order.update({ where: { id: existing.id }, data });
    try {
      const { batchExecuteStatusUpdateHook } = await import('@/lib/hooks/statusUpdateHook');
      await batchExecuteStatusUpdateHook([existing.id], userId);
    } catch (err) {
      logIntegrationEvent('warn', {
        message: 'Status update hook failed after Etsy order webhook',
        operation: 'etsy.webhook.status_hook_failed',
        userId,
        details: { eventId: row.id },
      });
    }
    return { note: `note:order_updated,${order.status}` };
  }

  if (row.eventType !== 'order.paid') {
    // Cancel/ship/deliver for an order we never imported (older than the sync
    // window, or the user doesn't sync Etsy orders yet) — nothing to update.
    throw new IgnoreEvent('order not in db');
  }

  // New order: run the regular Etsy order sync so line items, hooks and
  // address enrichment follow exactly the same path. Once per user per pass.
  if (!ctx.orderSyncedUsers.has(userId)) {
    ctx.orderSyncedUsers.add(userId);
    const { syncAllOrders } = await import('@/lib/orderSync');
    await syncAllOrders(userId, { syncType: 'fast', source: 'etsy-api' });
  }
  const created = await prisma.order.findFirst({ where: { userId, marketplaceKey: order.marketplaceKey }, select: { id: true } });
  if (!created) throw new Error('order.paid: order still missing after Etsy order sync');
  return { note: 'note:order_created' };
}

function emittedAtOf(row: EventRow): Date {
  const ts = Number((row.payload as any)?.__webhookTimestamp);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : row.createdAt;
}

// ---------------------------------------------------------------------------
// Queue mechanics
// ---------------------------------------------------------------------------

async function finish(id: string, status: 'done' | 'ignored' | 'failed', extra: { errorMessage?: string | null; userId?: string | null } = {}) {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      status,
      processedAt: new Date(),
      nextAttemptAt: null,
      errorMessage: extra.errorMessage?.slice(0, 200) ?? null,
      ...(extra.userId !== undefined ? { userId: extra.userId } : {}),
    },
  });
}

async function processOne(row: EventRow, groupTypes: Set<string>, ctx: RunContext): Promise<'done' | 'ignored' | 'retried' | 'failed'> {
  const eventType = row.eventType || '';
  const shopId = row.shopId;
  let userId: string | null = null;
  try {
    if (!shopId || !isSupportedEtsyEvent(eventType)) throw new IgnoreEvent('unsupported event');
    const shop = await prisma.etsyShop.findUnique({ where: { shopId }, select: { userId: true, isActive: true } });
    if (!shop || !shop.isActive) throw new IgnoreEvent('unknown or inactive shop');
    userId = shop.userId;

    const { note } = ORDER_EVENTS.has(eventType)
      ? await handleOrder(row, userId, shopId, ctx)
      : await handleListingGroup(row, userId, shopId, groupTypes);
    await finish(row.id, 'done', { errorMessage: note ?? null, userId });
    return 'done';
  } catch (err: any) {
    if (err instanceof IgnoreEvent) {
      await finish(row.id, 'ignored', { errorMessage: `ignored:${err.message}`, userId });
      return 'ignored';
    }
    const message = String(err?.message || err).slice(0, 200);
    // Reconnect needed: retrying can't help until the user re-authorizes.
    const permanent = err?.code === 'ETSY_REAUTH_REQUIRED';
    if (err?.code === 'SHOP_NOT_FOUND') {
      await finish(row.id, 'ignored', { errorMessage: 'ignored:shop not connected', userId });
      return 'ignored';
    }
    if (permanent || row.attempts >= MAX_ATTEMPTS) {
      await finish(row.id, 'failed', { errorMessage: message, userId });
      logIntegrationEvent('error', {
        message: `Etsy webhook ${eventType} failed permanently`,
        operation: 'etsy.webhook.failed',
        userId: userId ?? undefined,
        details: { eventId: row.id, attempts: row.attempts, error: message },
      });
      return 'failed';
    }
    const delay = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)] || 30_000;
    await prisma.webhookEvent.update({
      where: { id: row.id },
      data: { status: 'received', nextAttemptAt: new Date(Date.now() + delay), errorMessage: message, ...(userId ? { userId } : {}) },
    });
    logIntegrationEvent('warn', {
      message: `Etsy webhook ${eventType} failed, retrying`,
      operation: 'etsy.webhook.retry',
      userId: userId ?? undefined,
      details: { eventId: row.id, attempts: row.attempts, retryInMs: delay, error: message },
    });
    return 'retried';
  }
}

let running = false;

/**
 * Drain due Etsy webhook events. Safe to call concurrently (rows are claimed
 * atomically); within one process overlapping calls are skipped.
 */
export async function processEtsyWebhookQueue(opts: { maxEvents?: number; maxApiEvents?: number } = {}): Promise<ProcessResult | { skipped: true }> {
  if (running) return { skipped: true };
  running = true;
  const maxEvents = opts.maxEvents ?? 200;
  const maxApiEvents = opts.maxApiEvents ?? 25;
  const result: ProcessResult = { claimed: 0, done: 0, ignored: 0, retried: 0, failed: 0, coalesced: 0, recovered: 0 };
  const ctx: RunContext = { orderSyncedUsers: new Set() };
  try {
    // Rows orphaned in 'processing' by a restart go back to the queue.
    const recovered = await prisma.webhookEvent.updateMany({
      where: { provider: ETSY_WEBHOOK_PROVIDER, status: 'processing', nextAttemptAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
      data: { status: 'received', nextAttemptAt: new Date() },
    });
    result.recovered = recovered.count;

    const due = await prisma.webhookEvent.findMany({
      where: { provider: ETSY_WEBHOOK_PROVIDER, status: 'received', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: maxEvents,
      select: { id: true, eventType: true, shopId: true, resourceKey: true, payload: true, attempts: true, createdAt: true },
    });

    // Coalesce: newest event per (shop, resourceKey) wins. Events without a
    // key are processed individually.
    const groups = new Map<string, EventRow[]>();
    for (const row of due as EventRow[]) {
      const key = row.resourceKey && row.shopId ? `${row.shopId}|${row.resourceKey}` : `id|${row.id}`;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }

    let apiEvents = 0;
    for (const rows of groups.values()) {
      if (apiEvents >= maxApiEvents) break; // rest stays queued for the next pass
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      let winner = rows[rows.length - 1];
      // Newest-wins is safe for out-of-order delete/update pairs: a refresh of
      // a deleted listing 404s and takes the delete path.
      const groupTypes = new Set(rows.map((r) => r.eventType || ''));

      const claim = await prisma.webhookEvent.updateMany({
        where: { id: winner.id, status: 'received' },
        data: { status: 'processing', attempts: { increment: 1 }, nextAttemptAt: new Date() },
      });
      if (claim.count === 0) continue; // another worker took it
      winner = { ...winner, attempts: winner.attempts + 1 };
      result.claimed++;

      const losers = rows.slice(0, -1).map((r) => r.id);
      if (losers.length) {
        const c = await prisma.webhookEvent.updateMany({
          where: { id: { in: losers }, status: 'received' },
          data: { status: 'done', processedAt: new Date(), nextAttemptAt: null, errorMessage: `coalesced:${winner.id}`.slice(0, 200) },
        });
        result.coalesced += c.count;
      }

      apiEvents++;
      const outcome = await processOne(winner, groupTypes, ctx);
      result[outcome]++;
    }
    return result;
  } finally {
    running = false;
  }
}

let kickTimer: NodeJS.Timeout | null = null;

/**
 * Debounced in-process kick after a webhook is stored. Etsy usually fires
 * listing.updated + inventory.updated together; the short delay lets them
 * coalesce into one Etsy API refresh.
 */
export function kickEtsyWebhookProcessing(delayMs = 3_000) {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    processEtsyWebhookQueue().catch((err) => {
      logIntegrationEvent('error', {
        message: 'Etsy webhook queue pass crashed',
        operation: 'etsy.webhook.pass_crashed',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });
  }, delayMs);
  kickTimer.unref?.();
}
