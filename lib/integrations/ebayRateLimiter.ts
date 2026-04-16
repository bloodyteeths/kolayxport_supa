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

const EBAY_MIN_INTERVAL_MS = 260; // ~3.8 QPS
let queueTail: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

interface CallOptions {
  token: string;
  marketplaceId?: string;
  options?: RequestInit;
  /** Max retry attempts for 429/5xx. Default 4. */
  maxRetries?: number;
}

export async function callEbayRateLimited<T = any>(
  url: string,
  { token, marketplaceId, options = {}, maxRetries = 4 }: CallOptions
): Promise<T> {
  const run = async (): Promise<T> => {
    // Global pacing
    const waitMs = Math.max(0, lastCallAt + EBAY_MIN_INTERVAL_MS - Date.now());
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    lastCallAt = Date.now();

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
      const response = await fetch(url, { ...options, headers });

      if (response.ok) {
        if (response.status === 204 || response.headers.get('content-length') === '0') {
          return { success: true } as unknown as T;
        }
        return response.json() as Promise<T>;
      }

      const text = await response.text();
      const err = new Error(`eBay API ${response.status}: ${text.substring(0, 300)}`);

      // Retry 429 / 5xx with exponential backoff
      if (response.status === 429 || response.status >= 500) {
        lastErr = err;
        const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
        logger.warn(`[ebay] ${response.status} — retry in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries}) url=${url.substring(0, 120)}`);
        await new Promise(r => setTimeout(r, backoffMs));
        // Re-pace after sleep so other queued calls don't immediately retry hot
        lastCallAt = Date.now();
        continue;
      }

      throw err;
    }
    throw lastErr || new Error('eBay API: exhausted retries');
  };

  const next = queueTail.then(run, run);
  queueTail = next.catch(() => {});
  return next;
}
