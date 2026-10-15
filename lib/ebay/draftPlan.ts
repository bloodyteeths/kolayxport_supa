// Pure helpers for the eBay staged-draft engine (lib/ebay/draftService.ts).
// No Prisma, no network: everything here is unit-tested in
// test/listingEditor/f-ebayDraftPlan.test.ts.
//
// listing-editor §7.1:
//   F1 — a new listing is a draft with `queuedActions: [{ type: 'create', publish }]`;
//        its content lives in inventoryPatch / offerPatch / variationPatch exactly
//        like an edit, and `buildCreatePlan` turns it into the creator's eBay calls.
//   F3 — `computeEbayDiff` / `dropRejectedKeys` power Review differences.

import { normalizeCondition, sanitizeAspects, sanitizeInventoryItemPayload } from './payloadRules';

export type JsonMap = Record<string, any>;

export const DEFAULT_MARKETPLACE = 'EBAY_US';

// ---------------------------------------------------------------------------
// JSON merge
// ---------------------------------------------------------------------------

export function mergeJson(existing: any, patch: any): any {
  if (patch === undefined) return existing ?? {};
  if (patch === null) return null;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {};
  for (const key of Object.keys(patch)) {
    const pVal = patch[key];
    const eVal = base[key];
    if (pVal && typeof pVal === 'object' && !Array.isArray(pVal) && eVal && typeof eVal === 'object' && !Array.isArray(eVal)) {
      base[key] = mergeJson(eVal, pVal);
    } else {
      base[key] = pVal;
    }
  }
  return base;
}

/**
 * Applies an inventoryPatch to a live inventory item. Deep merge, except
 * `product.aspects`, which the editor always stages as the WHOLE map: merging
 * it would make a removed item specific come back on send.
 */
export function applyInventoryPatch(current: any, patch: any): any {
  const merged = mergeJson(current, patch);
  const aspects = patch?.product?.aspects;
  if (aspects && typeof aspects === 'object' && !Array.isArray(aspects) && merged?.product) {
    merged.product = { ...merged.product, aspects };
  }
  return merged;
}

