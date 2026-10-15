// components/domain/listing-editor/sections/etsyShared.ts — Group B (listing-editor §10): pure helpers, data
// loaders and constants shared by the Etsy field sections (Title, Tags, Price, Details, Shipping) and their
// modals. No staging logic lives here: core fields go through the engine's `setField`, category details and
// queued "create" actions keep the drawer's exact `stageEtsyDraft` payloads (see DetailsSection / modals).
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { tagTitleOverlap } from '@/lib/etsy/seoRules';
import { fieldAnchorId } from '@/lib/listingEditor/sections';

// ─── DOM ids (score `fix.field`, validation "Go to first", SectionNav.scrollTo) ─────────────────────────────

/**
 * Score-fix / shorthand ids → the engine's field key. Inputs carry `fieldAnchorId(<field key>)`
 * (lib/listingEditor/sections.ts), which is what `FieldIssue.field` / `FieldError.field` already use; the
 * `Check.fix.field` ids of `lib/listingScore/etsy.ts` (`details`, `shipping`, `weight`, `processing`, …) are
 * aliases resolved here.
 */
export const ETSY_FIELD_ALIAS: Record<string, string> = {
  details: 'taxonomy_id',
  category: 'taxonomy_id',
  shipping: 'shipping_profile_id',
  processing: 'readiness_state_id',
  processing_min: 'readiness_state_id',
  processing_max: 'readiness_state_id',
  weight: 'item_weight',
  dimensions: 'item_length',
};

/** DOM id of the control for a field key or a score-fix alias. */
export function fieldDomId(field: string): string {
  return fieldAnchorId(ETSY_FIELD_ALIAS[field] ?? field);
}

/** Focus a field by logical id (after `SectionNav.scrollTo`). Returns false when it is not on the page. */
export function focusEtsyField(field: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.getElementById(fieldDomId(field));
  if (!el) return false;
  el.focus({ preventScroll: false });
  return true;
}

// ─── Constants ────────────────────────────────────────────────────────────────────────────────────────────

export const WEIGHT_UNITS = ['oz', 'lb', 'g', 'kg'] as const;
export const DIMENSION_UNITS = ['in', 'ft', 'mm', 'cm'] as const;
/** Etsy only accepts these return windows (POST /shops/{id}/policies/return). */
export const RETURN_DEADLINES = [7, 14, 21, 30, 45, 60, 90] as const;
export const WHO_MADE_VALUES = ['i_did', 'collective', 'someone_else'] as const;
export const WHO_MADE_I18N: Record<string, string> = { i_did: 'iDid', collective: 'collective', someone_else: 'someoneElse' };
/** Countries offered by the shipping-profile form (same list as the drawer; labels from `etsy.countries`). */
export const SHIPPING_COUNTRIES = ['TR', 'US', 'GB', 'DE', 'FR', 'CA', 'AU', 'NL', 'IT', 'ES'] as const;
export const DESCRIPTION_MAX = 13_000;
export const MATERIAL_MAX = 13;
export const MATERIAL_MAX_LEN = 45;

// ─── Text helpers ─────────────────────────────────────────────────────────────────────────────────────────

/** Display-safe text: entity-decoded (idempotent), so "one&#39;s" never shows even on an old cache row. */
export function displayText(value: unknown): string {
  return typeof value === 'string' ? decodeEntities(value) : '';
}

/** Display-safe list (tags, materials). */
export function displayList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => decodeEntities(v)) : [];
}

/** Words in a description (Etsy counts whitespace-separated words). */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * The title word repeated in most tags ("blanket" repeats in 2 tags), for the title helper line.
 * Uses `tagTitleOverlap` (stemmed, stop words ignored) so it agrees with the TagInput chip flags.
 */
