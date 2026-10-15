// Formatting adapter for the data-display primitives. Everything goes through lib/format.ts (DS §3.12:
// narrowSymbol money, compact only ≥ 100,000, percent ≤ 1 decimal, dates in the seller timezone).
// This file only adapts its option-object API to short positional calls used inside the DS.
import { useMemo } from 'react';
import {
  COMPACT_MIN,
  calendarDay,
  fmtDate,
  fmtDelta,
  fmtMoney,
  fmtNum,
  fmtPercent,
  fmtRelative,
  toIntlLocale,
  useFormatters,
  type DateInput,
  type DeltaParts,
} from '@/lib/format';

export { COMPACT_MIN };

export type MoneyOpts = { compact?: boolean; approx?: boolean; sign?: boolean };
export type NumOpts = { compact?: boolean; decimals?: number };

export interface DsFormat {
  locale: 'en' | 'tr';
  intlLocale: string;
  /** Seller timezone the dates are formatted in (undefined = lib/format default). */
  timeZone?: string;
  /** Same calendar day in the seller timezone (not the JS runtime's), so SSR and client agree. */
  sameDay(a: Date, b: Date): boolean;
  money(amount: number, currency: string, opts?: MoneyOpts): string;
  num(value: number, opts?: NumOpts): string;
  /** `value` is a fraction: 0.042 → 4.2 %. */
  percent(value: number, decimals?: 0 | 1): string;
  delta(value: number, goodWhen: 'up' | 'down'): DeltaParts | null;
  date(value: DateInput): string;
  dateTime(value: DateInput): string;
  time(value: DateInput): string;
  relative(value: DateInput, now?: Date): string;
}

export function makeDsFormat(locale: string, timeZone?: string): DsFormat {
  const l: 'en' | 'tr' = locale === 'en' ? 'en' : 'tr';
  const d = { locale: l, timeZone };
  return {
    locale: l,
    intlLocale: toIntlLocale(l),
    timeZone,
    sameDay: (a, b) => calendarDay(a, timeZone) === calendarDay(b, timeZone),
    money: (amount, currency, opts = {}) => fmtMoney(amount, currency, { locale: l, ...opts }),
    num: (value, opts = {}) => fmtNum(value, { locale: l, ...opts }),
    percent: (value, decimals) => fmtPercent(value, { locale: l, ...(decimals !== undefined ? { decimals } : {}) }),
    delta: (value, goodWhen) => fmtDelta(value, { locale: l, goodWhen }),
    date: (v) => fmtDate(v, 'date', d),
    dateTime: (v) => fmtDate(v, 'datetime', d),
    time: (v) => fmtDate(v, 'time', d),
    relative: (v, now) => fmtRelative(v, { ...d, now }),
  };
}

/** Binds the UI locale and the seller timezone (FormatProvider) via lib/format.ts `useFormatters`. */
export function useDsFormat(): DsFormat {
  const f = useFormatters();
  return useMemo(() => makeDsFormat(f.locale, f.timeZone), [f.locale, f.timeZone]);
}

/**
 * Locale-aware number parse for edit cells: "1.109,30" (tr) and "1,109.30" (en) → 1109.3.
 * Returns null for anything that is not a finite number.
 */
export function parseLocaleNumber(input: string, locale: string): number | null {
  const s = String(input ?? '').trim().replace(/[\s ₺$€£¥]/g, '');
  if (!s) return null;
  const tr = locale === 'tr';
  const decimal = tr ? ',' : '.';
  const group = tr ? '.' : ',';
  let norm = s;
  // Only the "other" separator once with ≤ 2 trailing digits is read as a decimal
  // (sellers type "12.50" in the TR UI too).
  if (!norm.includes(decimal) && new RegExp(`^-?\\d+\\${group}\\d{1,2}$`).test(norm)) {
    norm = norm.replace(group, '.');
  } else {
    norm = norm.split(group).join('').replace(decimal, '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}
