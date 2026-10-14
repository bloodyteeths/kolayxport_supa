/**
 * Listing alerts + live events (owner W3).
 *
 * Noise rules (spec T6):
 *  - deleted / 404                 -> listingDeleted (error) unless KolayXport
 *                                     itself deleted it in the last 10 min
 *  - active -> inactive, external  -> listingDeactivated (error, dedupe
 *    and no order with the listing    listing+day). Not raised when an order
 *    in the last 30 min               for the listing arrived in the last 30 min.
 *  - active -> sold_out            -> no alert (W4's orderNew carries lastUnit)
 *  - -> expired                    -> listingExpired (warning, digest)
 *  - external title/tags/description/images/price change
 *                                  -> listingChangedExternally (badge=false),
 *                                     only when the listing has an open draft
 *  - inventory.out_of_stock and the listing is not stock-managed
 *                                  -> stockOutOfStock (warning, digest, 6 h bucket)
 *  - back to active                -> resolves an open listingDeactivated / listingExpired
 *
 * Every alert also publishes a LiveListingEvent so open tabs update instantly.
 * Nothing here throws into the caller.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify, resolveByPrefix } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import type { LiveListingKind } from '@/lib/live/types';
import { EXTERNAL_ALERT_KEYS } from './listingNormalize';

export const LISTING_LINK = '/app/etsy-listings';
export const ACTIVITY_LINK = '/app/etsy-aktivite';
const RECENT_ORDER_WINDOW_MS = 30 * 60_000;
const KX_DELETE_WINDOW_MS = 10 * 60_000;
const OOS_BUCKET_MS = 6 * 60 * 60_000;

export type AlertKind = 'listingDeactivated' | 'listingExpired' | 'listingChangedExternally' | 'stockOutOfStock';

export type AlertInput = {
  prevState: string | null;
  newState: string;
  attribution: string;
  /** reconcile/initial sources produce 'unknown' attribution */
  source: string;
  changedKeys: string[];
  eventTypes: Set<string> | string[];
  recentOrderForListing: boolean;
  hasOpenDraft: boolean;
  stockManaged: boolean;
};

/** Pure: which alerts does this refresh raise? */
export function decideListingAlerts(i: AlertInput): AlertKind[] {
  const types = i.eventTypes instanceof Set ? i.eventTypes : new Set(i.eventTypes);
  const out: AlertKind[] = [];
  const own = i.attribution.startsWith('kolayxport_');
  // A reconcile (nightly) that discovers a transition we missed is treated like
  // an external change; the very first import ('initial') never alerts.
  const externalLike = i.attribution === 'external' || (i.attribution === 'unknown' && i.source === 'reconcile');
  const transitioned = i.prevState !== null && i.prevState !== i.newState;

  if (transitioned && i.prevState === 'active' && i.newState === 'inactive' && externalLike && !own && !i.recentOrderForListing) {
    out.push('listingDeactivated');
  }
  if (transitioned && i.newState === 'expired' && !own && i.source !== 'initial') out.push('listingExpired');
  if (externalLike && i.attribution === 'external' && i.hasOpenDraft && i.changedKeys.some((k) => (EXTERNAL_ALERT_KEYS as readonly string[]).includes(k))) {
    out.push('listingChangedExternally');
  }
  if (types.has('inventory.out_of_stock') && !i.stockManaged) out.push('stockOutOfStock');
  return out;
}

