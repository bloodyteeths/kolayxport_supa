/**
 * Stable identity for Etsy inventory products (implemented by W0, owner W3).
 * Pure and isomorphic (no node:crypto), so the browser can compute the same key.
 *
 * Etsy regenerates product_id / offering_id on every inventory PUT, so they
 * can never be used as identity. The identity is the set of
 * (property_id, value_id) pairs of a product:
 *
 *   variantKey      = sha1( sorted 'pid:vid' pairs joined by '|' )
 *                     a pair without value_id falls back to 'pid:v=<normalized value>'
 *   variantValueKey = sha1( sorted 'pid:<normalized value>' pairs joined by '|' )
 *                     (survives value-id churn; a pair without value falls back to 'pid:#<vid>')
 *
 * Special keys:
 *   ''  — listing without variations (no property values)
 *   '*' — shared-quantity listing (quantity not on any property); see etsyQuantityKey.
 */

export const NO_VARIATION_KEY = '';
export const SHARED_QUANTITY_KEY = '*';

export type EtsyVariantPair = { propertyId: number; valueId?: number | null; value?: string | null };

function normalizeValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[İı]/g, 'I')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function validPid(p: EtsyVariantPair): boolean {
  return p != null && Number.isFinite(Number(p.propertyId));
}

function hasVid(p: EtsyVariantPair): boolean {
  return p.valueId !== null && p.valueId !== undefined && Number.isFinite(Number(p.valueId));
}

export function etsyVariantKeys(pairs: EtsyVariantPair[]): { variantKey: string; variantValueKey: string } {
  const list = (Array.isArray(pairs) ? pairs : []).filter(validPid);
  if (list.length === 0) return { variantKey: NO_VARIATION_KEY, variantValueKey: NO_VARIATION_KEY };

  const idParts = list
    .map((p) => {
      const pid = Math.trunc(Number(p.propertyId));
      return hasVid(p) ? `${pid}:${Math.trunc(Number(p.valueId))}` : `${pid}:v=${normalizeValue(p.value)}`;
    })
    .sort();
  const valueParts = list
    .map((p) => {
      const pid = Math.trunc(Number(p.propertyId));
      const nv = normalizeValue(p.value);
      return nv ? `${pid}:${nv}` : `${pid}:#${hasVid(p) ? Math.trunc(Number(p.valueId)) : ''}`;
    })
    .sort();

  return { variantKey: sha1Hex(idParts.join('|')), variantValueKey: sha1Hex(valueParts.join('|')) };
}

/**
 * Stock identity of a product given the listing's quantity_on_property:
 *  - no property values           -> ''  (single offering)
 *  - quantity on no property      -> '*' (one shared quantity for the listing)
 *  - otherwise                    -> variantKey over ONLY the quantity properties
 *    (e.g. quantity varies by Size but not Color: all colours of one size share a key).
 */
export function etsyQuantityKey(pairs: EtsyVariantPair[], quantityOnProperty: number[] | null | undefined): string {
  const list = (Array.isArray(pairs) ? pairs : []).filter(validPid);
  if (list.length === 0) return NO_VARIATION_KEY;
  const qp = new Set((quantityOnProperty || []).map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n)));
  if (qp.size === 0) return SHARED_QUANTITY_KEY;
  const filtered = list.filter((p) => qp.has(Math.trunc(Number(p.propertyId))));
  if (filtered.length === 0) return SHARED_QUANTITY_KEY;
  return etsyVariantKeys(filtered).variantKey;
}

/** Convenience: pairs from an Etsy inventory product's property_values. */
export function pairsFromEtsyProduct(product: any): EtsyVariantPair[] {
  const out: EtsyVariantPair[] = [];
  for (const pv of Array.isArray(product?.property_values) ? product.property_values : []) {
    const propertyId = Number(pv?.property_id);
    if (!Number.isFinite(propertyId)) continue;
    const valueIds = Array.isArray(pv?.value_ids) ? pv.value_ids : [];
    const values = Array.isArray(pv?.values) ? pv.values : [];
    const n = Math.max(valueIds.length, values.length, 1);
    for (let i = 0; i < n; i++) {
      const vid = valueIds[i];
      out.push({
        propertyId,
        valueId: vid === undefined || vid === null || !Number.isFinite(Number(vid)) ? null : Number(vid),
        value: values[i] ?? null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SHA-1 over UTF-8 (pure JS; identical output to node:crypto sha1 hex).
// ---------------------------------------------------------------------------

function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha1Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
