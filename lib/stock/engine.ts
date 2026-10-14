/**
 * Canonical stock engine (W2, T2). Server-only.
 *
 * All mutations: advisory-locked transaction + idempotent ledger insert, no
 * network I/O inside. After commit: enqueue pushes to ALL active tracked
 * links of the item (origin included — the worker's fresh read turns a
 * no-op into 'skipped'), publish a live stock event and raise/resolve the
 * out-of-stock notification.
 */
import { randomUUID } from 'crypto';
import { processState } from '@/lib/processState';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify, resolve as resolveNotification } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import { channelEnabled, getStockSettings, isStockSyncActive } from './settings';
import { insertLedger, sumOrderDeltas, withItemLock, type StockItemRow, type Tx } from './ledger';
import { computeLinkTarget, splitSaleAgainstOrigin, RAISE_ALLOWED_REASONS, type PushReason } from './math';

export const STOCK_PAGE_LINK = '/app/stok-senkron';

export type MutationOutcome = {
  status: 'applied' | 'deduped' | 'noop';
  stockItemId: string;
  onHandBefore?: number;
  onHandAfter?: number;
  ledgerId?: string | null;
};

type AfterCommit = {
  userId: string;
  item: Pick<StockItemRow, 'id' | 'displaySku'>;
  before: number;
  after: number;
  reason: PushReason;
};

