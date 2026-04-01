import { useCallback, useMemo } from 'react';
import useLocaleStore from '../stores/useLocaleStore';
import { getLocaleConfig } from './localeConfig';
import {
  formatCurrency as fmtCurrency,
  formatDate as fmtDate,
  formatDateTime as fmtDateTime,
  formatNumber as fmtNumber,
} from './formatting';

export function useLocale() {
  const locale = useLocaleStore((s) => s.locale);
  const config = useMemo(() => getLocaleConfig(locale), [locale]);

  const formatCurrency = useCallback(
    (value: number, currency?: string) => fmtCurrency(value, locale, currency),
    [locale]
  );
  const formatDate = useCallback(
    (date: Date | string, options?: Intl.DateTimeFormatOptions) => fmtDate(date, locale, options),
    [locale]
  );
  const formatDateTime = useCallback(
    (date: Date | string, options?: Intl.DateTimeFormatOptions) => fmtDateTime(date, locale, options),
    [locale]
  );
  const formatNumber = useCallback(
    (value: number) => fmtNumber(value, locale),
    [locale]
  );

  return { locale, config, formatCurrency, formatDate, formatDateTime, formatNumber };
}
