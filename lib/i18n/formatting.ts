import type { AppLocale } from '../stores/useLocaleStore';
import type { LocaleConfig } from './localeConfig';
import { getLocaleConfig } from './localeConfig';

export function formatCurrency(value: number, locale: AppLocale, currency?: string): string {
  const config = getLocaleConfig(locale);
  return new Intl.NumberFormat(config.intlLocale, {
    style: 'currency',
    currency: currency || config.defaultCurrency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(
  date: Date | string,
  locale: AppLocale,
  options?: Intl.DateTimeFormatOptions
): string {
  const config = getLocaleConfig(locale);
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(config.intlLocale, options);
}

export function formatDateTime(
  date: Date | string,
  locale: AppLocale,
  options?: Intl.DateTimeFormatOptions
): string {
  const config = getLocaleConfig(locale);
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(config.intlLocale, options);
}

export function formatNumber(value: number, locale: AppLocale): string {
  const config = getLocaleConfig(locale);
  return value.toLocaleString(config.intlLocale);
}

export function getIntlLocale(locale: AppLocale): string {
  return getLocaleConfig(locale).intlLocale;
}

export async function getDateFnsLocale(locale: AppLocale) {
  if (locale === 'tr') {
    const { tr } = await import('date-fns/locale');
    return tr;
  }
  const { enUS } = await import('date-fns/locale');
  return enUS;
}
