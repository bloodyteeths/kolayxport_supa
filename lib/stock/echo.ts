/**
 * Recognising our own stock writes (W2, T5). Server-only.
 */
import prisma from '@/lib/prisma';
import { getEnabledStockUserIds } from './settings';

export const ECHO_WINDOW_MS = 30 * 60 * 1000;
export const OPEN_PUSH_STATUSES = ['in_flight', 'unknown', 'awaiting_batch'] as const;

/** A recent push of ours for this link sent exactly R. */
export async function isOwnEcho(linkId: string, remoteQty: number, now: Date = new Date()): Promise<boolean> {
  const hit = await prisma.stockPush.findFirst({
    where: {
      linkId,
      status: { in: ['in_flight', 'applied', 'unknown'] },
      sentQty: Math.trunc(remoteQty),
      claimedAt: { gte: new Date(now.getTime() - ECHO_WINDOW_MS) },
    },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Any push for these links still in flight / unverified / awaiting a batch
 * result. A draft-sync echo marker ('in_flight', externalRef 'draft_sync') is
 * not a pending write of the worker: the observation that follows the draft's
 * PUT must run, not defer (isOwnEcho recognises the marker).
 */
export async function hasOpenPush(linkIds: string[]): Promise<boolean> {
  if (!linkIds.length) return false;
  const hit = await prisma.stockPush.findFirst({
    where: {
      linkId: { in: linkIds },
      OR: [
        { status: { in: ['unknown', 'awaiting_batch'] } },
        { status: 'in_flight', OR: [{ externalRef: null }, { externalRef: { not: 'draft_sync' } }] },
      ],
    },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Attribution for listing history (W3): a push of ours on this Etsy listing
 * whose write window contains the listing's updated_timestamp (±10 s).
 */
export async function findOwnStockWrite(shopId: string, listingId: string, remoteUpdatedTs: number): Promise<{ pushId: string } | null> {
  if (!shopId || !listingId || !Number.isFinite(remoteUpdatedTs) || remoteUpdatedTs <= 0) return null;
  const enabled = await getEnabledStockUserIds();
  if (enabled.size === 0) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p."id"
    FROM "StockPush" p
    JOIN "StockLink" l ON l."id" = p."linkId"
    WHERE l."channel" = 'etsy'
      AND l."accountRef" = ${String(shopId)}
      AND l."externalId" = ${String(listingId)}
      AND p."claimedAt" IS NOT NULL
      AND p."status" IN ('in_flight', 'applied', 'unknown')
      AND to_timestamp(${Math.trunc(remoteUpdatedTs)}::double precision)
          BETWEEN p."claimedAt" - interval '10 seconds' AND COALESCE(p."appliedAt", now()) + interval '10 seconds'
    ORDER BY p."claimedAt" DESC
    LIMIT 1`;
  return rows[0] ? { pushId: rows[0].id } : null;
}
