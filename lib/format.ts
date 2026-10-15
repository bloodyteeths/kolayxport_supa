// lib/format.ts — DESIGN_SYSTEM §3.12, §4.1. The ONLY place money, numbers and dates are formatted.
// The locale follows the UI and the currency follows the data. Times use the seller's timezone
// (account setting, default Europe/Istanbul), never the server's.
//
// Pure functions (`fmt*`) take an explicit locale so they also work on the server and in tests.
// `useFormatters()` binds the UI locale (next-intl) and the seller timezone (`FormatProvider`).
// Components: components/ds/format/{Money,Num,DateText,ShipBy}.tsx.

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getIntlLocale } from '@/lib/i18n/formatting';
import type { AppLocale } from '@/lib/stores/useLocaleStore';
import {
  DEFAULT_TIME_ZONE, EMPTY, fmtDate, fmtDateRange, fmtDelta, fmtDuration, fmtMoney, fmtMoneyTotals, fmtNum,
  fmtPercent, fmtRelative, safeZone, shipByParts, toIntlLocale,
  type DateInput, type DateMode, type DateOptions, type DeltaParts, type FormatLocale, type MoneyOptions,
  type MoneyPart, type NumOptions, type PercentOptions, type ShipByParts,
} from './formatCore';
// Pure formatters live in ./formatCore (server-safe); re-exported so every import keeps working.
export * from './formatCore';

// ---------------------------------------------------------------------------------------------
// React binding: useFormatters() + FormatProvider (seller timezone)
// ---------------------------------------------------------------------------------------------

interface FormatContextValue {
  timeZone: string;
}
const FormatContext = createContext<FormatContextValue>({ timeZone: DEFAULT_TIME_ZONE });

/**
 * Supplies the seller timezone (account setting, BUILD_PLAN BR-2 / D-T1) to every formatter below it.
 * Mount once in the app shell; without it the default is Europe/Istanbul.
 */
export function FormatProvider({ timeZone, children }: { timeZone?: string | null; children?: ReactNode }) {
  const value = useMemo(() => ({ timeZone: safeZone(timeZone ?? undefined) }), [timeZone]);
  return createElement(FormatContext.Provider, { value }, children);
}

export interface Formatters {
  locale: FormatLocale;
  intlLocale: string;
  timeZone: string;
  money(amount: number | null | undefined, currency: string | null | undefined, o?: Omit<MoneyOptions, 'locale'>): string;
  moneyTotals(parts: readonly MoneyPart[], o?: Omit<MoneyOptions, 'locale'>): string;
  num(value: number | null | undefined, o?: Omit<NumOptions, 'locale'>): string;
  percent(value: number | null | undefined, o?: Omit<PercentOptions, 'locale'>): string;
  delta(value: number | null | undefined, goodWhen?: 'up' | 'down'): DeltaParts | null;
  duration(ms: number | null | undefined): string;
  date(v: DateInput, mode?: DateMode, now?: Date): string;
  relative(v: DateInput, now?: Date): string;
  dateRange(start: DateInput, end: DateInput): string;
  shipByParts(date: DateInput, shippedAt?: DateInput, now?: Date): ShipByParts;
  /** Translated one-phrase ship-by text ("Ship by today 10:59 PM", "Overdue 1 day", "—"). */
  shipBy(date: DateInput, shippedAt?: DateInput, now?: Date): string;
}

/** Binds the UI locale (next-intl) and the seller timezone. Must render inside NextIntlClientProvider. */
export function useFormatters(): Formatters {
  const raw = useLocale();
  const locale: FormatLocale = raw === 'en' ? 'en' : 'tr';
  const { timeZone } = useContext(FormatContext);
  const t = useTranslations('ds.shipBy');
  return useMemo<Formatters>(() => {
    const d = (now?: Date): DateOptions => ({ locale, timeZone, now });
    const parts = (date: DateInput, shippedAt?: DateInput, now?: Date) => shipByParts(date, shippedAt, d(now));
    return {
      locale,
      intlLocale: toIntlLocale(locale),
      timeZone,
      money: (a, c, o) => fmtMoney(a, c, { ...o, locale }),
      moneyTotals: (p, o) => fmtMoneyTotals(p, { ...o, locale }),
      num: (v, o) => fmtNum(v, { ...o, locale }),
      percent: (v, o) => fmtPercent(v, { ...o, locale }),
      delta: (v, goodWhen) => fmtDelta(v, { locale, goodWhen }),
      duration: (ms) => fmtDuration(ms, { locale }),
      date: (v, mode = 'date', now) => fmtDate(v, mode, d(now)),
      relative: (v, now) => fmtRelative(v, d(now)),
      dateRange: (a, b) => fmtDateRange(a, b, d()),
      shipByParts: parts,
      shipBy: (date, shippedAt, now) => {
        const p = parts(date, shippedAt, now);
        return p.kind === 'unknown' ? EMPTY : t(p.key, p.values);
      },
    };
  }, [locale, timeZone, t]);
}
