/**
 * Address merging (W4 T4a). Pure.
 *
 * Etsy's API withholds buyer addresses for most shops; the Chrome extension
 * scrapes them into EtsyAddress and they are merged into Order.shippingAddress.
 * A later sync that receives an EMPTY address must never wipe that.
 *
 * Rules:
 *  - '' / null / '—' (the Veeqo placeholder) count as empty.
 *  - If the incoming address has a street, it is the primary block (the
 *    marketplace is authoritative for a real address) and only contact fields
 *    (name/phone/email/company) are filled from the existing one.
 *  - Otherwise, if the existing address has a street, it stays primary and
 *    only its empty fields are filled from the incoming one.
 *  - Neither has a street: field-wise, incoming non-empty wins.
 */

export type AddressLike = Record<string, any>;

const PLACEHOLDERS = new Set(['', '—', '-', 'n/a', 'null', 'undefined']);
const CONTACT_FIELDS = ['name', 'phone', 'email', 'company'];

export function isEmptyAddressValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return PLACEHOLDERS.has(v.trim().toLowerCase());
  return false;
}

/** Order.shippingAddress may be stored as a JSON string (legacy writer) or an object. */
export function parseStoredAddress(v: unknown): AddressLike | null {
  if (!v) return null;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) return v as AddressLike;
  return null;
}

export function hasStreet(a: AddressLike | null | undefined): boolean {
  if (!a) return false;
  return !isEmptyAddressValue(a.street1) || !isEmptyAddressValue(a.line1) || !isEmptyAddressValue(a.address1);
}

function fill(target: AddressLike, source: AddressLike, keys?: string[]) {
  for (const k of keys || Object.keys(source)) {
    if (isEmptyAddressValue(target[k]) && !isEmptyAddressValue(source[k])) target[k] = source[k];
  }
}

export function mergeAddressPreferNonEmpty(existing: unknown, incoming: unknown): AddressLike | null {
  const ex = parseStoredAddress(existing);
  const inc = parseStoredAddress(incoming);
  if (!ex && !inc) return null;
  if (!ex) return { ...inc! };
  if (!inc) return { ...ex };

  if (hasStreet(inc)) {
    const out: AddressLike = { ...inc };
    fill(out, ex, CONTACT_FIELDS);
    return out;
  }
  if (hasStreet(ex)) {
    const out: AddressLike = { ...ex };
    fill(out, inc);
    return out;
  }
  const out: AddressLike = { ...ex };
  for (const [k, v] of Object.entries(inc)) {
    if (!isEmptyAddressValue(v)) out[k] = v;
  }
  return out;
}

/** customerName: incoming non-empty wins; never blank out a stored name. */
export function mergeNamePreferNonEmpty(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  if (!isEmptyAddressValue(incoming)) return String(incoming).trim();
  if (!isEmptyAddressValue(existing)) return String(existing);
  return (incoming ?? existing ?? null) as string | null;
}

/** Stable comparison of two stored/incoming address values (string or object). */
export function sameAddress(a: unknown, b: unknown): boolean {
  const pa = parseStoredAddress(a);
  const pb = parseStoredAddress(b);
  if (!pa && !pb) return true;
  if (!pa || !pb) return false;
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  for (const k of keys) {
    const va = isEmptyAddressValue(pa[k]) ? '' : String(pa[k]);
    const vb = isEmptyAddressValue(pb[k]) ? '' : String(pb[k]);
    if (va !== vb) return false;
  }
  return true;
}
