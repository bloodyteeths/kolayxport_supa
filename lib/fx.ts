/**
 * Shared FX: one rates fetch, one in-process cache, one conversion rule app-wide
 * (overview §4.1 / §4.4, CRITIQUE C5). Created by M8 overview-G1; imported by
 * `pages/api/analytics/index.ts`, `lib/overview/summary.ts` and finance (M9 B11).
 *
 * Rates are TRY per one unit of the currency (`amount_in_currency * rates[code] = TRY`),
 * with `rates.TRY = rates.TL = 1`. Server-side only in practice (the cache is per process).
 */

/** TRY per one unit of each currency code (upper-case keys). */
export type FxRates = Record<string, number>;

export interface RatesSnapshot {
  rates: FxRates;
  /** True when live rates could not be fetched (last-known or none used). */
  stale: boolean;
  /** When the rates in use were fetched (epoch ms); null when there are none. */
  asOf: number | null;
}

const RATES_URL = 'https://api.exchangerate-api.com/v4/latest/USD';
export const RATES_TTL_MS = 60 * 60 * 1000;
/** After a failed fetch, retry sooner than the normal TTL. */
export const RATES_RETRY_MS = 5 * 60 * 1000;

// Module-level cache. `cachedRatesAt` is when the cached rates were actually fetched,
// so a stale fallback can say how old it is.
let cachedRates: FxRates = {};
let cachedRatesAt = 0;
let cacheExpiry = 0;

/** Fetch live rates (USD base, converted to TRY-per-unit). Null on any failure. */
export async function fetchLiveRates(): Promise<FxRates | null> {
  try {
    const response = await fetch(RATES_URL);
    if (!response.ok) throw new Error(`Exchange rate API ${response.status}`);
    const data = await response.json();
    const usdToTry = Number(data?.rates?.TRY);
    if (!data?.rates || typeof data.rates !== 'object' || !Number.isFinite(usdToTry) || usdToTry <= 0) {
      throw new Error('Exchange rate API returned no TRY rate');
    }
    const rates: FxRates = {};
    for (const [currency, perUsd] of Object.entries(data.rates as Record<string, unknown>)) {
      const n = Number(perUsd);
      // amount_in_currency * (TRY_per_USD / currency_per_USD)
      if (Number.isFinite(n) && n > 0) rates[currency.toUpperCase()] = usdToTry / n;
    }
    rates.TRY = 1;
    rates.TL = 1;
    return rates;
  } catch (error) {
    console.error('[fx] Exchange rate API failed:', error);
    return null;
  }
}

/**
 * Cached rates: live for an hour; after a failure, the last-known rates (marked stale)
 * and a 5-minute retry window; `{ rates: {}, stale: true, asOf: null }` when none were ever fetched.
 */
export async function getExchangeRates(): Promise<RatesSnapshot> {
  const now = Date.now();
  const haveCache = Object.keys(cachedRates).length > 0;
  if (haveCache && now < cacheExpiry) {
    // Inside a post-failure retry window the cache can be older than the TTL.
    return { rates: cachedRates, stale: now - cachedRatesAt > RATES_TTL_MS, asOf: cachedRatesAt };
  }
  if (!haveCache && now < cacheExpiry) {
    // A fetch failed recently and there is nothing cached: don't hammer the API.
    return { rates: {}, stale: true, asOf: null };
  }
  const live = await fetchLiveRates();
  if (live) {
    cachedRates = live;
    cachedRatesAt = now;
    cacheExpiry = now + RATES_TTL_MS;
    return { rates: live, stale: false, asOf: now };
  }
  cacheExpiry = now + RATES_RETRY_MS;
  // Last-known rates (even if expired) beat summing USD as if it were TRY.
  if (haveCache) return { rates: cachedRates, stale: true, asOf: cachedRatesAt };
  return { rates: {}, stale: true, asOf: null };
}

/** Test hook: forget the cached rates. */
export function resetExchangeRatesCache(): void {
  cachedRates = {};
  cachedRatesAt = 0;
  cacheExpiry = 0;
}

/** Upper-case currency code; `TL` is TRY; empty/missing → TRY (orders are stored in TRY unless they say otherwise). */
export function normalizeCurrency(currency: string | null | undefined): string {
  const code = String(currency ?? '').trim().toUpperCase();
  if (!code || code === 'TL') return 'TRY';
  return code;
}

/** TRY per one unit of `code`, or null when there is no usable rate. */
function tryPerUnit(code: string, rates: FxRates): number | null {
  if (code === 'TRY') return 1;
  const r = Number(rates[code]);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * Convert `amount` in `currency` to `base`. Returns null when a needed rate is missing,
 * so the caller leaves the amount OUT of the total (and names the currency) instead of
 * summing it unconverted.
 *
 * - `amount` 0 (or not finite) → 0.
 * - `currency` missing/empty → TRY; `TL` → TRY.
 * - same currency as `base` → `amount` (no rate needed).
 * - otherwise `amount * rates[currency]` (TRY), then `/ rates[base]` when `base` is not TRY.
 */
export function convertToBase(
  amount: number,
  currency: string | null | undefined,
  rates: FxRates,
  base: string = 'TRY',
): number | null {
  if (!amount || !Number.isFinite(amount)) return 0;
  const from = normalizeCurrency(currency);
  const to = normalizeCurrency(base);
  if (from === to) return amount;
  const fromRate = tryPerUnit(from, rates);
  if (fromRate === null) return null;
  const toRate = tryPerUnit(to, rates);
  if (toRate === null) return null;
  return (amount * fromRate) / toRate;
}
