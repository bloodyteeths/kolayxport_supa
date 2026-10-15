// components/ds/inputs/_number.ts — locale-aware number parsing/formatting for NumberField and MoneyField.
// Pure functions (unit-tested in test/ds/m1b-number.test.ts).

export function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';
}

/**
 * Parse what a seller typed. Accepts both "1.109,30" and "1,109.30" (DS §4.6 "locale-aware parse of 1.109,30").
 * - both separators present → the last one is the decimal separator;
 * - one separator repeated → grouping;
 * - one separator once → the locale decimal separator is decimal; the other one is grouping only when it is
 *   followed by exactly three digits ("1.109" in TR = 1109, "12.5" in TR = 12.5).
 * Returns null for empty input and NaN for anything that is not a number.
 */
export function parseLocaleNumber(input: string, locale: string): number | null {
  let s = input.replace(/[\s  ']/g, '');
  if (s === '') return null;
  let sign = 1;
  if (s.startsWith('-') || s.startsWith('−')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s === '' || !/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    if (s.split(dec).length > 2) return NaN;
    normalized = s.split(grp).join('').replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return NaN;
      normalized = parts.join('');
    } else {
      const isLocaleDecimal = sep === decimalSeparator(locale);
      const looksGrouped = parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0';
      normalized = !isLocaleDecimal && looksGrouped ? parts.join('') : `${parts[0] || '0'}.${parts[1]}`;
    }
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? sign * n : NaN;
}

export function formatLocaleNumber(n: number, locale: string, opts: { minDecimals?: number; maxDecimals?: number; grouping?: boolean } = {}): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: opts.minDecimals ?? 0,
    maximumFractionDigits: opts.maxDecimals ?? 6,
    useGrouping: opts.grouping ?? true,
  }).format(n);
}

export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function currencySymbol(currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Round to `decimals` without floating-point drift (no .toFixed: lint P5). */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}