function warn(msg: string, details: Record<string, unknown>) {
  try {
    void Promise.resolve(logger.warn(msg, details)).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// After-commit side effects
// ---------------------------------------------------------------------------

export async function afterStockChange(a: AfterCommit): Promise<void> {
  try {
    publishLive(a.userId, { type: 'stock', kind: 'changed', stockItemId: a.item.id, sku: a.item.displaySku, onHand: a.after });
    const dedupeKey = `stock:oos:${a.item.id}`;
    if (a.before > 0 && a.after <= 0) {
      void notify(a.userId, {
        type: 'stockOutOfStock',
        severity: 'warning',
        titleKey: 'types.stockOutOfStock',
        params: { sku: a.item.displaySku },
        link: STOCK_PAGE_LINK,
        dedupeKey,
        entity: { type: 'stockItem', id: a.item.id },
      });
      publishLive(a.userId, { type: 'stock', kind: 'out_of_stock', stockItemId: a.item.id, sku: a.item.displaySku, onHand: a.after });
    } else if (a.before <= 0 && a.after > 0) {
      void resolveNotification(a.userId, dedupeKey);
    }
    await enqueuePushes(a.item.id, a.reason);
  } catch (err) {
    warn('stock.after_change_failed', { stockItemId: a.item.id, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Upsert one pending push per active link (pendingKey = linkId). A pending
 * row keeps the right to raise the remote if either enqueue had it.
 * Untracked / paused items never enqueue; disabled users never enqueue.
 */
export async function enqueuePushes(stockItemId: string, reason: PushReason, opts: { onlyLinkIds?: string[] } = {}): Promise<number> {
  const item = await prisma.stockItem.findUnique({
    where: { id: stockItemId },
    include: { links: { where: { status: 'active' } } },
  });
  if (!item || item.tracking !== 'tracked' || item.status !== 'active') return 0;
  const settings = await getStockSettings(item.userId);
  if (!isStockSyncActive(settings)) return 0;
  const raise = Array.from(RAISE_ALLOWED_REASONS);
  let n = 0;
  for (const link of item.links) {
    if (opts.onlyLinkIds && !opts.onlyLinkIds.includes(link.id)) continue;
    if (!channelEnabled(settings, link.channel)) continue;
    const target = computeLinkTarget({
      onHand: item.onHand,
      safetyBuffer: item.safetyBuffer,
      buffer: link.buffer,
      unitsPerSale: link.unitsPerSale,
      maxListedQty: link.maxListedQty,
    });
    await prisma.$executeRaw`
      INSERT INTO "StockPush" ("id", "userId", "stockItemId", "linkId", "pendingKey", "reason", "targetQty", "status",
                               "attempts", "nextAttemptAt", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${item.userId}, ${item.id}, ${link.id}, ${link.id}, ${reason}, ${target}::int, 'pending', 0, now(), now(), now())
      ON CONFLICT ("pendingKey") DO UPDATE SET
        "targetQty" = EXCLUDED."targetQty",
        "reason" = CASE
          WHEN EXCLUDED."reason" = ANY(${raise}::text[]) THEN EXCLUDED."reason"
          WHEN "StockPush"."reason" = ANY(${raise}::text[]) THEN "StockPush"."reason"
          ELSE EXCLUDED."reason" END,
        "nextAttemptAt" = now(),
        "updatedAt" = now()`;
    n++;
  }
  if (n > 0) kickStockPushWorker();
  return n;
}

// ---------------------------------------------------------------------------
// In-process push kick (single Hetzner instance; cron is the safety net)
// ---------------------------------------------------------------------------

// On globalThis (processState): the API-route bundle and the instrumentation
// bundle must share one kick timer per process.
const kick = processState('stock.pushKick', () => ({ timer: null as ReturnType<typeof setTimeout> | null }));

export function inprocessJobsDisabled(): boolean {
  const v = String(process.env.KX_DISABLE_INPROCESS_JOBS || '').trim().toLowerCase();
  return v === '1' || v === 'true' || process.env.NEXT_PHASE === 'phase-production-build';
}

export function kickStockPushWorker(delayMs = 750): void {
  if (inprocessJobsDisabled() || kick.timer) return;
  if (process.env.VITEST) return;
  kick.timer = setTimeout(() => {
    kick.timer = null;
    import('./pushWorker')
      .then((m) => m.runStockPushWorker({ trigger: 'kick' }))
      .catch((err) => warn('stock.push_kick_failed', { error: err instanceof Error ? err.message : String(err) }));
  }, delayMs);
  (kick.timer as any)?.unref?.();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Bring the sale recorded for (orderKey, stockItem) to `desiredUnits`.
 * First sight: one 'sale' row (origin link expected-state + unattributed
 * drop absorption). Later quantity changes: 'sale_adjust' rows keyed by the
 * current row count, so the same desired value never applies twice.
 */
export async function applySaleDesired(a: {
  userId: string;
  stockItemId: string;
  orderKey: string;
  orderId?: string | null;
  channel?: string | null;
  desiredUnits: number;
  originLinkId?: string | null;
  sourceEventId?: string | null;
  /** Aggregator copies (Veeqo/Shippo): may record or raise a sale, never reduce one. */
  noReduce?: boolean;
}): Promise<MutationOutcome> {
  const desired = Math.max(0, Math.trunc(a.desiredUnits));
  let after = null as AfterCommit | null;
  const out = await withItemLock(a.stockItemId, async (tx, item) => {
    if (item.userId !== a.userId) throw new Error('stock_item_owner_mismatch');
    const prior = await sumOrderDeltas(tx, a.orderKey, item.id, ['sale', 'sale_adjust']);
    const origin = a.originLinkId
      ? await tx.stockLink.findFirst({ where: { id: a.originLinkId, stockItemId: item.id, userId: a.userId } })
      : null;

    if (prior.count === 0) {
      if (desired === 0) return { status: 'noop' as const, stockItemId: item.id };
      const saleKey = `sale:${a.userId}:${a.orderKey}:${item.id}`;
      let absorbedUnits = 0;
      let split: ReturnType<typeof splitSaleAgainstOrigin> | null = null;
      if (origin) {
        const u = Math.max(1, origin.unitsPerSale);
        split = splitSaleAgainstOrigin({
          qty: Math.ceil(desired / u),
          unitsPerSale: u,
          unattributedDrop: origin.unattributedDrop,
          lastSeenRemoteQty: origin.lastSeenRemoteQty,
        });
        absorbedUnits = Math.min(desired, split.absorbedUnits);
      }
      const afterSale = item.onHand - desired;
      const ledgerId = await insertLedger(tx, {
        userId: a.userId,
        stockItemId: item.id,
        kind: 'sale',
        delta: -desired,
        qtyAfter: afterSale,
        channel: a.channel,
        linkId: origin?.id ?? null,
        orderId: a.orderId,
        orderKey: a.orderKey,
        idempotencyKey: saleKey,
        sourceEventId: a.sourceEventId,
        note: absorbedUnits > 0 ? `counted_via_remote_drop:${absorbedUnits}` : null,
      });
      if (!ledgerId) return { status: 'deduped' as const, stockItemId: item.id };
      let newOnHand = afterSale;
      if (absorbedUnits > 0) {
        newOnHand = afterSale + absorbedUnits;
        // The marketplace drop we already counted was this sale: re-attribute it.
        await insertLedger(tx, {
          userId: a.userId,
          stockItemId: item.id,
          kind: 'remote_adjust',
          delta: absorbedUnits,
          qtyAfter: newOnHand,
          channel: a.channel,
          linkId: origin?.id ?? null,
          orderId: a.orderId,
          orderKey: a.orderKey,
          idempotencyKey: `${saleKey}:absorb`,
          note: 'reattributed_to_sale',
        });
      }
      await tx.stockItem.update({ where: { id: item.id }, data: { onHand: newOnHand } });
      if (origin && split) {
        await tx.stockLink.update({
          where: { id: origin.id },
          data: {
            unattributedDrop: split.nextUnattributedDrop,
            unattributedDropSince: split.nextUnattributedDrop > 0 ? origin.unattributedDropSince : null,
            lastSeenRemoteQty: split.nextLastSeenRemoteQty,
          },
        });
      }
      after = { userId: a.userId, item, before: item.onHand, after: newOnHand, reason: 'sale' };
      return { status: 'applied' as const, stockItemId: item.id, onHandBefore: item.onHand, onHandAfter: newOnHand, ledgerId };
    }

    const applied = -prior.sum;
    const diff = desired - applied;
    if (diff === 0 || (diff < 0 && a.noReduce)) return { status: 'deduped' as const, stockItemId: item.id };
    const newOnHand = item.onHand - diff;
    const ledgerId = await insertLedger(tx, {
      userId: a.userId,
      stockItemId: item.id,
      kind: 'sale_adjust',
      delta: -diff,
      qtyAfter: newOnHand,
      channel: a.channel,
      linkId: origin?.id ?? null,
      orderId: a.orderId,
      orderKey: a.orderKey,
      idempotencyKey: `sale_adj:${a.userId}:${a.orderKey}:${item.id}:${prior.count}`,
      sourceEventId: a.sourceEventId,
    });
    if (!ledgerId) return { status: 'deduped' as const, stockItemId: item.id };
    await tx.stockItem.update({ where: { id: item.id }, data: { onHand: newOnHand } });
    if (origin && origin.lastSeenRemoteQty !== null) {
      const qtyDiff = Math.round(diff / Math.max(1, origin.unitsPerSale));
      await tx.stockLink.update({ where: { id: origin.id }, data: { lastSeenRemoteQty: Math.max(0, origin.lastSeenRemoteQty - qtyDiff) } });
    }
    after = { userId: a.userId, item, before: item.onHand, after: newOnHand, reason: diff > 0 ? 'sale' : 'adjust' };
    return { status: 'applied' as const, stockItemId: item.id, onHandBefore: item.onHand, onHandAfter: newOnHand, ledgerId };
  });
  if (after) await afterStockChange(after);
  return out;
}

/** Restock what this order sold on this item (once). */
export async function applyCancel(a: {
  userId: string;
  stockItemId: string;
  orderKey: string;
  orderId?: string | null;
  channel?: string | null;
  sourceEventId?: string | null;
}): Promise<MutationOutcome> {
  let after = null as AfterCommit | null;
  const out = await withItemLock(a.stockItemId, async (tx, item) => {
    if (item.userId !== a.userId) throw new Error('stock_item_owner_mismatch');
    const sold = -(await sumOrderDeltas(tx, a.orderKey, item.id, ['sale', 'sale_adjust'])).sum;
    const restocked = (await sumOrderDeltas(tx, a.orderKey, item.id, ['cancel'])).sum;
    const restock = sold - restocked;
    if (restock <= 0) return { status: 'noop' as const, stockItemId: item.id };
    const newOnHand = item.onHand + restock;
    const ledgerId = await insertLedger(tx, {
      userId: a.userId,
      stockItemId: item.id,
      kind: 'cancel',
      delta: restock,
      qtyAfter: newOnHand,
      channel: a.channel,
      orderId: a.orderId,
      orderKey: a.orderKey,
      idempotencyKey: `cancel:${a.userId}:${a.orderKey}:${item.id}`,
      sourceEventId: a.sourceEventId,
    });
    if (!ledgerId) return { status: 'deduped' as const, stockItemId: item.id };
    await tx.stockItem.update({ where: { id: item.id }, data: { onHand: newOnHand } });
    after = { userId: a.userId, item, before: item.onHand, after: newOnHand, reason: 'cancel' };
    return { status: 'applied' as const, stockItemId: item.id, onHandBefore: item.onHand, onHandAfter: newOnHand, ledgerId };
  });
  if (after) await afterStockChange(after);
  return out;
}

/** Seller-entered correction: absolute (setTo) or relative (delta). */
export async function manualAdjust(a: {
  userId: string;
  stockItemId: string;
  setTo?: number;
  delta?: number;
  actor: string;
  note?: string | null;
  idempotencyKey?: string;
  linkId?: string | null;
  channel?: string | null;
}): Promise<MutationOutcome> {
  let after = null as AfterCommit | null;
  const out = await withItemLock(a.stockItemId, async (tx, item) => {
    if (item.userId !== a.userId) throw new Error('stock_item_owner_mismatch');
    const target = a.setTo !== undefined ? Math.max(0, Math.trunc(a.setTo)) : item.onHand + Math.trunc(a.delta || 0);
    const delta = target - item.onHand;
    if (delta === 0) return { status: 'noop' as const, stockItemId: item.id, onHandBefore: item.onHand, onHandAfter: item.onHand };
    const ledgerId = await insertLedger(tx, {
      userId: a.userId,
      stockItemId: item.id,
      kind: 'manual_adjust',
      delta,
      qtyAfter: target,
      actor: a.actor,
      note: a.note ?? null,
      linkId: a.linkId ?? null,
      channel: a.channel ?? null,
      idempotencyKey: a.idempotencyKey || `manual:${a.userId}:${item.id}:${randomUUID()}`,
    });
    if (!ledgerId) return { status: 'deduped' as const, stockItemId: item.id };
    await tx.stockItem.update({ where: { id: item.id }, data: { onHand: target } });
    after = { userId: a.userId, item, before: item.onHand, after: target, reason: 'manual' };
    return { status: 'applied' as const, stockItemId: item.id, onHandBefore: item.onHand, onHandAfter: target, ledgerId };
  });
  if (after) await afterStockChange(after);
  return out;
}

/** Initial quantity (wizard / confirm). Seeding twice with the same key is a no-op. */
export async function seedItem(a: { userId: string; stockItemId: string; qty: number; actor: string; idempotencyKey: string; note?: string }): Promise<MutationOutcome> {
  let after = null as AfterCommit | null;
  const out = await withItemLock(a.stockItemId, async (tx, item) => {
    if (item.userId !== a.userId) throw new Error('stock_item_owner_mismatch');
    const qty = Math.max(0, Math.trunc(a.qty));
    const ledgerId = await insertLedger(tx, {
      userId: a.userId,
      stockItemId: item.id,
      kind: 'seed',
      delta: qty - item.onHand,
      qtyAfter: qty,
      actor: a.actor,
      note: a.note ?? null,
      idempotencyKey: a.idempotencyKey,
    });
    if (!ledgerId) return { status: 'deduped' as const, stockItemId: item.id };
    await tx.stockItem.update({ where: { id: item.id }, data: { onHand: qty, seededAt: new Date() } });
    after = { userId: a.userId, item, before: item.onHand, after: qty, reason: 'seed' };
    return { status: 'applied' as const, stockItemId: item.id, onHandBefore: item.onHand, onHandAfter: qty, ledgerId };
  });
  if (after) await afterStockChange(after);
  return out;
}

/**
 * Remote decrease we could not attribute to an order (yet). Runs INSIDE the
 * observation transaction (caller holds the item lock).
 */
export async function remoteAdjustInTx(
  tx: Tx,
  item: StockItemRow,
  a: { userId: string; linkId: string; channel: string; deltaRemote: number; unitsPerSale: number; idempotencyKey: string; sourceEventId?: string | null },
): Promise<{ applied: boolean; onHandAfter: number }> {
  const deltaUnits = Math.trunc(a.deltaRemote) * Math.max(1, a.unitsPerSale);
  const newOnHand = item.onHand + deltaUnits;
  const ledgerId = await insertLedger(tx, {
    userId: a.userId,
    stockItemId: item.id,
    kind: 'remote_adjust',
    delta: deltaUnits,
    qtyAfter: newOnHand,
    channel: a.channel,
    linkId: a.linkId,
    idempotencyKey: a.idempotencyKey,
    sourceEventId: a.sourceEventId ?? null,
    note: 'unattributed_drop',
  });
  if (!ledgerId) return { applied: false, onHandAfter: item.onHand };
  await tx.stockItem.update({ where: { id: item.id }, data: { onHand: newOnHand } });
  return { applied: true, onHandAfter: newOnHand };
}

/** Current target for every active link of an item (preview / API). */
export function linkTargets(item: { onHand: number; safetyBuffer: number }, links: Array<{ id: string; buffer: number; unitsPerSale: number; maxListedQty: number | null }>) {
  return new Map(links.map((l) => [l.id, computeLinkTarget({ onHand: item.onHand, safetyBuffer: item.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty })]));
}
