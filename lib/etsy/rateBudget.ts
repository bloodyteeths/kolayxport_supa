/**
 * Etsy API rate budget (owner W1). Single node (one systemd service).
 *
 * Two independent limits protect the shared Etsy app quota:
 *
 *  1. Per second: a token bucket (100/s, burst 140), additionally clamped by
 *     Etsy's x-remaining-this-second header when it was just observed.
 *  2. Per day: gates by priority on the fraction of the daily quota already
 *     used. Etsy's own headers (x-limit-per-day / x-remaining-today, from the
 *     latest response) are authoritative; local call counters are the fallback
 *     when no header was seen for 5 minutes.
 *
 *        P0 Critical    allowed until 98%   (never deferred to the next day: retry in 5 min)
 *        P1 Webhook     allowed while < 85% (then deferred to 00:05 UTC)
 *        P3 Interactive allowed while < 90%
 *        P2 Reconcile   allowed while < 70% (then deferred to 00:05 UTC)
 *        P4 Bulk        allowed while < 75% (seller-triggered bulk / scheduled sends of many drafts)
 *
 *     Plus a per-shop cap on P4 Bulk calls per day: BULK_SHOP_DAILY_CAP (20,000 ≈ 6,500 listings), so one
 *     big shop's bulk send can never drain the app's shared quota (measured 2026-10-24 from Etsy's headers:
 *     x-limit-per-second 150, x-limit-per-day 100,000 for our app key).
 *
 *     Plus a per-shop cap on P1+P2 calls per day:
 *        clamp(floor(0.6 * limit / activeShopsToday), 300, 5000)
 *
 * The priority and the worker's "defer instead of sleeping" mode travel in an
 * AsyncLocalStorage context set by withEtsyBudget(), so deep call sites
 * (EtsyClient, draft engine, listing cache) inherit them without new params.
 *
 * Local counters are flushed every 30 s to EtsyApiUsage (and the latest remote
 * header values to EtsyApiQuota), and reloaded on boot (loadEtsyUsageFromDb).
 */
import { AsyncLocalStorage } from 'async_hooks';
import { EtsyDeferError, EtsyRateLimitedError, type EtsyDeferReason } from './webhooks/types';
import { processState } from '@/lib/processState';

export enum EtsyPriority {
  Critical = 0,
  Webhook = 1,
  Reconcile = 2,
  Interactive = 3,
  /** Seller-triggered bulk sends (bulk-sync, scheduled sends): gated at 75% and capped per shop per day. */
  Bulk = 4,
}

export type EtsyBudgetContext = {
  shopId?: string;
  userId?: string;
  priority: EtsyPriority;
  /** Inside the worker: throw EtsyDeferError instead of sleeping on 429/5xx/budget waits. */
  deferOn429?: boolean;
};