export function isEmptyPatch(value: any) {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** Stable stringify (sorted keys) for deep equality of JSON values. */
export function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

export function getPath(obj: any, path: string[]): any {
  let cur = obj;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Removes `path` from `obj` (returns a copy) and prunes parents left empty. */
export function deletePath(obj: JsonMap, path: string[]): JsonMap {
  if (!obj || typeof obj !== 'object' || path.length === 0) return obj;
  const [head, ...rest] = path;
  if (!(head in obj)) return obj;
  const copy: JsonMap = { ...obj };
  if (rest.length === 0) {
    delete copy[head];
    return copy;
  }
  const child = copy[head];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return copy;
  const next = deletePath(child, rest);
  if (Object.keys(next).length === 0) delete copy[head];
  else copy[head] = next;
  return copy;
}

// ---------------------------------------------------------------------------
// Queued actions
// ---------------------------------------------------------------------------

export type EbayQueuedAction = { type: string; [k: string]: any };

export interface EbayCreateProgress {
  /** The eBay SKU the first created resource used; a retry keeps it even if the seller edits the SKU field. */
  sku?: string;
  /** Inventory items already PUT on eBay (simple: [sku]; variations: every variant SKU). */
  itemsCreated?: string[];
  groupCreated?: boolean;
  /** Offer id per SKU already created on eBay. */
  offerIds?: Record<string, string>;
  listingId?: string;
  published?: boolean;
}

export interface EbayCreateAction extends EbayQueuedAction {
  type: 'create';
  /** true = create and publish ("List on eBay"); false = "Save on eBay as unpublished". */
  publish?: boolean;
  /** Optional seed merged UNDER the patches (inventory / offer) — the patches win. */
  payload?: { inventory?: JsonMap; offer?: JsonMap };
  /** The seller's own SKU for the new listing (else the draft's generated local key). */
  sku?: string;
  /** Server-written: what already exists on eBay, so a retry never re-creates it. */
  progress?: EbayCreateProgress;
}

export function isCreateAction(a: unknown): a is EbayCreateAction {
  return Boolean(a) && typeof a === 'object' && (a as { type?: unknown }).type === 'create';
}

export function findCreateAction(actions: unknown): EbayCreateAction | null {
  return Array.isArray(actions) ? (actions.find(isCreateAction) ?? null) : null;
}

function actionKey(action: any) {
  return JSON.stringify(action || {});
}

/**
 * Appends incoming actions, de-duplicated by value. A `create` action is unique
 * per draft: an incoming one replaces the staged one (the publish choice can
 * change between saves) and keeps the server-written `progress`.
 */
export function mergeQueuedActions(existing: any[] = [], incoming?: any[]) {
  if (!incoming) return existing;
  let merged = [...existing];
  const incomingCreate = incoming.find(isCreateAction);
  if (incomingCreate) {
    const prev = merged.find(isCreateAction);
    merged = merged.filter((a) => !isCreateAction(a));
    const { progress: _ignored, ...rest } = incomingCreate;
    merged.unshift(prev?.progress ? { ...rest, progress: prev.progress } : rest);
  }
  const seen = new Set(merged.map(actionKey));
  for (const action of incoming) {
    if (isCreateAction(action)) continue;
    const key = actionKey(action);
    if (seen.has(key)) continue;
    merged.push(action);
    seen.add(key);
  }
  return merged;
}

/** eBay SKU rule for a seller-entered SKU: 1-50 letters, digits, `-`, `_` or `.`. Invalid or blank → null. */
export const SELLER_SKU_MAX = 50;
export function normalizeSellerSku(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sku = raw.trim();
  return sku && sku.length <= SELLER_SKU_MAX && /^[A-Za-z0-9._-]+$/.test(sku) ? sku : null;
}

/** Types the user may un-queue. `create` is the draft's identity and is never removable. */
export const REMOVABLE_ACTION_TYPES = ['delete', 'publish', 'withdraw', 'copy'] as const;

export function removeActions(existing: unknown, types: string[]): EbayQueuedAction[] {
  const list = Array.isArray(existing) ? (existing as EbayQueuedAction[]) : [];
  const drop = new Set(types.filter((t) => (REMOVABLE_ACTION_TYPES as readonly string[]).includes(t)));
  return list.filter((a) => !(a && drop.has(a.type)));
}

// ---------------------------------------------------------------------------
// Media ops (images live in product.imageUrls)
// ---------------------------------------------------------------------------

export interface MediaOpLike {
  operation: string;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  rank?: number | null;
}

/** Applies staged media ops in the engine's order: delete → add → reorder. Pure. */
export function applyMediaOps(imageUrls: string[], media: MediaOpLike[]): { imageUrls: string[]; changed: boolean } {
  const urls = [...imageUrls];
  let changed = false;
  const order: Record<string, number> = { delete: 0, upload: 1, add_url: 1, reorder: 2 };
  const sorted = [...media].sort((a, b) => (order[a.operation] ?? 3) - (order[b.operation] ?? 3));
  for (const m of sorted) {
    if (m.operation === 'delete' && m.imageUrl) {
      const idx = urls.indexOf(m.imageUrl);
      if (idx !== -1) {
        urls.splice(idx, 1);
        changed = true;
      }
    } else if (m.operation === 'upload' || m.operation === 'add_url') {
      const url = m.imageUrl || m.sourceUrl;
      if (url && !urls.includes(url)) {
        if (m.rank != null && m.rank >= 0 && m.rank <= urls.length) urls.splice(m.rank, 0, url);
        else urls.push(url);
        changed = true;
      }
    } else if (m.operation === 'reorder' && m.imageUrl) {
      const idx = urls.indexOf(m.imageUrl);
      if (idx !== -1 && m.rank != null) {
        urls.splice(idx, 1);
        urls.splice(m.rank, 0, m.imageUrl);
        changed = true;
      }
    }
  }
  return { imageUrls: urls, changed };
}

// ---------------------------------------------------------------------------
// F1: create plan
// ---------------------------------------------------------------------------

/** variationPatch of a NEW listing (an existing listing's variationPatch is an inventory_item_group body). */
export interface EbayCreateVariations {
  variants: Array<{ sku: string; combination: Record<string, string>; quantity: number | string; price?: number | string | null }>;
  /** Aspect whose value picks the photo (e.g. "Color"). */
  imageVaryingAspect?: string | null;
  /** Value → image URL for `imageVaryingAspect`. */
  variationImages?: Record<string, string>;
  /** Defined variation aspects with their values, in order. */
  specifications: Array<{ name: string; values: string[] }>;
}

export function isCreateVariations(v: unknown): v is EbayCreateVariations {
  return Boolean(v) && typeof v === 'object' && Array.isArray((v as EbayCreateVariations).variants) && (v as EbayCreateVariations).variants.length > 0;
}

export interface EbayCreateCall {
  step: 'inventory_item' | 'inventory_item_group' | 'offer' | 'publish' | 'publish_group';
  sku: string;
  body?: JsonMap;
}

export interface EbayCreatePlan {
  sku: string;
  publish: boolean;
  /** Every SKU that becomes a new inventory item (checked for existence first). */
  newSkus: string[];
  calls: EbayCreateCall[];
  /** Missing pieces eBay would reject; empty when the plan can run. */
  missing: string[];
}

const OFFER_FIELDS = [
  'format', 'availableQuantity', 'listingDuration', 'listingDescription', 'pricingSummary', 'listingPolicies',
  'categoryId', 'merchantLocationKey', 'storeCategoryNames', 'tax', 'charity', 'extendedProducerResponsibility',
  'regulatoryInformation', 'quantityLimitPerBuyer', 'secondaryCategoryId', 'lotSize',
] as const;

function toQty(v: unknown, fallback = 1): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Builds the exact eBay call sequence the legacy creator ran client-side
 * (components/ebay/ListingCreatorDialog.tsx handleCreate), from the draft rows.
 * Simple: inventory_item → offer → (publish). Variations: inventory_item per
 * variant → inventory_item_group → offer per variant → (publish_by_inventory_item_group).
 */
export function buildCreatePlan(input: {
  sku: string;
  action: EbayCreateAction;
  inventoryPatch: JsonMap | null | undefined;
  offerPatch: JsonMap | null | undefined;
  variationPatch: unknown;
  media: MediaOpLike[];
  marketplaceId?: string;
}): EbayCreatePlan {
  const marketplaceId = input.marketplaceId || DEFAULT_MARKETPLACE;
  const inventory: JsonMap = mergeJson(input.action.payload?.inventory || {}, input.inventoryPatch || {}) || {};
  const offerIn: JsonMap = mergeJson(input.action.payload?.offer || {}, input.offerPatch || {}) || {};
  const product: JsonMap = { ...(inventory.product || {}) };
  product.imageUrls = applyMediaOps(Array.isArray(product.imageUrls) ? product.imageUrls : [], input.media).imageUrls;

  const title = typeof product.title === 'string' ? product.title.trim() : '';
  const description = typeof product.description === 'string' ? product.description.trim() : '';
  const listingDescription = typeof offerIn.listingDescription === 'string' && offerIn.listingDescription.trim()
    ? offerIn.listingDescription.trim()
    : description;
  const quantity = toQty(inventory.availability?.shipToLocationAvailability?.quantity, 1);
  const price = offerIn.pricingSummary?.price?.value;
  const currency = offerIn.pricingSummary?.price?.currency || 'USD';
  const policies = offerIn.listingPolicies || {};

  const missing: string[] = [];
  if (!title) missing.push('title');
  if (!description) missing.push('description');
  if (!product.imageUrls.length) missing.push('photos');
  if (!offerIn.categoryId) missing.push('category');
  if (!policies.fulfillmentPolicyId) missing.push('fulfillmentPolicy');
  if (!policies.returnPolicyId) missing.push('returnPolicy');
  if (!policies.paymentPolicyId) missing.push('paymentPolicy');

  const baseOffer = (sku: string, qty: number, value: unknown): JsonMap => {
    const body: JsonMap = {};
    for (const k of OFFER_FIELDS) if (offerIn[k] !== undefined) body[k] = offerIn[k];
    body.sku = sku;
    body.marketplaceId = marketplaceId;
    body.format = body.format || 'FIXED_PRICE';
    body.listingDuration = body.listingDuration || 'GTC';
    body.availableQuantity = qty;
    body.listingDescription = listingDescription;
    body.pricingSummary = { price: { value: String(value ?? ''), currency } };
    body.listingPolicies = {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      returnPolicyId: policies.returnPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
    };
    if (Array.isArray(body.storeCategoryNames) && body.storeCategoryNames.length === 0) delete body.storeCategoryNames;
    return body;
  };

  // The legacy creator defaulted to NEW; an unset condition is not a blocker.
  const condition = normalizeCondition(inventory.condition) || 'NEW';
  const conditionDescription = condition && condition !== 'NEW' && inventory.conditionDescription
    ? inventory.conditionDescription
    : undefined;
  const calls: EbayCreateCall[] = [];
  const publish = input.action.publish !== false;

  if (isCreateVariations(input.variationPatch)) {
    const v = input.variationPatch;
    const varNames = (v.specifications || []).map((s) => s.name);
    const common = sanitizeAspects(product.aspects) || {};
    if (!varNames.length) missing.push('variations');
    for (const variant of v.variants) {
      if (!variant.sku) missing.push('variantSku');
      const price = variant.price !== undefined && variant.price !== null && String(variant.price) !== '' ? variant.price : offerIn.pricingSummary?.price?.value;
      if (price === undefined || price === null || String(price) === '' || !(Number(price) > 0)) missing.push(`price:${variant.sku}`);
    }
    const newSkus = v.variants.map((x) => x.sku);
    for (const variant of v.variants) {
      const aspects: Record<string, string[]> = { ...common };
      for (const [k, val] of Object.entries(variant.combination || {})) aspects[k] = [val];
      const own = v.imageVaryingAspect ? v.variationImages?.[variant.combination?.[v.imageVaryingAspect]] : undefined;
      const images = own ? [own, ...product.imageUrls.filter((u: string) => u !== own)] : product.imageUrls;
      calls.push({
        step: 'inventory_item',
        sku: variant.sku,
        body: sanitizeInventoryItemPayload({
          product: { title, description, aspects, imageUrls: images },
          condition,
          ...(conditionDescription ? { conditionDescription } : {}),
          availability: { shipToLocationAvailability: { quantity: toQty(variant.quantity, 1) } },
          ...(inventory.packageWeightAndSize ? { packageWeightAndSize: inventory.packageWeightAndSize } : {}),
        }),
      });
    }
    calls.push({
      step: 'inventory_item_group',
      sku: input.sku,
      body: {
        title,
        description,
        imageUrls: product.imageUrls,
        aspects: sanitizeAspects(Object.fromEntries(Object.entries(common).filter(([k]) => !varNames.includes(k)))) || {},
        variantSKUs: newSkus,
        variesBy: {
          aspectsImageVariesBy: v.imageVaryingAspect ? [v.imageVaryingAspect] : [],
          specifications: (v.specifications || []).map((s) => ({ name: s.name, values: s.values })),
        },
      },
    });
    for (const variant of v.variants) {
      const value = variant.price !== undefined && variant.price !== null && String(variant.price) !== '' ? variant.price : price;
      calls.push({ step: 'offer', sku: variant.sku, body: baseOffer(variant.sku, toQty(variant.quantity, 1), value) });
    }
    if (publish) calls.push({ step: 'publish_group', sku: input.sku, body: { inventoryItemGroupKey: input.sku, marketplaceId } });
    return { sku: input.sku, publish, newSkus: [...newSkus, input.sku], calls, missing: Array.from(new Set(missing)) };
  }

  if (price === undefined || price === null || String(price) === '' || !(Number(price) > 0)) missing.push('price');
  calls.push({
    step: 'inventory_item',
    sku: input.sku,
    body: (() => {
      const item: JsonMap = sanitizeInventoryItemPayload({
        ...inventory,
        product: { ...product, title, description },
        condition,
        availability: { shipToLocationAvailability: { quantity } },
      });
      if (conditionDescription) item.conditionDescription = conditionDescription;
      else delete item.conditionDescription;
      return item;
    })(),
  });
  calls.push({ step: 'offer', sku: input.sku, body: baseOffer(input.sku, quantity, price) });
  if (publish) calls.push({ step: 'publish', sku: input.sku });
  return { sku: input.sku, publish, newSkus: [input.sku], calls, missing: Array.from(new Set(missing)) };
}

// ---------------------------------------------------------------------------
// F3: diff + resolve
// ---------------------------------------------------------------------------

export interface EbayDiffFieldDef {
  key: string;
  source: 'inventory' | 'offer';
  path: string[];
  /** Other staged copies of the same value: compared and kept/dropped together with `path`. */
  also?: Array<{ source: 'inventory' | 'offer'; path: string[] }>;
}

/** Fields compared by Review differences. `key` is what `resolve { keep }` takes. */
export const EBAY_DIFF_FIELDS: EbayDiffFieldDef[] = [
  { key: 'title', source: 'inventory', path: ['product', 'title'] },
  { key: 'subtitle', source: 'inventory', path: ['product', 'subtitle'] },
  // The editor stages the description on the item AND as the offer's listingDescription (what buyers see):
  // one choice in Review differences covers both copies.
  { key: 'description', source: 'inventory', path: ['product', 'description'], also: [{ source: 'offer', path: ['listingDescription'] }] },
  { key: 'aspects', source: 'inventory', path: ['product', 'aspects'] },
  { key: 'imageUrls', source: 'inventory', path: ['product', 'imageUrls'] },
  { key: 'condition', source: 'inventory', path: ['condition'] },
  { key: 'conditionDescription', source: 'inventory', path: ['conditionDescription'] },
  { key: 'quantity', source: 'inventory', path: ['availability', 'shipToLocationAvailability', 'quantity'] },
  { key: 'packageWeightAndSize', source: 'inventory', path: ['packageWeightAndSize'] },
  { key: 'price', source: 'offer', path: ['pricingSummary', 'price'] },
  { key: 'listingPolicies', source: 'offer', path: ['listingPolicies'] },
  { key: 'categoryId', source: 'offer', path: ['categoryId'] },
  { key: 'storeCategoryNames', source: 'offer', path: ['storeCategoryNames'] },
];

export interface EbayDiffField {
  key: string;
  base: unknown;
  remote: unknown;
  draft: unknown;
  changedRemotely: boolean;
  inDraft: boolean;
}

function effectiveDraftValue(key: string, baseVal: unknown, patchVal: unknown): unknown {
  if (key === 'aspects') return patchVal;
  if (patchVal && typeof patchVal === 'object' && !Array.isArray(patchVal) && baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
    return mergeJson(baseVal, patchVal);
  }
  return patchVal;
}

/** Field-level comparison of base snapshot vs live eBay vs the staged patch. Pure. */
export function computeEbayDiff(input: {
  baseInventory: JsonMap | null | undefined;
  baseOffer: JsonMap | null | undefined;
  liveInventory: JsonMap | null | undefined;
  liveOffer: JsonMap | null | undefined;
  inventoryPatch: JsonMap | null | undefined;
  offerPatch: JsonMap | null | undefined;
}): EbayDiffField[] {
  const out: EbayDiffField[] = [];
  const read = (source: 'inventory' | 'offer', path: string[]) => ({
    base: getPath(source === 'inventory' ? input.baseInventory : input.baseOffer, path),
    remote: getPath(source === 'inventory' ? input.liveInventory : input.liveOffer, path),
    patch: getPath(source === 'inventory' ? input.inventoryPatch : input.offerPatch, path),
  });
  for (const def of EBAY_DIFF_FIELDS) {
    const copies = [read(def.source, def.path), ...(def.also || []).map((a) => read(a.source, a.path))];
    // Show the first copy that has a value (an item with no product.description shows the offer's).
    const shown = copies.find((c) => c.base !== undefined || c.remote !== undefined || c.patch !== undefined) ?? copies[0];
    const { base, remote } = shown;
    const patch = copies.find((c) => c.patch !== undefined)?.patch;
    const inDraft = copies.some((c) => c.patch !== undefined);
    const changedRemotely = copies.some((c) => stableJson(c.base) !== stableJson(c.remote));
    if (!inDraft && !changedRemotely) continue;
    out.push({
      key: def.key,
      base: base ?? null,
      remote: remote ?? null,
      draft: inDraft ? effectiveDraftValue(def.key, base, patch) : undefined,
      changedRemotely,
      inDraft,
    });
  }
  return out;
}

/**
 * Drops every staged field that changed on eBay and is NOT in `keep` (the user
 * picked "eBay's"). Fields the user kept, and fields eBay did not change, stay.
 */
export function dropRejectedKeys(input: {
  fields: EbayDiffField[];
  keep: string[];
  inventoryPatch: JsonMap | null | undefined;
  offerPatch: JsonMap | null | undefined;
}): { inventoryPatch: JsonMap; offerPatch: JsonMap; dropped: string[] } {
  let inventoryPatch: JsonMap = { ...(input.inventoryPatch || {}) };
  let offerPatch: JsonMap = { ...(input.offerPatch || {}) };
  const keep = new Set(input.keep);
  const dropped: string[] = [];
  for (const f of input.fields) {
    if (!f.inDraft || !f.changedRemotely || keep.has(f.key)) continue;
    const def = EBAY_DIFF_FIELDS.find((d) => d.key === f.key);
    if (!def) continue;
    for (const loc of [{ source: def.source, path: def.path }, ...(def.also || [])]) {
      if (loc.source === 'inventory') inventoryPatch = deletePath(inventoryPatch, loc.path);
      else offerPatch = deletePath(offerPatch, loc.path);
    }
    dropped.push(f.key);
  }
  return { inventoryPatch, offerPatch, dropped };
}
