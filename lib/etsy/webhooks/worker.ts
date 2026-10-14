/**
 * Etsy webhook queue worker (owner W1).
 *
 * Queue: WebhookEvent rows with provider='etsy'.
 *   received -> processing -> done | ignored
 *                          -> received (retry with backoff, or a defer that keeps the attempt)
 *                          -> blocked_reauth (shop needs reconnect; requeued on recovery)
 *                          -> failed (terminal after MAX_ATTEMPTS)
 *   received -> coalesced (absorbed by a winner for the same shop+resource)
 *
 * Fairness: candidates are taken per shop (row_number over (priority,
 * createdAt) <= 3) and interleaved round-robin, so one shop's backlog never
 * starves another shop's order event.
 *
 * At most one active winner per resource: the claim excludes resources that
 * already have a 'processing' row, under a per-resource advisory lock. The
 * winner absorbs every other 'received' row of the same resource (status
 * 'coalesced'); the union of their event types and the earliest receipt time
 * are persisted on the winner, so they survive retries.
 *
 * Execution is continuous, not pass-bound: each pass claims only up to free
 * capacity (6 global, 2 per shop) and returns; every finished event kicks the
 * next pass. A slow handler therefore never blocks new order events.
 *
 * Handlers run inside withEtsyBudget({ priority: order ? Critical : Webhook,
 * deferOn429: true }): rate limits/budget/lock waits throw EtsyDeferError and
 * the row is re-queued WITHOUT consuming an attempt.
 *
 * Network I/O never runs inside a DB transaction here; claim transactions are
 * short and DB-only.
 */
import os from 'os';
import prisma from '@/lib/prisma';
import { logIntegrationEvent } from '@/lib/admin/events';
import { EtsyPriority, withEtsyBudget } from '@/lib/etsy/rateBudget';
import { isShopReauthBlocked } from '@/lib/etsy/etsyToken';
import { processState } from '@/lib/processState';
import { isEtsyDeferError, type EtsyEventContext, type HandlerOutcome } from './types';
import {
  ETSY_WEBHOOK_PROVIDER,
  isListingEventType,
  isOrderEventType,
  listingIdFromPayload,
  parseResourceKey,
  receiptIdFromPayload,
} from './events';

export const WORKER_LIMITS = {
  globalConcurrency: 6,
  perShopConcurrency: 2,
  candidatesPerShop: 3,
  maxCandidates: 60,
  heartbeatMs: 30_000,
  staleMs: 3 * 60_000,
  tickMs: 5_000,
  maxAttempts: 10,
  /** Defers stop being free after this many (a resource that always 5xx's must eventually fail). */
  maxFreeDeferrals: 100,
  drainMs: 20_000,
};

/** Delay before the next attempt, indexed by attempts already made - 1. */
export const BACKOFF_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
  6 * 60 * 60_000,
];

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}

// ---------------------------------------------------------------------------
// Claim plan (pure, unit-tested)
// ---------------------------------------------------------------------------

export type ClaimCandidate = {
  id: string;
  shopId: string | null;
  resourceKey: string | null;
  priority: number;
  createdAt: Date;
};

/**
 * Orders candidates fairly: one entry per (shop, resource) — the most urgent
 * row; then round-robin across shops (every shop's best row first, then every
 * shop's second, ...), each round ordered by (priority, createdAt).
 * Shops already at their concurrency cap are skipped.
 */
