/**
 * Shopify Admin GraphQL transport (the only way the app talks to the Shopify Admin API;
 * App Store requirement 2.2.4). Server-only.
 *
 * - One endpoint per shop: /admin/api/{SHOPIFY_API_VERSION}/graphql.json.
 * - Cost-based throttling: a THROTTLED error (or HTTP 429) waits for the bucket to refill
 *   (from `extensions.cost.throttleStatus`) and retries; the request was not executed, so this
 *   is safe for mutations too. Network errors / 5xx are retried only for queries.
 * - Before each call, a shop whose last known bucket is nearly empty waits a little.
 * - Errors carry a numeric `status` (401/403/404/422/429/5xx) and the text "failed: <status>",
 *   which `httpStatusOf`, `opCodeOfError` and `isAuthFailure` already understand.
 */
import { logger } from '../logger';
import { shopifyGraphqlUrl } from './shopifyApiVersion';

export type ShopifyGqlOptions = {
  /** Treat the operation as a mutation (no retry on network errors / 5xx). Auto-detected from the document. */
  mutation?: boolean;
  /** Keep partial data when the only errors are ACCESS_DENIED on some fields (REST redacted those fields). */
  allowAccessDenied?: boolean;
  timeoutMs?: number;
  /** Label for logs/errors (e.g. "orders"). */
  label?: string;
};

export class ShopifyApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ShopifyApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ThrottleState = { available: number; max: number; restoreRate: number; at: number };
const throttleByShop = new Map<string, ThrottleState>();

const MAX_THROTTLE_RETRIES = 6;
const MAX_TRANSIENT_RETRIES = 3;
/** Wait before a call when the known bucket is below this many points. */
const LOW_WATERMARK = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function estimatedAvailable(s: ThrottleState): number {
  return Math.min(s.max, s.available + ((Date.now() - s.at) / 1000) * s.restoreRate);
}

async function waitForBucket(shopDomain: string) {
  const s = throttleByShop.get(shopDomain);
  if (!s || s.restoreRate <= 0) return;
  const avail = estimatedAvailable(s);
  if (avail >= LOW_WATERMARK) return;
  const ms = Math.min(10_000, Math.ceil(((LOW_WATERMARK - avail) / s.restoreRate) * 1000));
  if (ms > 0) await sleep(ms);
}

function recordThrottle(shopDomain: string, extensions: any) {
  const t = extensions?.cost?.throttleStatus;
  if (!t || typeof t.currentlyAvailable !== 'number') return;
  throttleByShop.set(shopDomain, {
    available: t.currentlyAvailable,
    max: Number(t.maximumAvailable) || 1000,
    restoreRate: Number(t.restoreRate) || 50,
    at: Date.now(),
  });
}

function throttleWaitMs(extensions: any, attempt: number): number {
  const cost = extensions?.cost;
  const t = cost?.throttleStatus;
  const requested = Number(cost?.requestedQueryCost) || 0;
  if (t && typeof t.currentlyAvailable === 'number' && Number(t.restoreRate) > 0) {
    const deficit = Math.max(0, requested - t.currentlyAvailable);
    return Math.min(20_000, Math.ceil((deficit / Number(t.restoreRate)) * 1000) + 250);
  }
  return Math.min(20_000, 1000 * 2 ** attempt);
}

/**
 * Run one Admin GraphQL operation and return `data`. Top-level `errors` are thrown
 * (userErrors are the caller's job: see `assertNoUserErrors`).
 */
