/**
 * Research quota layer for the Chrome extension's research overlays.
 *
 * The overlays (Etsy / eBay / Amazon search + listing analysis) call our commercial
 * marketplace APIs (Etsy v3, eBay Browse, Amazon SP-API) on basic tiers, so one heavy
 * user must not drain the shared quota. Three mechanisms, all stored in `ResearchCache`
 * (no schema change; `userId` has no FK):
 *
 * 1. Shared cross-user cache: public marketplace data under userId `__shared__`, key
 *    `ext:v1:<marketplace>:<action>:<site>:<normalised query or id>`. Searches 6 h,
 *    listing / item details 24 h. A hit costs the user nothing.
 * 2. Per-plan daily lookups (`EXT_RESEARCH_DAILY_LOOKUPS`, lib/billing/planLimits.ts):
 *    userId `<user>`, key `quota:ext:YYYY-MM-DD` (Europe/Istanbul day), `data.count`.
 *    A lookup = one request that misses the shared cache and calls a marketplace API.
 *    The extension sends `X-KX-Page-View`; every miss of one page view after the first
 *    is free (up to PAGE_VIEW_MAX_FETCHES), so a page view counts once.
 * 3. Global safety brake per marketplace: userId `__global__`, key
 *    `budget:<etsy|ebay|amazon>:YYYY-MM-DD`, `data.count` = marketplace API calls.
 *    At BRAKE_RATIO of the daily budget (env KX_BUDGET_<M>_DAILY) only shared-cache
 *    data is served; misses get 429 `reason: 'global_brake'`.
 *
 * Counters are bumped atomically with one `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
 * The user's lookup is reserved before the marketplace call and refunded when the call
 * turns out not to reach the marketplace (validation errors) or throws.
 *
 * Exempt (never limited): /api/integrations/etsy/*, /api/auth/extension, content.js
 * (Etsy order / address import + tracking entry). They do not import this module.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getExtResearchDailyLimit } from '@/lib/billing/planLimits';

export type ResearchMarketplace = 'etsy' | 'ebay' | 'amazon';
export type ResearchLimitReason = 'user_daily' | 'global_brake' | 'signed_out';

export const SHARED_USER_ID = '__shared__';
export const GLOBAL_USER_ID = '__global__';

const HOUR_MS = 60 * 60 * 1000;
/** Shared-cache TTLs (founder decision): searches 6 h, listing / item details 24 h. */
export const RESEARCH_TTL = { search: 6 * HOUR_MS, detail: 24 * HOUR_MS } as const;

export const UPGRADE_URL = 'https://kolayxport.com/plan';
export const SIGNUP_URL = 'https://kolayxport.com/login?mode=signup&utm_source=extension&utm_medium=limit';

/** Share of the daily marketplace budget after which only cached data is served. */
export const BRAKE_RATIO = 0.8;
export const DEFAULT_DAILY_BUDGETS: Readonly<Record<ResearchMarketplace, number>> = {
  etsy: 100000,
  ebay: 5000,
  amazon: 20000,
};
const BUDGET_ENV: Record<ResearchMarketplace, string> = {
  etsy: 'KX_BUDGET_ETSY_DAILY',
  ebay: 'KX_BUDGET_EBAY_DAILY',
  amazon: 'KX_BUDGET_AMAZON_DAILY',
};

/** Misses one page view may make before it is charged again (anti-abuse for a reused id). */
export const PAGE_VIEW_MAX_FETCHES = 10;
const PAGE_VIEW_TTL_MS = 10 * 60 * 1000;
/** Counter rows outlive their day a little so the prune job (lib/researchCache.ts) removes them. */
const COUNTER_GRACE_MS = 2 * 24 * HOUR_MS;

export function dailyBudget(marketplace: ResearchMarketplace): number {
  const raw = Number(process.env[BUDGET_ENV[marketplace]]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_BUDGETS[marketplace];
}

/* ------------------------------------------------------------ Istanbul day */

const istanbulFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

/** The Europe/Istanbul calendar day of `now` and the instant of the next 00:00 Istanbul. */
export function istanbulDay(now: Date = new Date()): { day: string; resetAt: Date } {
  const parts: Record<string, number> = {};
  for (const p of istanbulFmt.formatToParts(now)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const wallMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  const nowSec = now.getTime() - (((now.getTime() % 1000) + 1000) % 1000);
  const offsetMs = Math.round((wallMs - nowSec) / 60000) * 60000;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    resetAt: new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offsetMs),
  };
}

