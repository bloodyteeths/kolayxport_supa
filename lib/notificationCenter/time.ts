/**
 * Timezone helpers for quiet hours and the daily digest (owner W5). Pure, no
 * dependencies: uses Intl only. Hours are local wall-clock hours 0–23.
 */

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 'YYYY-MM-DD' in the given timezone */
  dateKey: string;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
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
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of `date` in `tz` (falls back to Europe/Istanbul on a bad tz). */
export function localParts(date: Date, tz: string | null | undefined): LocalParts {
  const zone = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const parts = formatter(zone).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') % 24;
  const minute = get('minute');
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, dateKey };
}

function validHour(h: unknown): h is number {
  return typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23;
}

/**
 * True when `date` falls inside the quiet window [start, end) local time.
 * The window may wrap midnight (23 → 8). null/equal hours = no quiet hours.
 */
export function inQuietHours(
  date: Date,
  tz: string | null | undefined,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  if (!validHour(start) || !validHour(end) || start === end) return false;
  const { hour } = localParts(date, tz);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * When the quiet window that contains `date` ends (next local `end`:00).
 * Returns `date` itself when not in quiet hours. DST shifts inside the window
 * can move the result by up to an hour, which is fine for a hold.
 */
export function quietHoursEnd(
  date: Date,
  tz: string | null | undefined,
  start: number | null | undefined,
  end: number | null | undefined,
): Date {
  if (!inQuietHours(date, tz, start, end)) return date;
  const { hour, minute } = localParts(date, tz);
  const nowMin = hour * 60 + minute;
  const endMin = (end as number) * 60;
  let delta = (endMin - nowMin + 1440) % 1440;
  if (delta === 0) delta = 1440;
  const out = new Date(date.getTime() + delta * 60_000);
  out.setUTCSeconds(0, 0);
  return out;
}
