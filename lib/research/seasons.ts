// lib/research/seasons.ts — "Upcoming seasons (shipping from Türkiye)" (research.md §4.1, RR §3 supporting module).
// Deterministic event table with per-country dates + ship-from-Türkiye lead times:
//   lastShip = event − transit days − SAFETY_DAYS
//   listBy   = lastShip − production days − the event's shopping window (buyers order this early) − INDEX_DAYS
// Transit = median of the user's own delivered labels per carrier and destination (Measured), else the
// carrier's rate-card transit (Estimate). Pure: the API passes the samples in. No strings: names are i18n
// keys `research.season.<key>`; seeds are English marketplace phrases (P5: keywords stay English).

import type { Guarded, SeasonRow } from './types';

export const DEFAULT_PRODUCTION_DAYS = 3;
export const SAFETY_DAYS = 3;
/** Etsy search needs about a week to rank a new listing. */
export const INDEX_DAYS = 7;
export const MIN_TRANSIT_SAMPLE = 3;
const DAY = 86_400_000;

export type SeasonKey =
  | 'christmas' | 'valentines' | 'mothersDayUs' | 'mothersDayUk' | 'mothersDayDe' | 'fathersDay' | 'halloween'
  | 'blackFriday' | 'diwali' | 'ramadan' | 'eidAlAdha' | 'backToSchool' | 'graduation';

export interface SeasonDef {
  key: SeasonKey;
  countries: string[];
  /** Days before the event that buyers start ordering (the listing must be live by then). */
  shopWindowDays: number;
  seed: string;
  date: (year: number) => Date | null;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** n-th weekday (0 = Sunday) of a month; n = -1 → last. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = utc(year, month, 1);
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return utc(year, month, 1 + offset + (n - 1) * 7);
  }
  const last = utc(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, last.getUTCDate() - offset);
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** Lunar-calendar events: published dates (may shift ±1 day with moon sighting). Years outside the table are skipped. */
const LUNAR: Record<'diwali' | 'ramadan' | 'eidAlAdha', Record<number, [number, number]>> = {
  diwali: { 2025: [10, 20], 2026: [11, 8], 2027: [10, 29], 2028: [10, 17] },
  ramadan: { 2026: [2, 18], 2027: [2, 8], 2028: [1, 28], 2029: [1, 16] },
  eidAlAdha: { 2026: [5, 27], 2027: [5, 16], 2028: [5, 5], 2029: [4, 24] },
};
const lunar = (k: keyof typeof LUNAR) => (y: number) => { const d = LUNAR[k][y]; return d ? utc(y, d[0], d[1]) : null; };

export const SEASONS: readonly SeasonDef[] = [
  { key: 'christmas', countries: ['US', 'GB', 'DE', 'CA', 'AU'], shopWindowDays: 45, seed: 'personalized christmas ornament', date: (y) => utc(y, 12, 25) },
  { key: 'valentines', countries: ['US', 'GB', 'DE', 'CA', 'AU'], shopWindowDays: 30, seed: 'valentines gift for her', date: (y) => utc(y, 2, 14) },
  { key: 'mothersDayUs', countries: ['US', 'CA', 'AU'], shopWindowDays: 30, seed: 'mothers day gift personalized', date: (y) => nthWeekday(y, 5, 0, 2) },
  { key: 'mothersDayUk', countries: ['GB'], shopWindowDays: 30, seed: 'mothers day gift personalized', date: (y) => new Date(easterSunday(y).getTime() - 21 * DAY) },
  { key: 'mothersDayDe', countries: ['DE'], shopWindowDays: 30, seed: 'mothers day gift personalized', date: (y) => nthWeekday(y, 5, 0, 2) },
  { key: 'fathersDay', countries: ['US', 'GB', 'CA'], shopWindowDays: 30, seed: 'fathers day gift personalized', date: (y) => nthWeekday(y, 6, 0, 3) },
  { key: 'halloween', countries: ['US', 'GB', 'CA'], shopWindowDays: 35, seed: 'halloween decor', date: (y) => utc(y, 10, 31) },
  { key: 'blackFriday', countries: ['US', 'GB', 'DE', 'CA'], shopWindowDays: 14, seed: 'christmas gift idea', date: (y) => new Date(nthWeekday(y, 11, 4, 4).getTime() + DAY) },
  { key: 'diwali', countries: ['US', 'GB', 'CA'], shopWindowDays: 30, seed: 'diwali decoration', date: lunar('diwali') },
  { key: 'ramadan', countries: ['US', 'GB', 'DE', 'CA'], shopWindowDays: 30, seed: 'ramadan decoration', date: lunar('ramadan') },
  { key: 'eidAlAdha', countries: ['US', 'GB', 'DE', 'CA'], shopWindowDays: 21, seed: 'eid gift', date: lunar('eidAlAdha') },
  { key: 'backToSchool', countries: ['US', 'CA'], shopWindowDays: 30, seed: 'personalized back to school', date: (y) => utc(y, 8, 15) },
  { key: 'graduation', countries: ['US', 'CA'], shopWindowDays: 30, seed: 'graduation gift personalized', date: (y) => utc(y, 5, 25) },
];

