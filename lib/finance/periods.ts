/**
 * Time-zone-aware windows and buckets for the finance APIs (finance-analytics §6.2,
 * B2/B10/B13). Pure, no dependencies, client- and server-safe.
 *
 * Date keys are local calendar days in the seller's time zone (`YYYY-MM-DD`).
 * Bucket keys:
 *   hour  → `YYYY-MM-DDTHH`
 *   day   → `YYYY-MM-DD`
 *   week  → `YYYY-MM-DD` of the local Monday that starts the week
 *   month → `YYYY-MM`
 */

export const DEFAULT_REPORT_TZ = 'Europe/Istanbul';
export const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** Upper bound on zero-filled buckets in one response (a year by day = 366). */
export const MAX_BUCKETS = 2000;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isGranularity(v: unknown): v is Granularity {
  return typeof v === 'string' && (GRANULARITIES as readonly string[]).includes(v);
}

/** A valid IANA zone from the query, else Europe/Istanbul. */
export function parseTz(raw: unknown): string {
  const tz = Array.isArray(raw) ? raw[0] : raw;
  if (typeof tz !== 'string' || !tz || tz.length > 64) return DEFAULT_REPORT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_REPORT_TZ;
  }
}

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

/** `YYYY-MM-DD` → parts, or null when it is not a real calendar date. */
export function parseDateKey(raw: unknown): DateParts | null {
  if (typeof raw !== 'string') return null;
  const match = DATE_KEY_RE.exec(raw);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(p: DateParts): string {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Calendar arithmetic on a date key (no time zone involved). */
export function addDays(key: string, days: number): string {
  const p = parseDateKey(key);
  if (!p) throw new Error(`Invalid date key: ${key}`);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return dateKey({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

/** Number of calendar days from `from` to `to`, both included (1 for the same day). */
export function daysInclusive(from: string, to: string): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (!a || !b) throw new Error('Invalid date key');
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts extends DateParts {
  hour: number;
  minute: number;
}

/** Wall-clock parts of `date` in `tz`. */
export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** Local calendar day of `date` in `tz`. */
export function localDateKey(date: Date, tz: string): string {
  return dateKey(localParts(date, tz));
}

/** UTC offset of `tz` at instant `at` (local wall clock − UTC), minute precision. */
function tzOffsetMs(at: number, tz: string): number {
  const p = localParts(new Date(at), tz);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
  return wall - Math.floor(at / 60_000) * 60_000;
}

/** UTC instant of local midnight of `key` in `tz` (DST-safe, two passes). */
export function zonedMidnight(key: string, tz: string): Date {
  const p = parseDateKey(key);
  if (!p) throw new Error(`Invalid date key: ${key}`);
  const guess = Date.UTC(p.y, p.m - 1, p.d);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return new Date(t);
}

export interface DateWindow {
  /** First local day, `YYYY-MM-DD`. */
  from: string;
  /** Last local day (included), `YYYY-MM-DD`. */
  to: string;
  /** UTC instant of local midnight of `from`. */
  start: Date;
  /** Last millisecond before local midnight after `to`. */
  end: Date;
}

/** Local-day window [from 00:00, to 24:00) in `tz`; null when a key is invalid or from > to. */
export function windowFromKeys(from: string, to: string, tz: string): DateWindow | null {
  if (!parseDateKey(from) || !parseDateKey(to) || from > to) return null;
  return {
    from,
    to,
    start: zonedMidnight(from, tz),
    end: new Date(zonedMidnight(addDays(to, 1), tz).getTime() - 1),
  };
}

/** The window of equal day count that ends the day before `from` (finance §4.2). */
export function previousKeys(from: string, to: string): { from: string; to: string } {
  const n = daysInclusive(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Monday (local) that starts the ISO week of `key`. */
export function mondayOf(key: string): string {
  const p = parseDateKey(key);
  if (!p) throw new Error(`Invalid date key: ${key}`);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

/** Bucket key of instant `date` for `granularity` in `tz`. */
export function bucketKey(date: Date, granularity: Granularity, tz: string): string {
  const p = localParts(date, tz);
  const day = dateKey(p);
  switch (granularity) {
    case 'hour':
      return `${day}T${pad(p.hour)}`;
    case 'day':
      return day;
    case 'week':
      return mondayOf(day);
    case 'month':
    default:
      return `${p.y}-${pad(p.m)}`;
  }
}

/**
 * Every bucket key between `start` and `end` (inclusive), ascending, de-duplicated.
 * Returns null when there would be more than `max` buckets.
 */
export function bucketKeys(
  start: Date,
  end: Date,
  granularity: Granularity,
  tz: string,
  max: number = MAX_BUCKETS,
): string[] | null {
  if (end.getTime() < start.getTime()) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (seen.has(k)) return true;
    seen.add(k);
    keys.push(k);
    return keys.length <= max;
  };
  if (granularity === 'hour') {
    // 15-minute steps so 30/45-minute offsets and DST transitions never skip a local hour.
    const step = 15 * 60_000;
    if ((end.getTime() - start.getTime()) / step > max * 4 + 8) return null;
    for (let t = start.getTime(); t <= end.getTime(); t += step) {
      if (!push(bucketKey(new Date(t), 'hour', tz))) return null;
    }
    if (!push(bucketKey(end, 'hour', tz))) return null;
    return keys;
  }
  const first = localDateKey(start, tz);
  const last = localDateKey(end, tz);
  if (daysInclusive(first, last) > max * 31) return null;
  for (let k = first; k <= last; k = addDays(k, 1)) {
    const b = granularity === 'day' ? k : granularity === 'week' ? mondayOf(k) : k.slice(0, 7);
    if (!push(b)) return null;
  }
  return keys;
}