/* -------------------------------------------------------------------- keys */

export const quotaKey = (day: string) => `quota:ext:${day}`;
export const budgetKey = (marketplace: ResearchMarketplace, day: string) => `budget:${marketplace}:${day}`;
const pageViewKey = (id: string) => `quota:ext:pv:${id}`;

/** Lower-case, trimmed, single-spaced. */
export function normalizeQuery(q: unknown): string {
  return String(q ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Shared-cache key: marketplace + action + marketplace site + normalised query / item id
 * (+ any extra parameters that change the response). Long parts are hashed.
 */
export function sharedCacheKey(
  marketplace: ResearchMarketplace,
  action: string,
  site: string,
  ...parts: Array<string | number | null | undefined>
): string {
  const id = parts.map((p) => (p === null || p === undefined ? '' : normalizeQuery(p))).join('|');
  const safeId = id.length > 160 || /[^\w .|:@+-]/.test(id) ? 'h' + createHash('sha1').update(id).digest('hex') : id;
  return `ext:v1:${marketplace}:${action}:${normalizeQuery(site) || 'global'}:${safeId}`;
}

/** True for calls from the Chrome extension's background worker (`X-KX-Client: ext/<version>`). */
export function isExtensionRequest(req: NextApiRequest): boolean {
  const v = req.headers?.['x-kx-client'];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.startsWith('ext/');
}

function pageViewId(req: NextApiRequest): string | null {
  const v = req.headers?.['x-kx-page-view'];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

/* ---------------------------------------------------------------- storage */

/** Atomically add `delta` to `data.count` of a counter row (created on first use). Returns the new count. */
async function bumpCounter(userId: string, cacheKey: string, delta: number, expiresAt: Date, now: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint | string }>>`
    INSERT INTO "ResearchCache" ("id", "userId", "cacheKey", "data", "expiresAt", "createdAt")
    VALUES (${randomUUID()}, ${userId}, ${cacheKey}, jsonb_build_object('count', ${delta}::int), ${expiresAt}, ${now})
    ON CONFLICT ("userId", "cacheKey") DO UPDATE SET
      "data" = CASE
        WHEN "ResearchCache"."expiresAt" <= ${now} THEN jsonb_build_object('count', ${delta}::int)
        ELSE jsonb_set(
          CASE WHEN jsonb_typeof("ResearchCache"."data") = 'object' THEN "ResearchCache"."data" ELSE '{}'::jsonb END,
          '{count}',
          to_jsonb(COALESCE(("ResearchCache"."data"->>'count')::int, 0) + ${delta}::int)
        )
      END,
      "expiresAt" = CASE WHEN "ResearchCache"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "ResearchCache"."expiresAt" END
    RETURNING ("data"->>'count')::int AS "count"`;
  return Number(rows?.[0]?.count ?? 0);
}

async function readCounter(userId: string, cacheKey: string, now: Date): Promise<number> {
  const row = await prisma.researchCache.findUnique({ where: { userId_cacheKey: { userId, cacheKey } } });
  if (!row || row.expiresAt <= now) return 0;
  const n = Number((row.data as { count?: unknown } | null)?.count);
  return Number.isFinite(n) ? n : 0;
}

export async function readShared<T = unknown>(cacheKey: string, now: Date = new Date()): Promise<T | null> {
  try {
    const row = await prisma.researchCache.findUnique({ where: { userId_cacheKey: { userId: SHARED_USER_ID, cacheKey } } });
    return row && row.expiresAt > now ? (row.data as T) : null;
  } catch (err) {
    logger.warn('researchQuota: shared cache read failed', { cacheKey, err: (err as Error)?.message });
    return null;
  }
}

export async function readSharedMany<T = unknown>(cacheKeys: string[], now: Date = new Date()): Promise<Record<string, T>> {
  if (!cacheKeys.length) return {};
  try {
    const rows = await prisma.researchCache.findMany({
      where: { userId: SHARED_USER_ID, cacheKey: { in: cacheKeys }, expiresAt: { gt: now } },
    });
    const out: Record<string, T> = {};
    for (const r of rows) out[r.cacheKey] = r.data as T;
    return out;
  } catch (err) {
    logger.warn('researchQuota: shared cache read failed', { n: cacheKeys.length, err: (err as Error)?.message });
    return {};
  }
}

export async function writeShared(cacheKey: string, data: unknown, ttlMs: number, now: Date = new Date()): Promise<void> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.researchCache.upsert({
      where: { userId_cacheKey: { userId: SHARED_USER_ID, cacheKey } },
      create: { userId: SHARED_USER_ID, cacheKey, data: data as any, expiresAt },
      update: { data: data as any, expiresAt },
    });
  } catch (err) {
    logger.warn('researchQuota: shared cache write failed', { cacheKey, err: (err as Error)?.message });
  }
}

