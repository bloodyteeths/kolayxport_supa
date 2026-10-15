// lib/reports/dayMath.ts — finance-analytics §4.2. The one copy of the Reports day-key arithmetic, comparison window
// and granularity rules. Imported by the Sales API (`lib/reports/salesApi.ts`, server) and by the client helpers
// (`lib/reports/dateRange.ts`), so the API's `previousRange` and the UI's fallback label cannot drift (CRITIQUE C4/C5).
// No imports: safe on the server and in the browser.

/** Day key `YYYY-MM-DD` (seller timezone, calendar arithmetic only). */
export type DayKey = string;

export interface DayRange {
  from: DayKey;
  to: DayKey;
}

export const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DAY_MS = 86_400_000;

/** true for a real calendar day `YYYY-MM-DD` (rejects 2026-02-30). */
export function isDayKey(v: unknown): v is DayKey {
  if (typeof v !== 'string') return false;
  const m = DAY_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function dayParts(day: DayKey): [number, number, number] {
  const m = DAY_RE.exec(day);
  if (!m) throw new RangeError(`Not a day key: ${day}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** UTC midnight of the calendar day (arithmetic only — never a seller-zone instant). */
export function dayUtcMs(day: DayKey): number {
  const [y, m, d] = dayParts(day);
  return Date.UTC(y, m - 1, d);
}

/** The UTC calendar day of an epoch ms. */
export function dayFromUtcMs(ms: number): DayKey {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${mo}-${da}`;
}

export function addDays(day: DayKey, n: number): DayKey {
  return dayFromUtcMs(dayUtcMs(day) + n * DAY_MS);
}

/** Whole days from `a` to `b` (b later → positive). */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((dayUtcMs(b) - dayUtcMs(a)) / DAY_MS);
}

/** Inclusive day count of a range (1 for a single day). */
export function rangeDays(from: DayKey, to: DayKey): number {
  return Math.abs(diffDays(from, to)) + 1;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface PreviousWindowOptions {
  /**
   * The range is the "This month" preset (1st of the month → today). Only the caller knows this: a 1–7 Oct range
   * may be "This month" or "Last 7 days" on 7 Oct. When true and the range is 2+ days, it compares with the same
   * days of the previous month.
   */
  monthToDate?: boolean;
}

/**
 * §4.2: the comparison window — always the previous period of equal length, immediately before the range (a single
 * day → the previous day), with two calendar exceptions for ranges that start on the 1st inside one month:
 * - a whole calendar month compares with the whole previous month ("1–30 Sep" vs "1–31 Aug");
 * - the This month preset (`monthToDate`, 2+ days) compares with the same days of the previous month
 *   ("1–15 Oct" vs "1–15 Sep", clipped to that month's length).
 * Any other range starting on the 1st (Today on the 1st, Last 7 days on the 7th, a custom 1–10) uses equal length.
 * The Sales API does not know the preset, so the client sends the This month window as `compareFrom`/`compareTo`.
 */
export function previousWindow(from: DayKey, to: DayKey, opts: PreviousWindowOptions = {}): DayRange {
  const [fy, fm, fd] = dayParts(from);
  const [ty, tm, td] = dayParts(to);
  if (fd === 1 && fy === ty && fm === tm) {
    const fullMonth = td === daysInMonth(ty, tm);
    const monthToDate = opts.monthToDate === true && td >= 2;
    if (fullMonth || monthToDate) {
      const py = fm === 1 ? fy - 1 : fy;
      const pm = fm === 1 ? 12 : fm - 1;
      const prevLen = daysInMonth(py, pm);
      const endDay = fullMonth ? prevLen : Math.min(td, prevLen);
      return { from: dayFromUtcMs(Date.UTC(py, pm - 1, 1)), to: dayFromUtcMs(Date.UTC(py, pm - 1, endDay)) };
    }
  }
  const len = rangeDays(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

/** §4.2: 1 day → hour, 2–45 → day, 46–180 → week, more → month. */
export function autoGranularityForDays(n: number): Granularity {
  if (n <= 1) return 'hour';
  if (n <= 45) return 'day';
  if (n <= 180) return 'week';
  return 'month';
}

/**
 * The granularities allowed for a range (the UI control and the API accept the same set). A single day is hourly
 * only; otherwise day (≤ 400 days, so a chart never draws thousands of points), week (≥ 8 days) and month
 * (≥ 32 days).
 */
export function validGranularitiesForDays(n: number): Granularity[] {
  if (n <= 1) return ['hour'];
  const out: Granularity[] = [];
  if (n <= 400) out.push('day');
  if (n >= 8) out.push('week');
  if (n >= 32) out.push('month');
  return out.length ? out : ['day'];
}

/** A requested override when it is valid for the range, else the automatic one (or the first valid one). */
export function effectiveGranularityForDays(n: number, override?: unknown): Granularity {
  const valid = validGranularitiesForDays(n);
  if (typeof override === 'string' && (valid as string[]).includes(override)) return override as Granularity;
  const auto = autoGranularityForDays(n);
  return valid.includes(auto) ? auto : valid[0];
}
