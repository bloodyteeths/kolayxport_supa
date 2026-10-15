// lib/bulk/parseMoney.ts — locale-independent, deterministic number parse for BulkGrid paste and typing
// (bulk-grid.md §5.3 step 7). The same text gives the same number in the EN and the TR UI:
//   the LAST `.` or `,` followed by exactly 1–2 digits at the end is the decimal separator; every other
//   `.` / `,` / space / `'` is grouping.  `1.109,30` and `1,109.30` → 1109.3 · `12,50` → 12.5 · `1,109` → 1109.
// A currency symbol or ISO code is accepted only when it matches the row currency.

export type NumberParse = { ok: true; value: number } | { ok: false; code: 'empty' | 'invalid' };
export type MoneyParse = NumberParse | { ok: false; code: 'currency'; found: string };

/** Symbols → the currencies they can stand for. `$` is any dollar; `kr` any krona/krone. */
const SYMBOLS: Record<string, string[]> = {
  '$': ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'],
  'us$': ['USD'], 'ca$': ['CAD'], 'c$': ['CAD'], 'a$': ['AUD'], 'au$': ['AUD'], 'nz$': ['NZD'], 'hk$': ['HKD'], 's$': ['SGD'],
  '€': ['EUR'], '£': ['GBP'], '₺': ['TRY'], 'tl': ['TRY'], '¥': ['JPY', 'CNY'], '₹': ['INR'], '₩': ['KRW'],
  'zł': ['PLN'], 'kr': ['SEK', 'NOK', 'DKK'], 'r$': ['BRL'], 'chf': ['CHF'], 'fr': ['CHF'],
};

/** ISO codes recognised as "a currency" (so `12 EUR` on a USD shop is a mismatch, not a typo). */
const ISO = new Set([
  'USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'BRL',
  'MXN', 'SGD', 'HKD', 'KRW', 'ZAR', 'ILS', 'AED', 'SAR', 'CZK', 'HUF', 'RON', 'BGN', 'UAH',
]);

const GROUPING = /[\s   '’]/g;

/** Parses a plain number with the separator rule above. `-` prefix allowed; letters are not. */
export function parseNumberText(input: string): NumberParse {
  const s = String(input ?? '').trim().replace(GROUPING, '');
  if (!s) return { ok: false, code: 'empty' };
  const m = /^([+-]?)([\d.,]+)$/.exec(s);
  if (!m) return { ok: false, code: 'invalid' };
  const [, sign, body] = m;
  if (!/\d/.test(body)) return { ok: false, code: 'invalid' };
  const dec = /[.,](\d{1,2})$/.exec(body);
  let intPart = body;
  let frac = '';
  if (dec) {
    intPart = body.slice(0, dec.index);
    frac = dec[1];
  }
  // Grouping separators may appear anywhere in the integer part (`1.109`, `1,234,567`), never doubled.
  if (/[.,]{2}/.test(intPart) || /^[.,]|[.,]$/.test(intPart)) return { ok: false, code: 'invalid' };
  const digits = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(digits) || (digits === '' && frac === '')) return { ok: false, code: 'invalid' };
  const value = Number(`${sign === '-' ? '-' : ''}${digits || '0'}${frac ? `.${frac}` : ''}`);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, code: 'invalid' };
}

/** Splits a leading/trailing currency marker off the number text. */
function splitCurrency(text: string): { marker: string; rest: string } {
  const s = text.trim();
  const lead = /^([^\d\s.,+-]+)\s*(.*)$/.exec(s);
  if (lead && !/^\d/.test(s)) return { marker: lead[1], rest: lead[2] };
  const trail = /^(.*?[\d.,])\s*([^\d\s.,]+)$/.exec(s);
  if (trail) return { marker: trail[2], rest: trail[1] };
  return { marker: '', rest: s };
}

/** True when `marker` (symbol or ISO code, any case) can mean `currency`. */
export function currencyMatches(marker: string, currency: string | undefined): boolean {
  const m = marker.trim().toLowerCase();
  const cur = (currency ?? '').toUpperCase();
  if (!m) return true;
  if (!cur) return false;
  if (m.toUpperCase() === cur) return true;
  return (SYMBOLS[m] ?? []).includes(cur);
}

/**
 * Money parse for a row whose shop currency is `currency` (e.g. 'USD').
 * `$12.50`, `12,50 USD`, `₺1.109,30`, `1109.3` → ok · `12.50 EUR` on a USD shop → `currency` · `abc` → `invalid`.
 */
export function parseMoney(input: string, currency?: string): MoneyParse {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, code: 'empty' };
  // A sign may sit before the symbol (`-$5`): move it onto the number.
  const signed = /^([+-])\s*(.*)$/.exec(raw);
  const sign = signed ? signed[1] : '';
  const body = signed ? signed[2] : raw;
  const { marker, rest } = splitCurrency(body);
  if (marker) {
    if (!rest.trim()) return { ok: false, code: 'invalid' };
    if (!/^[\p{L}\p{Sc}$]+[$]?$/u.test(marker)) return { ok: false, code: 'invalid' };
    if (!currencyMatches(marker, currency)) {
      // Only call it a currency mismatch when the marker really is a currency.
      const known = ISO.has(marker.toUpperCase()) || marker.toLowerCase() in SYMBOLS;
      return known ? { ok: false, code: 'currency', found: marker } : { ok: false, code: 'invalid' };
    }
  }
  return parseNumberText(`${sign}${rest}`);
}
