/**
 * Stock push worker (W2, T9). Server-only.
 *
 * Claim: pending rows due now whose link has no push in flight / unknown /
 * awaiting a batch (so a link never has two writes outstanding), FOR UPDATE
 * SKIP LOCKED, max 200. Claimed rows go in_flight with pendingKey=NULL so a
 * new enqueue for the link creates a fresh pending row.
 *
 * Execution recomputes the target from the CURRENT onHand. Dry run marks
 * 'dry_run' without any adapter call. Results:
 *   applied   -> link.lastPushedQty / lastSeenRemoteQty updated
 *   skipped   -> remote already equal
 *   unknown   -> write may have landed (timeout); next pass verifies by GET
 *   awaiting_batch -> Trendyol batch; resolved via getBatchStatus (24 h max)
 *   retry     -> deferred without consuming an attempt
 *   failed    -> backoff [30s,2m,10m,30m,2h], max 6 attempts, then
 *                'failed' + stockPushFailed notification (deduped per link per 6 h)
 * In-flight rows whose heartbeat (updatedAt) is older than 5 min become
 * 'unknown'; a running worker re-stamps its claimed rows every minute so a
 * long run never has its own rows stolen. Unknown rows that cannot be read
 * back are rotated (updatedAt bumped) and, after UNKNOWN_REPEND_MS, go back to
 * pending so a fresh read-before-write push replaces them.
 *
 * One run per process: the guard lives in processState (shared between the
 * instrumentation bundle and the API-route bundle).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { publishLive } from '@/lib/live/publish';
import { getAdapter } from './adapters';
import type { PushItem, PushResult, StockLinkRow } from './adapters/types';
import { channelEnabled, getStockSettings, isStockSyncActive, type StockSettingsRow } from './settings';
import { computeLinkTarget, pushBackoffMs, PUSH_MAX_ATTEMPTS } from './math';
import { kickStockPushWorker, STOCK_PAGE_LINK } from './engine';
import { processState } from '@/lib/processState';

const CLAIM_LIMIT = 200;
const MAX_ROUNDS = 5;
const STALE_IN_FLIGHT_MIN = 5;
const BATCH_MAX_AGE_MS = 24 * 3600 * 1000;
const SIX_HOURS_MS = 6 * 3600 * 1000;
const HEARTBEAT_MS = 60_000;
/** An unknown push still unreadable after this goes back to pending (fresh read-before-write). */
export const UNKNOWN_REPEND_MS = 15 * 60 * 1000;

type Claimed = { id: string; userId: string; stockItemId: string; linkId: string; reason: string; targetQty: number; attempts: number };

export type WorkerStats = { claimed: number; applied: number; skipped: number; failed: number; dryRun: number; unknown: number; awaiting: number; retried: number; verified: number };

const guard = processState('stock.pushWorker', () => ({ running: false, rerun: false, inFlight: new Set<string>() }));

function zero(): WorkerStats {
  return { claimed: 0, applied: 0, skipped: 0, failed: 0, dryRun: 0, unknown: 0, awaiting: 0, retried: 0, verified: 0 };
}