export function planClaims(
  candidates: ClaimCandidate[],
  opts: { maxTotal: number; perShopCap?: number; runningPerShop?: Map<string, number> } = { maxTotal: 60 },
): ClaimCandidate[] {
  const byUrgency = (a: ClaimCandidate, b: ClaimCandidate) =>
    a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  const sorted = [...candidates].sort(byUrgency);
  const seen = new Set<string>();
  const perShop = new Map<string, ClaimCandidate[]>();
  for (const c of sorted) {
    const shop = c.shopId || '_';
    if (c.resourceKey) {
      const key = `${shop}|${c.resourceKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const list = perShop.get(shop) || [];
    list.push(c);
    perShop.set(shop, list);
  }
  const cap = opts.perShopCap ?? Infinity;
  const out: ClaimCandidate[] = [];
  for (let round = 0; out.length < opts.maxTotal; round++) {
    const layer: ClaimCandidate[] = [];
    for (const [shop, list] of perShop) {
      const running = opts.runningPerShop?.get(shop) ?? 0;
      if (round >= Math.max(0, cap - running)) continue;
      if (list[round]) layer.push(list[round]);
    }
    if (layer.length === 0) break;
    layer.sort(byUrgency);
    for (const c of layer) {
      if (out.length >= opts.maxTotal) break;
      out.push(c);
    }
  }
  return out;
}

/** Union of event types for a coalesced group (pure). */
export function mergeEventTypes(rows: Array<{ eventType: string | null; eventTypes?: string[] | null }>): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.eventType) set.add(r.eventType);
    for (const t of r.eventTypes || []) if (t) set.add(t);
  }
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type ClaimedEvent = {
  id: string;
  eventType: string | null;
  eventTypes: string[];
  shopId: string | null;
  resourceKey: string | null;
  payload: any;
  attempts: number;
  deferrals: number;
  createdAt: Date;
  firstReceivedAt: Date;
  priority: number;
  coalesced: number;
};

export type EventOutcome = 'done' | 'ignored' | 'deferred' | 'retried' | 'failed' | 'blocked';

export type WorkerPassResult = {
  recovered: number;
  candidates: number;
  claimed: number;
  coalesced: number;
  inFlight: number;
  /** Only with wait: outcomes of the events this pass started. */
  outcomes?: Partial<Record<EventOutcome, number>>;
};

const OWNER = `${os.hostname()}:${process.pid}`;
type WorkerState = {
  running: Map<string, { shopId: string; promise: Promise<EventOutcome> }>;
  passInFlight: Promise<WorkerPassResult> | null;
  rerunRequested: boolean;
  kickTimer: NodeJS.Timeout | null;
  kickDueAt: number;
  loopTimer: NodeJS.Timeout | null;
  stopping: boolean;
  lastPassAt: number;
  totals: Record<EventOutcome, number>;
};

// One worker per process, shared by the instrumentation bundle (loop) and the
// API-route bundle (ingest kicks, cron fallback, monitoring) — see lib/processState.ts.
const W = processState<WorkerState>('etsy.webhookWorker', () => ({
  running: new Map(),
  passInFlight: null,
  rerunRequested: false,
  kickTimer: null,
  kickDueAt: 0,
  loopTimer: null,
  stopping: false,
  lastPassAt: 0,
  totals: { done: 0, ignored: 0, deferred: 0, retried: 0, failed: 0, blocked: 0 },
}));

function runningPerShop(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of W.running.values()) m.set(r.shopId, (m.get(r.shopId) || 0) + 1);
  return m;
}

export function getEtsyWorkerStatus() {
  return {
    owner: OWNER,
    loopRunning: Boolean(W.loopTimer),
    stopping: W.stopping,
    lastPassAt: W.lastPassAt ? new Date(W.lastPassAt).toISOString() : null,
    inFlight: W.running.size,
    totals: { ...W.totals },
  };
}

/** True when the in-process loop is running and made a pass within the last 2 minutes. */
export function isEtsyWorkerHealthy(nowMs: number = Date.now()): boolean {
  return Boolean(W.loopTimer) && !W.stopping && nowMs - W.lastPassAt < 2 * 60_000;
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

async function recoverStale(): Promise<number> {
  const n = await prisma.$executeRaw`
    UPDATE "WebhookEvent"
    SET "status" = 'received', "nextAttemptAt" = now(), "heartbeatAt" = NULL,
        "note" = 'recovered:stale_processing'
    WHERE "provider" = 'etsy' AND "status" = 'processing'
      AND COALESCE("heartbeatAt", "processingStartedAt", "nextAttemptAt", "createdAt") < now() - interval '3 minutes'`;
  return Number(n) || 0;
}

async function loadCandidates(limit: number): Promise<ClaimCandidate[]> {
  return prisma.$queryRaw<ClaimCandidate[]>`
    WITH due AS (
      SELECT d."id", d."shopId", d."resourceKey", d."priority", d."createdAt",
             row_number() OVER (PARTITION BY d."shopId" ORDER BY d."priority", d."createdAt") AS rn
      FROM "WebhookEvent" d
      WHERE d."provider" = 'etsy'
        AND d."status" = 'received'
        AND (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= now())
        AND (d."resourceKey" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "WebhookEvent" p
          WHERE p."provider" = 'etsy' AND p."shopId" = d."shopId"
            AND p."resourceKey" = d."resourceKey" AND p."status" = 'processing'))
    )
    SELECT "id", "shopId", "resourceKey", "priority", "createdAt"
    FROM due
    WHERE rn <= ${WORKER_LIMITS.candidatesPerShop}
    ORDER BY "priority", "createdAt"
    LIMIT ${limit}`;
}

type WonRow = {
  id: string;
  eventType: string | null;
  eventTypes: string[] | null;
  shopId: string | null;
  resourceKey: string | null;
  payload: any;
  attempts: number;
  deferrals: number;
  createdAt: Date;
  firstReceivedAt: Date | null;
  priority: number;
};

type LoserRow = {
  eventType: string | null;
  eventTypes: string[] | null;
  createdAt: Date;
  firstReceivedAt: Date | null;
  priority: number;
};

/** Claims one row (and coalesces its siblings) in one short DB-only transaction. */
async function claimEvent(c: ClaimCandidate): Promise<ClaimedEvent | null> {
  const lockKey = `etsy-wh:${c.shopId || '_'}:${c.resourceKey || c.id}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const won = await tx.$queryRaw<WonRow[]>`
      UPDATE "WebhookEvent" w
      SET "status" = 'processing', "attempts" = w."attempts" + 1,
          "processingStartedAt" = now(), "heartbeatAt" = now(), "nextAttemptAt" = now()
      WHERE w."id" = ${c.id} AND w."status" = 'received'
        AND (w."resourceKey" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "WebhookEvent" p
          WHERE p."provider" = 'etsy' AND p."shopId" = w."shopId" AND p."resourceKey" = w."resourceKey"
            AND p."status" = 'processing' AND p."id" <> w."id"))
      RETURNING w."id", w."eventType", w."eventTypes", w."shopId", w."resourceKey", w."payload",
                w."attempts", w."deferrals", w."createdAt", w."firstReceivedAt", w."priority"`;
    const row = won[0];
    if (!row) return null;

    let losers: LoserRow[] = [];
    if (row.resourceKey && row.shopId) {
      losers = await tx.$queryRaw<LoserRow[]>`
        UPDATE "WebhookEvent"
        SET "status" = 'coalesced', "note" = ${`coalesced:${row.id}`.slice(0, 191)},
            "processedAt" = now(), "nextAttemptAt" = NULL
        WHERE "provider" = 'etsy' AND "shopId" = ${row.shopId} AND "resourceKey" = ${row.resourceKey}
          AND "status" = 'received' AND "id" <> ${row.id}
        RETURNING "eventType", "eventTypes", "createdAt", "firstReceivedAt", "priority"`;
    }
    const all = [row, ...losers];
    const eventTypes = mergeEventTypes(all);
    const firstReceivedAt = new Date(Math.min(...all.map((r) => (r.firstReceivedAt ?? r.createdAt).getTime())));
    const priority = Math.min(...all.map((r) => r.priority));
    await tx.$executeRaw`
      UPDATE "WebhookEvent"
      SET "eventTypes" = ${eventTypes}::text[], "firstReceivedAt" = ${firstReceivedAt}, "priority" = ${priority}
      WHERE "id" = ${row.id}`;
    return {
      id: row.id,
      eventType: row.eventType,
      eventTypes,
      shopId: row.shopId,
      resourceKey: row.resourceKey,
      payload: row.payload,
      attempts: row.attempts,
      deferrals: row.deferrals,
      createdAt: row.createdAt,
      firstReceivedAt,
      priority,
      coalesced: losers.length,
    };
  }, { timeout: 15_000, maxWait: 10_000 });
}

