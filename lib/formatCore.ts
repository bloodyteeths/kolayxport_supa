// lib/formatCore.ts — the React-free half of lib/format.ts (server-safe: API routes, jobs).
// lib/format.ts re-exports everything here and adds useFormatters/FormatProvider.
// Original header: DESIGN_SYSTEM §3.12, §4.1. The ONLY place money, numbers and dates are formatted.
// The locale follows the UI and the currency follows the data. Times use the seller's timezone
// (account setting, default Europe/Istanbul), never the server's.
//
// Pure functions (`fmt*`) take an explicit locale so they also work on the server and in tests.
// `useFormatters()` binds the UI locale (next-intl) and the seller timezone (`FormatProvider`).
// Components: components/ds/format/{Money,Num,DateText,ShipBy}.tsx.

import { getIntlLocale } from '@/lib/i18n/formatting';
import type { AppLocale } from '@/lib/stores/useLocaleStore';

export type FormatLocale = AppLocale;
export type DateInput = Date | string | number | null | undefined;
export type DateMode = 'date' | 'datetime' | 'time' | 'weekday' | 'relative';
export type FormatTone = 'neutral' | 'warning' | 'danger';

export const DEFAULT_TIME_ZONE = 'Europe/Istanbul';
/** Compact notation is only used at or above this absolute value (KPI tiles and chart axes). */
export const COMPACT_MIN = 100_000;
/** Relative dates are only used for values closer than this (absolute value in the tooltip). */
export const RELATIVE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** `ShipBy` turns warning when the deadline is this close. */
export const SHIP_BY_WARNING_MS = 24 * 60 * 60 * 1000;
/** Rendered for a missing or invalid value. Never a fake-precise number (P6). */
export const EMPTY = '—';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Currencies printed without decimals (DS §3.12: "0 for JPY/KRW"). */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'PYG']);

export function toIntlLocale(locale: FormatLocale | string): string {
  if (locale === 'tr' || locale === 'en') return getIntlLocale(locale);
  return locale;
}

function isTr(locale: FormatLocale | string): boolean {
  return toIntlLocale(locale).toLowerCase().startsWith('tr');
}

export function toDate(v: DateInput): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

export interface MoneyOptions {
  locale: FormatLocale | string;
  /** Compact notation ("₺1,07 Mn"), only applied when |amount| >= COMPACT_MIN. KPI tiles and chart axes only. */
  compact?: boolean;
  /** Converted value: prefixed with "≈ " and printed without decimals at or above 1,000 (DS §3.12 "≈ ₺1.070.860"). */
  approx?: boolean;
  /** Always print the sign ("+$12.00" / "-$12.00"). Zero stays unsigned. */
  sign?: boolean;
  /** Drop ",00" when the amount is a whole number ("₺2.499"); amounts with cents keep them. */
  wholeIfIntegral?: boolean;
}

