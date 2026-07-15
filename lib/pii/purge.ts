import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Buyer-PII retention enforcement (see docs/security/DATA_HANDLING_POLICY.md).
 *
 * Removes buyer PII from orders older than the retention window while KEEPING the
 * non-PII order metadata (id, marketplace, order number, totals, SKUs, status) that
 * the seller needs for reporting. Specifically:
 *   - Order:         null customerName, giftMessage, customerNote, shippingAddress, rawData
 *   - OrderShipping: delete the structured recipient row (name/street/city/phone)
 *   - EtsyAddress:   delete the cached address row
 *
 * SAFETY: dry-run by default. It only deletes when PII_PURGE_DRY_RUN=false is set
 * explicitly, so a deploy never silently destroys data — review the dry-run counts
 * in the logs first, then enable.
 *
 * Env:
 *   PII_RETENTION_DAYS  retention window in days (default 90)
 *   PII_PURGE_DRY_RUN   'false' to actually delete; anything else = dry-run (default)
 */

const DEFAULT_RETENTION_DAYS = 90;

export interface PiiPurgeResult {
  dryRun: boolean;
  retentionDays: number;
  cutoff: string;
  // counts of records past retention still holding PII
  ordersWithPii: number;
  orderShippingRows: number;
  etsyAddressRows: number;
  // counts actually modified (0 in dry-run)
  ordersPurged: number;
  orderShippingDeleted: number;
  etsyAddressesDeleted: number;
}

function resolveRetentionDays(override?: number): number {
  if (typeof override === 'number' && override > 0) return override;
  const env = Number(process.env.PII_RETENTION_DAYS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_RETENTION_DAYS;
}

function resolveDryRun(override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  // Default to dry-run; real deletion requires an explicit opt-out.
  return (process.env.PII_PURGE_DRY_RUN ?? 'true') !== 'false';
}

export async function purgeExpiredPii(opts?: {
  retentionDays?: number;
  dryRun?: boolean;
}): Promise<PiiPurgeResult> {
  const retentionDays = resolveRetentionDays(opts?.retentionDays);
  const dryRun = resolveDryRun(opts?.dryRun);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // Orders past retention that still hold scalar buyer PII. (The structured address
  // in OrderShipping is handled separately by date, so json-only edge cases are
  // still covered there.)
  const orderWhere: Prisma.OrderWhereInput = {
    createdAt: { lt: cutoff },
    OR: [
      { customerName: { not: null } },
      { giftMessage: { not: null } },
      { customerNote: { not: null } },
    ],
  };

  const [ordersWithPii, orderShippingRows, etsyAddressRows] = await Promise.all([
    prisma.order.count({ where: orderWhere }),
    prisma.orderShipping.count({ where: { insertedAt: { lt: cutoff } } }),
    prisma.etsyAddress.count({ where: { createdAt: { lt: cutoff } } }),
  ]);

  let ordersPurged = 0;
  let orderShippingDeleted = 0;
  let etsyAddressesDeleted = 0;

  if (!dryRun) {
    const upd = await prisma.order.updateMany({
      where: orderWhere,
      data: {
        customerName: null,
        giftMessage: null,
        customerNote: null,
        shippingAddress: Prisma.DbNull,
        rawData: Prisma.DbNull,
      },
    });
    ordersPurged = upd.count;

    const delShip = await prisma.orderShipping.deleteMany({ where: { insertedAt: { lt: cutoff } } });
    orderShippingDeleted = delShip.count;

    const delEtsy = await prisma.etsyAddress.deleteMany({ where: { createdAt: { lt: cutoff } } });
    etsyAddressesDeleted = delEtsy.count;
  }

  const result: PiiPurgeResult = {
    dryRun,
    retentionDays,
    cutoff: cutoff.toISOString(),
    ordersWithPii,
    orderShippingRows,
    etsyAddressRows,
    ordersPurged,
    orderShippingDeleted,
    etsyAddressesDeleted,
  };

  logger.event(
    'security',
    'info',
    dryRun ? 'PII retention purge (dry-run — nothing deleted)' : 'PII retention purge executed',
    result,
    { operation: 'pii.purge' },
  );

  return result;
}