/** Rate-card transit days from Türkiye (Estimate), used until the user has MIN_TRANSIT_SAMPLE delivered labels. */
export const RATE_CARD_TRANSIT: Record<string, number> = { fedex: 4, ups: 4, dhl: 4, mng: 7, ptt: 14, default: 6 };

export function normalizeCarrier(c: string | null | undefined): string {
  const s = String(c || '').toLowerCase();
  if (s.includes('fedex')) return 'fedex';
  if (s.includes('ups')) return 'ups';
  if (s.includes('dhl')) return 'dhl';
  if (s.includes('mng')) return 'mng';
  if (s.includes('ptt')) return 'ptt';
  return s.trim() || 'default';
}

export interface TransitSample {
  carrier: string;
  /** ISO-3166 alpha-2 destination. */
  country: string;
  shippedAt: Date | string;
  deliveredAt: Date | string;
}

export interface TransitStat { carrier: string; country: string; median: number; n: number }

/** Median transit days per carrier × country. Negative or > 60-day spans are dropped as bad data. */
export function transitMedians(samples: TransitSample[]): TransitStat[] {
  const groups = new Map<string, number[]>();
  for (const s of samples) {
    const a = new Date(s.shippedAt).getTime();
    const b = new Date(s.deliveredAt).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const days = (b - a) / DAY;
    if (days <= 0 || days > 60) continue;
    const key = `${normalizeCarrier(s.carrier)}|${String(s.country || '').toUpperCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(days);
    groups.set(key, arr);
  }
  const out: TransitStat[] = [];
  for (const [key, arr] of groups) {
    const [carrier, country] = key.split('|');
    const v = [...arr].sort((x, y) => x - y);
    const mid = (v.length - 1) / 2;
    out.push({ carrier, country, median: Math.round(((v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2) * 10) / 10, n: v.length });
  }
  return out.sort((x, y) => y.n - x.n);
}

/** Best transit for a destination: the user's most-used carrier with enough samples, else the rate card. */
export function transitFor(country: string, stats: TransitStat[]): { carrier: string; days: Guarded<number>; sample: number } {
  const c = country.toUpperCase();
  const measured = stats.filter((s) => s.country === c && s.n >= MIN_TRANSIT_SAMPLE).sort((a, b) => b.n - a.n)[0];
  if (measured) {
    return { carrier: measured.carrier, days: { value: Math.ceil(measured.median), kind: 'measured', guard: { ok: true } }, sample: measured.n };
  }
  // Rate card for the carrier the user ships with most (any destination), else FedEx.
  const usual = stats.filter((s) => s.carrier !== 'default').sort((a, b) => b.n - a.n)[0]?.carrier ?? 'fedex';
  const days = RATE_CARD_TRANSIT[usual] ?? RATE_CARD_TRANSIT.default;
  return { carrier: usual, days: { value: days, kind: 'estimate', guard: { ok: true } }, sample: 0 };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) => utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

export interface UpcomingOptions {
  country?: string;
  now?: Date;
  productionDays?: number;
  transit?: TransitStat[];
  /** Look-ahead from today on the event date (default 200 days). */
  horizonDays?: number;
  limit?: number;
}

/** Events for `country` whose list-by date is today or later and whose date is inside the horizon, sorted by `listBy`. */
export function upcomingSeasons(opts: UpcomingOptions = {}): SeasonRow[] {
  const country = (opts.country || 'US').toUpperCase();
  const today = startOfDay(opts.now ?? new Date());
  const production = clampProductionDays(opts.productionDays);
  const horizon = opts.horizonDays ?? 200;
  const t = transitFor(country, opts.transit ?? []);
  const transitDays = t.days.value ?? RATE_CARD_TRANSIT.default;
  const rows: SeasonRow[] = [];
  for (const def of SEASONS) {
    if (!def.countries.includes(country)) continue;
    for (const year of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const date = def.date(year);
      if (!date) continue;
      const until = (date.getTime() - today.getTime()) / DAY;
      if (until <= 0 || until > horizon) continue;
      const lastShip = new Date(date.getTime() - (transitDays + SAFETY_DAYS) * DAY);
      const listBy = new Date(lastShip.getTime() - (production + def.shopWindowDays + INDEX_DAYS) * DAY);
      // Too late to list for this year's date: show next year's instead (when inside the horizon).
      if (listBy.getTime() < today.getTime()) continue;
      rows.push({
        key: def.key,
        country,
        date: iso(date),
        listBy: iso(listBy),
        daysToListBy: Math.round((listBy.getTime() - today.getTime()) / DAY),
        lastShip: { carrier: t.carrier, date: iso(lastShip), transitDays: t.days, sample: t.sample },
        productionDays: production,
        seed: def.seed,
      });
      break;
    }
  }
  rows.sort((a, b) => (a.listBy < b.listBy ? -1 : a.listBy > b.listBy ? 1 : 0));
  return rows.slice(0, opts.limit ?? 6);
}

export function clampProductionDays(v: unknown): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return DEFAULT_PRODUCTION_DAYS;
  return Math.max(0, Math.min(60, Math.round(n)));
}

/** Destination country from an order's `shippingAddress` JSON (keys vary per marketplace). */
export function countryFromAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  for (const k of ['countryCode', 'country_code', 'country_iso', 'countryIso', 'CountryCode', 'country']) {
    const v = a[k];
    if (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim())) return v.trim().toUpperCase();
  }
  return null;
}
