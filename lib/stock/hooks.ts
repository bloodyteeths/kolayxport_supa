/**
 * Stock sync integration hooks called from other workstreams (owner W2).
 *
 * Stock sync ships DISABLED: every function is a fast no-op (one cached
 * settings lookup, 30 s TTL) unless the user enabled it in the setup wizard.
 * Marketplace writes additionally require Go Live (dryRun=false). The global
 * kill switch STOCK_SYNC_GLOBAL_DISABLE=1 turns everything off.
 *
 * Heavy modules are imported lazily so callers (draftService, webhook
 * handlers, order upserts) do not pull the adapters into their module graph
 * and no import cycle forms (adapters -> lib/etsy/http -> draftService).
 *
 * None of these functions throw into the caller except
 * applyStockToEtsyDraftInventory (the draft sync must know if the overlay
 * failed so it does not PUT stale quantities over managed variants).
 */
import { logger } from '@/lib/logger';
import type { ApplyOrderToStockResult, EtsyOfferingObservation, StockChannel, StockOrderSource } from './types';
import { getEnabledStockUserIds, getStockSettings, isStockLive, isStockSyncActive, stockGloballyDisabled } from './settings';

function warn(msg: string, err: unknown, details: Record<string, unknown>) {
  try {
    void Promise.resolve(logger.warn(msg, { ...details, error: err instanceof Error ? err.message : String(err) })).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** Feed the offerings seen in a listing refresh (webhook or our own draft sync). */
export async function observeEtsyOfferings(a: {
  userId: string;
  shopId: string;
  listingId: string;
  listingState: string;
  remoteUpdatedTs: number;
  offerings: EtsyOfferingObservation[];
  source: 'webhook' | 'draft_sync';
  eventId?: string;
}): Promise<{ observed: number; echoes: number; deferMs?: number }> {
  try {
    if (!isStockSyncActive(await getStockSettings(a.userId))) return { observed: 0, echoes: 0 };
    const { observeEtsyOfferingsImpl } = await import('./observe');
    return await observeEtsyOfferingsImpl(a);
  } catch (err) {
    warn('stock.observe_failed', err, { userId: a.userId, shopId: a.shopId, listingId: a.listingId });
    return { observed: 0, echoes: 0 };
  }
}

/** If a stock push of ours explains this listing update, return it (attribution). */
export async function findOwnStockWrite(shopId: string, listingId: string, remoteUpdatedTs: number): Promise<{ pushId: string } | null> {
  try {
    if (stockGloballyDisabled()) return null;
    if ((await getEnabledStockUserIds()).size === 0) return null;
    const { findOwnStockWrite: impl } = await import('./echo');
    return await impl(shopId, listingId, remoteUpdatedTs);
  } catch (err) {
    warn('stock.find_own_write_failed', err, { shopId, listingId });
    return null;
  }
}

/** Apply an order (sale / cancel restock) to canonical stock. Idempotent via the ledger. */
export async function applyOrderToStock(
  orderId: string,
  opts: { source: StockOrderSource; sourceEventId?: string },
): Promise<ApplyOrderToStockResult> {
  try {
    if ((await getEnabledStockUserIds()).size === 0) return { applied: 0, deduped: 0, unmatched: 0, restocked: 0, skipped: 'disabled' };
    const { applyOrderToStockImpl } = await import('./orders');
    return await applyOrderToStockImpl(orderId, opts);
  } catch (err) {
    warn('stock.apply_order_failed', err, { orderId, source: opts.source });
    return { applied: 0, deduped: 0, unmatched: 0, restocked: 0 };
  }
}

/** Safety-net scan of recent orders for users with stock sync enabled. */
export async function scanOrdersForStock(opts?: { userId?: string; limit?: number }): Promise<{ users: number; orders: number }> {
  try {
    if ((await getEnabledStockUserIds()).size === 0) return { users: 0, orders: 0 };
    const { scanOrdersForStockImpl } = await import('./orders');
    return await scanOrdersForStockImpl(opts);
  } catch (err) {
    warn('stock.scan_orders_failed', err, {});
    return { users: 0, orders: 0 };
  }
}

/**
 * Before a draft inventory PUT: overlay canonical quantities on stock-managed
 * variants the user did not explicitly change (and record explicit editor
 * changes as manual adjustments). Unchanged unless the user is LIVE.
 */
export async function applyStockToEtsyDraftInventory(a: {
  userId: string;
  shopId: string;
  listingId: string;
  actorUserId: string;
  products: any[];
  userChangedVariantKeys: Set<string>;
}): Promise<{ products: any[]; overridden: Array<{ variantKey: string; from: number; to: number }>; manualAdjusts: number; echoPushIds: string[]; outOfStock?: boolean }> {
  if (!isStockLive(await getStockSettings(a.userId))) return { products: a.products, overridden: [], manualAdjusts: 0, echoPushIds: [] };
  const { applyStockToEtsyDraftInventoryImpl } = await import('./etsyDraftHook');
  return applyStockToEtsyDraftInventoryImpl(a);
}

/**
 * After the draft's inventory PUT: settle the echo markers returned by
 * applyStockToEtsyDraftInventory (ok = the PUT succeeded). Never throws.
 * Unsettled markers are verified by the push worker after ~5 min.
 */
export async function settleEtsyDraftStockEcho(pushIds: string[] | null | undefined, ok: boolean): Promise<void> {
  if (!pushIds || !pushIds.length) return;
  try {
    const { settleEtsyDraftStockEchoImpl } = await import('./etsyDraftHook');
    await settleEtsyDraftStockEchoImpl(pushIds, ok);
  } catch (err) {
    warn('stock.settle_draft_echo_failed', err, { count: pushIds.length });
  }
}

export async function isListingStockManaged(userId: string, shopId: string, listingId: string): Promise<boolean> {
  try {
    if (!isStockSyncActive(await getStockSettings(userId))) return false;
    const { isListingStockManagedImpl } = await import('./etsyDraftHook');
    return await isListingStockManagedImpl(userId, shopId, listingId);
  } catch (err) {
    warn('stock.is_managed_failed', err, { userId, shopId, listingId });
    return false;
  }
}

/** An Etsy shop moved to another user (or was disconnected): pause its links. Returns links touched. */
export async function onEtsyShopOwnershipChanged(shopId: string, newUserId: string | null): Promise<number> {
  try {
    const { onEtsyShopOwnershipChangedImpl } = await import('./reconcile');
    return await onEtsyShopOwnershipChangedImpl(shopId, newUserId);
  } catch (err) {
    warn('stock.ownership_change_failed', err, { shopId });
    return 0;
  }
}

export async function listUsersWithLiveStockChannel(channel: StockChannel): Promise<string[]> {
  try {
    if ((await getEnabledStockUserIds()).size === 0) return [];
    const { listUsersWithLiveStockChannelImpl } = await import('./reconcile');
    return await listUsersWithLiveStockChannelImpl(channel);
  } catch (err) {
    warn('stock.live_users_failed', err, { channel });
    return [];
  }
}
