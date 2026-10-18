import { logger } from '../logger';

/**
 * Global eBay Browse API rate limiter.
 *
 * eBay application tokens allow ~5 QPS. We stay under 4 QPS and retry on 429/5xx
 * with exponential backoff so that concurrent callers across arbitrage scans,
 * research endpoints, tracker pollers, etc. don't stampede the API.
 *
 * Usage:
 *   const data = await callEbayRateLimited(url, {
 *     token,
 *     marketplaceId: 'EBAY_US',
 *     options: { method: 'POST', body: JSON.stringify({...}) },
 *   });
 */

const EBAY_MIN_INTERVAL_MS = 140; // ~7 QPS — eBay Browse app token ceiling; retries cover any 429 bursts
let queueTail: Promise<unknown> = Promise.resolve();
/** Earliest start time of the next eBay request (shared by queued and concurrent calls). */
let nextSlotAt = 0;

/** Reserve the next start slot (one every EBAY_MIN_INTERVAL_MS) and wait for it. */
async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlotAt);
  nextSlotAt = at + EBAY_MIN_INTERVAL_MS;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

interface CallOptions {
  token: string;
  marketplaceId?: string;
  options?: RequestInit;
  /** Max retry attempts for 429/5xx. Default 4. */
  maxRetries?: number;
  /**
   * Read-only calls that may overlap (e.g. the research overlay's per-item lookups): they skip
   * the FIFO queue but still take a paced start slot, so the global start rate stays the same.
   * Default false: the call waits for every earlier queued call to finish (writes keep their order).
   */
  concurrent?: boolean;
}

/**
 * eBay returns errors as `{"errors":[{errorId, message, longMessage, ...}]}`.
 * Surface just the human-readable part — the raw JSON ends up in user-facing
 * toasts otherwise.
 */
function summarizeEbayError(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const errors = [
      ...(Array.isArray(parsed?.errors) ? parsed.errors : []),
      ...(Array.isArray(parsed?.warnings) ? parsed.warnings : []),
    ];
    if (errors.length > 0) {
      return errors
        .map((e: any) => {
          const text = e.longMessage || e.message || 'Unknown error';
          // Generic errors (notably 2004, "The request has errors") say nothing
          // on their own — the field at fault is only named in `parameters`.
          const params = (e.parameters || [])
            .map((p: any) => String(p?.value ?? '').trim())
            .filter(Boolean)
            // eBay often echoes the message back as a positional parameter; only
            // keep values that actually add something.
            .filter((v: string) => !text.includes(v) && !v.includes(text))
            .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
            .join(', ');
          const parts = [text];
          if (params) parts.push(`[${params}]`);
          if (e.errorId) parts.push(`(eBay ${e.errorId})`);
          return parts.join(' ');
        })
        .join(' | ')
        .substring(0, 600);
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body.substring(0, 400);
}

export async function callEbayRateLimited<T = any>(
  url: string,
  { token, marketplaceId, options = {}, maxRetries = 4, concurrent = false }: CallOptions
): Promise<T> {
  const run = async (): Promise<T> => {

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'Content-Language': 'en-US',
      ...((options.headers as Record<string, string>) || {}),
    };
    if (marketplaceId) headers['X-EBAY-C-MARKETPLACE-ID'] = marketplaceId;

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Global pacing: one request start per slot, retries included.
      await waitForSlot();
      const response = await fetch(url, { ...options, headers });

      if (response.ok) {
        if (response.status === 204 || response.headers.get('content-length') === '0') {
          return { success: true } as unknown as T;
        }
        return response.json() as Promise<T>;
      }

      const text = await response.text();
      const err = new Error(`eBay API ${response.status}: ${summarizeEbayError(text)}`);

      // Retry 429 / 5xx with exponential backoff
      if (response.status === 429 || response.status >= 500) {
        lastErr = err;
        const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
        logger.warn(`[ebay] ${response.status} — retry in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries}) url=${url.substring(0, 120)}`);
        // A 429 holds every caller (queued or concurrent) back for the backoff, like the old
        // fully serial queue did; the retry then takes the next free slot.
        if (response.status === 429) nextSlotAt = Math.max(nextSlotAt, Date.now() + backoffMs);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      throw err;
    }
    throw lastErr || new Error('eBay API: exhausted retries');
  };

  if (concurrent) return run();
  const next = queueTail.then(run, run);
  queueTail = next.catch(() => {});
  return next;
}
