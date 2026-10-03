/**
 * eBay Inventory API payload rules, enforced server-side.
 *
 * eBay accepts a malformed inventory item at creation and only rejects it at
 * publish, often with a generic "The request has errors (eBay 2004)" that names
 * nothing. Each rule below cost a separate bug report before it was found, so
 * they live here rather than in whichever dialog happened to be edited last.
 *
 * Applied at both places that PUT an inventory item — the /api/clawd/ebay route
 * and lib/ebay/draftService — so every UI path is covered, including ones added
 * later.
 */

/** eBay rejects an item-specific value longer than this, at publish time. */
export const ASPECT_VALUE_MAX = 65;
/** eBay rejects an item-specific name longer than this. */
export const ASPECT_NAME_MAX = 40;
/** eBay truncates/rejects listing titles beyond this. */
export const TITLE_MAX = 80;

/**
 * Inventory API ConditionEnum. The used grades carry a USED_ prefix; the bare
 * VERY_GOOD / GOOD / ACCEPTABLE are not valid values and make eBay answer
 * "Could not serialize field [condition]".
 */
const LEGACY_CONDITION_MAP: Record<string, string> = {
  VERY_GOOD: 'USED_VERY_GOOD',
  GOOD: 'USED_GOOD',
  ACCEPTABLE: 'USED_ACCEPTABLE',
  USED: 'USED_EXCELLENT',
};

export function normalizeCondition(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const upper = value.trim().toUpperCase();
  return LEGACY_CONDITION_MAP[upper] || upper;
}

/**
 * Drop empty item specifics and clamp over-long ones. Empty values are their own
 * rejection (eBay 25719); over-long ones fail only on publish (eBay 25002).
 */
export function sanitizeAspects(
  aspects: unknown
): Record<string, string[]> | undefined {
  if (!aspects || typeof aspects !== 'object') return undefined;

  const clean: Record<string, string[]> = {};
  for (const [rawName, rawValues] of Object.entries(aspects as Record<string, unknown>)) {
    const name = String(rawName ?? '').trim().slice(0, ASPECT_NAME_MAX);
    if (!name) continue;

    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const kept = values
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .map((v) => (v.length > ASPECT_VALUE_MAX ? v.slice(0, ASPECT_VALUE_MAX).trim() : v))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    if (kept.length > 0) clean[name] = kept;
  }
  return clean;
}

/** Names whose value exceeds eBay's limit — for warning a seller before publish. */
export function overlongAspectNames(aspects: unknown): string[] {
  if (!aspects || typeof aspects !== 'object') return [];
  return Object.entries(aspects as Record<string, unknown>)
    .filter(([, values]) =>
      (Array.isArray(values) ? values : [values]).some(
        (v) => String(v ?? '').trim().length > ASPECT_VALUE_MAX
      )
    )
    .map(([name]) => name);
}

/**
 * Normalise a full inventory-item payload in place of ad-hoc per-caller cleanup.
 * Only touches fields that are present, so it is safe for partial PATCH-style
 * updates where omitting a key means "leave it alone".
 */
export function sanitizeInventoryItemPayload<T extends Record<string, any>>(body: T): T {
  if (!body || typeof body !== 'object') return body;

  const next: Record<string, any> = { ...body };

  if (next.product && typeof next.product === 'object') {
    const product: Record<string, any> = { ...next.product };

    if (typeof product.title === 'string') {
      product.title = product.title.trim().slice(0, TITLE_MAX);
    }
    if ('aspects' in product) {
      const cleaned = sanitizeAspects(product.aspects);
      // An aspects map that cleans down to nothing must be dropped, not sent as
      // {} — eBay treats an empty object as a malformed field.
      if (cleaned && Object.keys(cleaned).length > 0) product.aspects = cleaned;
      else delete product.aspects;
    }
    if (Array.isArray(product.imageUrls)) {
      product.imageUrls = product.imageUrls
        .map((u: unknown) => String(u ?? '').trim())
        .filter(Boolean);
    }

    next.product = product;
  }

  if ('condition' in next) {
    const normalized = normalizeCondition(next.condition);
    if (normalized) next.condition = normalized;
    else delete next.condition;
  }

  return next as T;
}
