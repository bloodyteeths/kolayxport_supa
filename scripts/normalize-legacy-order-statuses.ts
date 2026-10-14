/**
 * W4 cleanup: normalise legacy order statuses so every reader agrees.
 *   1. Cancel spellings ('canceled', 'Canceled', 'cancelled', ...) -> 'CANCELLED'.
 *   2. Direct Etsy orders: status re-derived from the stored receipt
 *      (mapEtsyReceiptStatus) when they disagree — except a local lowercase
 *      'shipped' written by submit-tracking while Etsy still says PAID (the
 *      tracking push is pending; the next receipt sync settles it), a case-only
 *      difference, or DELIVERED (receipts have no delivered flag).
 *   3. cancelledAt is set for cancelled orders that have none (from the
 *      receipt's updated_timestamp when available, else updatedAt).
 *
 * Dry-run by default; prints counts only.
 *   npx tsx scripts/normalize-legacy-order-statuses.ts [--user=<id>]
 *   KX_ALLOW_PROD_WRITE=1 npx tsx scripts/normalize-legacy-order-statuses.ts --apply --db-host=<host>
 */
import { runSafeDbScript } from './lib/safeDb';
import { isCancelledStatus, mapEtsyReceiptStatus } from '../lib/orders/orderStatus';

void runSafeDbScript('normalize-legacy-order-statuses', async ({ prisma, write, args, count }) => {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.order.findMany({
      where: { ...(args.userId ? { userId: args.userId } : {}) },
      select: { id: true, status: true, externalStatus: true, marketplaceKey: true, rawData: true, cancelledAt: true, updatedAt: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const o of rows) {
      const raw: any = o.rawData && typeof o.rawData === 'object' ? o.rawData : null;
      const isEtsy = raw?.receipt_id !== undefined && String(raw.receipt_id) === o.marketplaceKey;
      const data: Record<string, any> = {};
      let status = o.status;
      if (isEtsy) {
        const derived = mapEtsyReceiptStatus(raw);
        const pendingPush = o.status === 'shipped' && derived === 'PAID';
        // Receipts carry no delivered flag: never downgrade DELIVERED to SHIPPED.
        const keepDelivered = (o.status || '').toUpperCase() === 'DELIVERED' && derived === 'SHIPPED';
        if (!pendingPush && !keepDelivered && (o.status || '').toUpperCase() !== derived) {
          data.status = derived;
          status = derived;
          count(`status.etsy.${(o.status || 'null').toUpperCase()}->${derived}`);
        }
      } else if (status && status !== 'CANCELLED' && isCancelledStatus(status, null)) {
        if (/^cancel/i.test(status)) {
          data.status = 'CANCELLED';
          status = 'CANCELLED';
          count('status.cancel_spelling');
        }
      }
      if (isCancelledStatus(status, o.externalStatus) && !o.cancelledAt) {
        const ts = Number(raw?.updated_timestamp);
        data.cancelledAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : o.updatedAt;
        count('cancelledAt.set');
      }
      if (Object.keys(data).length === 0) continue;
      count('orders.changed');
      if (write) await prisma.order.update({ where: { id: o.id }, data });
    }
  }
});
