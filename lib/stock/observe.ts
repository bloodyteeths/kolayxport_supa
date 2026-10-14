/**
 * Etsy offering observation (W2, T5). Server-only.
 *
 * Called by W3 after every listing refresh (webhook or our own draft sync)
 * with the offerings as Etsy reports them now. For each ACTIVE link on the
 * listing it classifies the remote quantity against the link's expected
 * state (lastSeenRemoteQty):
 *
 *   stale_ignored     remoteUpdatedTs older than what we already saw
 *   echo              our own push (isOwnEcho)
 *   baseline          first sight
 *   expected          unchanged
 *   unattributed_drop decrease -> remote_adjust on the hub (a sale usually follows
 *                     and is absorbed instead of double counted)
 *   increase_alert    increase -> NEVER adopted; stockDrift rollup with one-tap adopt
 *
 * Every classification writes a StockObservation row.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import { withListingInventoryLock } from '@/lib/etsy/inventoryLock';
import { isEtsyDeferError } from '@/lib/etsy/webhooks/types';
import { getStockSettings, isStockSyncActive } from './settings';
import { withItemLock } from './ledger';
import { afterStockChange, enqueuePushes, remoteAdjustInTx, STOCK_PAGE_LINK } from './engine';
import { classifyObservation } from './math';
import { hasOpenPush, isOwnEcho } from './echo';
import { foldSkuLoose, normalizeSku } from './normalize';
import type { EtsyOfferingObservation } from './types';

export const OBSERVE_DEFER_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

type ObserveArgs = {
  userId: string;
  shopId: string;
  listingId: string;
  listingState: string;
  remoteUpdatedTs: number;
  offerings: EtsyOfferingObservation[];
  source: 'webhook' | 'draft_sync';
  eventId?: string;
};

function warn(msg: string, details: Record<string, unknown>) {
  try {
    void Promise.resolve(logger.warn(msg, details)).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** Pure: pick the offering for a link (variantKey, then variantValueKey if unique, then SKU). */
export function matchOfferingForLink(
  link: { variantRef: string; variantValueKey: string | null; remoteSku: string | null },
  offerings: EtsyOfferingObservation[],
): { offering: EtsyOfferingObservation; repoint: boolean } | null {
  if (link.variantRef === '*') {
    const enabled = offerings.filter((o) => o.isEnabled);
    const pool = enabled.length ? enabled : offerings;
    if (!pool.length) return null;
    // Shared quantity: all products carry the same number; take the minimum defensively.
    const min = pool.reduce((m, o) => (o.quantity < m.quantity ? o : m), pool[0]);
    return { offering: min, repoint: false };
  }
  const byKey = offerings.find((o) => o.variantKey === link.variantRef);
  if (byKey) return { offering: byKey, repoint: false };
  if (link.variantValueKey) {
    const byValue = offerings.filter((o) => o.variantValueKey === link.variantValueKey);
    if (byValue.length === 1) return { offering: byValue[0], repoint: true };
  }
  const sku = normalizeSku(link.remoteSku);
  if (sku) {
    const bySku = offerings.filter((o) => normalizeSku(o.sku) === sku);
    if (bySku.length === 1) return { offering: bySku[0], repoint: true };
  }
  return null;
}

/**
 * Pure: how to read a matched offering.
 *  'qty'             enabled -> its quantity
 *  'zero'            effective 0: our own listing deactivation, a disable WE made
 *                    (last push sent 0 / already seen at 0), or a sold-out row (raw qty 0)
 *  'seller_disabled' disabled with stock left and nothing of ours explains it:
 *                    a seller decision, never a sale -> pause the link, no drop.
 */
export function classifyOfferingRead(a: {
  isEnabled: boolean;
  quantity: number;
  ourDeactivation: boolean;
  weDisabled: boolean;
}): 'qty' | 'zero' | 'seller_disabled' {
  if (a.ourDeactivation) return 'zero';
  if (a.isEnabled) return 'qty';
  if (a.weDisabled || Math.max(0, Math.trunc(a.quantity)) === 0) return 'zero';
  return 'seller_disabled';
}

export const VARIATION_DISABLED_REASON = 'variation_disabled';

