/**
 * Safely convert an arbitrary value to an ISO date string.
 *
 * Marketplace APIs (Etsy in particular) occasionally send garbage values such
 * as "0", "invalid", or malformed ISO strings in date fields. Calling
 * `new Date(garbage).toISOString()` throws `RangeError: Invalid time value`,
 * which would otherwise propagate up and 500 the whole endpoint.
 *
 * Returns `null` for null/undefined/empty-string/unparseable input,
 * otherwise an ISO 8601 string.
 */
export function safeIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = new Date(v as any);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Safely build a Date object from an arbitrary value.
 * Returns `null` for unparseable input.
 */
export function safeDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(v as any);
  return Number.isFinite(d.getTime()) ? d : null;
}
