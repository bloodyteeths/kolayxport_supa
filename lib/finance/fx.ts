import { logger } from '@/lib/logger';

// Lightweight USD-base exchange rates with a 1h in-memory cache — same source
// and pattern as /api/analytics. Used to convert manually-entered shipping
// costs (usually TRY from UPS/MNG invoices) into each marketplace dashboard's
// display currency.

let cachedRates: Record<string, number> = {};
let cacheExpiry = 0;

async function getUsdBaseRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now < cacheExpiry && Object.keys(cachedRates).length > 0) return cachedRates;
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.rates && typeof data.rates === 'object') {
      cachedRates = { ...data.rates, USD: 1, TL: data.rates.TRY };
      cacheExpiry = now + 3_600_000;
    }
  } catch (err: any) {
    logger.warn('FX rate fetch failed, using stale cache if any', { error: err?.message });
  }
  return cachedRates;
}

/**
 * Convert an amount between currencies. Returns null when a needed rate is
 * unavailable — callers should skip (and log) rather than mis-sum.
 */
export async function convertCurrency(amount: number, from: string, to: string): Promise<number | null> {
  const f = (from || '').toUpperCase() === 'TL' ? 'TRY' : (from || '').toUpperCase();
  const t = (to || '').toUpperCase() === 'TL' ? 'TRY' : (to || '').toUpperCase();
  if (!f || !t || f === t) return amount;
  const rates = await getUsdBaseRates();
  const rFrom = rates[f];
  const rTo = rates[t];
  if (!rFrom || !rTo) return null;
  return (amount / rFrom) * rTo;
}
