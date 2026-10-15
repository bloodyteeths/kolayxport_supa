import { describe, expect, it } from 'vitest';
import { currencyMatches, parseMoney, parseNumberText } from '@/lib/bulk/parseMoney';

const ok = (value: number) => ({ ok: true, value });

describe('parseNumberText: last separator + 1–2 digits = decimal, the rest is grouping', () => {
  it.each([
    ['1.109,30', 1109.3], ['1,109.30', 1109.3], ['12,50', 12.5], ['12.50', 12.5], ['1,109', 1109], ['1.109', 1109],
    ['0.10', 0.1], ['0,1', 0.1], ['1 234,5', 1234.5], ["1'234.50", 1234.5], ['1,234,567', 1234567], ['42', 42], ['-3,5', -3.5], ['.5', 0.5],
  ])('%s → %s (same in every UI language)', (text, value) => {
    expect(parseNumberText(text)).toEqual(ok(value));
  });
  it.each(['abc', '1..2', '12,', ',', '1,2,3x', '--1'])('%s is invalid', (text) => {
    expect(parseNumberText(text)).toEqual({ ok: false, code: 'invalid' });
  });
  it('empty', () => {
    expect(parseNumberText('  ')).toEqual({ ok: false, code: 'empty' });
  });
});

describe('parseMoney', () => {
  it('strips a symbol or code that matches the row currency', () => {
    expect(parseMoney('$12.50', 'USD')).toEqual(ok(12.5));
    expect(parseMoney('12,50 USD', 'USD')).toEqual(ok(12.5));
    expect(parseMoney('₺1.109,30', 'TRY')).toEqual(ok(1109.3));
    expect(parseMoney('1.109,30 TL', 'TRY')).toEqual(ok(1109.3));
    expect(parseMoney('€ 9,99', 'EUR')).toEqual(ok(9.99));
    expect(parseMoney('usd 3', 'USD')).toEqual(ok(3));
    expect(parseMoney('-$5', 'USD')).toEqual(ok(-5));
    expect(parseMoney('69.99', 'USD')).toEqual(ok(69.99));
  });
  it('a different currency is a mismatch, junk is invalid', () => {
    expect(parseMoney('12.50 EUR', 'USD')).toEqual({ ok: false, code: 'currency', found: 'EUR' });
    expect(parseMoney('€12', 'USD')).toEqual({ ok: false, code: 'currency', found: '€' });
    expect(parseMoney('abc', 'USD')).toEqual({ ok: false, code: 'invalid' });
    expect(parseMoney('12 xyz', 'USD')).toEqual({ ok: false, code: 'invalid' });
    expect(parseMoney('', 'USD')).toEqual({ ok: false, code: 'empty' });
  });
  it('currencyMatches', () => {
    expect(currencyMatches('$', 'CAD')).toBe(true);
    expect(currencyMatches('CA$', 'USD')).toBe(false);
    expect(currencyMatches('', 'USD')).toBe(true);
  });
});
