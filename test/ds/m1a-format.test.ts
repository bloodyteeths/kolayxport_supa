import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  calendarDayDiff,
  fmtDate,
  fmtDateRange,
  fmtDelta,
  fmtDuration,
  fmtMoney,
  fmtMoneyTotals,
  fmtNum,
  fmtPercent,
  fmtRelative,
  shipByParts,
} from '@/lib/format';

// Intl output uses NBSP / narrow NBSP in some places; normalise for readable assertions.
const n = (s: string) => s.replace(/[\u00a0\u202f\u2009]/g, ' ');

// 2026-10-15 22:59 in Istanbul (UTC+3)
const AT = new Date('2026-10-15T19:59:00Z');
const NOW = new Date('2026-10-15T09:00:00Z'); // 12:00 Istanbul

describe('fmtMoney (DS §3.12)', () => {
  it('uses the narrow symbol and locale grouping, never the ISO code', () => {
    expect(fmtMoney(1109.3, 'TRY', { locale: 'tr' })).toBe('₺1.109,30');
    expect(fmtMoney(169.99, 'USD', { locale: 'tr' })).toBe('$169,99');
    expect(fmtMoney(1109.3, 'TRY', { locale: 'en' })).toBe('₺1,109.30');
    expect(fmtMoney(169.99, 'usd', { locale: 'en' })).toBe('$169.99');
    expect(fmtMoney(1070860.03, 'TRY', { locale: 'tr' })).toBe('₺1.070.860,03');
    expect(fmtMoney(1070860.03, 'TRY', { locale: 'en' })).not.toMatch(/TRY/);
  });

  it('prints 0 decimals for JPY/KRW', () => {
    expect(fmtMoney(1200, 'JPY', { locale: 'en' })).toBe('¥1,200');
    expect(n(fmtMoney(1200, 'KRW', { locale: 'en' }))).toBe('₩1,200');
  });

  it('compacts only at ≥ 100,000', () => {
    expect(n(fmtMoney(1070860.03, 'TRY', { locale: 'tr', compact: true }))).toBe('₺1,07 Mn');
    expect(fmtMoney(1070860.03, 'TRY', { locale: 'en', compact: true })).toBe('₺1.07M');
    expect(fmtMoney(99999, 'USD', { locale: 'en', compact: true })).toBe('$99,999.00');
  });

  it('approx prefixes ≈ and drops decimals at ≥ 1,000', () => {
    expect(fmtMoney(1070860.03, 'TRY', { locale: 'tr', approx: true })).toBe('≈ ₺1.070.860');
    expect(fmtMoney(1070860.03, 'TRY', { locale: 'en', approx: true })).toBe('≈ ₺1,070,860');
    expect(fmtMoney(12.5, 'USD', { locale: 'en', approx: true })).toBe('≈ $12.50');
  });

  it('sign and wholeIfIntegral', () => {
    expect(fmtMoney(12, 'USD', { locale: 'en', sign: true })).toBe('+$12.00');
    expect(fmtMoney(-12, 'USD', { locale: 'en', sign: true })).toBe('-$12.00');
    expect(fmtMoney(0, 'USD', { locale: 'en', sign: true })).toBe('$0.00');
    expect(fmtMoney(2499, 'TRY', { locale: 'tr', wholeIfIntegral: true })).toBe('₺2.499');
    expect(fmtMoney(2499.4, 'TRY', { locale: 'tr', wholeIfIntegral: true })).toBe('₺2.499,40');
  });

  it('renders — for missing amounts and keeps unknown currency codes visible', () => {
    expect(fmtMoney(null, 'USD', { locale: 'en' })).toBe(EMPTY);
    expect(fmtMoney(Number.NaN, 'USD', { locale: 'en' })).toBe(EMPTY);
    expect(fmtMoney(5, 'XXXX', { locale: 'en' })).toBe('5.00 XXXX');
    expect(fmtMoney(5, null, { locale: 'en' })).toBe('5.00');
  });

  it('never sums mixed currencies', () => {
    const parts = [
      { amount: 4000, currency: 'USD' },
      { amount: 86400, currency: 'TRY' },
      { amount: 210, currency: 'usd' },
      { amount: null, currency: 'EUR' },
    ];
    expect(fmtMoneyTotals(parts, { locale: 'en' })).toBe('$4,210.00 · ₺86,400.00');
    expect(fmtMoneyTotals(parts, { locale: 'tr' })).toBe('$4.210,00 · ₺86.400,00');
    expect(fmtMoneyTotals([], { locale: 'tr' })).toBe(EMPTY);
  });
});

