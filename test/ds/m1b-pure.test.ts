import { describe, expect, it } from 'vitest';
import { parseLocaleNumber, currencyDecimals, currencySymbol, roundTo } from '@/components/ds/inputs/_number';
import {
  resolvePreset, nextRange, inRange, formatRange, zonedTimeToDate, wallTimeIn, tzOffsetLabel, weekStartsOn,
} from '@/components/ds/inputs/_dates';
import { countryFromE164, flagEmoji, COUNTRY_DIAL, countryName } from '@/components/ds/inputs/_countries';
import { toE164, fromE164 } from '@/components/ds/inputs/PhoneInput';
import { mergeTags } from '@/components/ds/inputs/TagInput';
import { moveItem } from '@/components/ds/inputs/ImageGrid';
import { cleanTag, tagKey } from '@/lib/etsy/seoRules';
import { m1bInputs, flattenM1b } from './m1b-messages';

describe('parseLocaleNumber', () => {
  it.each([
    ['1.109,30', 'tr-TR', 1109.3],
    ['1,109.30', 'tr-TR', 1109.3],
    ['1.109,30', 'en-US', 1109.3],
    ['1,109.30', 'en-US', 1109.3],
    ['12,5', 'tr-TR', 12.5],
    ['12.5', 'tr-TR', 12.5],
    ['1.109', 'tr-TR', 1109],
    ['1,109', 'en-US', 1109],
    ['12,50', 'en-US', 12.5],
    ['1.234.567', 'tr-TR', 1234567],
    ['-3,5', 'tr-TR', -3.5],
    ['0,99', 'tr-TR', 0.99],
    [' 49 ', 'en-US', 49],
  ])('%s (%s) → %s', (input, locale, out) => {
    expect(parseLocaleNumber(input, locale)).toBe(out);
  });
  it('empty → null, junk → NaN', () => {
    expect(parseLocaleNumber('', 'en-US')).toBeNull();
    expect(Number.isNaN(parseLocaleNumber('12abc', 'en-US'))).toBe(true);
    expect(Number.isNaN(parseLocaleNumber('1.2.3,4.5', 'en-US'))).toBe(true);
  });
  it('currency helpers', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('TRY')).toBe(2);
    expect(currencySymbol('TRY', 'tr-TR')).toBe('₺');
    expect(currencySymbol('USD', 'en-US')).toBe('$');
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
});

describe('date helpers', () => {
  const now = new Date(2026, 9, 14, 15, 30); // 14 Oct 2026
  it('resolves presets to whole local days', () => {
    expect(resolvePreset('last7', now).from).toEqual(new Date(2026, 9, 8));
    expect(resolvePreset('last7', now).to).toEqual(new Date(2026, 9, 14));
    expect(resolvePreset('lastMonth', now)).toEqual({ from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) });
    expect(resolvePreset('thisYear', now).from).toEqual(new Date(2026, 0, 1));
    expect(resolvePreset('yesterday', now).from).toEqual(new Date(2026, 9, 13));
  });
  it('picks a range in two clicks and swaps a backwards pick', () => {
    const a = nextRange({ from: null, to: null }, new Date(2026, 9, 10));
    expect(a.complete).toBe(false);
    const b = nextRange({ from: a.from, to: a.to }, new Date(2026, 9, 3));
    expect(b).toEqual({ from: new Date(2026, 9, 3), to: new Date(2026, 9, 10), complete: true });
    expect(inRange(new Date(2026, 9, 5), b.from, b.to)).toBe(true);
    expect(inRange(new Date(2026, 9, 11), b.from, b.to)).toBe(false);
  });
  it('formats the trigger as "1–14 Oct 2026" / "1–14 Eki 2026"', () => {
    expect(formatRange(new Date(2026, 9, 1), new Date(2026, 9, 14), 'en-US')).toMatch(/^1\s?–\s?14 Oct 2026$/);
    expect(formatRange(new Date(2026, 9, 1), new Date(2026, 9, 14), 'tr-TR')).toMatch(/^1\s?–\s?14 Eki 2026$/);
  });
  it('weeks start on Monday in TR', () => {
    expect(weekStartsOn('tr-TR')).toBe(1);
    expect(weekStartsOn('en-US')).toBe(0);
  });
  it('converts seller wall time to an instant and back (no browser zone involved)', () => {
    const d = zonedTimeToDate({ year: 2026, month: 10, day: 20, hour: 9, minute: 15 }, 'Europe/Istanbul');
    expect(d.toISOString()).toBe('2026-10-20T06:15:00.000Z');
    expect(wallTimeIn(d, 'Europe/Istanbul')).toEqual({ year: 2026, month: 10, day: 20, hour: 9, minute: 15 });
    const ny = zonedTimeToDate({ year: 2026, month: 3, day: 8, hour: 12, minute: 0 }, 'America/New_York'); // DST day
    expect(ny.toISOString()).toBe('2026-03-08T16:00:00.000Z');
    expect(tzOffsetLabel('Europe/Istanbul', 'en-US', d)).toBe('GMT+3');
  });
});