export async function shopifyGraphql<T = any>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  opts: ShopifyGqlOptions = {},
): Promise<T> {
  const isMutation = opts.mutation ?? /^\s*mutation\b/.test(query);
  const label = opts.label || (query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] ?? 'graphql');
  const url = shopifyGraphqlUrl(shopDomain);
  const body = JSON.stringify({ query, variables });
  let throttleRetries = 0;
  let transientRetries = 0;

  for (;;) {
    await waitForBucket(shopDomain);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err: any) {
      if (!isMutation && transientRetries < MAX_TRANSIENT_RETRIES) {
        transientRetries++;
        await sleep(500 * 2 ** transientRetries);
        continue;
      }
      throw err;
    }

    if (res.status === 429) {
      if (throttleRetries < MAX_THROTTLE_RETRIES) {
        throttleRetries++;
        const ra = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20_000) : 1000 * 2 ** throttleRetries);
        continue;
      }
    }
    if (res.status >= 500 && !isMutation && transientRetries < MAX_TRANSIENT_RETRIES) {
      transientRetries++;
      await sleep(500 * 2 ** transientRetries);
      continue;
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      logger.error(`Shopify GraphQL ${label} failed: ${res.status}`, undefined, { shopDomain, status: res.status, body: text.slice(0, 500) });
      throw new ShopifyApiError(`Shopify API ${label} failed: ${res.status} - ${text.slice(0, 500)}`, res.status);
    }

    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new ShopifyApiError(`Shopify API ${label} failed: ${res.status} - invalid JSON`, 502);
    }
    recordThrottle(shopDomain, json?.extensions);

    const errors: any[] = Array.isArray(json?.errors) ? json.errors : [];
    if (errors.length) {
      const codes = errors.map((e) => String(e?.extensions?.code || ''));
      if (codes.includes('THROTTLED') && throttleRetries < MAX_THROTTLE_RETRIES) {
        const ms = throttleWaitMs(json?.extensions, throttleRetries);
        throttleRetries++;
        logger.debug('Shopify GraphQL throttled, waiting', { shopDomain, label, ms });
        await sleep(ms);
        continue;
      }
      const allDenied = codes.every((c) => c === 'ACCESS_DENIED');
      if (allDenied && opts.allowAccessDenied && json?.data) {
        logger.warn(`Shopify GraphQL ${label}: some fields were denied (kept partial data)`, {
          shopDomain,
          errors: errors.map((e) => `${(e?.path || []).join('.')}: ${e?.message}`).slice(0, 5),
        });
        return json.data as T;
      }
      const status = codes.includes('THROTTLED') ? 429 : allDenied ? 403 : codes.includes('INTERNAL_SERVER_ERROR') ? 500 : 400;
      const msg = errors.map((e) => e?.message).filter(Boolean).join('; ');
      throw new ShopifyApiError(`Shopify API ${label} failed: ${status} - ${msg.slice(0, 500)}`, status, codes[0] || undefined, errors);
    }
    return (json?.data ?? {}) as T;
  }
}

/** Throw the `userErrors` / `mediaUserErrors` of a mutation payload as one error (status 422, or 404 for a missing resource). */
export function assertNoUserErrors(payload: any, label: string): void {
  const errs: any[] = [
    ...(Array.isArray(payload?.userErrors) ? payload.userErrors : []),
    ...(Array.isArray(payload?.mediaUserErrors) ? payload.mediaUserErrors : []),
  ];
  if (!errs.length) return;
  const msg = errs.map((e) => (e?.field?.length ? `${e.field.join('.')}: ${e.message}` : e?.message)).join('; ');
  const notFound = errs.some((e) => /NOT_FOUND|DOES_NOT_EXIST/.test(String(e?.code || '')) || /does not exist|not found/i.test(String(e?.message || '')));
  const status = notFound ? 404 : 422;
  throw new ShopifyApiError(`Shopify API ${label} failed: ${status} - ${msg.slice(0, 500)}`, status, errs[0]?.code, errs);
}

/** `gid://shopify/Product/123` for a numeric id (a gid passes through). */
export function toGid(type: string, id: string | number): string {
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/${type}/${s}`;
}

/** Numeric id of a gid (`gid://shopify/Product/123?x=1` → 123), or null. */
export function gidNum(gid: unknown): number | null {
  if (gid === null || gid === undefined) return null;
  const m = String(gid).match(/\/(\d+)(?:\?.*)?$/) || String(gid).match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Numeric id as a string (bigint-safe: never through Number), or ''. */
export function gidStr(gid: unknown): string {
  if (gid === null || gid === undefined) return '';
  const m = String(gid).match(/\/(\d+)(?:\?.*)?$/) || String(gid).match(/^(\d+)$/);
  return m ? m[1] : '';
}