describe('fmtNum / fmtPercent / fmtDelta / fmtDuration', () => {
  it('numbers', () => {
    expect(fmtNum(12480, { locale: 'tr' })).toBe('12.480');
    expect(fmtNum(12480, { locale: 'en' })).toBe('12,480');
    expect(fmtNum(1.23456, { locale: 'en' })).toBe('1.23');
    expect(fmtNum(3, { locale: 'en', decimals: 1 })).toBe('3.0');
    expect(n(fmtNum(1070860, { locale: 'tr', compact: true }))).toBe('1,07 Mn');
    expect(fmtNum(undefined, { locale: 'tr' })).toBe(EMPTY);
  });

  it('percent takes a ratio, at most 1 decimal', () => {
    expect(fmtPercent(0.042, { locale: 'tr' })).toBe('%4,2');
    expect(fmtPercent(0.042, { locale: 'en' })).toBe('4.2%');
    expect(fmtPercent(0.58549, { locale: 'en' })).toBe('58.5%');
    expect(fmtPercent(0.5, { locale: 'en', decimals: 1 })).toBe('50.0%');
  });

  it('delta: arrow + absolute percent, tone from goodWhen', () => {
    expect(fmtDelta(0.124, { locale: 'tr' })).toEqual({ direction: 'up', text: '▲ %12,4', tone: 'success' });
    expect(fmtDelta(-0.031, { locale: 'en' })).toEqual({ direction: 'down', text: '▼ 3.1%', tone: 'danger' });
    expect(fmtDelta(-0.031, { locale: 'en', goodWhen: 'down' })?.tone).toBe('success');
    expect(fmtDelta(0, { locale: 'en' })?.direction).toBe('flat');
    expect(fmtDelta(null, { locale: 'en' })).toBeNull();
  });

  it('duration', () => {
    expect(fmtDuration(72_000, { locale: 'en' })).toBe('1m 12s');
    expect(n(fmtDuration(72_000, { locale: 'tr' }))).toBe('1 dk 12 sn');
    expect(fmtDuration(9_000, { locale: 'en' })).toBe('9s');
    expect(fmtDuration(-1, { locale: 'en' })).toBe(EMPTY);
  });
});

