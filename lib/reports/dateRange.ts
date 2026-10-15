// lib/reports/dateRange.ts — finance-analytics §4.2 (M9 Group C). Pure date-range helpers for every Reports tab.
//
// Every day is a `YYYY-MM-DD` string in the **seller timezone** (account setting, default Europe/Istanbul). Days are
// computed with `Intl` in that zone and moved with UTC calendar arithmetic, never with `toISOString()` on a local
// Date (B13: the UTC day-shift bug of the legacy finance store). The DS `DateRangeField` works with local
// start-of-day Dates; `dayToPickerDate` / `pickerDateToDay` convert at that boundary only (they read the calendar
// fields, so the browser zone never shifts a day).
import { calendarDay } from '@/lib/format';
import {
  addDays,
  autoGranularityForDays,
  dayFromUtcMs as fromUtc,
  dayParts as parts,
  diffDays,
  effectiveGranularityForDays,
  isDayKey,
  previousWindow as sharedPreviousWindow,
  rangeDays,
  validGranularitiesForDays,
  type DayKey,
  type DayRange,
  type Granularity,
} from './dayMath';

// Day arithmetic and the §4.2 window/granularity rules live once in `./dayMath` (shared with the Sales API).
export { GRANULARITIES, addDays, diffDays, isDayKey, rangeDays } from './dayMath';
export type { DayKey, DayRange, Granularity, PreviousWindowOptions } from './dayMath';

export const REPORT_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
  'last90',
  'thisYear',
  'lastYear',
  'custom',
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
export type NamedReportPreset = Exclude<ReportPreset, 'custom'>;

/**
 * Longest range a report accepts, in days (both ends inclusive): the Sales API's `SALES_MAX_RANGE_DAYS`
 * (`lib/reports/salesApi.ts`, server-only, so not imported here). Longer custom ranges are clamped to the last
 * `REPORT_MAX_RANGE_DAYS` days ending on `to`, so a shared or edited URL never asks for a 400 `range_too_long`.
 */
export const REPORT_MAX_RANGE_DAYS = 732;

/** §4.2: Last 30 days is the default range of every tab. */
export const DEFAULT_REPORT_PRESET: NamedReportPreset = 'last30';

export interface ResolvedReportRange extends DayRange {
  /** The named preset, or `custom` for explicit dates. */
  preset: ReportPreset;
}

/** Calendar day of an instant in `tz` (`toLocalDateStr` in §6.3). */
export function toLocalDateStr(date: Date, tz: string): DayKey {
  return calendarDay(date, tz);
}

/** Today in the seller timezone. */
export function todayIn(tz: string, now: Date = new Date()): DayKey {
  return calendarDay(now, tz);
}

function startOfMonth(day: DayKey): DayKey {
  const [y, m] = parts(day);
  return fromUtc(Date.UTC(y, m - 1, 1));
}

function endOfMonth(day: DayKey): DayKey {
  const [y, m] = parts(day);
  return fromUtc(Date.UTC(y, m, 0));
}

function startOfYear(day: DayKey): DayKey {
  return `${day.slice(0, 4)}-01-01`;
}

