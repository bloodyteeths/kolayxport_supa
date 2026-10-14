/**
 * Etsy HTTP entry point (owner W1).
 *
 * Every Etsy API call goes through etsyFetch so that
 *  - the per-second token bucket and the daily priority gates apply
 *    (lib/etsy/rateBudget.ts), and
 *  - Etsy's quota headers (x-limit-per-day / x-remaining-today /
 *    x-remaining-this-second) are recorded for the global gate.
 * The only Etsy host fetch allowed outside this file is the OAuth token
 * endpoint (lib/etsy/etsyToken.ts and the OAuth callback).
 *
 * Priority: opts.priority, else the AsyncLocalStorage context set by
 * withEtsyBudget(), else Interactive — except that a Critical context is
 * sticky (an explicit lower priority cannot downgrade a P0 order chain).
 *
 * Retry behaviour (unchanged from the old draftService.etsyFetch): 30 s
 * timeout per attempt; 429/5xx are retried honouring Retry-After (capped at
 * 30 s); network errors are retried for GET only. A non-GET timeout throws
 * EtsyWriteTimeoutError, because the write may have landed on Etsy.
 *
 * Worker mode (deferOn429, from opts or the ALS context): a 429, a 5xx or a
 * token wait over 1 s throws EtsyRateLimitedError/EtsyDeferError immediately
 * (Retry-After, default 60 s) so the queue re-schedules without sleeping and
 * without consuming an attempt.
 */
import { logger } from '@/lib/logger';
import {
  EtsyPriority,
  acquireEtsyCall,
  assertCanSpend,
  getEtsyBudgetContext,
  mergeEtsyPriority,
  recordEtsyCall,
  recordEtsyResponse as recordBudgetResponse,
} from './rateBudget';
import { EtsyDeferError, EtsyRateLimitedError } from './webhooks/types';

export const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';
export const ETSY_FETCH_TIMEOUT_MS = 30_000;
export const ETSY_FETCH_MAX_RETRIES = 3;
const DEFAULT_DEFER_MS = 60_000;

export type EtsyFetchOptions = {
  priority?: EtsyPriority;
  /** Worker mode: throw EtsyDeferError on 429/5xx/budget waits instead of sleeping. */
  deferOn429?: boolean;
  timeoutMs?: number;
  /** Max retries on 429/5xx (and GET network errors). Default 3. */
  retries?: number;
  /** Shop the call is made for (budget accounting). Defaults to the ALS context shop. */
  shopId?: string;
};

/** A write (non-GET) timed out: it may or may not have been applied on Etsy. */
export class EtsyWriteTimeoutError extends Error {
  method: string;
  timeoutMs: number;
  constructor(method: string, timeoutMs: number) {
    super(`Etsy API timeout after ${Math.round(timeoutMs / 1000)}s (${method})`);
    this.name = 'EtsyWriteTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function resolveEtsyFetchOptions(optsOrTimeout?: EtsyFetchOptions | number) {
  const opts: EtsyFetchOptions = typeof optsOrTimeout === 'number' ? { timeoutMs: optsOrTimeout } : (optsOrTimeout || {});
  const ctx = getEtsyBudgetContext();
  return {
    // An explicit priority never downgrades a Critical context (worker order events).
    priority: mergeEtsyPriority(ctx?.priority, opts.priority) ?? EtsyPriority.Interactive,
    deferOn429: opts.deferOn429 ?? ctx?.deferOn429 ?? false,
    shopId: opts.shopId ?? ctx?.shopId,
    timeoutMs: opts.timeoutMs ?? ETSY_FETCH_TIMEOUT_MS,
    retries: Math.max(0, opts.retries ?? ETSY_FETCH_MAX_RETRIES),
  };
}

/**
 * fetch() for Etsy. The third argument also accepts a bare timeout in ms
 * (the old draftService.etsyFetch signature).
 */
export async function etsyFetch(url: string, init: RequestInit = {}, optsOrTimeout?: EtsyFetchOptions | number): Promise<Response> {
  const { priority, deferOn429, shopId, timeoutMs, retries } = resolveEtsyFetchOptions(optsOrTimeout);
  const method = String(init?.method || 'GET').toUpperCase();

  // Daily gate once per logical call (retries of the same call are not re-gated).
  assertCanSpend(shopId, priority);

  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquireEtsyCall(priority, deferOn429);
    recordEtsyCall(shopId, priority);

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err: any) {
      lastErr = err;
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      if (method !== 'GET') {
        if (isTimeout) throw new EtsyWriteTimeoutError(method, timeoutMs);
        throw new Error(`Etsy API network error: ${err?.message || err}`);
      }
      if (attempt < retries && !deferOn429) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(isTimeout ? `Etsy API timeout after ${Math.round(timeoutMs / 1000)}s (${method})` : `Etsy API network error: ${err?.message || err}`);
    }

    recordBudgetResponse(response, priority, shopId);

    if (response.status === 429 || response.status >= 500) {
      const ra = retryAfterMs(response);
      if (deferOn429) {
        await response.text().catch(() => undefined);
        const wait = ra && ra > 0 ? ra : DEFAULT_DEFER_MS;
        if (response.status === 429) throw new EtsyRateLimitedError(wait, `Etsy API 429 (${method}); deferred ${wait}ms`);
        throw new EtsyDeferError('rate_limited', wait, `Etsy API ${response.status} (${method}); deferred ${wait}ms`);
      }
      if (attempt < retries) {
        const waitMs = ra && ra > 0 ? Math.min(ra, 30_000) : Math.min(1000 * 2 ** attempt, 8_000);
        await response.text().catch(() => undefined);
        logger.warn('Etsy API transient error, retrying', { status: response.status, method, attempt: attempt + 1, waitMs });
        await sleep(waitMs);
        continue;
      }
    }
    return response;
  }
  throw lastErr || new Error('Etsy API request failed');
}

export function etsyAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`,
  };
}

/** x-api-key only (public endpoints that need no OAuth token). */
export function etsyPublicHeaders(): Record<string, string> {
  const apiKey = (process.env.ETSY_API_KEY || '').trim().replace(/^"|"$/g, '');
  const apiSecret = (process.env.ETSY_API_SECRET || '').trim().replace(/^"|"$/g, '');
  return { 'x-api-key': `${apiKey}:${apiSecret}` };
}

/** JSON call against the Etsy v3 application API. Same behaviour as the old draftService.callEtsyAPI. */
export async function callEtsyAPI(endpoint: string, accessToken: string, options: RequestInit = {}, opts?: EtsyFetchOptions): Promise<any> {
  const response = await etsyFetch(`${ETSY_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...etsyAuthHeaders(accessToken),
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  }, opts);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Etsy API error: ${response.status} - ${errorText}`);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return { success: true };
  return response.json();
}

/** Records Etsy quota headers into the rate budget (for responses not fetched via etsyFetch). */
export function recordEtsyResponse(res: Response, priority: EtsyPriority, shopId?: string): void {
  recordBudgetResponse(res, priority, shopId);
}
