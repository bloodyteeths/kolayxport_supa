// Verdict and category/preset constants
// Turkish display labels are handled via next-intl in consuming components.
// The `label` field is a translation key — use t(`ebay.research.arbitrage.${label}`) in components.

import type { AppLocale } from '../../../../lib/stores/useLocaleStore';

export const VERDICT_CONFIG = {
  excellent: { color: '#2e7d32', bg: '#e8f5e9', label: 'excellent', icon: '🏆' },
  good: { color: '#1565c0', bg: '#e3f2fd', label: 'good', icon: '👍' },
  marginal: { color: '#e65100', bg: '#fff3e0', label: 'marginal', icon: '⚠️' },
  skip: { color: '#c62828', bg: '#ffebee', label: 'skip', icon: '❌' },
} as const;

// Keys are Trendyol category group identifiers (Turkish data values, not display strings).
// Display names come from the `label` translation key.
export const CATEGORY_GROUPS = [
  { key: 'Ev & Dekor', label: 'homeDecor', icon: '🏠' },
  { key: 'Mutfak', label: 'kitchen', icon: '🍽️' },
  { key: 'jewelry', label: 'jewelry', icon: '💎' },
  { key: 'Tekstil', label: 'textile', icon: '👜' },
  { key: 'Yiyecek', label: 'food', icon: '🍯' },
  { key: 'Kozmetik', label: 'cosmetics', icon: '🧴' },
  { key: 'Hediyelik', label: 'gifts', icon: '🎁' },
] as const;

export const SCAN_PRESETS = [
  { label: 'mostPopular', description: 'mostPopularDesc', slugs: ['havlu-x-c104073', 'pestemal-x-c104074', 'kilim-x-c104037', 'seramik-cini-x-c104165', 'lamba-x-c104155'] },
  { label: 'highProfit', description: 'highProfitDesc', slugs: ['gumus-kolye-x-c104279', 'gumus-yuzuk-x-c104280', 'deri-canta-x-c103891', 'bakir-cezve-x-c104262', 'taki-seti-x-c104256'] },
  { label: 'lightSmall', description: 'lightSmallDesc', slugs: ['el-yapimi-sabun-x-c104389', 'lokum-x-c104301', 'baharat-x-c103966', 'nazar-boncugu-x-c104271', 'magnet-x-c104148'] },
  { label: 'kitchenPreset', description: 'kitchenPresetDesc', slugs: ['seramik-tabak-x-c104209', 'seramik-kase-x-c104210', 'cay-bardagi-x-c104217', 'bakir-cezve-x-c104262', 'caydanlik-x-c104220'] },
] as const;

/**
 * Locale-aware currency formatter.
 * @param val - numeric value
 * @param currency - ISO 4217 currency code (default 'USD')
 * @param locale - app locale for number formatting (default 'en')
 */
export function formatCurrency(val: number, currency = 'USD', locale: AppLocale = 'en'): string {
  const intlLocale = locale === 'tr' ? 'tr-TR' : 'en-US';
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatPercent(val: number): string {
  return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
}

export function getVerdictConfig(verdict: string) {
  return VERDICT_CONFIG[verdict as keyof typeof VERDICT_CONFIG] || VERDICT_CONFIG.skip;
}