function warn(msg: string, details: Record<string, unknown>) {
  try {
    void Promise.resolve(logger.warn(msg, details)).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export async function runStockPushWorker(opts: { trigger?: string } = {}): Promise<WorkerStats> {
  const stats = zero();
  if (guard.running) {
    guard.rerun = true;
    return stats;
  }
  guard.running = true;
  // Heartbeat: keep this run's claimed rows fresh so markStaleInFlight never
  // turns them into 'unknown' while they are still being processed.
  const heartbeat = setInterval(() => {
    const ids = Array.from(guard.inFlight);
    if (!ids.length) return;
    void prisma.stockPush
      .updateMany({ where: { id: { in: ids }, status: 'in_flight' }, data: { updatedAt: new Date() } })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  (heartbeat as any)?.unref?.();
  try {
    await markStaleInFlight();
    stats.verified += await verifyUnknown();
    await resolveBatches(stats);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const claimed = await claim();
      if (!claimed.length) break;
      stats.claimed += claimed.length;
      for (const c of claimed) guard.inFlight.add(c.id);
      try {
        await processClaimed(claimed, stats);
      } finally {
        for (const c of claimed) guard.inFlight.delete(c.id);
      }
      if (claimed.length < CLAIM_LIMIT) break;
    }
  } catch (err) {
    warn('stock.push_worker_failed', { trigger: opts.trigger, error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(heartbeat);
    guard.inFlight.clear();
    guard.running = false;
    if (guard.rerun) {
      guard.rerun = false;
      kickStockPushWorker(1000);
    }
  }
  return stats;
}

async function claim(): Promise<Claimed[]> {
  return prisma.$queryRaw<Claimed[]>`
    WITH c AS (
      SELECT p."id"
      FROM "StockPush" p
      WHERE p."status" = 'pending'
        AND p."nextAttemptAt" <= now()
        AND NOT EXISTS (
          SELECT 1 FROM "StockPush" q
          WHERE q."linkId" = p."linkId" AND q."status" IN ('in_flight', 'unknown', 'awaiting_batch')
            -- a draft-sync echo marker is not a worker write (the push waits on the inventory lock anyway)
            AND NOT (q."status" = 'in_flight' AND COALESCE(q."externalRef", '') = 'draft_sync')
        )
      ORDER BY p."nextAttemptAt" ASC
      LIMIT ${CLAIM_LIMIT}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "StockPush" s
    SET "status" = 'in_flight', "claimedAt" = now(), "pendingKey" = NULL, "attempts" = s."attempts" + 1, "updatedAt" = now()
    FROM c
    WHERE s."id" = c."id"
    RETURNING s."id", s."userId", s."stockItemId", s."linkId", s."reason", s."targetQty", s."attempts"`;
}

async function markStaleInFlight(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "StockPush" SET "status" = 'unknown', "updatedAt" = now()
    WHERE "status" = 'in_flight'
      AND "claimedAt" < now() - make_interval(mins => ${STALE_IN_FLIGHT_MIN}::int)
      AND "updatedAt" < now() - make_interval(mins => ${STALE_IN_FLIGHT_MIN}::int)`;
}

/** Put a push back to pending (only if the link has no other pending row). */
async function repend(id: string, linkId: string, at: Date, patch: { lastError?: string | null; attemptsDelta?: number } = {}): Promise<boolean> {
  try {
    const n = await prisma.$executeRaw`
      UPDATE "StockPush"
      SET "status" = 'pending', "pendingKey" = ${linkId}, "nextAttemptAt" = ${at},
          "attempts" = GREATEST(0, "attempts" + ${patch.attemptsDelta ?? 0}::int),
          "lastError" = ${patch.lastError ?? null}, "updatedAt" = now()
      WHERE "id" = ${id}
        AND NOT EXISTS (SELECT 1 FROM "StockPush" o WHERE o."pendingKey" = ${linkId})`;
    if (n > 0) return true;
  } catch {
    /* unique race: a newer pending row exists */
  }
  await prisma.stockPush.update({ where: { id }, data: { status: 'superseded', lastError: patch.lastError ?? 'superseded' } });
  return false;
}

async function processClaimed(claimed: Claimed[], stats: WorkerStats): Promise<void> {
  const links = await prisma.stockLink.findMany({ where: { id: { in: claimed.map((c) => c.linkId) } } });
  const items = await prisma.stockItem.findMany({ where: { id: { in: Array.from(new Set(claimed.map((c) => c.stockItemId))) } } });
  const linkById = new Map(links.map((l) => [l.id, l]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const settingsByUser = new Map<string, StockSettingsRow | null>();
  for (const uid of Array.from(new Set(claimed.map((c) => c.userId)))) settingsByUser.set(uid, await getStockSettings(uid, { fresh: true }));

  const groups = new Map<string, { userId: string; channel: string; items: PushItem[] }>();
  for (const c of claimed) {
    const link = linkById.get(c.linkId);
    const item = itemById.get(c.stockItemId);
    const settings = settingsByUser.get(c.userId) ?? null;
    if (!link || !item || link.userId !== c.userId || item.userId !== c.userId) {
      await prisma.stockPush.update({ where: { id: c.id }, data: { status: 'superseded', lastError: 'link_or_item_missing' } });
      continue;
    }
    if (link.status !== 'active' || item.tracking !== 'tracked' || item.status !== 'active') {
      await prisma.stockPush.update({ where: { id: c.id }, data: { status: 'superseded', lastError: `link_${link.status}_item_${item.status}` } });
      continue;
    }
    if (!isStockSyncActive(settings) || !channelEnabled(settings, link.channel)) {
      await prisma.stockPush.update({ where: { id: c.id }, data: { status: 'skipped', lastError: 'disabled' } });
      stats.skipped++;
      continue;
    }
    const target = computeLinkTarget({ onHand: item.onHand, safetyBuffer: item.safetyBuffer, buffer: link.buffer, unitsPerSale: link.unitsPerSale, maxListedQty: link.maxListedQty });
    if (settings!.dryRun) {
      // Dry run: record what would be sent, never call the marketplace.
      await prisma.stockPush.update({ where: { id: c.id }, data: { status: 'dry_run', targetQty: target, freshRemoteQty: link.lastSeenRemoteQty } });
      stats.dryRun++;
      continue;
    }
    const adapter = getAdapter(link.channel);
    if (!adapter || !adapter.supportsWrite) {
      const reason = adapter?.unsupportedReason || 'unsupported_channel';
      await prisma.stockPush.update({ where: { id: c.id }, data: { status: 'failed', lastError: reason } });
      await prisma.stockLink.update({ where: { id: link.id }, data: { status: 'unsupported', statusReason: reason } });
      stats.failed++;
      continue;
    }
    if (target !== c.targetQty) await prisma.stockPush.update({ where: { id: c.id }, data: { targetQty: target } });
    const key = `${c.userId}|${link.channel}`;
    const g = groups.get(key) || { userId: c.userId, channel: link.channel, items: [] };
    g.items.push({ pushId: c.id, link, targetQty: target, reason: c.reason });
    groups.set(key, g);
  }

  const attemptsById = new Map(claimed.map((c) => [c.id, c.attempts]));
  for (const g of Array.from(groups.values())) {
    const adapter = getAdapter(g.channel)!;
    let results: PushResult[];
    try {
      results = await adapter.pushQuantities(g.userId, g.items, { settings: settingsByUser.get(g.userId)! });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results = g.items.map((it) => ({ pushId: it.pushId, linkId: it.link.id, status: 'failed' as const, retryable: true, error: msg }));
    }
    const seen = new Set<string>();
    for (const r of results) {
      seen.add(r.pushId);
      const it = g.items.find((x) => x.pushId === r.pushId);
      if (!it) continue;
      await applyResult(it, r, attemptsById.get(r.pushId) ?? 1, stats);
    }
    // An adapter that forgot an item: treat as unknown (verify by read next pass).
    for (const it of g.items) {
      if (!seen.has(it.pushId)) {
        await prisma.stockPush.update({ where: { id: it.pushId }, data: { status: 'unknown', lastError: 'no_result' } });
        stats.unknown++;
      }
    }
  }
}

async function applyResult(it: PushItem, r: PushResult, attempts: number, stats: WorkerStats): Promise<void> {
  const link = it.link;
  const now = new Date();
  if (r.linkPatch && Object.keys(r.linkPatch).length) {
    await prisma.stockLink.update({ where: { id: link.id }, data: r.linkPatch as any }).catch(() => undefined);
  }
  switch (r.status) {
    case 'applied': {
      await prisma.stockPush.update({
        where: { id: it.pushId },
        data: { status: 'applied', appliedAt: now, freshRemoteQty: r.freshRemoteQty ?? null, sentQty: r.sentQty ?? null, remoteQtyAfter: r.remoteQtyAfter ?? r.sentQty ?? null, externalRef: r.externalRef ?? null, lastError: null },
      });
      const after = r.remoteQtyAfter ?? r.sentQty ?? null;
      await prisma.stockLink.update({
        where: { id: link.id },
        data: { lastPushedQty: r.sentQty ?? null, lastPushedAt: now, ...(after !== null ? { lastSeenRemoteQty: after, lastSeenAt: now } : {}) },
      });
      publishLive(link.userId, { type: 'stock', kind: 'push_applied', stockItemId: link.stockItemId, linkId: link.id, channel: link.channel });
      stats.applied++;
      return;
    }
    case 'skipped': {
      await prisma.stockPush.update({ where: { id: it.pushId }, data: { status: 'skipped', freshRemoteQty: r.freshRemoteQty ?? null, sentQty: null, lastError: null } });
      // Etsy expected state is owned by observations; other channels just mirror the read.
      if (link.channel !== 'etsy' && r.freshRemoteQty !== null && r.freshRemoteQty !== undefined) {
        await prisma.stockLink.update({ where: { id: link.id }, data: { lastSeenRemoteQty: r.freshRemoteQty, lastSeenAt: now } });
      }
      stats.skipped++;
      return;
    }
    case 'unknown': {
      await prisma.stockPush.update({ where: { id: it.pushId }, data: { status: 'unknown', freshRemoteQty: r.freshRemoteQty ?? null, sentQty: r.sentQty ?? null, lastError: r.error ?? null } });
      stats.unknown++;
      return;
    }
    case 'awaiting_batch': {
      await prisma.stockPush.update({ where: { id: it.pushId }, data: { status: 'awaiting_batch', freshRemoteQty: r.freshRemoteQty ?? null, sentQty: r.sentQty ?? null, externalRef: r.externalRef ?? null } });
      stats.awaiting++;
      return;
    }
    case 'retry': {
      await repend(it.pushId, link.id, new Date(Date.now() + Math.max(5_000, r.deferMs ?? 30_000)), { lastError: r.error ?? 'deferred', attemptsDelta: -1 });
      stats.retried++;
      return;
    }
    case 'failed':
    default: {
      if (r.retryable && attempts < PUSH_MAX_ATTEMPTS) {
        await repend(it.pushId, link.id, new Date(Date.now() + pushBackoffMs(attempts)), { lastError: r.error ?? 'failed' });
        stats.retried++;
        return;
      }
      await prisma.stockPush.update({ where: { id: it.pushId }, data: { status: 'failed', freshRemoteQty: r.freshRemoteQty ?? null, lastError: r.error ?? 'failed' } });
      stats.failed++;
      await notifyPushFailed(link, r.error ?? 'failed');
    }
  }
}

async function notifyPushFailed(link: StockLinkRow, error: string) {
  const item = await prisma.stockItem.findUnique({ where: { id: link.stockItemId }, select: { displaySku: true } });
  const bucket = Math.floor(Date.now() / SIX_HOURS_MS);
  void notify(link.userId, {
    type: 'stockPushFailed',
    severity: 'error',
    titleKey: 'types.stockPushFailed',
    params: { sku: item?.displaySku || link.remoteSku || '', channel: link.channel },
    link: STOCK_PAGE_LINK,
    dedupeKey: `stock:pushfail:${link.id}:${bucket}`,
    entity: { type: 'stockLink', id: link.id },
  });
  publishLive(link.userId, { type: 'stock', kind: 'push_failed', stockItemId: link.stockItemId, linkId: link.id, channel: link.channel });
  void error;
}

/** unknown -> fresh GET: remote == sentQty means applied, otherwise back to pending. */
async function verifyUnknown(): Promise<number> {
  const rows = await prisma.stockPush.findMany({ where: { status: 'unknown' }, orderBy: { updatedAt: 'asc' }, take: 100 });
  if (!rows.length) return 0;
  const links = await prisma.stockLink.findMany({ where: { id: { in: rows.map((r) => r.linkId) } } });
  const linkById = new Map(links.map((l) => [l.id, l]));
  let verified = 0;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const l = linkById.get(r.linkId);
    if (!l) {
      await prisma.stockPush.update({ where: { id: r.id }, data: { status: 'superseded', lastError: 'link_missing' } });
      continue;
    }
    const k = `${r.userId}|${l.channel}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  for (const [k, group] of Array.from(groups.entries())) {
    const [userId, channel] = k.split('|');
    const adapter = getAdapter(channel);
    if (!adapter) continue;
    let remote: Map<string, { qty: number }>;
    try {
      remote = await adapter.readQuantities(userId, group.map((r) => linkById.get(r.linkId)!).filter(Boolean));
    } catch {
      remote = new Map();
    }
    for (const r of group) {
      const q = remote.get(r.linkId)?.qty;
      if (q === undefined) {
        await unverifiable(r);
        continue;
      }
      if (r.sentQty !== null && q === r.sentQty) {
        const now = new Date();
        await prisma.stockPush.update({ where: { id: r.id }, data: { status: 'applied', appliedAt: now, remoteQtyAfter: q, lastError: null } });
        await prisma.stockLink.update({ where: { id: r.linkId }, data: { lastPushedQty: q, lastPushedAt: now, lastSeenRemoteQty: q, lastSeenAt: now } });
        verified++;
      } else {
        await repend(r.id, r.linkId, new Date(), { lastError: `unverified remote=${q} sent=${r.sentQty}` });
      }
    }
  }
  return verified;
}

export type UnverifiableAction = 'rotate' | 'repend' | 'fail';

/**
 * Pure: what to do with an unknown push we could not read back. Rows that
 * stay unreadable go back to pending after UNKNOWN_REPEND_MS (the fresh push
 * reads before it writes, so a write that did land is never repeated blindly);
 * a row that keeps cycling for a day is given up.
 */
export function unverifiableAction(claimedAt: Date | null, now = Date.now()): UnverifiableAction {
  const age = now - (claimedAt?.getTime() ?? 0);
  if (age > BATCH_MAX_AGE_MS) return 'fail';
  if (age > UNKNOWN_REPEND_MS) return 'repend';
  return 'rotate';
}

async function unverifiable(r: { id: string; linkId: string; claimedAt: Date | null }): Promise<void> {
  const action = unverifiableAction(r.claimedAt);
  if (action === 'fail') {
    await prisma.stockPush.update({ where: { id: r.id }, data: { status: 'failed', lastError: 'unverifiable' } });
  } else if (action === 'repend') {
    await repend(r.id, r.linkId, new Date(), { lastError: 'unverifiable_repend' });
  } else {
    // Rotate: the oldest-updated rows are read first, so bump this one to the back.
    await prisma.stockPush.update({ where: { id: r.id }, data: { updatedAt: new Date() } });
  }
}

/** awaiting_batch (Trendyol) -> applied / pending / unknown. */
async function resolveBatches(stats: WorkerStats): Promise<void> {
  const rows = await prisma.stockPush.findMany({ where: { status: 'awaiting_batch' }, take: 300 });
  if (!rows.length) return;
  const links = await prisma.stockLink.findMany({ where: { id: { in: rows.map((r) => r.linkId) } } });
  const linkById = new Map(links.map((l) => [l.id, l]));
  const byBatch = new Map<string, typeof rows>();
  for (const r of rows) {
    const l = linkById.get(r.linkId);
    if (!l || !r.externalRef) {
      await prisma.stockPush.update({ where: { id: r.id }, data: { status: 'unknown' } });
      continue;
    }
    const k = `${r.userId}|${l.channel}|${l.accountRef}|${r.externalRef}`;
    byBatch.set(k, [...(byBatch.get(k) || []), r]);
  }
  for (const [k, group] of Array.from(byBatch.entries())) {
    const [userId, channel, accountRef, batchRef] = k.split('|');
    const adapter = getAdapter(channel);
    if (!adapter?.resolveBatch) continue;
    let res: Awaited<ReturnType<NonNullable<typeof adapter.resolveBatch>>>;
    try {
      res = await adapter.resolveBatch(userId, accountRef, batchRef);
    } catch {
      continue;
    }
    const now = new Date();
    for (const r of group) {
      const link = linkById.get(r.linkId)!;
      if (!res.done) {
        if (now.getTime() - (r.claimedAt?.getTime() ?? 0) > BATCH_MAX_AGE_MS) {
          await prisma.stockPush.update({ where: { id: r.id }, data: { status: 'unknown', lastError: 'batch_timeout' } });
        }
        continue;
      }
      if (res.error || res.failedBarcodes?.has(link.externalId)) {
        await applyResult({ pushId: r.id, link, targetQty: r.targetQty, reason: r.reason }, { pushId: r.id, linkId: link.id, status: 'failed', retryable: true, error: res.error || 'batch_item_failed' }, r.attempts, stats);
        continue;
      }
      await prisma.stockPush.update({ where: { id: r.id }, data: { status: 'applied', appliedAt: now, remoteQtyAfter: r.sentQty, lastError: null } });
      await prisma.stockLink.update({ where: { id: link.id }, data: { lastPushedQty: r.sentQty, lastPushedAt: now, ...(r.sentQty !== null ? { lastSeenRemoteQty: r.sentQty, lastSeenAt: now } : {}) } });
      stats.applied++;
    }
  }
}