async function finishEvent(id: string, status: 'done' | 'ignored', note: string | undefined, userId: string | null) {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      status,
      processedAt: new Date(),
      nextAttemptAt: null,
      heartbeatAt: null,
      note: note ? note.slice(0, 500) : null,
      errorMessage: status === 'ignored' && note ? `ignored:${note}`.slice(0, 200) : null,
      ...(userId ? { userId } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(ev: ClaimedEvent, ctx: EtsyEventContext): Promise<HandlerOutcome> {
  const parsed = parseResourceKey(ev.resourceKey);
  const types = Array.from(ctx.eventTypes);

  if (parsed?.kind === 'receipt' || types.some(isOrderEventType)) {
    const receiptId = parsed?.kind === 'receipt' ? parsed.id : receiptIdFromPayload(ev.payload);
    if (!receiptId) return { outcome: 'ignored', note: 'no receipt id' };
    // W4: the single Etsy order writer. It publishes the live order event
    // (new order -> sound + live row) after its write commits.
    const { handleEtsyOrderEvent } = await import('@/lib/orders/etsyLifecycle');
    return handleEtsyOrderEvent({ ...ctx, receiptId });
  }

  if (parsed?.kind === 'listing' || types.some(isListingEventType)) {
    const listingIdStr = parsed?.kind === 'listing' ? parsed.id : listingIdFromPayload(ev.payload);
    if (!listingIdStr) return { outcome: 'ignored', note: 'no listing_id' };
    const listingId = BigInt(listingIdStr);
    const { handleEtsyListingEvent } = await import('@/lib/etsy/listingCache');
    const out = await handleEtsyListingEvent({ ...ctx, listingId });
    if (out.outcome === 'ignored' && String(out.note || '').startsWith('stub:')) {
      // W3 handler not landed yet: keep today's behaviour.
      const { legacyHandleListingEvent } = await import('./legacyListingHandler');
      return legacyHandleListingEvent({ ...ctx, listingId, payload: ev.payload });
    }
    return out;
  }

  return { outcome: 'ignored', note: 'unsupported event' };
}

function hourBucket(nowMs: number = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 13);
}

async function processClaimed(ev: ClaimedEvent): Promise<EventOutcome> {
  const heartbeat = setInterval(() => {
    prisma.webhookEvent.updateMany({ where: { id: ev.id, status: 'processing' }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
  }, WORKER_LIMITS.heartbeatMs);
  heartbeat.unref?.();

  let userId: string | null = null;
  try {
    if (!ev.shopId) {
      await finishEvent(ev.id, 'ignored', 'no shop id', null);
      return 'ignored';
    }
    const shop = await prisma.etsyShop.findUnique({
      where: { shopId: ev.shopId },
      select: { userId: true, isActive: true, needsReauth: true, needsReauthAt: true, tokenExpiresAt: true },
    });
    if (!shop || !shop.isActive) {
      await finishEvent(ev.id, 'ignored', 'unknown or inactive shop', null);
      return 'ignored';
    }
    userId = shop.userId;
    if (isShopReauthBlocked(shop)) {
      await parkForReauth(ev, userId, 'shop needs reauth');
      return 'blocked';
    }

    const ctx: EtsyEventContext = {
      eventId: ev.id,
      userId,
      shopId: ev.shopId,
      resourceKey: ev.resourceKey || '',
      eventTypes: new Set(ev.eventTypes),
      firstReceivedAt: ev.firstReceivedAt,
      attempt: ev.attempts,
    };
    const isOrder = ev.priority === 0 || ev.eventTypes.some(isOrderEventType);
    const outcome = await withEtsyBudget(
      { shopId: ev.shopId, userId, priority: isOrder ? EtsyPriority.Critical : EtsyPriority.Webhook, deferOn429: true },
      () => dispatch(ev, ctx),
    );
    await finishEvent(ev.id, outcome.outcome, outcome.note, userId);
    return outcome.outcome;
  } catch (err: any) {
    return handleFailure(ev, userId, err);
  } finally {
    clearInterval(heartbeat);
  }
}

async function parkForReauth(ev: ClaimedEvent, userId: string | null, note: string) {
  await prisma.webhookEvent.update({
    where: { id: ev.id },
    data: {
      status: 'blocked_reauth',
      attempts: { decrement: 1 },
      nextAttemptAt: null,
      heartbeatAt: null,
      note: note.slice(0, 500),
      ...(userId ? { userId } : {}),
    },
  });
}

async function handleFailure(ev: ClaimedEvent, userId: string | null, err: any): Promise<EventOutcome> {
  const message = String(err?.message || err).slice(0, 200);
  try {
    if (err?.code === 'SHOP_NOT_FOUND') {
      await finishEvent(ev.id, 'ignored', 'shop not connected', userId);
      return 'ignored';
    }
    if (err?.code === 'ETSY_REAUTH_REQUIRED') {
      await parkForReauth(ev, userId, 'etsy reauth required');
      return 'blocked';
    }
    if (isEtsyDeferError(err) && ev.deferrals < WORKER_LIMITS.maxFreeDeferrals) {
      const retryAfterMs = Math.max(1_000, Number(err.retryAfterMs) || 60_000);
      await prisma.webhookEvent.update({
        where: { id: ev.id },
        data: {
          status: 'received',
          attempts: { decrement: 1 },
          deferrals: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + retryAfterMs),
          heartbeatAt: null,
          note: `deferred:${err.reason}`.slice(0, 500),
          ...(userId ? { userId } : {}),
        },
      });
      return 'deferred';
    }
    if (ev.attempts >= WORKER_LIMITS.maxAttempts) {
      await prisma.webhookEvent.update({
        where: { id: ev.id },
        data: {
          status: 'failed',
          processedAt: new Date(),
          nextAttemptAt: null,
          heartbeatAt: null,
          errorMessage: message,
          ...(userId ? { userId } : {}),
        },
      });
      logIntegrationEvent('error', {
        message: `Etsy webhook ${ev.eventTypes.join('+') || ev.eventType} failed permanently`,
        operation: 'etsy.webhook.failed',
        userId: userId ?? undefined,
        details: { eventId: ev.id, attempts: ev.attempts, error: message },
      });
      void notifyFailedEvent();
      return 'failed';
    }
    const delay = backoffFor(ev.attempts);
    await prisma.webhookEvent.update({
      where: { id: ev.id },
      data: {
        status: 'received',
        nextAttemptAt: new Date(Date.now() + delay),
        heartbeatAt: null,
        errorMessage: message,
        ...(userId ? { userId } : {}),
      },
    });
    logIntegrationEvent('warn', {
      message: `Etsy webhook ${ev.eventTypes.join('+') || ev.eventType} failed, retrying`,
      operation: 'etsy.webhook.retry',
      userId: userId ?? undefined,
      details: { eventId: ev.id, attempts: ev.attempts, retryInMs: delay, error: message },
    });
    return 'retried';
  } catch (dbErr) {
    // Leave the row in 'processing': stale recovery picks it up in 3 minutes.
    logIntegrationEvent('error', {
      message: 'Etsy webhook outcome could not be recorded',
      operation: 'etsy.webhook.outcome_write_failed',
      details: { eventId: ev.id },
      error: dbErr instanceof Error ? dbErr : new Error(String(dbErr)),
    });
    return 'retried';
  }
}

async function notifyFailedEvent() {
  try {
    const { notifyAdmins } = await import('@/lib/notifications');
    const failed1h = await prisma.webhookEvent.count({
      where: { provider: ETSY_WEBHOOK_PROVIDER, status: 'failed', processedAt: { gte: new Date(Date.now() - 60 * 60_000) } },
    });
    await notifyAdmins({
      type: 'webhookBacklog',
      severity: 'error',
      titleKey: 'types.webhookBacklog',
      params: { failed: failed1h, due: 0, oldestMinutes: 0 },
      link: '/admin/monitoring',
      dedupeKey: `webhookBacklog:${hourBucket()}`,
      onlyIfNew: true,
    });
  } catch {
    /* never fail the worker on a notification */
  }
}

// ---------------------------------------------------------------------------
// Pass / loop / kick
// ---------------------------------------------------------------------------

function startEvent(ev: ClaimedEvent) {
  const shopId = ev.shopId || '_';
  const promise = processClaimed(ev)
    .catch((): EventOutcome => 'retried')
    .then((outcome) => {
      W.totals[outcome] = (W.totals[outcome] || 0) + 1;
      return outcome;
    })
    .finally(() => {
      W.running.delete(ev.id);
      if (!W.stopping) kickEtsyWorker(50);
    });
  W.running.set(ev.id, { shopId, promise });
  return promise;
}

async function doPass(): Promise<WorkerPassResult> {
  const result: WorkerPassResult = { recovered: 0, candidates: 0, claimed: 0, coalesced: 0, inFlight: W.running.size };
  if (W.stopping) return result;
  result.recovered = await recoverStale();

  const free = WORKER_LIMITS.globalConcurrency - W.running.size;
  if (free <= 0) {
    W.rerunRequested = true;
    return result;
  }
  const candidates = await loadCandidates(WORKER_LIMITS.maxCandidates);
  result.candidates = candidates.length;
  const plan = planClaims(candidates, {
    maxTotal: WORKER_LIMITS.maxCandidates,
    perShopCap: WORKER_LIMITS.perShopConcurrency,
    runningPerShop: runningPerShop(),
  });

  const started: Promise<EventOutcome>[] = [];
  for (const c of plan) {
    if (W.stopping || W.running.size >= WORKER_LIMITS.globalConcurrency) {
      W.rerunRequested = true;
      break;
    }
    const shop = c.shopId || '_';
    if ((runningPerShop().get(shop) || 0) >= WORKER_LIMITS.perShopConcurrency) continue;
    let claimed: ClaimedEvent | null = null;
    try {
      claimed = await claimEvent(c);
    } catch (err) {
      logIntegrationEvent('warn', {
        message: 'Etsy webhook claim failed',
        operation: 'etsy.webhook.claim_failed',
        details: { eventId: c.id },
        error: err instanceof Error ? err : new Error(String(err)),
      });
      continue;
    }
    if (!claimed) continue;
    result.claimed++;
    result.coalesced += claimed.coalesced;
    started.push(startEvent(claimed));
  }
  if (candidates.length >= WORKER_LIMITS.maxCandidates) W.rerunRequested = true;
  result.inFlight = W.running.size;
  (result as any)._started = started;
  return result;
}

/**
 * One worker pass: recover stale rows, claim up to free capacity, start them.
 * With wait, also waits (up to waitTimeoutMs) for the events it started and
 * reports their outcomes. Concurrent calls share the in-flight pass.
 */
export async function runEtsyWorkerPass(opts: { wait?: boolean; waitTimeoutMs?: number } = {}): Promise<WorkerPassResult> {
  if (W.passInFlight) {
    W.rerunRequested = true;
    const r = await W.passInFlight;
    return { ...r, claimed: 0, coalesced: 0, recovered: 0 };
  }
  W.passInFlight = doPass();
  let result: WorkerPassResult;
  try {
    result = await W.passInFlight;
  } finally {
    W.passInFlight = null;
    W.lastPassAt = Date.now();
    if (W.rerunRequested && !W.stopping) {
      W.rerunRequested = false;
      kickEtsyWorker(250);
    }
  }
  const started: Promise<EventOutcome>[] = (result as any)._started || [];
  delete (result as any)._started;
  if (opts.wait && started.length) {
    const timeout = new Promise<'timeout'>((resolve) => {
      const t = setTimeout(() => resolve('timeout'), opts.waitTimeoutMs ?? 90_000);
      t.unref?.();
    });
    const settled = await Promise.race([Promise.allSettled(started), timeout]);
    const outcomes: Partial<Record<EventOutcome, number>> = {};
    if (settled !== 'timeout') {
      for (const s of settled) {
        const o = s.status === 'fulfilled' ? s.value : 'retried';
        outcomes[o] = (outcomes[o] || 0) + 1;
      }
    }
    result.outcomes = outcomes;
  }
  return result;
}

function runPassLogged(reason: string) {
  runEtsyWorkerPass().catch((err) => {
    logIntegrationEvent('error', {
      message: 'Etsy webhook worker pass crashed',
      operation: 'etsy.webhook.pass_crashed',
      details: { reason },
      error: err instanceof Error ? err : new Error(String(err)),
    });
  });
}

/**
 * Debounced in-process kick (ingest, completions). Never lost: a kick that
 * arrives during a pass sets the rerun flag. Etsy usually fires
 * listing.updated + inventory.updated together; the default 3 s delay lets
 * them coalesce into one refresh.
 */
export function kickEtsyWorker(delayMs = 3_000) {
  if (W.stopping) return;
  if (W.passInFlight) {
    W.rerunRequested = true;
    return;
  }
  const dueAt = Date.now() + Math.max(0, delayMs);
  if (W.kickTimer) {
    if (dueAt >= W.kickDueAt) return;
    clearTimeout(W.kickTimer); // an earlier kick (e.g. an order) wins
  }
  W.kickDueAt = dueAt;
  W.kickTimer = setTimeout(() => {
    W.kickTimer = null;
    runPassLogged('kick');
  }, Math.max(0, delayMs));
  W.kickTimer.unref?.();
}

/** Starts the 5 s worker loop (idempotent). */
export function startEtsyWebhookWorker(): boolean {
  if (W.loopTimer) return false;
  W.stopping = false;
  W.loopTimer = setInterval(() => runPassLogged('tick'), WORKER_LIMITS.tickMs);
  W.loopTimer.unref?.();
  kickEtsyWorker(1_000);
  return true;
}

/** Stops claiming and waits up to drainMs for in-flight events. */
export async function stopEtsyWebhookWorker(drainMs = WORKER_LIMITS.drainMs): Promise<{ drained: boolean; inFlight: number }> {
  W.stopping = true;
  if (W.loopTimer) clearInterval(W.loopTimer);
  W.loopTimer = null;
  if (W.kickTimer) clearTimeout(W.kickTimer);
  W.kickTimer = null;
  const pending = Array.from(W.running.values()).map((r) => r.promise);
  if (pending.length === 0) return { drained: true, inFlight: 0 };
  const done = await Promise.race([
    Promise.allSettled(pending).then(() => true),
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), drainMs);
      t.unref?.();
    }),
  ]);
  return { drained: done, inFlight: W.running.size };
}

/** For queue health checks (no I/O). */
export function __workerInternals() {
  return { running: W.running, owner: OWNER };
}