export function liveKindFor(alerts: AlertKind[], fallback: LiveListingKind): LiveListingKind {
  if (alerts.includes('listingDeactivated')) return 'deactivated';
  if (alerts.includes('listingExpired')) return 'expired';
  if (alerts.includes('listingChangedExternally')) return 'changed_externally';
  return fallback;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export const listingAlertKeys = {
  deactivated: (shopId: string, listingId: string, day = utcDay()) => `listing:deactivated:${shopId}:${listingId}:${day}`,
  deactivatedPrefix: (shopId: string, listingId: string) => `listing:deactivated:${shopId}:${listingId}:`,
  expired: (shopId: string, listingId: string) => `listing:expired:${shopId}:${listingId}`,
  deleted: (shopId: string, listingId: string) => `listing:deleted:${shopId}:${listingId}`,
  changed: (shopId: string, listingId: string) => `listing:changed:${shopId}:${listingId}`,
  outOfStock: (shopId: string, listingId: string, now = Date.now()) =>
    `stock:oos:${shopId}:${listingId}:${Math.floor(now / OOS_BUCKET_MS)}`,
};

function titleParam(title: string | null | undefined, listingId: string): string {
  return (title && title.trim() ? title.trim() : `#${listingId}`).slice(0, 120);
}

// ---------------------------------------------------------------------------
// KolayXport-initiated deletes (suppress the listingDeleted alert)
// ---------------------------------------------------------------------------

const kxDeletes = new Map<string, number>();

/** Called by our own delete paths (clawd delete_listing) right before deleting. */
export function markKolayxportDelete(shopId: string, listingId: string | bigint) {
  if (kxDeletes.size > 2000) kxDeletes.clear();
  kxDeletes.set(`${shopId}:${String(listingId)}`, Date.now());
}

export async function wasDeletedByKolayxport(shopId: string, listingId: bigint): Promise<boolean> {
  const at = kxDeletes.get(`${shopId}:${String(listingId)}`);
  if (at && Date.now() - at < KX_DELETE_WINDOW_MS) return true;
  try {
    const since = new Date(Date.now() - KX_DELETE_WINDOW_MS);
    const drafts = await prisma.etsyListingDraft.findMany({
      where: { etsyShopId: shopId, etsyListingId: listingId, updatedAt: { gte: since } },
      select: { queuedActions: true, status: true, syncedAt: true },
      take: 10,
    });
    return drafts.some((d) => {
      const actions = Array.isArray(d.queuedActions) ? (d.queuedActions as any[]) : [];
      if (!actions.some((a) => a?.type === 'delete')) return false;
      return d.status === 'synced' || d.status === 'syncing' || actions.some((a) => a?.type === 'delete' && a?.completedAt);
    });
  } catch {
    return false;
  }
}

/** Was there an order containing this listing in the last 30 minutes? */
export async function hasRecentOrderForListing(userId: string, listingId: bigint): Promise<boolean> {
  const since = new Date(Date.now() - RECENT_ORDER_WINDOW_MS);
  try {
    const byRef = await prisma.orderItem.findFirst({
      where: { listingRef: String(listingId), order: { userId, createdAt: { gte: since } } },
      select: { id: true },
    });
    if (byRef) return true;
    const containment = JSON.stringify({ transactions: [{ listing_id: Number(listingId) }] });
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order"
      WHERE "userId" = ${userId} AND "createdAt" >= ${since}
        AND "rawData"::jsonb @> ${containment}::jsonb
      LIMIT 1`;
    return rows.length > 0;
  } catch {
    // Unknown: err on the side of alerting (a missed deactivation is worse).
    return false;
  }
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

export async function emitListingAlerts(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  title: string | null;
  alerts: AlertKind[];
  newState: string;
  prevState: string | null;
  changedKeys: string[];
  /** SKU(s) that ran out, for stockOutOfStock ({sku} in the message). */
  outOfStockSku?: string | null;
}): Promise<void> {
  const id = String(a.listingId);
  const title = titleParam(a.title, id);
  const entity = { type: 'etsyListing', id: `${a.shopId}:${id}` };
  try {
    for (const kind of a.alerts) {
      if (kind === 'listingDeactivated') {
        await notify(a.userId, {
          type: 'listingDeactivated',
          severity: 'error',
          titleKey: 'types.listingDeactivated',
          params: { title, listingId: id },
          link: LISTING_LINK,
          dedupeKey: listingAlertKeys.deactivated(a.shopId, id),
          entity,
        });
      } else if (kind === 'listingExpired') {
        await notify(a.userId, {
          type: 'listingExpired',
          severity: 'warning',
          titleKey: 'types.listingExpired',
          params: { title, listingId: id },
          link: LISTING_LINK,
          dedupeKey: listingAlertKeys.expired(a.shopId, id),
          entity,
        });
      } else if (kind === 'listingChangedExternally') {
        await notify(a.userId, {
          type: 'listingChangedExternally',
          severity: 'info',
          titleKey: 'types.listingChangedExternally',
          params: { title, listingId: id, fields: a.changedKeys.filter((k) => (EXTERNAL_ALERT_KEYS as readonly string[]).includes(k)).join(', ') },
          link: ACTIVITY_LINK,
          dedupeKey: listingAlertKeys.changed(a.shopId, id),
          entity,
          badge: false,
        });
      } else if (kind === 'stockOutOfStock') {
        await notify(a.userId, {
          type: 'stockOutOfStock',
          severity: 'warning',
          titleKey: 'types.stockOutOfStock',
          // The message template uses {sku}; listings without SKUs fall back to the title.
          params: { title, listingId: id, sku: (a.outOfStockSku || title).slice(0, 120) },
          link: LISTING_LINK,
          dedupeKey: listingAlertKeys.outOfStock(a.shopId, id),
          entity,
        });
      }
    }
    // Back to active: the deactivation / expiry problem is solved.
    if (a.newState === 'active' && a.prevState && a.prevState !== 'active') {
      await resolveByPrefix(a.userId, listingAlertKeys.deactivatedPrefix(a.shopId, id));
      await resolveByPrefix(a.userId, listingAlertKeys.expired(a.shopId, id));
    }
  } catch (err: any) {
    logger.warn('emitListingAlerts failed', { shopId: a.shopId, listingId: id, error: err?.message });
  }
}

export async function emitListingDeleted(a: { userId: string; shopId: string; listingId: bigint; title: string | null; suppress: boolean }) {
  const id = String(a.listingId);
  try {
    if (!a.suppress) {
      await notify(a.userId, {
        type: 'listingDeleted',
        severity: 'error',
        titleKey: 'types.listingDeleted',
        params: { title: titleParam(a.title, id), listingId: id },
        link: ACTIVITY_LINK,
        dedupeKey: listingAlertKeys.deleted(a.shopId, id),
        entity: { type: 'etsyListing', id: `${a.shopId}:${id}` },
      });
    }
    await resolveByPrefix(a.userId, listingAlertKeys.deactivatedPrefix(a.shopId, id));
    await resolveByPrefix(a.userId, listingAlertKeys.expired(a.shopId, id));
  } catch (err: any) {
    logger.warn('emitListingDeleted failed', { shopId: a.shopId, listingId: id, error: err?.message });
  }
}

/** Fire-and-forget live hint (never throws). */
export function publishListingLive(
  userId: string,
  a: { kind: LiveListingKind; shopId: string; listingId: bigint | string; title?: string | null; state?: string | null; attribution?: string | null; versionId?: string | null },
) {
  publishLive(userId, {
    type: 'listing',
    kind: a.kind,
    marketplace: 'etsy',
    shopId: String(a.shopId),
    listingId: String(a.listingId),
    title: a.title ? String(a.title).slice(0, 140) : null,
    state: a.state ?? null,
    attribution: a.attribution ?? null,
    versionId: a.versionId ?? null,
  });
}
