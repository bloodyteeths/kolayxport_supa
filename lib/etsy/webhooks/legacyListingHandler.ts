/**
 * Listing/inventory webhook handling as it worked before the event backbone
 * (moved verbatim-in-behaviour from processor.ts; owner W1).
 *
 * The worker dispatches listing events to W3's listingCache.handleEtsyListingEvent.
 * This module is ONLY the fallback used while that handler is still the W0 stub
 * (it answers { outcome: 'ignored', note: 'stub:...' }), so merging W1 before
 * W3 never drops today's behaviour: cache refresh, draft conflict marking,
 * delete handling and the out-of-stock email.
 *
 * Delete this file (and the fallback branch in worker.ts) once W3 lands
 * lib/etsy/draftConflicts.ts and a real handleEtsyListingEvent.
 */
import prisma from '@/lib/prisma';
import { logIntegrationEvent } from '@/lib/admin/events';
import { getEtsyAccessToken } from '@/lib/etsy/etsyToken';
import { refreshListingCache, remoteChangedKeys } from '@/lib/etsy/draftService';
import { sendEmail } from '@/lib/auth/email';
import enMessages from '@/messages/en.json';
import trMessages from '@/messages/tr.json';
import type { EtsyEventContext, HandlerOutcome } from './types';
import { ETSY_WEBHOOK_PROVIDER } from './events';

/** Our own draft sync finishing within this window explains a listing.updated. */
const OWN_SYNC_WINDOW_MS = 90_000;
const RUNNING_SYNC_WINDOW_MS = 10 * 60_000;
/** At most one out-of-stock email per listing within this window. */
const OUT_OF_STOCK_NOTIFY_WINDOW_MS = 6 * 60 * 60_000;
const OPEN_DRAFT_STATUSES = ['draft', 'failed'];
export const OUT_OF_STOCK_NOTE = 'note:out_of_stock_notified';

function isEtsy404(err: any) {
  return /Etsy API error: 404/.test(String(err?.message || ''));
}

function isEmptyJson(v: any) {
  return v == null || (typeof v === 'object' && Object.keys(v).length === 0);
}

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

async function checkDraftConflicts(shopId: string, listingId: bigint, remote: any, emittedAt: Date) {
  const remoteUpdated = Number(remote?.updated_timestamp || 0);
  if (!remoteUpdated) return 0;

  const drafts = await prisma.etsyListingDraft.findMany({
    where: { etsyShopId: shopId, etsyListingId: listingId, status: { in: OPEN_DRAFT_STATUSES } },
    include: { _count: { select: { media: true } } },
  });
  if (drafts.length === 0) return 0;

  const ownSync = await prisma.etsyDraftSyncAttempt.findFirst({
    where: {
      draft: { etsyShopId: shopId, etsyListingId: listingId },
      OR: [
        { status: 'running', startedAt: { gte: new Date(Date.now() - RUNNING_SYNC_WINDOW_MS) } },
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
    if (otherPatchesEmpty && fieldKeys.length === 0 && draft._count.media > 0) continue;
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
  const since = new Date(Date.now() - OUT_OF_STOCK_NOTIFY_WINDOW_MS);
  const recent = await prisma.webhookEvent.findFirst({
    where: {
      provider: ETSY_WEBHOOK_PROVIDER,
      shopId,
      resourceKey,
      OR: [{ note: OUT_OF_STOCK_NOTE }, { errorMessage: OUT_OF_STOCK_NOTE }],
      processedAt: { gte: since },
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

  const vars = {
    title: (listing?.title || `#${listingId}`).slice(0, 120),
    url: listing?.url || `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`,
  };
  const subject = `${t(trMessages, 'outOfStockSubject', vars)} / ${t(enMessages, 'outOfStockSubject', vars)}`.slice(0, 200);
  const textBody = `${t(trMessages, 'outOfStockBody', vars)}\n\n---\n\n${t(enMessages, 'outOfStockBody', vars)}`;
  const result = await sendEmail({ to: user.email, subject, textBody });
  return result.sent;
}

function emittedAtOf(payload: any, fallback: Date): Date {
  const ts = Number(payload?.__webhookTimestamp);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : fallback;
}

export async function legacyHandleListingEvent(ctx: EtsyEventContext & { listingId: bigint; payload: any }): Promise<HandlerOutcome> {
  const { userId, shopId, listingId } = ctx;
  const types = ctx.eventTypes;

  const accessToken = await getEtsyAccessToken(shopId, userId);
  let remote: any;
  try {
    remote = await refreshListingCache(shopId, listingId, accessToken, { userId, source: 'webhook' });
  } catch (err) {
    if (isEtsy404(err)) {
      // Deleted on Etsy (listing.deleted, or the delete event was lost/out of order).
      const n = await handleListingDeleted(shopId, listingId);
      const tag = types.has('listing.deleted') ? 'deleted' : 'gone_404';
      return { outcome: 'done', note: n ? `note:${tag},drafts_conflicted=${n}` : `note:${tag}` };
    }
    throw err;
  }

  let note: string | undefined;
  if (types.has('listing.created') || types.has('listing.updated') || types.has('reconcile.changed')) {
    const n = await checkDraftConflicts(shopId, listingId, remote, emittedAtOf(ctx.payload, ctx.firstReceivedAt));
    if (n) note = `note:drafts_conflicted=${n}`;
  }

  if (types.has('inventory.out_of_stock')) {
    try {
      const sent = await notifyOutOfStock(userId, shopId, listingId, ctx.resourceKey || `listing:${listingId}`, ctx.eventId);
      if (sent) note = OUT_OF_STOCK_NOTE;
    } catch (err) {
      logIntegrationEvent('warn', {
        message: 'Etsy out-of-stock notification failed',
        operation: 'etsy.webhook.notify_failed',
        userId,
        details: { eventId: ctx.eventId },
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
  return { outcome: 'done', note };
}
