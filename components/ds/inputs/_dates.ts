// components/ds/inputs/_dates.ts — pure date helpers for DateRangeField and DateTimeField (unit-tested).
import {
  addDays, endOfMonth, endOfYear, isAfter, isBefore, isSameDay, startOfDay, startOfMonth, startOfYear, subDays,
  subMonths, subYears,
} from 'date-fns';
import { fmtDate } from '@/lib/format';

export type PresetKey =
  | 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'custom';

export interface DateRangeValue {
  from: Date | null;
  to: Date | null;
  preset?: PresetKey;
}

/** DS §3.3 default preset list. Finance passes its own (adds last90, lastYear). */
export const DEFAULT_PRESETS: PresetKey[] = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth', 'thisYear', 'custom'];

/** Both ends are local start-of-day dates; `to` is the last included day. */
export function resolvePreset(key: Exclude<PresetKey, 'custom'>, now: Date = new Date()): { from: Date; to: Date } {
  const today = startOfDay(now);
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = subDays(today, 1); return { from: y, to: y }; }
    case 'last7': return { from: subDays(today, 6), to: today };
    case 'last30': return { from: subDays(today, 29), to: today };
    case 'last90': return { from: subDays(today, 89), to: today };
    case 'thisMonth': return { from: startOfMonth(today), to: today };
    case 'lastMonth': { const m = subMonths(today, 1); return { from: startOfMonth(m), to: startOfDay(endOfMonth(m)) }; }
    case 'thisYear': return { from: startOfYear(today), to: today };
    case 'lastYear': { const y = subYears(today, 1); return { from: startOfYear(y), to: startOfDay(endOfYear(y)) }; }
    default: return { from: today, to: today };
  }
}

/** One click of a calendar day in range mode: first click starts, second click ends (swapped if earlier). */
export function nextRange(current: { from: Date | null; to: Date | null }, day: Date): { from: Date; to: Date | null; complete: boolean } {
  const d = startOfDay(day);
  if (!current.from || current.to) return { from: d, to: null, complete: false };
  if (isBefore(d, current.from)) return { from: d, to: current.from, complete: true };
  return { from: current.from, to: d, complete: true };
}

export function inRange(day: Date, from: Date | null, to: Date | null): boolean {
  if (!from || !to) return false;
  return !isBefore(day, startOfDay(from)) && !isAfter(day, startOfDay(to));
}

export function isEdge(day: Date, from: Date | null, to: Date | null): boolean {
  return Boolean((from && isSameDay(day, from)) || (to && isSameDay(day, to)));
}

/** Locale for range labels: EN reads "1–14 Oct 2026" (DS §3.3), TR "1–14 Eki 2026". */
function rangeLocale(locale: string): string {
  return locale.startsWith('en') ? 'en-GB' : locale;
}

export function formatDay(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(rangeLocale(locale), { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatRange(from: Date, to: Date, locale: string): string {
  const f = new Intl.DateTimeFormat(rangeLocale(locale), { day: 'numeric', month: 'short', year: 'numeric' });
  const fr = (f as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string }).formatRange;
  if (isSameDay(from, to)) return f.format(from);
  return fr ? fr.call(f, from, to) : `${f.format(from)} – ${f.format(to)}`;
}

/** Monday in TR (and most of Europe), Sunday in en-US. */
export function weekStartsOn(locale: string): 0 | 1 {
  return locale === 'en-US' ? 0 : 1;
}

export function addMonthsSafe(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export { addDays, startOfDay };

// ── Time zones (DateTimeField shows and edits wall-clock time in the seller's zone) ─────────────

export interface WallTime { year: number; month: number; day: number; hour: number; minute: number }

export function wallTimeIn(date: Date, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

function offsetMs(instant: number, timeZone: string): number {
  const w = wallTimeIn(new Date(instant), timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(instant / 60000) * 60000;
}

/** The instant at which the wall clock in `timeZone` reads the given time. */
export function zonedTimeToDate(w: WallTime, timeZone: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  let result = guess - offsetMs(guess, timeZone);
  const second = offsetMs(result, timeZone);
  if (guess - second !== result) result = guess - second;
  return new Date(result);
}

/** "GMT+3" for the zone at that instant. */
export function tzOffsetLabel(timeZone: string, locale: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** The one app date-time format (DS §3.12, P5): lib/format `datetime` — "Oct 15, 10:59 PM" / "15 Eki 22:59". */
export function formatDateTimeIn(date: Date, timeZone: string, locale: string, now?: Date): string {
  return fmtDate(date, 'datetime', { locale, timeZone, now });
}

/** Wall-clock time in the locale hour cycle, same options as lib/format `time` ("9:00 AM" / "09:00"). */
export function formatTime(hour: number, minute: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}