export type EtsyBudgetSnapshot = {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  remoteLimit: number | null;
  remoteRemaining: number | null;
  localCalls: number;
  byPriority: Record<number, number>;
  topShops: Array<{ shopId: string; calls: number }>;
  /** true when the remote header values are < 5 min old (they drive the gates). */
  remoteFresh?: boolean;
  /** Fraction of the daily quota considered used by the gates (0..1). */
  usedFraction?: number;
  /** Current per-shop cap for P1+P2 calls today. */
  perShopCap?: number;
  throttled?: number;
  remoteObservedAt?: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUCKET_RATE_PER_SEC = 100;
export const BUCKET_BURST = 140;
export const REMOTE_FRESH_MS = 5 * 60_000;
export const P0_RETRY_MS = 5 * 60_000;
/** Inside the worker a token wait longer than this throws instead of sleeping. */
export const MAX_WORKER_WAIT_MS = 1_000;
export const DEFAULT_DAILY_LIMIT = 100_000;

export const DAILY_GATES: Record<EtsyPriority, number> = {
  [EtsyPriority.Critical]: 0.98,
  [EtsyPriority.Webhook]: 0.85,
  [EtsyPriority.Reconcile]: 0.7,
  [EtsyPriority.Interactive]: 0.9,
  [EtsyPriority.Bulk]: 0.75,
};

/** Max P4 Bulk calls per shop per UTC day (~3 calls per listing → ≈ 6,500 listings). */
export const BULK_SHOP_DAILY_CAP = 20_000;
/** Typical Etsy calls for one draft send (fetch + inventory for the conflict check, update). */
export const BULK_CALLS_PER_DRAFT = 3;

const UNKNOWN_SHOP = '_';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function utcDay(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Milliseconds from now until the next 00:05 UTC. */
export function msUntilNextDayWindow(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5, 0, 0);
  return Math.max(1_000, next - nowMs);
}

export function perShopCap(limit: number, activeShops: number): number {
  const shops = Math.max(1, Math.floor(activeShops) || 1);
  const raw = Math.floor((0.6 * Math.max(0, limit)) / shops);
  return Math.min(5_000, Math.max(300, raw));
}

export type GateInput = {
  priority: EtsyPriority;
  /** Fraction of the daily quota used (0..1+). */
  usedFraction: number;
  /** Calls this shop already made today at P1+P2. */
  shopBackgroundCalls: number;
  shopCap: number;
  /** Calls this shop already made today at P4 Bulk. */
  shopBulkCalls?: number;
  calls?: number;
  nowMs?: number;
};

export type GateResult = { ok: true } | { ok: false; retryAfterMs: number; reason: EtsyDeferReason };

/** The daily gate decision (no I/O, no state). */
export function evaluateDailyGate(input: GateInput): GateResult {
  const nowMs = input.nowMs ?? Date.now();
  const priority = input.priority;
  const threshold = DAILY_GATES[priority] ?? DAILY_GATES[EtsyPriority.Interactive];
  if (input.usedFraction >= threshold) {
    if (priority === EtsyPriority.Critical) return { ok: false, retryAfterMs: P0_RETRY_MS, reason: 'p0_retry' };
    return { ok: false, retryAfterMs: msUntilNextDayWindow(nowMs), reason: 'budget' };
  }
  if (priority === EtsyPriority.Bulk && (input.shopBulkCalls ?? 0) + Math.max(1, input.calls ?? 1) > BULK_SHOP_DAILY_CAP) {
    return { ok: false, retryAfterMs: msUntilNextDayWindow(nowMs), reason: 'budget' };
  }
  if (priority === EtsyPriority.Webhook || priority === EtsyPriority.Reconcile) {
    const calls = Math.max(1, input.calls ?? 1);
    if (input.shopBackgroundCalls + calls > input.shopCap) {
      return { ok: false, retryAfterMs: msUntilNextDayWindow(nowMs), reason: 'budget' };
    }
  }
  return { ok: true };
}

/** Parses Etsy's quota headers. Missing/invalid values come back null. */
export function parseQuotaHeaders(headers: { get(name: string): string | null } | null | undefined): {
  limitPerDay: number | null;
  remainingToday: number | null;
  remainingThisSecond: number | null;
} {
  const n = (name: string) => {
    const raw = headers?.get?.(name);
    if (raw === null || raw === undefined || raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  };
  return {
    limitPerDay: n('x-limit-per-day'),
    remainingToday: n('x-remaining-today'),
    remainingThisSecond: n('x-remaining-this-second'),
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type ShopCounters = { calls: number; background: number; bulk: number };

type DayCounters = {
  day: string;
  total: number;
  throttled: number;
  byPriority: Record<number, number>;
  byShop: Map<string, ShopCounters>;
};

type RemoteState = {
  day: string;
  limit: number | null;
  remaining: number | null;
  observedAt: number;
  perSecondRemaining: number | null;
  perSecondObservedAt: number;
};

type PendingDelta = { day: string; shopId: string; priority: number; calls: number; throttled: number };

type BudgetState = {
  als: AsyncLocalStorage<EtsyBudgetContext>;
  counters: DayCounters;
  remote: RemoteState;
  remoteDirty: boolean;
  lastKnownLimit: number | null;
  pending: Map<string, PendingDelta>;
  bucketTokens: number;
  bucketRefilledAt: number;
  flushTimer: NodeJS.Timeout | null;
  flushing: boolean;
};

function emptyRemote(): RemoteState {
  return { day: '', limit: null, remaining: null, observedAt: 0, perSecondRemaining: null, perSecondObservedAt: 0 };
}

// One budget per process, shared by the instrumentation (worker/scheduler) and
// API-route bundles — see lib/processState.ts.
const S = processState<BudgetState>('etsy.rateBudget', () => ({
  als: new AsyncLocalStorage<EtsyBudgetContext>(),
  counters: freshCounters(utcDay()),
  remote: emptyRemote(),
  remoteDirty: false,
  lastKnownLimit: null,
  pending: new Map<string, PendingDelta>(),
  bucketTokens: BUCKET_BURST,
  bucketRefilledAt: Date.now(),
  flushTimer: null,
  flushing: false,
}));

function freshCounters(day: string): DayCounters {
  return { day, total: 0, throttled: 0, byPriority: {}, byShop: new Map() };
}

function rollDay(nowMs: number = Date.now()): DayCounters {
  const day = utcDay(nowMs);
  if (S.counters.day !== day) S.counters = freshCounters(day);
  return S.counters;
}

function isBackground(priority: EtsyPriority) {
  return priority === EtsyPriority.Webhook || priority === EtsyPriority.Reconcile;
}

function remoteIsFresh(nowMs: number = Date.now()): boolean {
  return S.remote.day === utcDay(nowMs)
    && S.remote.limit !== null
    && S.remote.limit > 0
    && S.remote.remaining !== null
    && nowMs - S.remote.observedAt <= REMOTE_FRESH_MS;
}

function effectiveLimit(): number {
  const envLimit = Number(process.env.ETSY_DAILY_LIMIT);
  return (S.remote.limit && S.remote.limit > 0 ? S.remote.limit : null)
    ?? S.lastKnownLimit
    ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_DAILY_LIMIT);
}

function usedFraction(nowMs: number = Date.now()): number {
  if (remoteIsFresh(nowMs)) {
    const limit = S.remote.limit as number;
    return Math.max(0, limit - (S.remote.remaining as number)) / limit;
  }
  const c = rollDay(nowMs);
  return c.total / effectiveLimit();
}

function activeShopsToday(): number {
  let n = 0;
  for (const [shopId, s] of rollDay().byShop) if (shopId !== UNKNOWN_SHOP && s.calls > 0) n++;
  return Math.max(1, n);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * The effective priority when an inner call/context asks for `inner` inside an
 * outer context at `outer`. Critical is sticky: once a call chain runs at P0
 * (the worker processing an order event), nothing nested inside it can
 * downgrade it to a gated/capped background priority. Otherwise the inner,
 * more specific priority wins.
 */
export function mergeEtsyPriority(outer: EtsyPriority | undefined, inner: EtsyPriority | undefined): EtsyPriority | undefined {
  if (outer === EtsyPriority.Critical || inner === EtsyPriority.Critical) return EtsyPriority.Critical;
  return inner ?? outer;
}

/**
 * Runs fn with a budget context. Nested contexts INHERIT from the enclosing
 * one: shop/user/deferOn429 fall back to the parent's, and a Critical parent
 * keeps the chain at Critical (see mergeEtsyPriority).
 */
export async function withEtsyBudget<T>(ctx: EtsyBudgetContext, fn: () => Promise<T>): Promise<T> {
  const parent = S.als.getStore();
  const next: EtsyBudgetContext = {
    shopId: ctx.shopId ?? parent?.shopId,
    userId: ctx.userId ?? parent?.userId,
    priority: mergeEtsyPriority(parent?.priority, ctx.priority) ?? EtsyPriority.Interactive,
    deferOn429: ctx.deferOn429 ?? parent?.deferOn429,
  };
  return S.als.run(next, fn);
}

export function getEtsyBudgetContext(): EtsyBudgetContext | undefined {
  return S.als.getStore();
}

export function currentEtsyPriority(): EtsyPriority {
  return S.als.getStore()?.priority ?? EtsyPriority.Interactive;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export function canSpend(shopId: string, priority: EtsyPriority, calls = 1): { ok: boolean; retryAfterMs?: number; reason?: EtsyDeferReason } {
  const nowMs = Date.now();
  const shop = rollDay(nowMs).byShop.get(shopId || UNKNOWN_SHOP);
  const res = evaluateDailyGate({
    priority,
    usedFraction: usedFraction(nowMs),
    shopBackgroundCalls: shop?.background ?? 0,
    shopCap: perShopCap(effectiveLimit(), activeShopsToday()),
    shopBulkCalls: shop?.bulk ?? 0,
    calls,
    nowMs,
  });
  return res.ok ? { ok: true } : { ok: false, retryAfterMs: res.retryAfterMs, reason: res.reason };
}

/** Throws EtsyDeferError when the daily gate refuses this call. */
export function assertCanSpend(shopId: string | undefined, priority: EtsyPriority, calls = 1): void {
  const res = canSpend(shopId || UNKNOWN_SHOP, priority, calls);
  if (!res.ok) {
    countThrottled(shopId, priority);
    throw new EtsyDeferError(res.reason || 'budget', res.retryAfterMs ?? 60_000,
      `Etsy daily budget gate refused P${priority} call (${Math.round(usedFraction() * 100)}% used)`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes one token from the per-second bucket. Sleeps for short waits; in
 * worker mode (deferOn429) a wait over 1 s throws EtsyRateLimitedError.
 */
export async function acquireEtsyCall(priority: EtsyPriority, deferOn429 = false): Promise<void> {
  void priority;
  for (let i = 0; i < 50; i++) {
    const now = Date.now();
    // Etsy said this second is exhausted: wait for the next second.
    if (S.remote.perSecondRemaining !== null && S.remote.perSecondRemaining <= 0 && now - S.remote.perSecondObservedAt < 1_000) {
      const wait = 1_000 - (now - S.remote.perSecondObservedAt) + 5;
      if (deferOn429 && wait > MAX_WORKER_WAIT_MS) throw new EtsyRateLimitedError(wait);
      await sleep(wait);
      continue;
    }
    S.bucketTokens = Math.min(BUCKET_BURST, S.bucketTokens + ((now - S.bucketRefilledAt) / 1_000) * BUCKET_RATE_PER_SEC);
    S.bucketRefilledAt = now;
    S.bucketTokens -= 1;
    if (S.bucketTokens >= 0) return;
    const wait = Math.ceil((-S.bucketTokens / BUCKET_RATE_PER_SEC) * 1_000);
    if (deferOn429 && wait > MAX_WORKER_WAIT_MS) {
      S.bucketTokens += 1;
      throw new EtsyRateLimitedError(wait);
    }
    await sleep(wait);
    return;
  }
}

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------

function addPending(day: string, shopId: string, priority: number, calls: number, throttled: number) {
  const key = `${day}|${shopId}|${priority}`;
  const cur = S.pending.get(key) || { day, shopId, priority, calls: 0, throttled: 0 };
  cur.calls += calls;
  cur.throttled += throttled;
  S.pending.set(key, cur);
  ensureFlushTimer();
}

/** Counts one request attempt that is about to be sent. */
export function recordEtsyCall(shopId: string | undefined, priority: EtsyPriority): void {
  const c = rollDay();
  const key = shopId || UNKNOWN_SHOP;
  c.total += 1;
  c.byPriority[priority] = (c.byPriority[priority] || 0) + 1;
  const s = c.byShop.get(key) || { calls: 0, background: 0, bulk: 0 };
  s.calls += 1;
  if (isBackground(priority)) s.background += 1;
  if (priority === EtsyPriority.Bulk) s.bulk += 1;
  c.byShop.set(key, s);
  addPending(c.day, key, priority, 1, 0);
}

function countThrottled(shopId: string | undefined, priority: EtsyPriority) {
  const c = rollDay();
  c.throttled += 1;
  addPending(c.day, shopId || UNKNOWN_SHOP, priority, 0, 1);
}

/** Reads Etsy's quota headers from a response into the budget state. */
export function recordEtsyResponse(res: Response, priority: EtsyPriority, shopId?: string): void {
  try {
    const now = Date.now();
    const q = parseQuotaHeaders(res?.headers as any);
    if (q.limitPerDay !== null && q.remainingToday !== null) {
      S.remote = { ...S.remote, day: utcDay(now), limit: q.limitPerDay, remaining: q.remainingToday, observedAt: now };
      S.lastKnownLimit = q.limitPerDay;
      S.remoteDirty = true;
      ensureFlushTimer();
    }
    if (q.remainingThisSecond !== null) {
      S.remote = { ...S.remote, perSecondRemaining: q.remainingThisSecond, perSecondObservedAt: now };
    }
    if (res?.status === 429) countThrottled(shopId, priority);
  } catch {
    /* accounting must never break a request */
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureFlushTimer() {
  if (S.flushTimer || process.env.NODE_ENV === 'test' || typeof window !== 'undefined') return;
  S.flushTimer = setInterval(() => {
    flushEtsyUsage().catch(() => undefined);
  }, 30_000);
  S.flushTimer.unref?.();
}

/** Writes pending call counters and the latest quota headers to the DB. Never throws. */
export async function flushEtsyUsage(): Promise<{ rows: number; quota: boolean }> {
  if (S.flushing) return { rows: 0, quota: false };
  if (S.pending.size === 0 && !S.remoteDirty) return { rows: 0, quota: false };
  S.flushing = true;
  const batch = Array.from(S.pending.values());
  S.pending.clear();
  const quotaDirty = S.remoteDirty;
  const snapshot = { ...S.remote };
  S.remoteDirty = false;
  let rows = 0;
  try {
    const [{ default: prisma }, { Prisma }, crypto] = await Promise.all([
      import('@/lib/prisma'),
      import('@prisma/client'),
      import('crypto'),
    ]);
    for (const d of batch) {
      try {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO "EtsyApiUsage" ("id", "day", "shopId", "priority", "calls", "throttled", "updatedAt")
          VALUES (${crypto.randomUUID()}, CAST(${d.day} AS date), ${d.shopId}, ${d.priority}, ${d.calls}, ${d.throttled}, now())
          ON CONFLICT ("day", "shopId", "priority") DO UPDATE SET
            "calls" = "EtsyApiUsage"."calls" + EXCLUDED."calls",
            "throttled" = "EtsyApiUsage"."throttled" + EXCLUDED."throttled",
            "updatedAt" = now()`);
        rows++;
      } catch {
        addPending(d.day, d.shopId, d.priority, d.calls, d.throttled);
      }
    }
    if (quotaDirty && snapshot.day && snapshot.limit !== null) {
      try {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO "EtsyApiQuota" ("day", "limitPerDay", "remainingToday", "observedAt")
          VALUES (CAST(${snapshot.day} AS date), ${snapshot.limit}, ${snapshot.remaining}, ${new Date(snapshot.observedAt)})
          ON CONFLICT ("day") DO UPDATE SET
            "limitPerDay" = EXCLUDED."limitPerDay",
            "remainingToday" = EXCLUDED."remainingToday",
            "observedAt" = EXCLUDED."observedAt"
          WHERE "EtsyApiQuota"."observedAt" <= EXCLUDED."observedAt"`);
      } catch {
        S.remoteDirty = true;
      }
    }
    return { rows, quota: quotaDirty };
  } catch {
    for (const d of batch) addPending(d.day, d.shopId, d.priority, d.calls, d.throttled);
    S.remoteDirty = S.remoteDirty || quotaDirty;
    return { rows: 0, quota: false };
  } finally {
    S.flushing = false;
  }
}

/** Boot: reload today's counters and the latest quota so a restart doesn't reset the budget. */
export async function loadEtsyUsageFromDb(): Promise<{ rows: number }> {
  try {
    const { default: prisma } = await import('@/lib/prisma');
    const day = utcDay();
    const dayDate = new Date(`${day}T00:00:00.000Z`);
    const [usage, quota] = await Promise.all([
      prisma.etsyApiUsage.findMany({ where: { day: dayDate } }),
      prisma.etsyApiQuota.findUnique({ where: { day: dayDate } }),
    ]);
    const c = rollDay();
    for (const row of usage) {
      c.total += row.calls;
      c.throttled += row.throttled;
      c.byPriority[row.priority] = (c.byPriority[row.priority] || 0) + row.calls;
      const s = c.byShop.get(row.shopId) || { calls: 0, background: 0, bulk: 0 };
      s.calls += row.calls;
      if (isBackground(row.priority as EtsyPriority)) s.background += row.calls;
      if ((row.priority as EtsyPriority) === EtsyPriority.Bulk) s.bulk += row.calls;
      c.byShop.set(row.shopId, s);
    }
    if (quota && quota.limitPerDay !== null && quota.observedAt.getTime() > S.remote.observedAt) {
      S.remote = { ...S.remote, day, limit: quota.limitPerDay, remaining: quota.remainingToday, observedAt: quota.observedAt.getTime() };
      S.lastKnownLimit = quota.limitPerDay;
    }
    return { rows: usage.length };
  } catch {
    return { rows: 0 };
  }
}

export function getBudgetSnapshot(): EtsyBudgetSnapshot {
  const now = Date.now();
  const c = rollDay(now);
  const topShops = Array.from(c.byShop.entries())
    .map(([shopId, s]) => ({ shopId, calls: s.calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);
  const fresh = remoteIsFresh(now);
  return {
    day: c.day,
    remoteLimit: S.remote.day === c.day ? S.remote.limit : null,
    remoteRemaining: S.remote.day === c.day ? S.remote.remaining : null,
    localCalls: c.total,
    byPriority: { ...c.byPriority },
    topShops,
    remoteFresh: fresh,
    usedFraction: Math.round(usedFraction(now) * 10_000) / 10_000,
    perShopCap: perShopCap(effectiveLimit(), activeShopsToday()),
    throttled: c.throttled,
    remoteObservedAt: S.remote.observedAt ? new Date(S.remote.observedAt).toISOString() : null,
  };
}

/** Test hook: reset all in-memory state. */
export function __resetEtsyBudget(): void {
  S.counters = freshCounters(utcDay());
  S.remote = { day: '', limit: null, remaining: null, observedAt: 0, perSecondRemaining: null, perSecondObservedAt: 0 };
  S.remoteDirty = false;
  S.lastKnownLimit = null;
  S.pending.clear();
  S.bucketTokens = BUCKET_BURST;
  S.bucketRefilledAt = Date.now();
}
