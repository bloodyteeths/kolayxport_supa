/**
 * SKU normalisation (implemented by W0, owner W2). Pure, isomorphic.
 *
 * normalizeSku  — canonical identity used for StockItem.sku and exact matching:
 *   NFKC; strip invisible chars (U+200B–U+200D, U+2060, U+FEFF, U+00AD);
 *   map Turkish İ (U+0130) and ı (U+0131) to I; trim; collapse whitespace;
 *   locale-free toUpperCase. Empty -> null.
 * foldSkuLoose  — suggestion-only key: normalizeSku, then fold Ş Ğ Ç Ö Ü to
 *   ASCII and strip '-', '_', '.', '/' and spaces. Never used to auto-link.
 */

const INVISIBLE_RE = /[​-‍⁠﻿­]/g;
const TURKISH_DOTTED_RE = /[İı]/g;
const WHITESPACE_RE = /\s+/g;
const LOOSE_STRIP_RE = /[-_./\s]+/g;
const LOOSE_FOLD: Record<string, string> = {
  'Ş': 'S', // Ş
  'Ğ': 'G', // Ğ
  'Ç': 'C', // Ç
  'Ö': 'O', // Ö
  'Ü': 'U', // Ü
};
const LOOSE_FOLD_RE = /[ŞĞÇÖÜ]/g;

export function normalizeSku(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  if (typeof s !== 'string' && typeof s !== 'number') return null;
  let v = String(s).normalize('NFKC');
  v = v.replace(INVISIBLE_RE, '').replace(TURKISH_DOTTED_RE, 'I');
  v = v.trim().replace(WHITESPACE_RE, ' ');
  // String.prototype.toUpperCase is locale-independent (unlike toLocaleUpperCase).
  v = v.toUpperCase();
  // Upper-casing can produce U+0130 from nothing, but strip again defensively.
  v = v.replace(TURKISH_DOTTED_RE, 'I');
  return v.length > 0 ? v : null;
}

export function foldSkuLoose(s: unknown): string | null {
  const n = normalizeSku(s);
  if (!n) return null;
  const v = n.replace(LOOSE_FOLD_RE, (ch) => LOOSE_FOLD[ch] || ch).replace(LOOSE_STRIP_RE, '');
  return v.length > 0 ? v : null;
}
