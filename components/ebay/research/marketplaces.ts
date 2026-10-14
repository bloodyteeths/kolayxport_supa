/** eBay marketplaces offered by the research tools, with the currency each one prices in. */
export const EBAY_RESEARCH_MARKETPLACES = [
  { value: 'EBAY_US', labelKey: 'marketplaceUS', flag: '🇺🇸', currency: 'USD', domain: 'ebay.com' },
  { value: 'EBAY_GB', labelKey: 'marketplaceGB', flag: '🇬🇧', currency: 'GBP', domain: 'ebay.co.uk' },
  { value: 'EBAY_DE', labelKey: 'marketplaceDE', flag: '🇩🇪', currency: 'EUR', domain: 'ebay.de' },
  { value: 'EBAY_FR', labelKey: 'marketplaceFR', flag: '🇫🇷', currency: 'EUR', domain: 'ebay.fr' },
  { value: 'EBAY_IT', labelKey: 'marketplaceIT', flag: '🇮🇹', currency: 'EUR', domain: 'ebay.it' },
  { value: 'EBAY_ES', labelKey: 'marketplaceES', flag: '🇪🇸', currency: 'EUR', domain: 'ebay.es' },
  { value: 'EBAY_AU', labelKey: 'marketplaceAU', flag: '🇦🇺', currency: 'AUD', domain: 'ebay.com.au' },
] as const;

export type EbayResearchMarketplace = typeof EBAY_RESEARCH_MARKETPLACES[number]['value'];

export const DEFAULT_EBAY_MARKETPLACE: EbayResearchMarketplace = 'EBAY_US';

export function isEbayResearchMarketplace(v: unknown): v is EbayResearchMarketplace {
  return typeof v === 'string' && EBAY_RESEARCH_MARKETPLACES.some((m) => m.value === v);
}

export function marketplaceCurrency(marketplace: string): string {
  return EBAY_RESEARCH_MARKETPLACES.find((m) => m.value === marketplace)?.currency || 'USD';
}

export function marketplaceDomain(marketplace: string): string {
  return EBAY_RESEARCH_MARKETPLACES.find((m) => m.value === marketplace)?.domain || 'ebay.com';
}

/** Money with the right symbol for `currency`; falls back to "$" formatting for unknown codes. */
export function formatMoney(amount: number, currency = 'USD', locale = 'en', fractionDigits = 2): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(n);
  } catch {
    return `$${n.toFixed(fractionDigits)}`;
  }
}

/** Just the symbol (e.g. "£") for input adornments. */
export function currencySymbol(currency = 'USD', locale = 'en'): string {
  try {
    const parts = new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || currency;
  } catch {
    return currency;
  }
}
