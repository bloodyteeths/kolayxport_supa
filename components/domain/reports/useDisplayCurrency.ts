// components/domain/reports/useDisplayCurrency.ts — Home (Reports › Sales) display currency (USABILITY_FINDINGS
// "Home defaults to USD — must default to TL"). Resolution: URL `cur` (a shared link) → the seller's last choice
// (this browser) → TRY. Never the sender profile / UI locale: a Turkish seller on the EN UI or with a US sender
// address still opens Home in TL, and the request no longer waits for the settings call.
import * as React from 'react';
import { SALES_CURRENCIES, type SalesCurrency } from '@/lib/reports/useSalesReport';

export const DEFAULT_DISPLAY_CURRENCY: SalesCurrency = 'TRY';
export const DISPLAY_CURRENCY_STORAGE_KEY = 'kx.reports.displayCurrency';

/** Pure: a Show-in currency, or null. */
export function asDisplayCurrency(v: unknown): SalesCurrency | null {
  const u = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return (SALES_CURRENCIES as readonly string[]).includes(u) ? (u as SalesCurrency) : null;
}

/** Pure: URL override → stored choice → TRY. */
export function resolveDisplayCurrency(urlCur: string | null | undefined, stored: string | null | undefined): SalesCurrency {
  return asDisplayCurrency(urlCur) ?? asDisplayCurrency(stored) ?? DEFAULT_DISPLAY_CURRENCY;
}

export function readStoredCurrency(): SalesCurrency | null {
  try {
    if (typeof window === 'undefined') return null;
    return asDisplayCurrency(window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredCurrency(c: SalesCurrency): void {
  try {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, c);
  } catch {
    /* private window / blocked storage: the choice lasts for this page only */
  }
}

/** The remembered choice (read once, synchronously: no TRY → USD flip and no second request). */
export function useStoredDisplayCurrency(): [SalesCurrency | null, (c: SalesCurrency) => void] {
  const [stored, setStored] = React.useState<SalesCurrency | null>(() => readStoredCurrency());
  const set = React.useCallback((c: SalesCurrency) => {
    writeStoredCurrency(c);
    setStored(c);
  }, []);
  return [stored, set];
}