export function titleTagRepeats(title: string, tags: readonly string[]): { word: string; count: number } | null {
  if (!title.trim() || tags.length === 0) return null;
  const counts = new Map<string, number>();
  for (const tag of tags) {
    for (const w of new Set(tagTitleOverlap(tag, title).map((x) => x.toLowerCase()))) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let best: { word: string; count: number } | null = null;
  for (const [word, count] of counts) {
    if (count >= 2 && (!best || count > best.count || (count === best.count && word < best.word))) best = { word, count };
  }
  return best;
}

/** `'' | number` field → `number | null` for NumberField. */
export function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** NumberField value → the engine's `'' | number`. */
export function numOrEmpty(v: number | null | undefined): number | '' {
  return typeof v === 'number' && Number.isFinite(v) ? v : '';
}

/** Price field (decimal string) → number | null. Accepts "12,50" too. */
export function priceToNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** number | null → the engine's decimal price string ("12.5"; '' when empty), rounded to cents. */
export function numberToPrice(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '' : String(Math.round(n * 100) / 100);
}

// ─── Taxonomy (category) ──────────────────────────────────────────────────────────────────────────────────

export interface TaxonomyNode {
  id: number;
  name: string;
  children?: TaxonomyNode[];
}

export interface FlatTaxonomy {
  id: number;
  name: string;
  /** "Home & Living › Bedding › Blankets". */
  path: string;
  /** True when the node has no children (Etsy prefers leaf categories). */
  leaf: boolean;
}

export function flattenTaxonomy(nodes: readonly TaxonomyNode[], prefix = ''): FlatTaxonomy[] {
  const out: FlatTaxonomy[] = [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'number' || !node.name) continue;
    const path = prefix ? `${prefix} › ${node.name}` : node.name;
    const children = Array.isArray(node.children) ? node.children : [];
    out.push({ id: node.id, name: node.name, path, leaf: children.length === 0 });
    if (children.length) out.push(...flattenTaxonomy(children, path));
  }
  return out;
}

/**
 * Search the flat taxonomy by name/path words (all words must match, case/diacritics-insensitive).
 * Name matches rank before path-only matches, leaves before parents, then shorter paths.
 */