/* ------------------------------------------------------------------ quota */

export interface QuotaInfo {
  used: number;
  limit: number;
  resetAt: string;
}

export interface ResearchLimitBody {
  error: 'research_limit';
  reason: ResearchLimitReason;
  limit: number;
  used: number;
  resetAt: string;
  /** null = no upgrade offer (Shopify-connected accounts: Shopify bills them, never Stripe). */
  upgradeUrl: string | null;
}

/**
 * Shopify-connected accounts (shopify_free) are billed by Shopify, so they must never see Stripe, plans or
 * upgrade prompts (App Store review 1.2.1). They get a generous cap and a neutral "resets tomorrow" card.
 */
export const SHOPIFY_FREE_RESEARCH_DAILY = 500;

async function userDailyInfo(userId: string, now: Date): Promise<{ limit: number; shopify: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionPlan: true, subscriptionStatus: true, trialExpiresAt: true },
  });
  if (!user) return { limit: 0, shopify: false };
  const r = getExtResearchDailyLimit(user.subscriptionPlan, user.subscriptionStatus, user.trialExpiresAt, now);
  if (r.plan === 'shopify_free') return { limit: SHOPIFY_FREE_RESEARCH_DAILY, shopify: true };
  return { limit: r.limit, shopify: false };
}

async function userDailyLimit(userId: string, now: Date): Promise<number> {
  return (await userDailyInfo(userId, now)).limit;
}

export async function getResearchQuota(userId: string, now: Date = new Date()): Promise<QuotaInfo | null> {
  try {
    const { day, resetAt } = istanbulDay(now);
    const [limit, used] = await Promise.all([userDailyLimit(userId, now), readCounter(userId, quotaKey(day), now)]);
    return { used, limit, resetAt: resetAt.toISOString() };
  } catch (err) {
    logger.warn('researchQuota: quota read failed', { userId, err: (err as Error)?.message });
    return null;
  }
}

export function limitBody(reason: ResearchLimitReason, used: number, limit: number, resetAt: Date, opts: { noUpgrade?: boolean } = {}): ResearchLimitBody {
  return {
    error: 'research_limit',
    reason,
    limit,
    used,
    resetAt: resetAt.toISOString(),
    upgradeUrl: opts.noUpgrade ? null : reason === 'signed_out' ? SIGNUP_URL : UPGRADE_URL,
  };
}

/** True when today's marketplace calls reached BRAKE_RATIO of the daily budget. */
export async function isGlobalBrakeOn(marketplace: ResearchMarketplace, now: Date = new Date()): Promise<boolean> {
  try {
    const used = await readCounter(GLOBAL_USER_ID, budgetKey(marketplace, istanbulDay(now).day), now);
    return used >= BRAKE_RATIO * dailyBudget(marketplace);
  } catch (err) {
    logger.warn('researchQuota: budget read failed', { marketplace, err: (err as Error)?.message });
    return false; // fail open: the per-user limit and the marketplace's own rate limits still apply
  }
}

