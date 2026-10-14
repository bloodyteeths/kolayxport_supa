/**
 * Stock ledger primitives (W2, T2). Server-only.
 *
 * Every canonical stock mutation runs inside a Prisma interactive
 * transaction that first takes a per-item advisory lock, then inserts a
 * ledger row with ON CONFLICT ("idempotencyKey") DO NOTHING. No row returned
 * means the mutation was already applied (deduped) and the caller must not
 * touch onHand. No network I/O happens inside these transactions.
 */
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export type Tx = Prisma.TransactionClient;

export type LedgerKind = 'seed' | 'sale' | 'sale_adjust' | 'cancel' | 'manual_adjust' | 'remote_adjust' | 'drift_fix';

export type LedgerInsert = {
  userId: string;
  stockItemId: string;
  kind: LedgerKind;
  delta: number;
  qtyAfter: number;
  idempotencyKey: string;
  channel?: string | null;
  linkId?: string | null;
  orderId?: string | null;
  orderKey?: string | null;
  sourceEventId?: string | null;
  actor?: string | null;
  note?: string | null;
};

export type StockItemRow = {
  id: string;
  userId: string;
  sku: string;
  displaySku: string;
  title: string | null;
  imageUrl: string | null;
  onHand: number;
  safetyBuffer: number;
  tracking: string;
  status: string;
  seededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function lockStockItem(tx: Tx, stockItemId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${stockItemId}`}))`;
}

/** Returns the new ledger id, or null when the idempotency key already exists. */
export async function insertLedger(tx: Tx, row: LedgerInsert): Promise<string | null> {
  const id = randomUUID();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "StockLedger"
      ("id", "userId", "stockItemId", "kind", "delta", "qtyAfter", "channel", "linkId", "orderId", "orderKey",
       "idempotencyKey", "sourceEventId", "actor", "note", "createdAt")
    VALUES
      (${id}, ${row.userId}, ${row.stockItemId}, ${row.kind}, ${Math.trunc(row.delta)}::int, ${Math.trunc(row.qtyAfter)}::int,
       ${row.channel ?? null}, ${row.linkId ?? null}, ${row.orderId ?? null}, ${row.orderKey ?? null},
       ${row.idempotencyKey.slice(0, 500)}, ${row.sourceEventId ?? null}, ${row.actor || 'system'}, ${row.note ? row.note.slice(0, 500) : null}, now())
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

/**
 * Runs fn inside a transaction holding the item's advisory lock, with the
 * freshly read item row. Throws 'stock_item_not_found' if it is gone.
 */
export async function withItemLock<T>(stockItemId: string, fn: (tx: Tx, item: StockItemRow) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockStockItem(tx, stockItemId);
      const item = (await tx.stockItem.findUnique({ where: { id: stockItemId } })) as StockItemRow | null;
      if (!item) throw new Error('stock_item_not_found');
      return fn(tx, item);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/** Sum of ledger deltas for (orderKey, stockItemId) restricted to kinds. */
export async function sumOrderDeltas(tx: Tx, orderKey: string, stockItemId: string, kinds: LedgerKind[]): Promise<{ sum: number; count: number }> {
  const rows = await tx.stockLedger.findMany({
    where: { orderKey, stockItemId, kind: { in: kinds } },
    select: { delta: true },
  });
  return { sum: rows.reduce((s, r) => s + r.delta, 0), count: rows.length };
}