describe('dates (seller timezone, default Europe/Istanbul)', () => {
  it('date: same year without the year, other years with it', () => {
    expect(fmtDate(AT, 'date', { locale: 'tr', now: NOW })).toBe('15 Eki');
    expect(fmtDate(AT, 'date', { locale: 'en', now: NOW })).toBe('Oct 15');
    const last = new Date('2025-10-15T12:00:00Z');
    expect(fmtDate(last, 'date', { locale: 'tr', now: NOW })).toBe('15 Eki 2025');
    expect(fmtDate(last, 'date', { locale: 'en', now: NOW })).toBe('Oct 15, 2025');
  });

  it('datetime / time follow the locale hour cycle and the timezone', () => {
    expect(fmtDate(AT, 'datetime', { locale: 'tr', now: NOW })).toBe('15 Eki 22:59');
    expect(n(fmtDate(AT, 'datetime', { locale: 'en', now: NOW }))).toBe('Oct 15, 10:59 PM');
    expect(fmtDate(AT, 'time', { locale: 'tr', now: NOW })).toBe('22:59');
    expect(n(fmtDate(AT, 'time', { locale: 'en', now: NOW, timeZone: 'UTC' }))).toBe('7:59 PM');
    // invalid zone falls back to the default
    expect(fmtDate(AT, 'time', { locale: 'tr', now: NOW, timeZone: 'Not/AZone' })).toBe('22:59');
  });

  it('weekday', () => {
    expect(fmtDate(AT, 'weekday', { locale: 'en', now: NOW })).toBe('Thursday, Oct 15');
    expect(fmtDate(AT, 'weekday', { locale: 'tr', now: NOW })).toBe('15 Eki Perşembe');
  });

  it('relative under 7 days, absolute after', () => {
    const fourMinAgo = new Date(NOW.getTime() - 4 * 60_000);
    expect(fmtRelative(fourMinAgo, { locale: 'en', now: NOW })).toBe('4 min ago');
    expect(fmtRelative(fourMinAgo, { locale: 'tr', now: NOW })).toBe('4 dk önce');
    expect(fmtRelative(new Date(NOW.getTime() - 10_000), { locale: 'en', now: NOW })).toBe('now');
    expect(fmtRelative(new Date(NOW.getTime() - 2 * 3_600_000), { locale: 'en', now: NOW })).toBe('2 hr ago');
    expect(fmtRelative(new Date(NOW.getTime() - 26 * 3_600_000), { locale: 'tr', now: NOW })).toBe('dün');
    expect(fmtRelative(new Date('2026-10-01T09:00:00Z'), { locale: 'en', now: NOW })).toBe('Oct 1');
    expect(fmtDate(fourMinAgo, 'relative', { locale: 'en', now: NOW })).toBe('4 min ago');
    expect(fmtRelative(null, { locale: 'en' })).toBe(EMPTY);
  });

  it('date range', () => {
    const a = new Date('2026-09-01T10:00:00Z');
    const b = new Date('2026-09-30T10:00:00Z');
    expect(n(fmtDateRange(a, b, { locale: 'tr' }))).toBe('1–30 Eyl 2026');
    expect(n(fmtDateRange(b, a, { locale: 'en' }))).toBe('Sep 1 – 30, 2026');
  });

  it('calendarDayDiff uses the timezone', () => {
    // 23:30 UTC on the 15th is already the 16th in Istanbul
    expect(calendarDayDiff(NOW, new Date('2026-10-15T23:30:00Z'))).toBe(1);
    expect(calendarDayDiff(NOW, new Date('2026-10-15T23:30:00Z'), 'UTC')).toBe(0);
  });
});

describe('shipByParts (one phrase)', () => {
  const o = { locale: 'en' as const, now: NOW };
  it('today within 24h → warning', () => {
    const p = shipByParts(AT, null, o);
    expect(p).toMatchObject({ kind: 'today', tone: 'warning', key: 'today' });
    expect(n(p.values.time ?? '')).toBe('10:59 PM');
    expect(n(p.absolute)).toBe('Oct 15, 10:59 PM');
  });
  it('tomorrow and later', () => {
    expect(shipByParts(new Date('2026-10-16T05:00:00Z'), null, o)).toMatchObject({ kind: 'tomorrow', tone: 'warning' });
    expect(shipByParts(new Date('2026-10-16T15:00:00Z'), null, o)).toMatchObject({ kind: 'tomorrow', tone: 'neutral' });
    expect(shipByParts(new Date('2026-10-17T20:00:00Z'), null, o)).toMatchObject({ kind: 'date', tone: 'neutral', values: { date: 'Oct 17' } });
  });
  it('overdue → danger, hours under a day, days after', () => {
    expect(shipByParts(new Date(NOW.getTime() - 3 * 3_600_000), null, o)).toMatchObject({ kind: 'overdue_hours', tone: 'danger', values: { count: 3 } });
    expect(shipByParts(new Date(NOW.getTime() - 30 * 3_600_000), null, o)).toMatchObject({ kind: 'overdue_days', tone: 'danger', values: { count: 1 } });
  });
  it('shipped wins; unknown never guesses', () => {
    expect(shipByParts(new Date(NOW.getTime() - 86_400_000 * 3), '2026-10-14T10:00:00Z', o)).toMatchObject({ kind: 'shipped', tone: 'neutral', values: { date: 'Oct 14' } });
    expect(shipByParts(null, null, o)).toMatchObject({ kind: 'unknown', tone: 'neutral', absolute: '' });
    expect(shipByParts('garbage', undefined, o).kind).toBe('unknown');
  });
});