async function addBudget(marketplace: ResearchMarketplace, calls: number, now: Date): Promise<void> {
  if (!(calls > 0)) return;
  const { day, resetAt } = istanbulDay(now);
  try {
    await bumpCounter(GLOBAL_USER_ID, budgetKey(marketplace, day), Math.ceil(calls), new Date(resetAt.getTime() + COUNTER_GRACE_MS), now);
  } catch (err) {
    logger.warn('researchQuota: budget bump failed', { marketplace, err: (err as Error)?.message });
  }
}

/* ---------------------------------------------------------------- wrapper */

export interface FetchResult {
  status: number;
  body: any;
  /** Store in the shared cache. Default: 2xx with a plain-object body without `error`. */
  cacheable?: boolean;
  /**
   * Did the call reach the marketplace and count as the user's lookup? Default: the global
   * budget counts any status except 400/401/403/405/422; the user is charged only below 500.
   */
  charge?: boolean;
  /** Marketplace calls actually made, when known (else `apiCallsEstimate`). */
  apiCalls?: number;
}

export interface ResearchQuotaOptions {
  req: NextApiRequest;
  /** Signed-in user, or null for anonymous callers. */
  userId: string | null;
  marketplace: ResearchMarketplace;
  /** Shared cross-user cache key (see `sharedCacheKey`); null = never shared (per-user data). */
  cacheKey: string | null;
  /** Shared-cache TTL in ms (RESEARCH_TTL.search / RESEARCH_TTL.detail). */
  ttl: number;
  /** Marketplace API calls one miss costs (for the global budget). */
  apiCallsEstimate: number;
  /** Anonymous callers: return true to let this miss through (e.g. a small per-IP allowance). Default: refused (signed_out). */
  allowAnonymous?: () => boolean;
  now?: Date;
}

export type ResearchQuotaOutcome =
  | { kind: 'ok'; status: number; body: any; quota: QuotaInfo | null; source: 'shared_cache' | 'live' }
  | { kind: 'limited'; status: 429; body: ResearchLimitBody };