export async function observeEtsyOfferingsImpl(a: ObserveArgs): Promise<{ observed: number; echoes: number; deferMs?: number }> {
  const settings = await getStockSettings(a.userId);
  if (!isStockSyncActive(settings)) return { observed: 0, echoes: 0 };

  // Tenant safety: only the shop's current owner's links are considered.
  const shop = await prisma.etsyShop.findFirst({ where: { shopId: String(a.shopId), isActive: true }, select: { userId: true } });
  if (!shop || shop.userId !== a.userId) return { observed: 0, echoes: 0 };

  const run = () => observeLocked(a);
  if (a.source === 'draft_sync') {
    // The draft sync path may already hold the inventory lock for this listing.
    return run();
  }
  try {
    return await withListingInventoryLock(String(a.listingId), run, { timeoutMs: LOCK_WAIT_MS });
  } catch (err) {
    if (isEtsyDeferError(err)) return { observed: 0, echoes: 0, deferMs: OBSERVE_DEFER_MS };
    throw err;
  }
}

async function observeLocked(a: ObserveArgs): Promise<{ observed: number; echoes: number; deferMs?: number }> {
  const links = await prisma.stockLink.findMany({
    where: { userId: a.userId, channel: 'etsy', accountRef: String(a.shopId), externalId: String(a.listingId) },
  });

  await handleListingState(a, links);
  await resumeReenabledVariations(a, links);

  const active = links.filter((l) => l.status === 'active');
  if (active.length && (await hasOpenPush(active.map((l) => l.id)))) {
    return { observed: 0, echoes: 0, deferMs: OBSERVE_DEFER_MS };
  }

  let observed = 0;
  let echoes = 0;
  const matchedVariantKeys = new Set<string>();
  const ts = Math.trunc(Number(a.remoteUpdatedTs) || 0);

  for (const link of active) {
    const m = matchOfferingForLink(link, a.offerings);
    if (!m) continue;
    if (link.variantRef === '*') a.offerings.forEach((o) => matchedVariantKeys.add(o.variantKey));
    else matchedVariantKeys.add(m.offering.variantKey);
    // Effective remote quantity: a disabled variation, or a listing we deactivated for stock, sells 0.
    const ourDeactivation = String(a.listingState || '').toLowerCase() === 'inactive' && link.deactivatedByStock;
    const weDisabled =
      !m.offering.isEnabled && !ourDeactivation
        ? link.lastPushedQty === 0 || link.lastSeenRemoteQty === 0 || (await isOwnEcho(link.id, 0))
        : false;
    const read = classifyOfferingRead({ isEnabled: m.offering.isEnabled, quantity: m.offering.quantity, ourDeactivation, weDisabled });
    if (read === 'seller_disabled') {
      await pauseSellerDisabled(a, link);
      continue;
    }
    const R = read === 'zero' ? 0 : Math.max(0, Math.trunc(m.offering.quantity));
    const echo = await isOwnEcho(link.id, R);

    let afterCommit = null as Parameters<typeof afterStockChange>[0] | null;
    let drift = null as { delta: number; obsId: string } | null;
    try {
      await withItemLock(link.stockItemId, async (tx, item) => {
        const cur = await tx.stockLink.findUnique({ where: { id: link.id } });
        if (!cur || cur.status !== 'active') return;
        const c = classifyObservation({
          remoteQty: R,
          remoteUpdatedTs: ts,
          lastSeenRemoteQty: cur.lastSeenRemoteQty,
          lastSeenRemoteTs: cur.lastSeenRemoteTs,
          isOwnEcho: echo,
        });
        const obs = await tx.stockObservation.create({
          data: {
            userId: a.userId,
            linkId: cur.id,
            stockItemId: item.id,
            remoteQty: R,
            prevSeenQty: cur.lastSeenRemoteQty,
            delta: c.delta,
            kind: c.kind,
            source: a.source,
            eventId: a.eventId ?? null,
            remoteUpdatedTs: ts || null,
          },
        });
        if (c.kind === 'stale_ignored') return;
        const linkPatch: Record<string, unknown> = {
          lastSeenRemoteQty: R,
          lastSeenRemoteTs: ts > 0 ? Math.max(ts, cur.lastSeenRemoteTs ?? 0) : cur.lastSeenRemoteTs,
          lastSeenAt: new Date(),
        };
        if (m.repoint) {
          linkPatch.variantRef = m.offering.variantKey;
          linkPatch.variantValueKey = m.offering.variantValueKey;
        }
        if (c.kind === 'unattributed_drop' && c.delta !== null) {
          const res = await remoteAdjustInTx(tx, item, {
            userId: a.userId,
            linkId: cur.id,
            channel: 'etsy',
            deltaRemote: c.delta,
            unitsPerSale: cur.unitsPerSale,
            idempotencyKey: `remote:${cur.id}:${ts}:${cur.lastSeenRemoteQty}->${R}`,
            sourceEventId: a.eventId ?? null,
          });
          if (res.applied) {
            linkPatch.unattributedDrop = cur.unattributedDrop + -c.delta;
            linkPatch.unattributedDropSince = cur.unattributedDropSince ?? new Date();
            afterCommit = { userId: a.userId, item, before: item.onHand, after: res.onHandAfter, reason: 'remote_adjust' };
          }
        }
        if (c.kind === 'increase_alert' && c.delta !== null) drift = { delta: c.delta, obsId: obs.id };
        await tx.stockLink.update({ where: { id: cur.id }, data: linkPatch });
        observed++;
        if (c.kind === 'echo') echoes++;
      });
    } catch (err) {
      warn('stock.observe_link_failed', { linkId: link.id, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (afterCommit) await afterStockChange(afterCommit);
    if (drift) await raiseIncreaseAlert(a.userId, link);
  }

  await suggestLinksForUnmatched(a, matchedVariantKeys, links);
  return { observed, echoes };
}

/** The seller disabled a variation that still had stock: pause the link (no drop recorded). */
async function pauseSellerDisabled(a: ObserveArgs, link: { id: string; stockItemId: string; lastSeenRemoteQty: number | null }) {
  try {
    await prisma.stockLink.update({ where: { id: link.id }, data: { status: 'paused', statusReason: VARIATION_DISABLED_REASON } });
    await prisma.stockPush.updateMany({ where: { linkId: link.id, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: VARIATION_DISABLED_REASON } });
    await prisma.stockObservation.create({
      data: {
        userId: a.userId,
        linkId: link.id,
        stockItemId: link.stockItemId,
        remoteQty: 0,
        prevSeenQty: link.lastSeenRemoteQty,
        delta: null,
        kind: VARIATION_DISABLED_REASON,
        source: a.source,
        eventId: a.eventId ?? null,
        remoteUpdatedTs: Math.trunc(Number(a.remoteUpdatedTs) || 0) || null,
      },
    });
    publishLive(a.userId, { type: 'stock', kind: 'changed', stockItemId: link.stockItemId, linkId: link.id, channel: 'etsy' });
  } catch (err) {
    warn('stock.observe_pause_failed', { linkId: link.id, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Links paused because the seller disabled their variation resume (re-baselined) once it is enabled again. */
async function resumeReenabledVariations(
  a: ObserveArgs,
  links: Array<{ id: string; stockItemId: string; status: string; statusReason: string | null; variantRef: string; variantValueKey: string | null; remoteSku: string | null; lastSeenRemoteQty: number | null; lastSeenRemoteTs: number | null }>,
) {
  for (const l of links) {
    if (l.status !== 'paused' || l.statusReason !== VARIATION_DISABLED_REASON) continue;
    const m = matchOfferingForLink(l, a.offerings);
    if (!m || !m.offering.isEnabled) continue;
    await prisma.stockLink.update({ where: { id: l.id }, data: { status: 'active', statusReason: null, lastSeenRemoteQty: null, lastSeenRemoteTs: null } });
    l.status = 'active';
    l.statusReason = null;
    l.lastSeenRemoteQty = null;
    l.lastSeenRemoteTs = null;
    // Lower-only: if the seller re-enabled it above what the hub covers, bring it down.
    await enqueuePushes(l.stockItemId, 'reconcile', { onlyLinkIds: [l.id] }).catch(() => 0);
  }
}

async function raiseIncreaseAlert(userId: string, link: { id: string; stockItemId: string; title: string | null; remoteSku: string | null }) {
  const day = new Date().toISOString().slice(0, 10);
  const count = await prisma.stockObservation.count({
    where: { userId, kind: 'increase_alert', createdAt: { gte: new Date(`${day}T00:00:00.000Z`) } },
  });
  void notify(userId, {
    type: 'stockDrift',
    severity: 'warning',
    titleKey: 'types.stockDrift',
    params: { count, sku: String(link.remoteSku || link.title || '').slice(0, 60) },
    link: STOCK_PAGE_LINK,
    dedupeKey: `stock:drift:${day}`,
    escalateOn: 'count',
  });
  publishLive(userId, { type: 'stock', kind: 'drift', stockItemId: link.stockItemId, linkId: link.id, channel: 'etsy' });
  // Lower-only correction when the seller opted in; otherwise alert only.
  if ((await getStockSettings(userId))?.autoFixDrift) await enqueuePushes(link.stockItemId, 'reconcile', { onlyLinkIds: [link.id] });
}

/**
 * Listing state: non-active listings pause their links (reason listing_<state>)
 * unless it is our own stock deactivation. A state we did not cause clears
 * deactivatedByStock; a listing back to 'active' resumes links we paused for
 * its state (re-baselined).
 */
async function handleListingState(a: ObserveArgs, links: Array<{ id: string; status: string; statusReason: string | null; deactivatedByStock: boolean }>) {
  const state = String(a.listingState || '').toLowerCase();
  if (!state) return;
  for (const l of links) {
    if (state === 'active') {
      const data: Record<string, unknown> = {};
      if (l.deactivatedByStock) {
        data.deactivatedByStock = false;
        data.deactivatedAt = null;
      }
      if (l.status === 'paused' && (l.statusReason || '').startsWith('listing_')) {
        data.status = 'active';
        data.statusReason = null;
        data.lastSeenRemoteQty = null;
        data.lastSeenRemoteTs = null;
      }
      if (Object.keys(data).length) await prisma.stockLink.update({ where: { id: l.id }, data });
      continue;
    }
    if (state === 'inactive' && l.deactivatedByStock) continue; // our own deactivation
    const data: Record<string, unknown> = {};
    if (l.deactivatedByStock) {
      data.deactivatedByStock = false;
      data.deactivatedAt = null;
    }
    if (l.status === 'active') {
      data.status = 'paused';
      data.statusReason = `listing_${state}`.slice(0, 60);
    }
    if (Object.keys(data).length) await prisma.stockLink.update({ where: { id: l.id }, data });
  }
}

/** Unlinked offerings whose SKU matches a hub item become suggestions (never active). */
async function suggestLinksForUnmatched(a: ObserveArgs, matched: Set<string>, links: Array<{ variantRef: string }>) {
  const linkedRefs = new Set(links.map((l) => l.variantRef));
  if (linkedRefs.has('*')) return;
  const open = a.offerings.filter((o) => !matched.has(o.variantKey) && !linkedRefs.has(o.variantKey) && o.sku);
  if (!open.length) return;
  const items = await prisma.stockItem.findMany({ where: { userId: a.userId }, select: { id: true, sku: true } });
  if (!items.length) return;
  const exact = new Map(items.map((i) => [i.sku, i.id]));
  const loose = new Map<string, string | null>();
  for (const i of items) {
    const k = foldSkuLoose(i.sku);
    if (!k) continue;
    loose.set(k, loose.has(k) ? null : i.id); // ambiguous loose key -> no suggestion
  }
  const rows: any[] = [];
  for (const o of open) {
    const n = normalizeSku(o.sku);
    if (!n) continue;
    const exactId = exact.get(n);
    const looseId = exactId ? null : loose.get(foldSkuLoose(n) || '') ?? null;
    const stockItemId = exactId || looseId;
    if (!stockItemId) continue;
    rows.push({
      userId: a.userId,
      stockItemId,
      channel: 'etsy',
      accountRef: String(a.shopId),
      externalId: String(a.listingId),
      variantRef: o.variantKey,
      variantValueKey: o.variantValueKey,
      remoteSku: o.sku,
      matchType: exactId ? 'auto_exact' : 'suggested_loose',
      status: 'suggested',
    });
  }
  if (rows.length) await prisma.stockLink.createMany({ data: rows, skipDuplicates: true });
}
