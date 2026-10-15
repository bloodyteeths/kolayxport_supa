import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertToBase, fetchLiveRates, getExchangeRates, normalizeCurrency, resetExchangeRatesCache, RATES_RETRY_MS, RATES_TTL_MS } from '../../lib/fx';

// TRY per unit.
const RATES = { TRY: 1, TL: 1, USD: 40, EUR: 44 };

/** The pre-move analytics closure (pages/api/analytics/index.ts:192-206 at 92087ba), kept to prove output is unchanged. */
function legacyTryConvertToTRY(amount: number, currency: string | null | undefined, exchangeRates: Record<string, number>): number | null {
  if (!amount) return 0;
  if (!currency) return amount;
  const code = currency.toUpperCase();
  if (code === 'TRY' || code === 'TL') return amount;
  const rate = exchangeRates[code];
  if (!rate) return null;
  return amount * rate;
}

describe('convertToBase', () => {
  it('matches the old analytics TRY conversion for every case', () => {
    const cases: [number, string | null | undefined][] = [
      [0, 'USD'], [100, null], [100, undefined], [100, ''], [100, 'TRY'], [100, 'tl'], [100, 'usd'], [100, 'EUR'], [100, 'GBP'], [-5, 'USD'],
    ];
    for (const [amount, cur] of cases) {
      expect(convertToBase(amount, cur, RATES, 'TRY')).toBe(legacyTryConvertToTRY(amount, cur, RATES));
    }
    // Same with no rates at all (FX fetch never succeeded).
    for (const [amount, cur] of cases) {
      expect(convertToBase(amount, cur, {}, 'TRY')).toBe(legacyTryConvertToTRY(amount, cur, {}));
    }
  });

  it('defaults base to TRY', () => {
    expect(convertToBase(10, 'USD', RATES)).toBe(400);
  });

  it('converts to USD through TRY (USD = TRY / rates.USD)', () => {
    expect(convertToBase(400, 'TRY', RATES, 'USD')).toBe(10);
    expect(convertToBase(400, null, RATES, 'USD')).toBe(10);
    expect(convertToBase(40, 'EUR', RATES, 'USD')).toBeCloseTo(44, 10);
    expect(convertToBase(25, 'USD', RATES, 'usd')).toBe(25);
  });

  it('returns null when a needed rate is missing (caller excludes and names the currency)', () => {
    expect(convertToBase(10, 'GBP', RATES, 'USD')).toBeNull();
    expect(convertToBase(400, 'TRY', {}, 'USD')).toBeNull();
    expect(convertToBase(10, 'EUR', { EUR: 0 }, 'TRY')).toBeNull();
    expect(convertToBase(10, 'EUR', { EUR: Number.NaN }, 'TRY')).toBeNull();
  });

  it('same currency needs no rate', () => {
    expect(convertToBase(7, 'USD', {}, 'USD')).toBe(7);
    expect(convertToBase(7, 'TL', {}, 'TRY')).toBe(7);
  });

  it('zero and non-finite amounts are 0', () => {
    expect(convertToBase(0, 'GBP', {}, 'USD')).toBe(0);
    expect(convertToBase(Number.NaN, 'USD', RATES, 'TRY')).toBe(0);
  });

  it('normalizeCurrency', () => {
    expect(normalizeCurrency(null)).toBe('TRY');
    expect(normalizeCurrency('tl')).toBe('TRY');
    expect(normalizeCurrency(' usd ')).toBe('USD');
  });
});

describe('fetchLiveRates / getExchangeRates', () => {
  const okResponse = (rates: Record<string, unknown>) => ({ ok: true, json: async () => ({ rates }) });

  beforeEach(() => {
    resetExchangeRatesCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('converts the USD-based feed to TRY per unit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ USD: 1, TRY: 40, EUR: 0.5, BAD: 'x', ZERO: 0 })));
    const r = await fetchLiveRates();
    expect(r).toEqual({ USD: 40, TRY: 1, TL: 1, EUR: 80 });
  });

  it('null when the feed has no TRY rate or the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ USD: 1 })));
    expect(await fetchLiveRates()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    expect(await fetchLiveRates()).toBeNull();
  });

  it('caches for an hour, then serves last-known rates as stale after a failure, retrying after 5 minutes', async () => {
    const fetchMock = vi.fn(async () => okResponse({ USD: 1, TRY: 40 }));
    vi.stubGlobal('fetch', fetchMock);
    const t0 = Date.now();
    const first = await getExchangeRates();
    expect(first).toEqual({ rates: { USD: 40, TRY: 1, TL: 1 }, stale: false, asOf: t0 });
    await getExchangeRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(t0 + RATES_TTL_MS + 1);
    fetchMock.mockImplementation(async () => { throw new Error('down'); });
    const stale = await getExchangeRates();
    expect(stale).toEqual({ rates: { USD: 40, TRY: 1, TL: 1 }, stale: true, asOf: t0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(t0 + RATES_TTL_MS + RATES_RETRY_MS / 2);
    await getExchangeRates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no rates at all → empty, stale, asOf null, and no refetch inside the retry window', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('down'); });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getExchangeRates()).toEqual({ rates: {}, stale: true, asOf: null });
    expect(await getExchangeRates()).toEqual({ rates: {}, stale: true, asOf: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