/** `₺1.109,30` (tr) / `₺1,109.30` (en). Symbol, never the ISO code. `—` for a missing amount. */
export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined, opts: MoneyOptions): string {
  if (!isNum(amount)) return EMPTY;
  const intl = toIntlLocale(opts.locale);
  const code = (currency || '').trim().toUpperCase();
  const abs = Math.abs(amount);
  const compact = !!opts.compact && abs >= COMPACT_MIN;
  let digits = ZERO_DECIMAL.has(code) ? 0 : 2;
  if (opts.wholeIfIntegral && Number.isInteger(amount)) digits = 0;
  if (opts.approx && abs >= 1000) digits = 0;
  const base: Intl.NumberFormatOptions = {
    signDisplay: opts.sign ? 'exceptZero' : 'auto',
    ...(compact
      ? { notation: 'compact', maximumFractionDigits: 2, minimumFractionDigits: 0 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  };
  let out: string;
  try {
    if (!code) throw new RangeError('no currency');
    out = new Intl.NumberFormat(intl, { ...base, style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).format(amount);
  } catch {
    // Unknown/invalid ISO code: number plus the raw code, so nothing is silently dropped.
    out = new Intl.NumberFormat(intl, base).format(amount) + (code ? ` ${code}` : '');
  }
  return opts.approx ? `≈ ${out}` : out;
}

export interface MoneyPart {
  amount: number | null | undefined;
  currency: string | null | undefined;
}

/**
 * Mixed currencies are never summed (DS §3.12). Sums per currency and joins them:
 * "$4,210.00 · ₺86.400,00". Order = first appearance. Invalid amounts are skipped.
 */
export function fmtMoneyTotals(parts: readonly MoneyPart[], opts: MoneyOptions): string {
  const totals = new Map<string, number>();
  for (const p of parts) {
    if (!isNum(p.amount)) continue;
    const c = (p.currency || '').toUpperCase();
    totals.set(c, (totals.get(c) ?? 0) + p.amount);
  }
  if (totals.size === 0) return EMPTY;
  return [...totals.entries()].map(([c, v]) => fmtMoney(v, c, opts)).join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Numbers, percent, delta, duration
// ---------------------------------------------------------------------------------------------

export interface NumOptions {
  locale: FormatLocale | string;
  /** Compact notation, only applied when |value| >= COMPACT_MIN. */
  compact?: boolean;
  /** Fixed number of decimals. Default: up to 2. */
  decimals?: number;
  sign?: boolean;
}

/** `12.480` (tr) / `12,480` (en). */
export function fmtNum(value: number | null | undefined, opts: NumOptions): string {
  if (!isNum(value)) return EMPTY;
  const compact = !!opts.compact && Math.abs(value) >= COMPACT_MIN;
  const o: Intl.NumberFormatOptions = { signDisplay: opts.sign ? 'exceptZero' : 'auto' };
  if (compact) Object.assign(o, { notation: 'compact', maximumFractionDigits: opts.decimals ?? 2 });
  else if (opts.decimals != null) Object.assign(o, { minimumFractionDigits: opts.decimals, maximumFractionDigits: opts.decimals });
  else o.maximumFractionDigits = 2;
  return new Intl.NumberFormat(toIntlLocale(opts.locale), o).format(value);
}

export interface PercentOptions {
  locale: FormatLocale | string;
  /** 0 or 1. The DS caps percent at 1 decimal. */
  decimals?: 0 | 1;
  sign?: boolean;
}

/** `value` is a ratio: 0.042 → `%4,2` (tr) / `4.2%` (en). At most 1 decimal. */
export function fmtPercent(value: number | null | undefined, opts: PercentOptions): string {
  if (!isNum(value)) return EMPTY;
  const max = opts.decimals ?? 1;
  return new Intl.NumberFormat(toIntlLocale(opts.locale), {
    style: 'percent',
    minimumFractionDigits: opts.decimals ?? 0,
    maximumFractionDigits: max,
    signDisplay: opts.sign ? 'exceptZero' : 'auto',
  }).format(value);
}

export type DeltaDirection = 'up' | 'down' | 'flat';
export interface DeltaParts {
  direction: DeltaDirection;
  /** "▲ 12.4%" / "▲ %12,4"; "0%" when flat. */
  text: string;
  /** success / danger / neutral given `goodWhen`. */
  tone: 'success' | 'danger' | 'neutral';
}

/** KPI delta (KPI only): arrow plus the absolute percent. `value` is a ratio ((v - prev) / prev). */
export function fmtDelta(
  value: number | null | undefined,
  opts: { locale: FormatLocale | string; goodWhen?: 'up' | 'down' },
): DeltaParts | null {
  if (!isNum(value)) return null;
  const pct = fmtPercent(Math.abs(value), { locale: opts.locale });
  // Rounds to 0 at 1 decimal → flat.
  if (Math.abs(value) < 0.0005) return { direction: 'flat', text: fmtPercent(0, { locale: opts.locale }), tone: 'neutral' };
  const direction: DeltaDirection = value > 0 ? 'up' : 'down';
  const good = (opts.goodWhen ?? 'up') === direction;
  return { direction, text: `${direction === 'up' ? '▲' : '▼'} ${pct}`, tone: good ? 'success' : 'danger' };
}

/** Elapsed time: "1m 12s" (en) / "1 dk 12 sn" (tr). Shows the two largest units. */
export function fmtDuration(ms: number | null | undefined, opts: { locale: FormatLocale | string }): string {
  if (!isNum(ms) || ms < 0) return EMPTY;
  const intl = toIntlLocale(opts.locale);
  const unitDisplay = isTr(intl) ? 'short' : 'narrow';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (n: number, u: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(intl, { style: 'unit', unit: u, unitDisplay }).format(n).replace(/\.$/, '');
  if (h > 0) return m > 0 ? `${unit(h, 'hour')} ${unit(m, 'minute')}` : unit(h, 'hour');
  if (m > 0) return s > 0 ? `${unit(m, 'minute')} ${unit(s, 'second')}` : unit(m, 'minute');
  return unit(s, 'second');
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

export interface DateOptions {
  locale: FormatLocale | string;
  /** IANA zone. Default Europe/Istanbul (the account timezone default). */
  timeZone?: string;
  /** Injected clock, for tests and for "same year" checks. */
  now?: Date;
}

export function safeZone(tz?: string): string {
  const zone = tz || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Calendar day "YYYY-MM-DD" of `d` in `tz`. */
export function calendarDay(d: Date, tz?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Whole calendar days from `a` to `b` in `tz` (b later → positive). */
export function calendarDayDiff(a: Date, b: Date, tz?: string): number {
  const pa = Date.parse(`${calendarDay(a, tz)}T00:00:00Z`);
  const pb = Date.parse(`${calendarDay(b, tz)}T00:00:00Z`);
  return Math.round((pb - pa) / DAY);
}

function sameYear(a: Date, b: Date, tz?: string): boolean {
  return calendarDay(a, tz).slice(0, 4) === calendarDay(b, tz).slice(0, 4);
}

/**
 * - `date`: "15 Eki" / "Oct 15" (adds the year when it differs from now: "15 Eki 2025" / "Oct 15, 2025")
 * - `datetime`: "15 Eki 22:59" / "Oct 15, 10:59 PM" (locale hour cycle)
 * - `time`: "22:59" / "10:59 PM"
 * - `weekday`: "15 Eki Perşembe" / "Thursday, Oct 15"
 * - `relative`: see fmtRelative (falls back to `date` at 7 days and beyond)
 */
export function fmtDate(v: DateInput, mode: DateMode, opts: DateOptions): string {
  const d = toDate(v);
  if (!d) return EMPTY;
  if (mode === 'relative') return fmtRelative(d, opts);
  const timeZone = safeZone(opts.timeZone);
  const now = opts.now ?? new Date();
  const withYear = !sameYear(d, now, timeZone);
  const o: Intl.DateTimeFormatOptions = { timeZone };
  if (mode === 'time') Object.assign(o, { hour: 'numeric', minute: '2-digit' });
  else {
    Object.assign(o, { day: 'numeric', month: 'short' });
    if (withYear) o.year = 'numeric';
    if (mode === 'datetime') Object.assign(o, { hour: 'numeric', minute: '2-digit' });
    if (mode === 'weekday') o.weekday = 'long';
  }
  return new Intl.DateTimeFormat(toIntlLocale(opts.locale), o).format(d);
}

/**
 * Under 7 days: "4 dk önce" / "4 min ago", "dün" / "yesterday", "şimdi" / "now" (also future: "in 2 hr").
 * 7 days and beyond: the `date` format. The caller shows the absolute value in a tooltip.
 */
export function fmtRelative(v: DateInput, opts: DateOptions): string {
  const d = toDate(v);
  if (!d) return EMPTY;
  const now = opts.now ?? new Date();
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs >= RELATIVE_MAX_MS) return fmtDate(d, 'date', opts);
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(opts.locale), { numeric: 'auto', style: 'short' });
  const sign = diff < 0 ? -1 : 1;
  let out: string;
  if (abs < 45 * 1000) out = rtf.format(0, 'second');
  else if (abs < HOUR) out = rtf.format(sign * Math.max(1, Math.round(abs / 60000)), 'minute');
  else if (abs < DAY) out = rtf.format(sign * Math.round(abs / HOUR), 'hour');
  else out = rtf.format(calendarDayDiff(now, d, opts.timeZone) || sign, 'day');
  // CLDR short forms carry abbreviation dots ("4 min. ago", "4 dk. önce"); the DS spells them without.
  return out.replace(/\.(?=\s|$)/g, '');
}

/** "1–30 Eyl 2026" / "Sep 1 – 30, 2026". The year is always printed (ranges are often cross-year). */
export function fmtDateRange(start: DateInput, end: DateInput, opts: DateOptions): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return EMPTY;
  const f = new Intl.DateTimeFormat(toIntlLocale(opts.locale), {
    timeZone: safeZone(opts.timeZone),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  return typeof f.formatRange === 'function' ? f.formatRange(lo, hi) : `${f.format(lo)} – ${f.format(hi)}`;
}

// ---------------------------------------------------------------------------------------------
// Ship-by: one phrase, never relative and absolute together
// ---------------------------------------------------------------------------------------------

export type ShipByKind = 'unknown' | 'shipped' | 'overdue_hours' | 'overdue_days' | 'today' | 'tomorrow' | 'date';

export interface ShipByParts {
  kind: ShipByKind;
  tone: FormatTone;
  /** i18n key under `ds.shipBy` (`ds.shipBy.<key>`). */
  key: 'unknown' | 'shipped' | 'overdueHours' | 'overdueDays' | 'today' | 'tomorrow' | 'date';
  /** ICU values for that key (`count`, `time`, `date`). */
  values: { count?: number; time?: string; date?: string };
  /** Absolute deadline for the tooltip ("Oct 15, 10:59 PM"); empty when unknown. */
  absolute: string;
}

/**
 * Pure ship-by model. Danger when overdue, warning when due within 24h, neutral otherwise.
 * `shippedAt` wins (neutral "Shipped Oct 14"). A missing ship-by is `unknown` (rendered `—`,
 * never a guessed date; orders §8).
 */
export function shipByParts(date: DateInput, shippedAt: DateInput, opts: DateOptions): ShipByParts {
  const now = opts.now ?? new Date();
  const shipped = toDate(shippedAt);
  if (shipped) {
    const ds = fmtDate(shipped, 'date', { ...opts, now });
    return { kind: 'shipped', tone: 'neutral', key: 'shipped', values: { date: ds }, absolute: fmtDate(shipped, 'datetime', { ...opts, now }) };
  }
  const d = toDate(date);
  if (!d) return { kind: 'unknown', tone: 'neutral', key: 'unknown', values: {}, absolute: '' };
  const absolute = fmtDate(d, 'datetime', { ...opts, now });
  const diff = d.getTime() - now.getTime();
  if (diff < 0) {
    const late = -diff;
    if (late < DAY) {
      return { kind: 'overdue_hours', tone: 'danger', key: 'overdueHours', values: { count: Math.max(1, Math.floor(late / HOUR)) }, absolute };
    }
    return { kind: 'overdue_days', tone: 'danger', key: 'overdueDays', values: { count: Math.floor(late / DAY) }, absolute };
  }
  const tone: FormatTone = diff <= SHIP_BY_WARNING_MS ? 'warning' : 'neutral';
  const days = calendarDayDiff(now, d, opts.timeZone);
  const time = fmtDate(d, 'time', { ...opts, now });
  if (days === 0) return { kind: 'today', tone, key: 'today', values: { time }, absolute };
  if (days === 1) return { kind: 'tomorrow', tone, key: 'tomorrow', values: { time }, absolute };
  return { kind: 'date', tone, key: 'date', values: { date: fmtDate(d, 'date', { ...opts, now }) }, absolute };
}

/** DS §4.1 inventory name for {@link shipByParts}: structured ship-by parts (kind, tone, i18n key, values). */
export const fmtShipBy = shipByParts;

