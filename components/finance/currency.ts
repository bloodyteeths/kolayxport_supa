import type { DashboardData } from '@/lib/stores/useFinanceStore';

const SYMBOLS: Record<string, string> = {
  TRY: '₺', TL: '₺', USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', JPY: '¥', MXN: 'MX$',
};

/** Currency the marketplace's money is in when the data itself doesn't say. */
const MARKETPLACE_DEFAULT: Record<string, string> = {
  trendyol: 'TRY',
  etsy: 'USD',
  ebay: 'USD',
  amazon: 'USD',
};

/** Symbol for an ISO code; unknown codes render as "CODE " so they're never mistaken for $. */
export function currencySymbol(code: string | null | undefined): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  return SYMBOLS[upper] ?? `${upper} `;
}

/**
 * The currency a finance dashboard's numbers are in. Prefers what the data
 * reports (summary.currency if the API sends it, then the account balance
 * currency, which the Amazon/eBay/Etsy syncs derive from the real ledger),
 * and only then falls back to the marketplace's usual currency.
 */
export function resolveFinanceCurrency(
  marketplace: string,
  data?: DashboardData | null,
): string {
  const summary = data?.summary as (DashboardData['summary'] & { currency?: string | null }) | undefined;
  const fromData = summary?.currency || summary?.balanceCurrency;
  if (typeof fromData === 'string' && fromData.trim()) return fromData.trim().toUpperCase();
  return MARKETPLACE_DEFAULT[marketplace] || 'USD';
}

export function resolveFinanceSymbol(marketplace: string, data?: DashboardData | null): string {
  return currencySymbol(resolveFinanceCurrency(marketplace, data));
}