export function searchTaxonomy(list: readonly FlatTaxonomy[], query: string, limit = 50): FlatTaxonomy[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
  const words = norm(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return list.filter((x) => !x.path.includes('›')).slice(0, limit);
  const scored: Array<{ x: FlatTaxonomy; s: number }> = [];
  for (const x of list) {
    const p = norm(x.path);
    if (!words.every((w) => p.includes(w))) continue;
    const n = norm(x.name);
    const s = (words.every((w) => n.includes(w)) ? 0 : 100) + (x.leaf ? 0 : 10) + x.path.length / 1000;
    scored.push({ x, s });
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((r) => r.x);
}

const taxonomyCache = new Map<string, Promise<FlatTaxonomy[]>>();

/** Etsy seller taxonomy (`action=taxonomy`), flattened, cached per shop for the session. Failures are not cached. */
export function loadEtsyTaxonomy(shopId: string, fetcher: typeof fetch = fetch): Promise<FlatTaxonomy[]> {
  const hit = taxonomyCache.get(shopId);
  if (hit) return hit;
  const p = fetcher(`/api/clawd/etsy?action=taxonomy&shop_id=${encodeURIComponent(shopId)}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const nodes = data?.categories ?? data?.results ?? data;
      return flattenTaxonomy(Array.isArray(nodes) ? nodes : []);
    })
    .catch((e) => {
      taxonomyCache.delete(shopId);
      throw e;
    });
  taxonomyCache.set(shopId, p);
  return p;
}

/** Test hook. */
export function __resetTaxonomyCache() {
  taxonomyCache.clear();
}

// ─── Category details (taxonomy properties) ───────────────────────────────────────────────────────────────

export interface TaxonomyProperty {
  property_id: number;
  display_name: string;
  is_required: boolean;
  supports_variations: boolean;
  possible_values: Array<{ value_id: number | undefined; name: string }>;
  scales: Array<{ scale_id: number; display_name: string }>;
}

export interface ListingPropertyValue {
  property_id: number;
  property_name?: string;
  values: string[];
  value_ids?: number[];
  scale_id?: number | null;
}

export type ListingPropertyMap = Record<number, ListingPropertyValue>;

/** `GET action=get_taxonomy_properties` → properties (same mapping as the drawer). */
export function parseTaxonomyProperties(json: unknown): TaxonomyProperty[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((raw) => {
      const p = raw as Record<string, unknown>;
      return {
        property_id: Number(p.property_id) || 0,
        display_name: decodeEntities(String(p.display_name || p.name || '')),
        is_required: Boolean(p.is_required),
        supports_variations: Boolean(p.supports_variations),
        possible_values: Array.isArray(p.possible_values)
          ? (p.possible_values as Array<Record<string, unknown>>)
            .map((v) => ({ value_id: Number(v.value_id) || undefined, name: decodeEntities(String(v.name ?? '')) }))
            .filter((v) => v.name)
          : [],
        scales: Array.isArray(p.scales)
          ? (p.scales as Array<Record<string, unknown>>)
            .map((s) => ({ scale_id: Number(s.scale_id) || 0, display_name: String(s.display_name ?? '') }))
            .filter((s) => s.scale_id)
          : [],
      };
    })
    .filter((p) => p.property_id && p.display_name);
}

/** `GET action=get_listing_properties` → map by property id (same mapping as the drawer). */
export function parseListingProperties(json: unknown): ListingPropertyMap {
  const results = (json as { results?: unknown[] } | null)?.results;
  const out: ListingPropertyMap = {};
  if (!Array.isArray(results)) return out;
  for (const raw of results) {
    const p = raw as Record<string, unknown>;
    const id = Number(p.property_id) || 0;
    if (!id) continue;
    out[id] = {
      property_id: id,
      property_name: (p.property_name || p.name) as string | undefined,
      values: Array.isArray(p.values) ? p.values.map((v) => decodeEntities(String(v))) : [],
      value_ids: Array.isArray(p.value_ids) ? p.value_ids.map((v) => Number(v)).filter(Boolean) : [],
      scale_id: p.scale_id != null ? Number(p.scale_id) : null,
    };
  }
  return out;
}

const sameList = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/**
 * Properties that differ from the original (drawer `getChangedListingProperties`, unchanged semantics: a
 * property removed from `current` is not reported). This is exactly the `taxonomy.properties` staged.
 */
export function changedListingProperties(original: ListingPropertyMap, current: ListingPropertyMap): ListingPropertyValue[] {
  const ids = new Set([...Object.keys(original), ...Object.keys(current)].map(Number));
  const changed: ListingPropertyValue[] = [];
  ids.forEach((id) => {
    const cur = current[id];
    const orig = original[id];
    if (!cur) return;
    if (!sameList(cur.values, orig?.values) || !sameList(cur.value_ids, orig?.value_ids) || (cur.scale_id ?? null) !== (orig?.scale_id ?? null)) {
      changed.push(cur);
    }
  });
  return changed;
}

/** Overlay a staged `taxonomyPatch.properties` (DB draft) onto the remote values (I0 overlay rule). */
export function overlayStagedProperties(base: ListingPropertyMap, taxonomyPatch: unknown): ListingPropertyMap {
  const next: ListingPropertyMap = { ...base };
  const staged = (taxonomyPatch as { properties?: unknown[] } | null)?.properties;
  if (!Array.isArray(staged)) return next;
  for (const raw of staged) {
    const p = raw as Partial<ListingPropertyValue>;
    const id = Number(p?.property_id) || 0;
    if (!id) continue;
    next[id] = {
      property_id: id,
      property_name: p.property_name,
      values: Array.isArray(p.values) ? p.values.map(String) : [],
      value_ids: Array.isArray(p.value_ids) ? p.value_ids.map(Number).filter(Boolean) : [],
      scale_id: p.scale_id ?? null,
    };
  }
  return next;
}

/** Required category attributes filled (score `attributes` check). null when no taxonomy is loaded. */
export function requiredAttributeSummary(props: readonly TaxonomyProperty[] | null, values: ListingPropertyMap): { required: number; filled: number } | null {
  if (!props) return null;
  const req = props.filter((p) => p.is_required);
  return { required: req.length, filled: req.filter((p) => (values[p.property_id]?.values?.length ?? 0) > 0).length };
}

/**
 * Category change: keep the values whose property still exists in the new category, report the ones that
 * will be removed (listing-editor §6.5 "2 details don't apply to the new category").
 */
export function keepApplicableProperties(values: ListingPropertyMap, nextProps: readonly TaxonomyProperty[]): { kept: ListingPropertyMap; dropped: number } {
  const allowed = new Set(nextProps.map((p) => p.property_id));
  const kept: ListingPropertyMap = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(values)) {
    const id = Number(k);
    if (allowed.has(id)) kept[id] = v;
    else if ((v.values?.length ?? 0) > 0) dropped += 1;
  }
  return { kept, dropped };
}

// ─── Shop metadata (sections, shipping profiles, return policies, processing profiles) ───────────────────

export interface ShopSectionOption { shop_section_id: number; title: string }
export interface ShippingProfileOption {
  shipping_profile_id: number;
  title: string;
  min_processing_days?: number | null;
  max_processing_days?: number | null;
  processing_days_display_label?: string | null;
}
export interface ReturnPolicyOption {
  return_policy_id: number;
  accepts_returns?: boolean;
  accepts_exchanges?: boolean;
  return_deadline?: number | null;
  /** Pending (staged) policy label. */
  description?: string;
}
export interface ReadinessStateOption {
  readiness_state_id: number;
  readiness_state: string;
  min_processing_days: number | null;
  max_processing_days: number | null;
  processing_days_display_label?: string | null;
}

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface ShopMetaList<T> {
  items: T[];
  status: LoadStatus;
  retry: () => void;
}

export interface EtsyShopMeta {
  sections: ShopMetaList<ShopSectionOption>;
  shippingProfiles: ShopMetaList<ShippingProfileOption>;
  returnPolicies: ShopMetaList<ReturnPolicyOption>;
  readinessStates: ShopMetaList<ReadinessStateOption> & { add: (s: ReadinessStateOption) => void };
}

function useShopList<T>(shopId: string | null | undefined, action: string, pick: (json: unknown) => T[]): ShopMetaList<T> & { setItems: (fn: (prev: T[]) => T[]) => void } {
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [nonce, setNonce] = useState(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    if (!shopId) return undefined;
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/clawd/etsy?action=${action}&shop_id=${encodeURIComponent(shopId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        if (cancelled) return;
        setItems(pickRef.current(json));
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [shopId, action, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { items, status, retry, setItems };
}

const arr = (json: unknown, key: string): Array<Record<string, unknown>> => {
  const v = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
};

/**
 * Loads the four shop lists the Details and Shipping sections need (each with its own load state, so one
 * failing list never blocks the form; listing-editor §6.1 "Partial loads"). Deleted shipping profiles are
 * hidden. Text is entity-decoded.
 */
export function useEtsyShopMeta(shopId: string | null | undefined): EtsyShopMeta {
  const sections = useShopList<ShopSectionOption>(shopId, 'get_shop_sections', (j) =>
    arr(j, 'shop_sections').map((s) => ({ shop_section_id: Number(s.shop_section_id), title: decodeEntities(String(s.title ?? '')) })).filter((s) => s.shop_section_id));
  const shippingProfiles = useShopList<ShippingProfileOption>(shopId, 'get_shipping_profiles', (j) =>
    arr(j, 'shipping_profiles')
      .filter((p) => !p.is_deleted)
      .map((p) => ({
        shipping_profile_id: Number(p.shipping_profile_id),
        title: decodeEntities(String(p.title ?? '')),
        min_processing_days: (p.min_processing_days as number | null) ?? null,
        max_processing_days: (p.max_processing_days as number | null) ?? null,
        processing_days_display_label: (p.processing_days_display_label as string | null) ?? null,
      }))
      .filter((p) => p.shipping_profile_id));
  const returnPolicies = useShopList<ReturnPolicyOption>(shopId, 'get_return_policies', (j) =>
    arr(j, 'return_policies').map((p) => ({
      return_policy_id: Number(p.return_policy_id),
      accepts_returns: Boolean(p.accepts_returns),
      accepts_exchanges: Boolean(p.accepts_exchanges),
      return_deadline: (p.return_deadline as number | null) ?? null,
    })).filter((p) => p.return_policy_id));
  const readiness = useShopList<ReadinessStateOption>(shopId, 'get_readiness_states', (j) =>
    arr(j, 'readiness_states').map((s) => ({
      readiness_state_id: Number(s.readiness_state_id),
      readiness_state: String(s.readiness_state ?? ''),
      min_processing_days: (s.min_processing_days as number | null) ?? null,
      max_processing_days: (s.max_processing_days as number | null) ?? null,
      processing_days_display_label: (s.processing_days_display_label as string | null) ?? null,
    })).filter((s) => s.readiness_state_id));
  const setReadiness = readiness.setItems;
  const add = useCallback((s: ReadinessStateOption) => setReadiness((prev) => [...prev.filter((x) => x.readiness_state_id !== s.readiness_state_id), s]), [setReadiness]);
  const pick = <T,>(l: ShopMetaList<T>): ShopMetaList<T> => ({ items: l.items, status: l.status, retry: l.retry });
  return {
    sections: pick(sections),
    shippingProfiles: pick(shippingProfiles),
    returnPolicies: pick(returnPolicies),
    readinessStates: { ...pick(readiness), add },
  };
}

// ─── Pending "create" actions in the draft (shop section / shipping profile / return policy) ─────────────

export interface QueuedCreateLike {
  type: string;
  tempId?: number;
  payload?: Record<string, unknown>;
  completedAt?: string | null;
}

/**
 * Options for not-yet-created shop items staged in the draft (`create_shop_section` & co., negative temp
 * ids). They survive a reload because they are read from `draft.queuedActions`, not from component state.
 */
export function pendingCreates(actions: readonly QueuedCreateLike[] | null | undefined) {
  const list = (actions ?? []).filter((a) => a && !a.completedAt && typeof a.tempId === 'number');
  return {
    sections: list.filter((a) => a.type === 'create_shop_section')
      .map((a) => ({ shop_section_id: a.tempId as number, title: String(a.payload?.title ?? '') })),
    shippingProfiles: list.filter((a) => a.type === 'create_shipping_profile')
      .map((a) => ({ shipping_profile_id: a.tempId as number, title: String(a.payload?.title ?? '') })),
    returnPolicies: list.filter((a) => a.type === 'create_return_policy')
      .map((a) => ({
        return_policy_id: a.tempId as number,
        accepts_returns: Boolean(a.payload?.accepts_returns),
        accepts_exchanges: Boolean(a.payload?.accepts_exchanges),
        return_deadline: (a.payload?.return_deadline as number | undefined) ?? null,
      })),
  };
}

/** Merge remote options with pending ones (pending last, de-duplicated by id). */
export function mergeById<T, K extends keyof T>(remote: readonly T[], pending: readonly T[], key: K): T[] {
  const seen = new Set(remote.map((r) => r[key]));
  return [...remote, ...pending.filter((p) => !seen.has(p[key]))];
}

// ─── Shipping profile form (payload identical to the drawer's handleCreateShippingProfile) ────────────────

export interface NewShippingProfileInput {
  title: string;
  origin_country_iso: string;
  destination_country_iso: string | null;
  primary_cost: number | null;
  secondary_cost: number | null;
  min_processing_days: number | null;
  max_processing_days: number | null;
}

export type ShippingFormError = 'titleRequired' | 'processingRange';

export function validateShippingProfile(input: NewShippingProfileInput): ShippingFormError[] {
  const errors: ShippingFormError[] = [];
  if (!input.title.trim()) errors.push('titleRequired');
  const min = input.min_processing_days ?? 1;
  const max = input.max_processing_days ?? 3;
  if (min > max) errors.push('processingRange');
  return errors;
}

export function shippingProfilePayload(input: NewShippingProfileInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: input.title.trim(),
    origin_country_iso: input.origin_country_iso,
    primary_cost: input.primary_cost ?? 0,
    secondary_cost: input.secondary_cost ?? 0,
    min_processing_days: Math.trunc(input.min_processing_days ?? 1) || 1,
    max_processing_days: Math.trunc(input.max_processing_days ?? 3) || 3,
  };
  if (input.destination_country_iso) payload.destination_country_iso = input.destination_country_iso;
  return payload;
}

/** A negative temp id for a staged create (same scheme as the drawer: `-Date.now()`). */
export function newTempId(now: () => number = Date.now): number {
  return -now();
}