/** Both ends inclusive, in the seller timezone. */
export function resolveReportPreset(preset: NamedReportPreset, tz: string, now: Date = new Date()): DayRange {
  const today = todayIn(tz, now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    case 'thisMonth':
      return { from: startOfMonth(today), to: today };
    case 'lastMonth': {
      const prev = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'thisYear':
      return { from: startOfYear(today), to: today };
    case 'lastYear': {
      const y = String(Number(today.slice(0, 4)) - 1).padStart(4, '0');
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: today, to: today };
  }
}

function isNamedPreset(v: unknown): v is NamedReportPreset {
  return typeof v === 'string' && v !== 'custom' && (REPORT_PRESETS as readonly string[]).includes(v);
}

/** The earliest `from` for a range ending on `to` (the `REPORT_MAX_RANGE_DAYS` limit; also the picker's `min`). */
export function minFromFor(to: DayKey): DayKey {
  return addDays(to, -(REPORT_MAX_RANGE_DAYS - 1));
}

function clampFrom(from: DayKey, to: DayKey): DayKey {
  return rangeDays(from, to) > REPORT_MAX_RANGE_DAYS ? minFromFor(to) : from;
}

/**
 * The URL state (`from`, `to`, `preset`) → the range in force. A named preset wins and is recomputed for today (a
 * shared "Last 30 days" link stays relative). Explicit valid dates are a custom range (swapped when reversed, and
 * clamped to the last `REPORT_MAX_RANGE_DAYS` days ending on `to`).
 * Anything else falls back to the default preset.
 */
export function resolveReportRange(
  input: { from?: string | null; to?: string | null; preset?: string | null },
  tz: string,
  now: Date = new Date(),
): ResolvedReportRange {
  if (isNamedPreset(input.preset)) return { ...resolveReportPreset(input.preset, tz, now), preset: input.preset };
  const from = isDayKey(input.from) ? input.from : null;
  const to = isDayKey(input.to) ? input.to : null;
  if (from || to) {
    const a = from ?? (to as DayKey);
    const b = to ?? (from as DayKey);
    const [lo, hi] = diffDays(a, b) >= 0 ? [a, b] : [b, a];
    return { from: clampFrom(lo, hi), to: hi, preset: 'custom' };
  }
  return { ...resolveReportPreset(DEFAULT_REPORT_PRESET, tz, now), preset: DEFAULT_REPORT_PRESET };
}

/**
 * §4.2 comparison window (rule and its calendar exceptions in `./dayMath`). `preset` decides the This month case,
 * which the dates alone cannot (1–7 Oct is This month or Last 7 days on 7 Oct). The Sales request sends this window
 * as `compareFrom`/`compareTo` for This month (`salesCompareWindow`); the UI prefers the response's `previousRange`.
 */
export function previousWindow(from: DayKey, to: DayKey, preset?: ReportPreset | null): DayRange {
  return sharedPreviousWindow(from, to, { monthToDate: preset === 'thisMonth' });
}

/**
 * The explicit comparison window the Sales request must carry, or null when the server's own rule gives the same
 * window (every preset except This month).
 */
export function salesCompareWindow(from: DayKey, to: DayKey, preset?: ReportPreset | null): DayRange | null {
  if (preset !== 'thisMonth') return null;
  const mine = previousWindow(from, to, preset);
  const server = sharedPreviousWindow(from, to);
  return mine.from === server.from && mine.to === server.to ? null : mine;
}

/** §4.2: 1 day → hour, 2–45 → day, 46–180 → week, more → month. */
export function autoGranularity(from: DayKey, to: DayKey): Granularity {
  return autoGranularityForDays(rangeDays(from, to));
}

/** The options the granularity control offers for a range (the API accepts the same set; `./dayMath`). */
export function validGranularities(from: DayKey, to: DayKey): Granularity[] {
  return validGranularitiesForDays(rangeDays(from, to));
}

/** The URL override `g` when it is valid for the range, else the automatic one. */
export function effectiveGranularity(from: DayKey, to: DayKey, override?: string | null): Granularity {
  return effectiveGranularityForDays(rangeDays(from, to), override);
}

/** Local start-of-day Date with the same calendar fields (the DS DateRangeField value). */
export function dayToPickerDate(day: DayKey): Date {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d);
}

/** The calendar fields of a DateRangeField Date (never `toISOString`, B13). */
export function pickerDateToDay(date: Date): DayKey {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A day key as an instant at 12:00 UTC: formats as that calendar day in every zone within ±11 h (DateText input). */
export function dayKeyToDate(day: DayKey): Date {
  return new Date(`${day}T12:00:00Z`);
}

/**
 * A series bucket key from the API (`YYYY-MM-DD` or `YYYY-MM-DDTHH`) → its day and hour (null for day buckets).
 * Invalid keys return null.
 */
export function parseBucketStart(bucket: string): { day: DayKey; hour: number | null } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2})(?::\d{2}(?::\d{2})?)?)?/.exec(bucket ?? '');
  if (!m || !isDayKey(m[1])) return null;
  const hour = m[2] == null ? null : Number(m[2]);
  return { day: m[1], hour: hour != null && hour >= 0 && hour < 24 ? hour : null };
}

/** Last day of a bucket that starts on `start` (week = 7 days, month = calendar month), clamped to `rangeTo`. */
export function bucketEnd(start: DayKey, granularity: Granularity, rangeTo?: DayKey): DayKey {
  let end = start;
  if (granularity === 'week') end = addDays(start, 6);
  else if (granularity === 'month') end = endOfMonth(start);
  if (rangeTo && diffDays(end, rangeTo) < 0) end = rangeTo;
  return end;
}