describe('countries and phone', () => {
  it('has the codes the specs use', () => {
    expect(COUNTRY_DIAL.TR).toBe('90');
    expect(COUNTRY_DIAL.US).toBe('1');
    expect(flagEmoji('TR')).toBe('🇹🇷');
    expect(countryName('TR', 'tr-TR')).toBe('Türkiye');
  });
  it('finds the country from an E.164 number', () => {
    expect(countryFromE164('+905320000000')).toBe('TR');
    expect(countryFromE164('+15550134')).toBe('US');
    expect(countryFromE164('+12685550134')).toBe('AG');
    expect(countryFromE164('+447700900000')).toBe('GB');
    expect(countryFromE164('5320000000')).toBeNull();
  });
  it('builds E.164 and drops the national trunk 0', () => {
    expect(toE164('TR', '0532 000 00 00')).toBe('+905320000000');
    expect(toE164('US', '(555) 0134')).toBe('+15550134');
    expect(toE164('TR', '')).toBe('');
    expect(fromE164('+905320000000', 'US')).toEqual({ country: 'TR', national: '5320000000' });
  });
});

describe('mergeTags', () => {
  it('adds valid tags and reports each rejection reason', () => {
    const r = mergeTags(['baby gift'], ['newborn gift', 'personalized baby blanket', 'Baby Gift', '', 'x'], {
      max: 3, maxLength: 20, validate: (t) => (t === 'x' ? 'too short' : null),
    });
    expect(r.added).toEqual(['newborn gift']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['too_long', 'duplicate', 'invalid']);
    expect(r.rejected[2].message).toBe('too short');
  });
  it('stops at max with over_limit', () => {
    const r = mergeTags(['a1', 'b2'], ['c3', 'd4'], { max: 3 });
    expect(r.tags).toEqual(['a1', 'b2', 'c3']);
    expect(r.rejected).toEqual([{ tag: 'd4', reason: 'over_limit' }]);
  });
  it('accepts Etsy rules injected from lib/etsy/seoRules', () => {
    const r = mergeTags(['mom gifts'], ['Gift for Mom!', 'Wooden  Box'], { normalize: cleanTag, tagKey, maxLength: 20 });
    expect(r.added).toEqual(['wooden box']);
    expect(r.rejected[0].reason).toBe('duplicate');
  });
});

describe('moveItem', () => {
  it('moves within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
  });
});

describe('ds.inputs messages', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  it('EN and TR have the same keys', () => {
    expect(keys(m1bInputs.tr).sort()).toEqual(keys(m1bInputs.en).sort());
  });
  it('TR uses real Turkish characters, no ASCII-Turkish, no empty values', () => {
    const rows = flattenM1b();
    for (const r of rows) {
      expect(r.tr, r.key).not.toBe('');
      expect(r.tr, r.key).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Kaldir\b|Secin|Tum\b/);
    }
  });
  it('no ICU-quoted placeholders (a straight apostrophe before { swallows it)', () => {
    for (const r of flattenM1b()) {
      expect(r.en, r.key).not.toMatch(/'\{/);
      expect(r.tr, r.key).not.toMatch(/'\{/);
    }
  });
});
