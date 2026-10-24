// lib/bulk/categoryAttributes.ts — Etsy bulk "Category attributes" (pure). Sets the same category details
// (taxonomy properties: Primary color, Material, Occasion…) on every selected listing of one category, as staged
// drafts. A draft's taxonomyPatch is replaced as a whole on staging, so the new values are merged with properties
// already staged on that listing (by property_id; the new value wins). Listings of another category, or of an
// unknown one, are skipped (an attribute only exists in its category).

export interface TaxonomyPropertyValue {
  property_id: number;
  property_name?: string;
  values: string[];
  value_ids?: number[];
  scale_id?: number | null;
}

export interface CategoryRowLike {
  id: string;
  taxonomyId: number | null;
}

/** Properties the seller filled in (empty ones mean "leave as is"). */
export function filledProperties(values: Record<number, TaxonomyPropertyValue | undefined>): TaxonomyPropertyValue[] {
  return Object.values(values).filter((v): v is TaxonomyPropertyValue => Boolean(v && v.values.length));
}

/** Merge by property_id; `next` wins (pure). */
export function mergeTaxonomyProperties(existing: unknown, next: TaxonomyPropertyValue[]): TaxonomyPropertyValue[] {
  const list = Array.isArray(existing) ? (existing as TaxonomyPropertyValue[]).filter((p) => p && Number.isFinite(Number(p.property_id))) : [];
  const byId = new Map<number, TaxonomyPropertyValue>(list.map((p) => [Number(p.property_id), p]));
  for (const p of next) byId.set(Number(p.property_id), p);
  return Array.from(byId.values());
}

/** The category most of these listings are in (null when none is known). */
export function mostCommonCategory(rows: CategoryRowLike[]): number | null {
  const counts = new Map<number, number>();
  for (const r of rows) if (r.taxonomyId != null) counts.set(r.taxonomyId, (counts.get(r.taxonomyId) ?? 0) + 1);
  let best: number | null = null;
  for (const [id, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = id;
  return best;
}

/**
 * Patches for the listings in `taxonomyId` (pure). `pending` = staged taxonomyPatch.properties per listing id
 * (open drafts only).
 */
export function planCategoryAttributes(
  rows: CategoryRowLike[],
  taxonomyId: number,
  changed: TaxonomyPropertyValue[],
  pending: Map<string, unknown>,
): { patches: Array<{ id: string; properties: TaxonomyPropertyValue[] }>; skipped: number } {
  if (!changed.length) return { patches: [], skipped: rows.length };
  const patches: Array<{ id: string; properties: TaxonomyPropertyValue[] }> = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.taxonomyId !== taxonomyId) {
      skipped += 1;
      continue;
    }
    patches.push({ id: r.id, properties: mergeTaxonomyProperties(pending.get(r.id), changed) });
  }
  return { patches, skipped };
}

/** Open drafts (from fetchEtsyDrafts(shop)) → staged taxonomy properties per listing id. */
export function pendingTaxonomyByListing(drafts: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const r = d as { status?: string; etsyListingId?: unknown; taxonomyPatch?: { properties?: unknown } | null };
    if (!r || !['draft', 'failed', 'conflict'].includes(String(r.status))) continue;
    const props = r.taxonomyPatch?.properties;
    if (Array.isArray(props) && props.length) out.set(String(r.etsyListingId), props);
  }
  return out;
}
