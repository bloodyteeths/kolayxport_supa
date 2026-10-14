/**
 * Who changed an Etsy listing? (owner W3)
 *
 * Attribution compares Etsy's listing updated_timestamp (seconds) against our
 * own write windows. The webhook emittedAt is NEVER used: a late or retried
 * webhook must still attribute a draft sync correctly.
 *
 *   1. draftId given (our own draft sync refresh)                 -> kolayxport_draft
 *   2. an EtsyDraftSyncAttempt for this listing whose
 *      remoteUpdatedTimestamp == ts, or whose
 *      [startedAt-10s, finishedAt+10s] window contains ts
 *      (a running attempt is open-ended)                          -> kolayxport_draft
 *   3. W2 findOwnStockWrite(shop, listing, ts)                     -> kolayxport_stock
 *   4. source reconcile / initial                                  -> unknown
 *   5. otherwise                                                   -> external
 */
import prisma from '@/lib/prisma';
import { findOwnStockWrite } from '@/lib/stock/hooks';

export type Attribution = 'kolayxport_draft' | 'kolayxport_stock' | 'external' | 'unknown';

export type AttributionResult = {
  attribution: Attribution;
  draftId?: string | null;
  syncAttemptId?: string | null;
  stockPushId?: string | null;
};

export const ATTRIBUTION_SLACK_MS = 10_000;
/** A 'running' attempt older than this is treated as dead (STALE_SYNCING_MS). */
export const RUNNING_ATTEMPT_MAX_MS = 10 * 60_000;

export type AttemptLike = {
  id: string;
  draftId: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  remoteUpdatedTimestamp: number | null;
};

/** Pure: does this sync attempt explain a remote change at `tsSec`? */
export function attemptExplains(attempt: AttemptLike, tsSec: number, now: number = Date.now()): boolean {
  if (!tsSec) return false;
  if (attempt.remoteUpdatedTimestamp && attempt.remoteUpdatedTimestamp === tsSec) return true;
  const tsMs = tsSec * 1000;
  const start = attempt.startedAt.getTime() - ATTRIBUTION_SLACK_MS;
  let end: number;
  if (attempt.finishedAt) {
    end = attempt.finishedAt.getTime() + ATTRIBUTION_SLACK_MS;
  } else if (attempt.status === 'running' && now - attempt.startedAt.getTime() < RUNNING_ATTEMPT_MAX_MS) {
    end = now + ATTRIBUTION_SLACK_MS;
  } else {
    return false;
  }
  return tsMs >= start && tsMs <= end;
}

/** Pure decision once the lookups are done (unit tested). */
export function decideAttribution(input: {
  draftId?: string | null;
  syncAttemptId?: string | null;
  matchedAttempt?: { id: string; draftId: string } | null;
  stockPushId?: string | null;
  source: string;
}): AttributionResult {
  if (input.draftId) return { attribution: 'kolayxport_draft', draftId: input.draftId, syncAttemptId: input.syncAttemptId ?? null };
  if (input.matchedAttempt) {
    return { attribution: 'kolayxport_draft', draftId: input.matchedAttempt.draftId, syncAttemptId: input.matchedAttempt.id };
  }
  if (input.stockPushId) return { attribution: 'kolayxport_stock', stockPushId: input.stockPushId };
  if (input.source === 'reconcile' || input.source === 'initial') return { attribution: 'unknown' };
  return { attribution: 'external' };
}

export async function findExplainingAttempt(shopId: string, listingId: bigint, tsSec: number): Promise<AttemptLike | null> {
  if (!tsSec) return null;
  const tsDate = new Date(tsSec * 1000);
  const rows = await prisma.etsyDraftSyncAttempt.findMany({
    where: {
      OR: [{ etsyListingId: listingId }, { draft: { etsyShopId: shopId, etsyListingId: listingId } }],
      AND: [
        {
          OR: [
            { remoteUpdatedTimestamp: tsSec },
            {
              startedAt: {
                lte: new Date(tsDate.getTime() + ATTRIBUTION_SLACK_MS),
                gte: new Date(tsDate.getTime() - 6 * 60 * 60_000),
              },
            },
          ],
        },
      ],
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: { id: true, draftId: true, status: true, startedAt: true, finishedAt: true, remoteUpdatedTimestamp: true },
  });
  const now = Date.now();
  return rows.find((r) => attemptExplains(r, tsSec, now)) || null;
}

export async function attributeChange(
  shopId: string,
  listingId: bigint,
  remoteUpdatedTs: number,
  ctx: { source: string; draftId?: string | null; syncAttemptId?: string | null },
): Promise<AttributionResult> {
  if (ctx.draftId) return decideAttribution({ draftId: ctx.draftId, syncAttemptId: ctx.syncAttemptId, source: ctx.source });
  let matchedAttempt: AttemptLike | null = null;
  try {
    matchedAttempt = await findExplainingAttempt(shopId, listingId, remoteUpdatedTs);
  } catch {
    matchedAttempt = null;
  }
  let stockPushId: string | null = null;
  if (!matchedAttempt) {
    try {
      const own = await findOwnStockWrite(shopId, String(listingId), remoteUpdatedTs);
      stockPushId = own?.pushId ?? null;
    } catch {
      stockPushId = null;
    }
  }
  return decideAttribution({ matchedAttempt, stockPushId, source: ctx.source });
}

export function isOwnAttribution(a: Attribution | string | null | undefined): boolean {
  return typeof a === 'string' && a.startsWith('kolayxport_');
}
