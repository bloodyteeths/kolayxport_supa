/**
 * Listing-id list helpers for the batch form of /api/stock/etsy-managed (BR-11).
 * Pure (no server imports) so the browser hook and the route share them.
 */
export const ETSY_MANAGED_MAX_IDS = 500;

const ID_RE = /^\d{1,20}$/;

/** Dedupes + sorts ids numerically (as strings) — the stable SWR key / query form. */
export function normalizeListingIds(ids: ReadonlyArray<string | number | bigint | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    if (raw === null || raw === undefined) continue;
    const s = String(raw).trim();
    if (ID_RE.test(s)) out.add(s.replace(/^0+(?=\d)/, ''));
  }
  return [...out].sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
}

export type ParsedManagedIds = { ok: true; ids: string[] } | { ok: false; code: 'invalid_listing' | 'too_many_ids' };

/**
 * Parses `ids` from a query: `ids=1,2,3`, repeated `ids=1&ids=2`, or both. Every entry must be a numeric
 * listing id; empty → invalid_listing; more than ETSY_MANAGED_MAX_IDS distinct ids → too_many_ids.
 */
export function parseManagedIdsParam(v: unknown, max = ETSY_MANAGED_MAX_IDS): ParsedManagedIds {
  const parts = (Array.isArray(v) ? v : [v])
    .flatMap((x) => (x === undefined || x === null ? [] : String(x).split(',')))
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((p) => !ID_RE.test(p))) return { ok: false, code: 'invalid_listing' };
  const ids = normalizeListingIds(parts);
  if (ids.length > max) return { ok: false, code: 'too_many_ids' };
  return { ok: true, ids };
}