const NO_CHARGE_STATUSES = new Set([400, 401, 403, 405, 422]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Serve `fetcher` under the research quota: shared cache → global brake → per-user
 * daily lookup (reserved atomically, refunded if the call did not reach the marketplace).
 */
export async function withResearchQuota(
  opts: ResearchQuotaOptions,
  fetcher: () => Promise<FetchResult>,
): Promise<ResearchQuotaOutcome> {
  const now = opts.now ?? new Date();
  const { day, resetAt } = istanbulDay(now);
  const counterExpiry = new Date(resetAt.getTime() + COUNTER_GRACE_MS);
  const { userId, marketplace } = opts;

  // 1. Shared cache: free for everyone.
  if (opts.cacheKey) {
    const hit = await readShared(opts.cacheKey, now);
    if (hit !== null && hit !== undefined) {
      return { kind: 'ok', status: 200, body: hit, quota: userId ? await getResearchQuota(userId, now) : null, source: 'shared_cache' };
    }
  }

  // 2. Global brake: cache-only mode.
  if (await isGlobalBrakeOn(marketplace, now)) {
    const q = userId ? await getResearchQuota(userId, now) : null;
    return { kind: 'limited', status: 429, body: limitBody('global_brake', q?.used ?? 0, q?.limit ?? 0, resetAt) };
  }

  // 3. Per-user daily lookups (anonymous callers: endpoint-specific allowance or signed_out).
  let charged = false;
  let pvKey: string | null = null;
  let quota: QuotaInfo | null = null;
  if (!userId) {
    if (!opts.allowAnonymous || !opts.allowAnonymous()) {
      return { kind: 'limited', status: 429, body: limitBody('signed_out', 0, 0, resetAt) };
    }
  } else {
    try {
      const { limit, shopify } = await userDailyInfo(userId, now);
      const pv = pageViewId(opts.req);
      let chargeThis = true;
      if (pv) {
        pvKey = pageViewKey(pv);
        const n = await bumpCounter(userId, pvKey, 1, new Date(now.getTime() + PAGE_VIEW_TTL_MS), now);
        chargeThis = (n - 1) % PAGE_VIEW_MAX_FETCHES === 0;
        if (!chargeThis) pvKey = null; // nothing of ours to refund on this request
      }
      if (chargeThis) {
        const used = await bumpCounter(userId, quotaKey(day), 1, counterExpiry, now);
        if (used > limit) {
          await bumpCounter(userId, quotaKey(day), -1, counterExpiry, now);
          if (pvKey) await bumpCounter(userId, pvKey, -1, new Date(now.getTime() + PAGE_VIEW_TTL_MS), now);
          return { kind: 'limited', status: 429, body: limitBody('user_daily', Math.min(used - 1, limit), limit, resetAt, { noUpgrade: shopify }) };
        }
        charged = true;
        quota = { used, limit, resetAt: resetAt.toISOString() };
      } else {
        quota = { used: await readCounter(userId, quotaKey(day), now), limit, resetAt: resetAt.toISOString() };
      }
    } catch (err) {
      // Fail open: a quota-store outage must not take research down (marketplace rate limits still apply).
      logger.warn('researchQuota: quota check failed, allowing', { userId, err: (err as Error)?.message });
    }
  }

  const refund = async () => {
    if (!charged || !userId) return;
    try {
      await bumpCounter(userId, quotaKey(day), -1, counterExpiry, now);
      if (pvKey) await bumpCounter(userId, pvKey, -1, new Date(now.getTime() + PAGE_VIEW_TTL_MS), now);
      if (quota) quota = { ...quota, used: Math.max(0, quota.used - 1) };
    } catch (err) {
      logger.warn('researchQuota: refund failed', { userId, err: (err as Error)?.message });
    }
  };

  // 4. The marketplace call.
  let result: FetchResult;
  try {
    result = await fetcher();
  } catch (err) {
    await refund(); // our failure, not the user's lookup
    await addBudget(marketplace, opts.apiCallsEstimate, now);
    throw err;
  }

  // Budget: every call that reached the marketplace. User: only when it also produced an
  // answer (5xx = our or the marketplace's failure, refunded like a throw).
  const reached = result.charge ?? !NO_CHARGE_STATUSES.has(result.status);
  if (reached) await addBudget(marketplace, result.apiCalls ?? opts.apiCallsEstimate, now);
  if (!(result.charge ?? (reached && result.status < 500))) await refund();

  const cacheable = result.cacheable ?? (result.status >= 200 && result.status < 300 && isPlainObject(result.body) && !('error' in result.body));
  if (cacheable && opts.cacheKey) await writeShared(opts.cacheKey, result.body, opts.ttl, now);

  return { kind: 'ok', status: result.status, body: result.body, quota, source: 'live' };
}

/**
 * Write an outcome: 429 limit payload, or the body with `quota` (and `extra`) merged in
 * when it is a plain object.
 */
export function sendResearchOutcome(res: NextApiResponse, outcome: ResearchQuotaOutcome, extra?: Record<string, unknown>) {
  if (outcome.kind === 'limited') {
    res.setHeader('Cache-Control', 'no-store');
    const retryAfter = outcome.body.reason === 'global_brake'
      ? 300
      : Math.max(1, Math.ceil((Date.parse(outcome.body.resetAt) - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json(outcome.body);
  }
  const body = isPlainObject(outcome.body)
    ? { ...outcome.body, ...(extra || {}), ...(outcome.quota ? { quota: outcome.quota } : {}) }
    : outcome.body;
  return res.status(outcome.status).json(body);
}

/**
 * Run an existing Next.js handler and capture its status + JSON body instead of sending it
 * (headers still go to the real response). Lets an endpoint shared with the web app be
 * wrapped for extension calls without touching its web behaviour.
 */
export async function captureHandler(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<FetchResult> {
  let status = 200;
  let body: any;
  const proxy: NextApiResponse = new Proxy(res, {
    get(target, prop) {
      if (prop === 'status') return (code: number) => { status = code; return proxy; };
      if (prop === 'json' || prop === 'send') return (b: any) => { body = b; return proxy; };
      if (prop === 'end') return () => proxy;
      const v = (target as any)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) {
      if (prop === 'statusCode') { status = Number(value) || status; return true; }
      (target as any)[prop] = value;
      return true;
    },
  });
  await handler(req, proxy);
  return { status, body };
}
