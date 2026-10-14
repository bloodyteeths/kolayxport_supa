/**
 * W4 backfill: Order.orderHash / itemsHash for rows written before W4, computed
 * from the stored row and its stored items (no item is rewritten). Writers
 * also compute NULL hashes lazily; this just front-loads the work so the
 * first sync after deploy is cheap. Optional.
 *
 * Safe to run before or after the first reconcile: writers decide whether a
 * pre-W4 row is "historical" (alerts born 'done') from "no OrderEffect row
 * exists yet" (quietForExistingWrite), NOT from orderHash IS NULL, so filling
 * hashes here does not re-arm cancel / new-order / shipped alerts.
 *
 * Dry-run by default; prints counts only.
 *   npx tsx scripts/backfill-order-hashes.ts [--user=<id>] [--limit=N]
 *   KX_ALLOW_PROD_WRITE=1 npx tsx scripts/backfill-order-hashes.ts --apply --db-host=<host>
 */
import { runSafeDbScript } from './lib/safeDb';
import { computeOrderHash, itemsHashFromDbRows } from '../lib/orders/orderHash';

void runSafeDbScript('backfill-order-hashes', async ({ prisma, write, args, count }) => {
  let cursor: string | undefined;
  let seen = 0;
  for (;;) {
    const rows = await prisma.order.findMany({
      where: { ...(args.userId ? { userId: args.userId } : {}), OR: [{ orderHash: null }, { itemsHash: null }] },
      select: {
        id: true,
        status: true,
        externalStatus: true,
        totalPrice: true,
        trackingNumber: true,
        shipByAt: true,
        orderHash: true,
        itemsHash: true,
        items: { select: { id: true, uniqueLineKey: true, remoteLineId: true, marketplaceKey: true, quantity: true, unitPrice: true, sku: true, image: true } },
      },
      orderBy: { id: 'asc' },
      take: 300,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const o of rows) {
      seen++;
      const orderHash = o.orderHash ?? computeOrderHash(o);
      const itemsHash = o.itemsHash ?? itemsHashFromDbRows(o.items);
      count('orders.hashed');
      if (write) await prisma.order.update({ where: { id: o.id }, data: { orderHash, itemsHash } });
      if (args.limit && seen >= args.limit) return;
    }
    // In apply mode the WHERE no longer matches written rows; the id cursor keeps paging correct either way.
  }
});
