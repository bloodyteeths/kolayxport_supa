import fs from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { queueHealthRefresh } from '@/lib/listings/healthQueue';
import { classifyEtsyDraftSyncError, ETSY_DRAFT_ERROR } from '@/lib/drafts/syncErrors';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';
import { EtsyDraftError, draftSendingError, isEtsyDraftError, type DraftIssue } from './draftErrors';
import { EMPTY_CANCELLABLE_STATUSES, isEmptyPatchValue, isEtsyDraftEmpty, type EmptyDraftOptions } from '@/lib/drafts/emptyDraft';
import {
  ETSY_DRAFT_UPLOAD_ROOT,
  assertAllowedSourceUrl,
  fetchSourceUrlSafely,
  readDraftUploadFile,
  unlinkDraftUploadFile,
} from './mediaSafety';
import {
  normalizeWhenMade,
  validateEtsyFieldPatch,
  validateEtsyInventory,
  validateEtsyPersonalization,
  type FieldError,
} from './validation';

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';
const UPLOAD_ROOT = ETSY_DRAFT_UPLOAD_ROOT;
const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_SOURCE_BYTES = 130 * 1024 * 1024;

/** Statuses from which a draft may be claimed for sync. */
const SYNCABLE_STATUSES = ['draft', 'failed', 'conflict'];

type JsonMap = Record<string, any>;

// Etsy HTTP lives in ./http (rate budget + quota headers). Re-exported here so
// existing `import { etsyFetch, callEtsyAPI } from '@/lib/etsy/draftService'`
// call sites keep working.
import { etsyFetch, callEtsyAPI, etsyAuthHeaders } from './http';
export { etsyFetch, callEtsyAPI, etsyAuthHeaders };
import { EtsyPriority, getEtsyBudgetContext, withEtsyBudget } from './rateBudget';
import { withListingInventoryLock } from './inventoryLock';
import { mergeFreshInventoryQuantities, reportedVariantKey, stripEditorFields } from './inventoryMerge';
import { applyStockToEtsyDraftInventory, isListingStockManaged, settleEtsyDraftStockEcho } from '@/lib/stock/hooks';

export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val)));
}

function mergeJson(existing: any, patch: any): any {
  if (patch === undefined) return existing ?? {};
  if (patch === null) return null;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  return { ...((existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {}), ...patch };
}

function actionKey(action: any) {
  // Completion markers are server-side bookkeeping; ignore them for dedupe.
  const { completedAt, completedResult, ...rest } = action || {};
  return JSON.stringify(rest);
}

function mergeQueuedActions(existing: any[] = [], incoming?: any[]) {
  if (!incoming) return existing;
  const merged = [...existing];
  const seen = new Set(merged.map(actionKey));
  for (const action of incoming) {
    const key = actionKey(action);
    if (seen.has(key)) continue;
    merged.push(action);
    seen.add(key);
  }
  return merged;
}

function mediaIdentity(media: any) {
  if (!media?.kind || !media?.operation || media.etsyMediaId == null) return null;
  return `${media.kind}:${media.operation}:${String(media.etsyMediaId)}`;
}

// Locked (advisory-lock) token refresh lives in ./etsyToken, shared with the
// clawd Etsy API and video upload routes.
import { getEtsyAccessToken } from './etsyToken';
export { getEtsyAccessToken };
import { notify, resolveNotification, notificationKeys, NOTIFICATION_LINKS } from '@/lib/notifications';

/** Human label for a draft in notifications: staged title > base title > listing id. */
function draftNotificationTitle(draft: any): string {
  const staged = draft?.fieldPatch && typeof draft.fieldPatch === 'object' ? draft.fieldPatch.title : null;
  const base = draft?.baseSnapshot && typeof draft.baseSnapshot === 'object' ? draft.baseSnapshot.title : null;
  const title = (typeof staged === 'string' && staged.trim()) || (typeof base === 'string' && base.trim()) || '';
  return (title || `#${String(draft?.etsyListingId ?? '')}`).slice(0, 120);
}

/** Fire-and-forget: never blocks or fails the sync path (notify/resolve never reject). */
function notifyDraftProblem(userId: string, draft: any, type: 'draftSyncFailed' | 'draftConflict') {
  void notify(userId, {
    type,
    severity: type === 'draftConflict' ? 'warning' : 'error',
    titleKey: `types.${type}`,
    params: { title: draftNotificationTitle(draft) },
    link: NOTIFICATION_LINKS.etsyListings,
    dedupeKey: notificationKeys.draft(String(draft.id)),
  });
}

async function getListingSnapshot(shopId: string, listingId: bigint | number | string, userId: string, accessToken?: string) {
  if (BigInt(listingId) < BigInt(0)) {
    return {
      baseEtsyUpdatedTimestamp: 0,
      baseSnapshot: { localDraft: true, etsyShopId: shopId, etsyListingId: String(listingId) },
    };
  }

  // Prefer the LIVE listing as the conflict base. The EtsyListing cache can be
  // hours old (it only refreshes on manual sync), and a stale cached
  // updated_timestamp was one of the two causes of the historical false
  // "Remote listing changed before sync" conflicts (the other being our own
  // partial syncs — see the failure path in syncDraft). Fall back to the
  // cache only if Etsy is unreachable.
  try {
    const token = accessToken || await getEtsyAccessToken(shopId, userId);
    // includes=Inventory: the base inventory lets the sync tell which variant
    // quantities the user changed (see inventoryMerge.ts).
    const remote = await getListingWithInventory(listingId, token);
    return {
      baseEtsyUpdatedTimestamp: remote.updated_timestamp || 0,
      baseSnapshot: remote,
    };
  } catch (err: any) {
    if (isEtsyDraftError(err)) throw err;
    const cached = await prisma.etsyListing.findUnique({
      where: { etsyShopId_etsyListingId: { etsyShopId: shopId, etsyListingId: BigInt(listingId) } },
    });
    if (!cached) throw err;
    logger.warn('Draft snapshot fell back to cached listing', { shopId, listingId: String(listingId), error: err?.message });
    return {
      baseEtsyUpdatedTimestamp: cached.etsyUpdatedTimestamp || 0,
      baseSnapshot: toSerializable(cached),
    };
  }
}

function buildInventoryCopyPayload(sourceInventoryData: JsonMap) {
  const sourceProducts = Array.isArray(sourceInventoryData?.products) ? sourceInventoryData.products : [];
  const products = sourceProducts
    .filter((product: any) => !product.is_deleted)
    .map((product: any) => ({
      sku: product.sku || '',
      property_values: (product.property_values || []).map((pv: any) => ({
        property_id: pv.property_id,
        property_name: pv.property_name,
        values: pv.values || [],
        ...(Array.isArray(pv.value_ids) && pv.value_ids.length ? { value_ids: pv.value_ids } : {}),
        ...(pv.scale_id ? { scale_id: pv.scale_id } : {}),
      })),
      offerings: (product.offerings || [])
        .filter((offering: any) => !offering.is_deleted)
        .map((offering: any) => ({
          price: typeof offering.price === 'object'
            ? offering.price.amount / (offering.price.divisor || 100)
            : offering.price,
          quantity: offering.quantity || 0,
          is_enabled: offering.is_enabled ?? true,
          ...(offering.readiness_state_id ? { readiness_state_id: offering.readiness_state_id } : {}),
        })),
    }))
    .filter((product: any) => product.property_values.length > 0 && product.offerings.length > 0);

  if (products.length === 0) return null;

  const propertyIds = new Set<number>();
  for (const product of products) {
    for (const pv of product.property_values || []) {
      if (pv.property_id) propertyIds.add(Number(pv.property_id));
    }
  }

  // Etsy requires *_on_property arrays to be 0, 1, or all variation IDs.
  // The source may legitimately set price_on_property to a single ID (per-property
  // pricing), so prefer the source value but only when its length is valid.
  const variationCount = propertyIds.size;
  const safeOnProperty = (raw: any, fallback: any[]) => {
    if (Array.isArray(raw)) {
      if (raw.length === 0 || raw.length === 1 || raw.length === variationCount) return raw;
    }
    if (fallback.length === 0 || fallback.length === 1 || fallback.length === variationCount) return fallback;
    return [];
  };

  return {
    products,
    price_on_property: safeOnProperty(sourceInventoryData.price_on_property, Array.from(propertyIds)),
    quantity_on_property: safeOnProperty(sourceInventoryData.quantity_on_property, []),
    sku_on_property: safeOnProperty(sourceInventoryData.sku_on_property, []),
  };
}

// Canonical key for a product based on its variation tuple. Sorting by
// property_id (then value_id/value) makes the key order-independent so the
// same Size/Color combo always hashes to the same string even if the UI
// emitted the property_values in a different order.
function variationDedupKey(product: JsonMap): string {
  const propertyValues = Array.isArray(product?.property_values) ? product.property_values : [];
  const tuple = propertyValues
    .map((pv: JsonMap) => {
      const propertyId = Number(pv?.property_id) || pv?.property_id || null;
      const valueIds = Array.isArray(pv?.value_ids)
        ? [...pv.value_ids].map((v) => Number(v) || v).sort((a, b) => String(a).localeCompare(String(b)))
        : [];
      const values = Array.isArray(pv?.values)
        ? [...pv.values].map((v) => String(v)).sort()
        : [];
      return { property_id: propertyId, value_ids: valueIds, values };
    })
    .sort((a: JsonMap, b: JsonMap) => String(a.property_id).localeCompare(String(b.property_id)));
  return JSON.stringify(tuple);
}

// Etsy rejects PUT /listings/{id}/inventory with "All combinations of property
// values must be supplied." whenever any cell of the variation matrix is
// missing. Detect missing combos in the dedup'd product set, fill them with a
// template offering cloned from the first product, and log the fill count so
// we can audit which drafts arrived incomplete.
export function fillMissingCartesianCombinations(products: JsonMap[]): JsonMap[] {
  if (products.length === 0) return products;
  const axisCount = Math.max(...products.map(p => (Array.isArray(p?.property_values) ? p.property_values.length : 0)));
  if (axisCount < 1) return products;

  type Axis = { property_id: any; property_name: any; scale_id: any; values: string[]; valueIds: Map<string, any> };
  const axes: Axis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const valuesInOrder: string[] = [];
    const valueIds = new Map<string, any>();
    let property_id: any = null;
    let property_name: any = '';
    let scale_id: any = null;
    for (const p of products) {
      const pv = (p?.property_values as JsonMap[])?.[i];
      if (!pv) continue;
      if (property_id == null) { property_id = pv.property_id; property_name = pv.property_name; scale_id = pv.scale_id ?? null; }
      const v = Array.isArray(pv.values) ? pv.values[0] : null;
      if (v == null) continue;
      const sv = String(v);
      if (!valueIds.has(sv)) {
        valuesInOrder.push(sv);
        valueIds.set(sv, Array.isArray(pv.value_ids) && pv.value_ids[0] != null ? pv.value_ids[0] : null);
      }
    }
    axes.push({ property_id, property_name, scale_id, values: valuesInOrder, valueIds });
  }
  const expected = axes.reduce((acc, a) => acc * Math.max(1, a.values.length), 1);
  if (expected <= products.length) return products;

  const present = new Set(products.map(p => {
    const pvs = Array.isArray(p?.property_values) ? p.property_values : [];
    return pvs.map((pv: JsonMap) => String(Array.isArray(pv.values) ? pv.values[0] ?? '' : '')).join('');
  }));

  const template = products[0];
  const templateOffering = Array.isArray(template?.offerings) ? template.offerings[0] : null;
  const refPrice = templateOffering?.price ?? 0;
  const refQuantity = templateOffering?.quantity ?? 1;
  const refReadinessStateId = templateOffering?.readiness_state_id ?? null;

  const filled: JsonMap[] = [...products];
  const addCombo = (idx: number, values: string[]) => {
    if (idx === axes.length) {
      const key = values.join('');
      if (present.has(key)) return;
      present.add(key);
      const property_values = values.map((v, axisIdx) => {
        const a = axes[axisIdx];
        const vid = a.valueIds.get(v);
        const entry: JsonMap = {
          property_id: a.property_id,
          property_name: a.property_name,
          values: [v],
          scale_id: a.scale_id,
        };
        if (vid != null) entry.value_ids = [vid];
        return entry;
      });
      const offering: JsonMap = {
        price: typeof refPrice === 'object' && refPrice ? (refPrice.amount / (refPrice.divisor || 100)) : refPrice,
        quantity: refQuantity,
        is_enabled: true,
      };
      if (refReadinessStateId != null) offering.readiness_state_id = refReadinessStateId;
      filled.push({
        sku: '',
        property_values,
        offerings: [offering],
      });
      return;
    }
    for (const v of axes[idx].values) {
      values.push(v);
      addCombo(idx + 1, values);
      values.pop();
    }
  };
  addCombo(0, []);
  const filledCount = filled.length - products.length;
  if (filledCount > 0) {
    logger.warn('Inventory had incomplete Cartesian — auto-filled missing combinations before PUT', {
      original: products.length,
      expected,
      filled: filledCount,
    });
  }
  return filled;
}

function sanitizeInventoryForEtsy(inventory: JsonMap, fallbackReadinessStateId?: number | string | null) {
  const products = Array.isArray(inventory?.products) ? inventory.products : [];
  const propertyIdMap = new Map<number, number>([
    // Etsy rejects deprecated generic "Style" (508) on modern seller taxonomy.
    // Custom1 is the supported variation slot for seller-defined style/options.
    [508, 513],
  ]);
  const normalizePropertyId = (propertyId: any) => {
    const numeric = Number(propertyId);
    return propertyIdMap.get(numeric) || numeric || propertyId;
  };
  const cleanProducts = products.map((product: JsonMap) => {
    const { product_id, is_deleted, kx_loaded_quantity, ...rest } = product;
    const clean: JsonMap = { ...rest };
    if (Array.isArray(clean.offerings)) {
      clean.offerings = clean.offerings.map((offering: JsonMap) => {
        const { offering_id, is_deleted: offeringDeleted, ...offeringRest } = offering;
        const next: JsonMap = { ...offeringRest };
        if (next.price && typeof next.price === 'object') {
          next.price = next.price.amount / (next.price.divisor || 100);
        }
        if (!next.readiness_state_id && fallbackReadinessStateId) {
          next.readiness_state_id = fallbackReadinessStateId;
        }
        return next;
      });
    }
    if (Array.isArray(clean.property_values)) {
      clean.property_values = clean.property_values.map((propertyValue: JsonMap) => {
        const { scale_name, ...propertyRest } = propertyValue;
        return {
          ...propertyRest,
          property_id: normalizePropertyId(propertyRest.property_id),
          property_name: Number(propertyRest.property_id) === 508 ? 'Style' : propertyRest.property_name,
        };
      });
    }
    return clean;
  });

  // Dedupe by variation tuple. Etsy's PUT /listings/{id}/inventory replaces
  // the entire variation set, so any duplicate { property_id, value(_id)s }
  // tuple in the payload becomes a duplicate row on Etsy. We keep the *last*
  // occurrence on the assumption that the patch already merged drafted edits
  // on top of the snapshot, so the later entry reflects the user's intent.
  const dedupedProducts: JsonMap[] = [];
  const dedupIndex = new Map<string, number>();
  for (const product of cleanProducts) {
    const key = variationDedupKey(product);
    // Empty tuples mean a product with no variations — keep at most one such
    // row (Etsy already rejects multiple variation-less products).
    const existingIndex = dedupIndex.get(key);
    if (existingIndex !== undefined) {
      dedupedProducts[existingIndex] = product;
    } else {
      dedupIndex.set(key, dedupedProducts.length);
      dedupedProducts.push(product);
    }
  }

  const completedProducts = fillMissingCartesianCombinations(dedupedProducts);
  const payload: JsonMap = { products: completedProducts };

  // Etsy requires *_on_property arrays to contain 0, 1, or ALL variation
  // property IDs. With 3-variation support, an array of length 2 throws
  // "unsupported number of property IDs". Count distinct property IDs
  // present across the products and drop any *_on_property field whose
  // length doesn't match {0, 1, variationCount}.
  const variationPropertyIds = new Set<number>();
  for (const product of dedupedProducts) {
    const propertyValues = Array.isArray(product?.property_values) ? product.property_values : [];
    for (const pv of propertyValues) {
      const pid = Number((pv as JsonMap)?.property_id);
      if (pid) variationPropertyIds.add(pid);
    }
  }
  const variationCount = variationPropertyIds.size;
  const isValidOnPropertyLength = (length: number) =>
    length === 0 || length === 1 || length === variationCount;
  const assignOnProperty = (key: 'price_on_property' | 'quantity_on_property' | 'sku_on_property' | 'readiness_state_on_property', raw: any) => {
    if (!Array.isArray(raw)) return;
    const normalized = raw.map(normalizePropertyId);
    if (!isValidOnPropertyLength(normalized.length)) {
      logger.warn('Dropping invalid *_on_property array (length must be 0, 1, or variationCount)', {
        field: key,
        length: normalized.length,
        variationCount,
      });
      return;
    }
    payload[key] = normalized;
  };
  assignOnProperty('price_on_property', inventory.price_on_property);
  assignOnProperty('quantity_on_property', inventory.quantity_on_property);
  assignOnProperty('sku_on_property', inventory.sku_on_property);
  assignOnProperty('readiness_state_on_property', (inventory as JsonMap).readiness_state_on_property);
  return payload;
}

function isMissingListingError(err: any) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('404') || msg.includes('not found') || msg.includes('resource_missing');
}

function buildListingPropertyCopyPayload(property: JsonMap) {
  const payload: JsonMap = {};
  if (Array.isArray(property.values) && property.values.length > 0) payload.values = property.values;
  if (Array.isArray(property.value_ids) && property.value_ids.length > 0) payload.value_ids = property.value_ids;
  if (property.scale_id !== undefined && property.scale_id !== null && property.scale_id !== '') payload.scale_id = property.scale_id;
  return Object.keys(payload).length > 0 ? payload : null;
}

function buildPersonalizationCopyPayload(personalization: JsonMap | null) {
  const questions = Array.isArray(personalization?.personalization_questions)
    ? personalization.personalization_questions
    : [];
  const cleaned = questions
    .map((question: JsonMap) => {
      const { question_id, ...rest } = question;
      return rest;
    })
    .filter((question: JsonMap) => question.question_type && question.question_text);
  return cleaned.length > 0 ? { personalization_questions: cleaned } : null;
}

async function linkExistingVideo(accessToken: string, shopId: string | number, listingId: bigint | number | string, videoId: bigint | number | string) {
  const response = await etsyFetch(`${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/videos`, {
    method: 'POST',
    headers: {
      ...etsyAuthHeaders(accessToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ video_id: String(videoId) }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Etsy video link failed: ${response.status} - ${errorText}`);
  }
  return response.json();
}

/** Throws unless the user owns this (active) Etsy shop. */
export async function assertShopOwnership(userId: string, shopId: string) {
  const shop = await prisma.etsyShop.findFirst({
    where: { shopId: String(shopId), userId, isActive: true },
    select: { id: true },
  });
  if (!shop) {
    throw new EtsyDraftError('SHOP_NOT_FOUND', 'Etsy shop not found or not connected to this account', {
      status: 404,
      key: 'draftSync.shopNotFound',
    });
  }
}

function parseListingId(raw: string | number | bigint): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new EtsyDraftError('INVALID_LISTING_ID', 'Invalid listing id', { status: 400, key: 'draftSync.invalidListingId' });
  }
}

export async function getOrCreateDraft(params: {
  userId: string;
  shopId: string;
  listingId: string | number | bigint;
  accessToken?: string;
}) {
  await assertShopOwnership(params.userId, params.shopId);
  const listingId = parseListingId(params.listingId);
  // A draft mid-send must not get a sibling draft (the sibling would carry a
  // stale conflict base and race the send). A 'syncing' row older than the
  // stale threshold is an orphan of a restart: recover it to 'failed' (which
  // is editable) and let the lookup below reuse it.
  const sending = await prisma.etsyListingDraft.findFirst({
    where: { userId: params.userId, etsyShopId: params.shopId, etsyListingId: listingId, status: 'syncing' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, updatedAt: true },
  });
  if (sending) {
    if (Date.now() - new Date(sending.updatedAt).getTime() < STALE_SYNCING_MS) throw draftSendingError();
    await recoverStaleSyncingDrafts(params.userId, params.shopId);
  }
  const existing = await prisma.etsyListingDraft.findFirst({
    where: {
      userId: params.userId,
      etsyShopId: params.shopId,
      etsyListingId: listingId,
      status: { in: SYNCABLE_STATUSES },
    },
    orderBy: { updatedAt: 'desc' },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
  if (existing) return existing;

  const snapshot = await getListingSnapshot(params.shopId, listingId, params.userId, params.accessToken);
  return prisma.etsyListingDraft.create({
    data: {
      userId: params.userId,
      etsyShopId: params.shopId,
      etsyListingId: listingId,
      status: 'draft',
      baseEtsyUpdatedTimestamp: snapshot.baseEtsyUpdatedTimestamp,
      baseSnapshot: snapshot.baseSnapshot,
      fieldPatch: {},
      queuedActions: [],
    },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
}

const CLIENT_MEDIA_KINDS = new Set(['image', 'video']);
const CLIENT_MEDIA_OPERATIONS = new Set(['upload', 'delete', 'reorder', 'update_alt']);

/**
 * Whitelist client-supplied media ops. `localPath` is NEVER accepted from a
 * client — only createDraftMediaFile (which writes the file itself) sets it.
 * `sourceUrl` must be a public https URL (re-validated with DNS at fetch time).
 */
function sanitizeClientMedia(media: unknown): JsonMap[] {
  if (media == null) return [];
  if (!Array.isArray(media)) {
    throw new EtsyDraftError('INVALID_MEDIA', 'media must be an array', { key: 'draftSync.invalidMedia' });
  }
  if (media.length > 50) {
    throw new EtsyDraftError('INVALID_MEDIA', 'Too many media operations in one request', { key: 'draftSync.invalidMedia' });
  }
  return media.map((raw: any) => {
    const kind = String(raw?.kind || '');
    const operation = String(raw?.operation || '');
    if (!CLIENT_MEDIA_KINDS.has(kind) || !CLIENT_MEDIA_OPERATIONS.has(operation)) {
      throw new EtsyDraftError('INVALID_MEDIA', `Unsupported media operation ${kind}/${operation}`, { key: 'draftSync.invalidMedia' });
    }
    let etsyMediaId: string | null = null;
    if (raw?.etsyMediaId != null && raw.etsyMediaId !== '') {
      if (!/^\d{1,20}$/.test(String(raw.etsyMediaId))) {
        throw new EtsyDraftError('INVALID_MEDIA', 'Invalid media id', { key: 'draftSync.invalidMedia' });
      }
      etsyMediaId = String(raw.etsyMediaId);
    }
    if (operation !== 'upload' && !etsyMediaId) {
      throw new EtsyDraftError('INVALID_MEDIA', `${operation} requires an Etsy media id`, { key: 'draftSync.invalidMedia' });
    }
    let sourceUrl: string | null = null;
    if (operation === 'upload') {
      sourceUrl = assertAllowedSourceUrl(raw?.sourceUrl);
    }
    const rank = raw?.rank == null || raw.rank === '' ? null : Number(raw.rank);
    if (rank != null && (!Number.isInteger(rank) || rank < 1 || rank > 20)) {
      throw new EtsyDraftError('INVALID_MEDIA', 'Invalid media rank', { key: 'draftSync.invalidMedia' });
    }
    const altText = raw?.altText == null ? null : String(raw.altText).slice(0, 500);
    const filename = raw?.filename == null ? null : String(raw.filename).replace(/[^\w.\- ]/g, '_').slice(0, 200);
    const contentType = raw?.contentType == null ? null : String(raw.contentType).slice(0, 100);
    const payload = raw?.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
      ? { ...(raw.payload.name != null ? { name: String(raw.payload.name).slice(0, 200) } : {}) }
      : null;
    return { kind, operation, etsyMediaId, sourceUrl, rank, altText, filename, contentType, payload };
  });
}

const QUEUED_ACTION_TYPES = new Set([
  'create_listing', 'create_shop_section', 'create_shipping_profile', 'create_return_policy',
  'publish', 'deactivate', 'renew', 'delete', 'copy', 'withdraw',
]);

function sanitizeQueuedActions(actions: unknown): JsonMap[] | undefined {
  if (actions === undefined) return undefined;
  if (!Array.isArray(actions)) {
    throw new EtsyDraftError('INVALID_ACTIONS', 'queuedActions must be an array', { key: 'draftSync.invalidActions' });
  }
  return actions.map((a: any) => {
    if (!a || typeof a !== 'object' || !QUEUED_ACTION_TYPES.has(String(a.type))) {
      throw new EtsyDraftError('INVALID_ACTIONS', `Unsupported queued action ${a?.type}`, { key: 'draftSync.invalidActions' });
    }
    // Completion markers are server-owned (idempotent retries).
    const { completedAt, completedResult, ...rest } = a;
    return rest;
  });
}

function hasDraftContent(draftLike: JsonMap, mediaCount: number, queuedActions: any[]) {
  return (
    !isEmptyPatch(draftLike.fieldPatch) ||
    !isEmptyPatch(draftLike.taxonomyPatch) ||
    !isEmptyPatch(draftLike.inventoryPatch) ||
    !isEmptyPatch(draftLike.variationImagesPatch) ||
    !isEmptyPatch(draftLike.personalizationPatch) ||
    mediaCount > 0 ||
    queuedActions.some((a) => a?.type !== 'delete')
  );
}

/**
 * True when the draft holds nothing to send: no non-empty field / taxonomy / inventory / variation-image /
 * personalization patch, no staged media, no queued action and no scheduledSendAt (lib/drafts/emptyDraft).
 */
export function isDraftEmpty(draft: JsonMap, mediaCount?: number | null, opts: EmptyDraftOptions = {}): boolean {
  return isEtsyDraftEmpty(draft, mediaCount, opts);
}

/**
 * Cancel an open draft (draft / failed / conflict) that holds nothing any more, e.g. after "Undo" un-staged its
 * only photo delete. Keeps the row (status `cancelled`) and never calls Etsy. Atomic: the conditional update only
 * matches the row version that was checked (status + updatedAt), so it cannot race a send claim or a new stage;
 * media staged in between (createDraftMediaFile does not touch the draft row) re-opens it.
 * Returns true when the draft was cancelled.
 */
export async function cancelDraftIfEmpty(draftId: string, userId: string, opts: EmptyDraftOptions = {}): Promise<boolean> {
  const draft = await prisma.etsyListingDraft.findFirst({
    where: { id: draftId, userId },
    include: { _count: { select: { media: true } } },
  });
  if (!draft || !EMPTY_CANCELLABLE_STATUSES.includes(draft.status)) return false;
  if (!isDraftEmpty(draft as any, undefined, opts)) return false;
  const res = await prisma.etsyListingDraft.updateMany({
    where: { id: draft.id, userId, status: draft.status, updatedAt: draft.updatedAt },
    data: { status: 'cancelled', ...(opts.ignoreSchedule ? { scheduledSendAt: null } : {}) },
  });
  if (res.count === 0) return false;
  const media = await prisma.etsyDraftMedia.count({ where: { draftId: draft.id } });
  if (media > 0) {
    await prisma.etsyListingDraft.updateMany({ where: { id: draft.id, status: 'cancelled' }, data: { status: draft.status } });
    return false;
  }
  logger.info('Etsy draft cancelled: nothing left to send', { draftId: draft.id });
  return true;
}

function issuesFromErrors(errors: FieldError[]): DraftIssue[] {
  return errors.map((e) => ({
    field: e.field,
    severity: e.severity,
    key: e.key || 'validation.generic',
    params: e.params,
    message: e.message,
  }));
}

function throwValidation(errors: FieldError[], code = 'VALIDATION_FAILED') {
  const first = errors[0];
  throw new EtsyDraftError(code, first.message, {
    status: 400,
    key: first.key,
    params: first.params,
    issues: issuesFromErrors(errors),
  });
}

/** Rejects a staged delete mixed with any other change (and vice versa). */
export function assertDeleteIsExclusive(draftLike: JsonMap, mediaCount: number, queuedActions: any[]) {
  const hasDelete = queuedActions.some((a) => a?.type === 'delete');
  if (hasDelete && hasDraftContent(draftLike, mediaCount, queuedActions)) {
    throw new EtsyDraftError(
      'DELETE_NOT_EXCLUSIVE',
      'A listing delete cannot be combined with other staged changes. Sync or discard the other changes first, or remove the queued delete.',
      { status: 409, key: 'draftSync.deleteNotExclusive' },
    );
  }
}

export async function upsertDraftPatch(params: {
  userId: string;
  shopId: string;
  listingId: string | number | bigint;
  fields?: JsonMap;
  taxonomy?: JsonMap;
  inventory?: JsonMap;
  variationImages?: any;
  personalization?: any;
  queuedActions?: any[];
  /** Action types to drop from the draft's queue (e.g. ['delete']). */
  removeQueuedActions?: string[];
  media?: Array<JsonMap>;
  replaceFields?: boolean;
  /**
   * Optional Etsy token, forwarded to getOrCreateDraft so a batch caller can
   * fetch it once per request instead of once per new draft.
   */
  accessToken?: string;
}) {
  if (params.fields !== undefined && (params.fields === null || typeof params.fields !== 'object' || Array.isArray(params.fields))) {
    throw new EtsyDraftError('INVALID_FIELDS', 'fields must be an object', { key: 'draftSync.invalidFields' });
  }
  const media = sanitizeClientMedia(params.media);
  const incomingActions = sanitizeQueuedActions(params.queuedActions);

  // Block structurally-invalid values from ever entering the draft
  // (block_save). block_sync issues are allowed here — the user may still be
  // editing — and are enforced again at sync time.
  const saveErrors = [
    ...validateEtsyFieldPatch(params.fields),
    ...(params.personalization !== undefined ? validateEtsyPersonalization(params.personalization) : []),
  ].filter((e) => e.severity === 'block_save');
  if (saveErrors.length) throwValidation(saveErrors);

  const draft = await getOrCreateDraft(params);
  const removeTypes = new Set((params.removeQueuedActions || []).map(String));
  let nextActions = incomingActions !== undefined
    ? mergeQueuedActions((((draft as any).queuedActions as any[]) || []), incomingActions)
    : (((draft as any).queuedActions as any[]) || []);
  if (removeTypes.size) nextActions = nextActions.filter((a: any) => !removeTypes.has(String(a?.type)));

  const data: JsonMap = {
    // A conflict stays a conflict until the user explicitly force-syncs or
    // discards; editing must not silently clear it.
    status: (draft as any).status === 'conflict' ? 'conflict' : 'draft',
    lastSyncError: (draft as any).status === 'conflict' ? (draft as any).lastSyncError : null,
    fieldPatch: params.replaceFields ? (params.fields || {}) : mergeJson((draft as any).fieldPatch, params.fields),
    taxonomyPatch: params.taxonomy !== undefined ? mergeJson((draft as any).taxonomyPatch, params.taxonomy) : (draft as any).taxonomyPatch,
    inventoryPatch: params.inventory !== undefined ? mergeJson((draft as any).inventoryPatch, params.inventory) : (draft as any).inventoryPatch,
    variationImagesPatch: params.variationImages !== undefined ? params.variationImages : (draft as any).variationImagesPatch,
    personalizationPatch: params.personalization !== undefined ? params.personalization : (draft as any).personalizationPatch,
    queuedActions: nextActions,
  };
  // NOTE: the conflict base (baseEtsyUpdatedTimestamp / baseSnapshot) is
  // deliberately NOT re-snapshotted here for failed/conflict drafts. Doing so
  // silently "resolved" real conflicts. The base only moves when (a) our own
  // sync mutates Etsy, or (b) the user force-syncs.

  const existingMediaCount = Array.isArray((draft as any).media) ? (draft as any).media.length : 0;
  assertDeleteIsExclusive(data, existingMediaCount + media.length, nextActions);

  const updated = await prisma.etsyListingDraft.update({
    where: { id: draft.id },
    data,
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });

  if (media.length) {
    const replaceableOps = media.filter((m) => (
      ['reorder', 'update_alt'].includes(String(m.operation)) && m.etsyMediaId != null
    ));
    if (replaceableOps.length) {
      await prisma.etsyDraftMedia.deleteMany({
        where: {
          draftId: draft.id,
          OR: replaceableOps.map((m) => ({
            kind: m.kind,
            operation: m.operation,
            etsyMediaId: BigInt(m.etsyMediaId),
          })),
        },
      });
    }

    const existingMedia = await prisma.etsyDraftMedia.findMany({
      where: { draftId: draft.id },
      select: { kind: true, operation: true, etsyMediaId: true },
    });
    const existingMediaKeys = new Set(existingMedia.map(mediaIdentity).filter(Boolean));
    const mediaToCreate = media.filter((m) => {
      const key = mediaIdentity(m);
      if (!key) return true;
      if (m.operation === 'delete' && existingMediaKeys.has(key)) return false;
      existingMediaKeys.add(key);
      return true;
    });

    if (!mediaToCreate.length) return finishUpsert(updated.id, params);

    await prisma.etsyDraftMedia.createMany({
      data: mediaToCreate.map((m) => ({
        draftId: draft.id,
        etsyListingId: BigInt(draft.etsyListingId),
        kind: m.kind,
        operation: m.operation,
        etsyMediaId: m.etsyMediaId != null ? BigInt(m.etsyMediaId) : null,
        localPath: null,
        sourceUrl: m.sourceUrl,
        contentType: m.contentType,
        filename: m.filename,
        rank: m.rank,
        altText: m.altText,
        payload: m.payload ?? undefined,
      })),
    });
  }

  return finishUpsert(updated.id, params);
}

/**
 * The stage request removed or cleared staged content: replaced the field patch, un-queued actions, or cleared a
 * taxonomy / inventory / variation-image / personalization patch (null or {}). A plain stage (e.g. the
 * `fields: {}` the media upload route sends to get a draft id) never auto-cancels.
 */
function stageRemovesContent(params: { replaceFields?: boolean; removeQueuedActions?: string[]; taxonomy?: any; inventory?: any; variationImages?: any; personalization?: any }) {
  return Boolean(
    params.replaceFields ||
    (params.removeQueuedActions && params.removeQueuedActions.length > 0) ||
    (params.taxonomy !== undefined && isEmptyPatchValue(params.taxonomy)) ||
    (params.inventory !== undefined && isEmptyPatchValue(params.inventory)) ||
    (params.variationImages !== undefined && isEmptyPatchValue(params.variationImages)) ||
    (params.personalization !== undefined && isEmptyPatchValue(params.personalization)),
  );
}

async function finishUpsert(draftId: string, params: { userId: string } & Parameters<typeof stageRemovesContent>[0]) {
  if (stageRemovesContent(params)) await cancelDraftIfEmpty(draftId, params.userId);
  return prisma.etsyListingDraft.findUnique({
    where: { id: draftId },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
}

/** Remove queued actions (by type) from a draft the user owns. */
export async function removeQueuedActions(draftId: string, userId: string, types: string[]) {
  const draft = await prisma.etsyListingDraft.findFirst({ where: { id: draftId, userId } });
  if (!draft) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  if (!SYNCABLE_STATUSES.includes(draft.status)) {
    throw new EtsyDraftError('DRAFT_NOT_EDITABLE', `Draft is not editable (${draft.status})`, { status: 409, key: 'draftSync.draftNotEditable', params: { status: draft.status } });
  }
  const remove = new Set(types.map(String));
  const next = (((draft.queuedActions as any[]) || [])).filter((a: any) => !remove.has(String(a?.type)));
  const updated = await prisma.etsyListingDraft.update({
    where: { id: draft.id },
    data: { queuedActions: next },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
  if (!(await cancelDraftIfEmpty(draft.id, userId))) return updated;
  return prisma.etsyListingDraft.findUnique({
    where: { id: draft.id },
    include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
}

/**
 * Un-stage media rows (any operation) from a draft the user owns. Staged local
 * files are removed through the upload-root-guarded unlink helper. Refused
 * while the draft is being sent (409 DRAFT_SENDING) or once it is no longer
 * editable. Ids that do not belong to this draft are ignored (reported in
 * `missingIds`), so another user's media id can never be touched.
 */
export async function removeDraftMedia(draftId: string, userId: string, mediaId: string | string[]) {
  const ids = [...new Set((Array.isArray(mediaId) ? mediaId : [mediaId]).map(String).filter(Boolean))];
  if (ids.length === 0 || ids.length > 100) {
    throw new EtsyDraftError('INVALID_MEDIA', 'removeMediaIds must hold 1-100 media ids', { key: 'draftSync.invalidMedia' });
  }
  const draft = await prisma.etsyListingDraft.findFirst({ where: { id: draftId, userId }, select: { id: true, status: true } });
  if (!draft) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  if (draft.status === 'syncing') throw draftSendingError();
  if (!SYNCABLE_STATUSES.includes(draft.status)) {
    throw new EtsyDraftError('DRAFT_NOT_EDITABLE', `Draft is not editable (${draft.status})`, { status: 409, key: 'draftSync.draftNotEditable', params: { status: draft.status } });
  }
  const rows = await prisma.etsyDraftMedia.findMany({
    where: { draftId: draft.id, id: { in: ids } },
    select: { id: true, localPath: true },
  });
  if (rows.length) {
    await prisma.etsyDraftMedia.deleteMany({ where: { draftId: draft.id, id: { in: rows.map((r) => r.id) } } });
    for (const r of rows) if (r.localPath) await unlinkDraftUploadFile(r.localPath);
  }
  const found = new Set(rows.map((r) => r.id));
  // "Undo" of the only staged change leaves nothing to send: close the draft.
  const cancelled = rows.length ? await cancelDraftIfEmpty(draft.id, userId) : false;
  return { removedIds: rows.map((r) => r.id), missingIds: ids.filter((id) => !found.has(id)), cancelled };
}

export function draftUploadDir(userId: string, draftId: string) {
  return path.join(UPLOAD_ROOT, userId, draftId);
}

const UPLOAD_KINDS = new Set(['image', 'video']);
const UPLOAD_OPERATIONS = new Set(['upload', 'ai_upload']);

export async function createDraftMediaFile(params: {
  userId: string;
  draftId: string;
  listingId: string | number | bigint;
  kind: string;
  operation: string;
  tempPath: string;
  filename: string;
  contentType?: string;
  rank?: number;
  altText?: string;
  payload?: any;
}) {
  if (!UPLOAD_KINDS.has(params.kind) || !UPLOAD_OPERATIONS.has(params.operation)) {
    throw new EtsyDraftError('INVALID_MEDIA', `Unsupported media upload ${params.kind}/${params.operation}`, { key: 'draftSync.invalidMedia' });
  }
  const draft = await prisma.etsyListingDraft.findFirst({
    where: { id: params.draftId, userId: params.userId },
    select: { id: true, status: true, queuedActions: true, etsyListingId: true },
  });
  if (!draft) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  if (draft.status === 'syncing') throw draftSendingError();
  if (((draft.queuedActions as any[]) || []).some((a: any) => a?.type === 'delete')) {
    throw new EtsyDraftError('DELETE_NOT_EXCLUSIVE',
      'A listing delete cannot be combined with other staged changes. Sync or discard the other changes first, or remove the queued delete.',
      { status: 409, key: 'draftSync.deleteNotExclusive' });
  }
  // userId / draftId are cuids from our DB, but never trust path segments.
  if (!/^[\w-]+$/.test(params.userId) || !/^[\w-]+$/.test(params.draftId)) {
    throw new EtsyDraftError('INVALID_MEDIA', 'Invalid upload path', { key: 'draftSync.invalidMedia' });
  }
  const dir = draftUploadDir(params.userId, params.draftId);
  await fs.promises.mkdir(dir, { recursive: true });
  const safeName = `${Date.now()}-${params.filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 150)}`;
  const target = path.join(dir, safeName);
  await fs.promises.copyFile(params.tempPath, target);
  const rank = params.rank != null && Number.isInteger(params.rank) && params.rank >= 1 && params.rank <= 20 ? params.rank : undefined;
  return prisma.etsyDraftMedia.create({
    data: {
      draftId: params.draftId,
      etsyListingId: BigInt(draft.etsyListingId),
      kind: params.kind,
      operation: params.operation,
      localPath: target,
      filename: params.filename,
      contentType: params.contentType,
      rank,
      altText: params.altText,
      payload: params.payload,
    },
  });
}

async function uploadImageFromBuffer(accessToken: string, shopId: string, listingId: bigint, buffer: Buffer, contentType: string, opts: JsonMap) {
  const formData = new FormData();
  formData.append('image', new Blob([new Uint8Array(buffer)]), opts.filename || 'image.jpg');
  formData.append('overwrite', String(opts.overwrite ?? false));
  if (opts.etsyMediaId) formData.append('listing_image_id', String(opts.etsyMediaId));
  if (opts.rank !== undefined && opts.rank !== null) formData.append('rank', String(opts.rank));
  if (opts.altText !== undefined && opts.altText !== null) formData.append('alt_text', String(opts.altText));

  const response = await etsyFetch(`${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/images`, {
    method: 'POST',
    headers: etsyAuthHeaders(accessToken),
    body: formData,
  }, 90_000);
  if (!response.ok) throw new Error(`Image upload failed: ${response.status} - ${await response.text()}`);
  return response.json();
}

// Reassigns an EXISTING listing image to a new rank / alt text without re-uploading
// its binary. Etsy's uploadListingImage endpoint accepts "either image OR
// listing_image_id"; sending both together (as our reorder path used to) made
// Etsy treat each reorder as a fresh upload at the target rank with `overwrite`
// destroying whatever image already lived there. That deleted images on save —
// a user-reported bug where 8 photos collapsed to 5 after re-saving a reorder.
// Sending listing_image_id alone moves the existing image safely.
// Apply all image-reorder ops as a single batch so we never leave Etsy in an
// inconsistent intermediate state. Etsy validates that ranks are unique 1..N
// after every individual PUT, so processing ops one-at-a-time blows up with
// "The ListingImages for this Listing are in an inconsistent order." whenever
// the user staged a permutation involving more than a simple swap.
//
// Strategy: simulate the reorder locally on the current image list, then issue
// PUTs in REVERSE order of the target rank. With swap-semantics on Etsy's side,
// processing rank N first, then N-1, ..., 1 means each move targets a slot
// whose current occupant we're about to move next.
async function applyImageReorderBatch(
  accessToken: string,
  shopId: string,
  listingId: bigint,
  reorderOps: Array<{ etsyMediaId: number | bigint | string; rank?: number | null; altText?: string | null; id?: string }>,
  context: MediaSyncContext | undefined,
) {
  const results: any[] = [];
  if (reorderOps.length === 0) return results;

  // Filter to ops that still target images currently on the listing.
  const valid = reorderOps.filter((op) => {
    const id = String(op.etsyMediaId);
    return !context?.imageIds || context.imageIds.has(id);
  });
  if (valid.length === 0) {
    return reorderOps.map((op) => ({ skipped: true, mediaId: String(op.etsyMediaId), operation: 'reorder', reason: 'image_not_on_listing' }));
  }

  // Build current ordering from the context (the snapshot we fetched at the
  // start of media sync). Sort by current rank so positions match Etsy state.
  const currentImages = Array.from(context?.imagesById?.values() || []) as any[];
  if (currentImages.length === 0) {
    // No snapshot — fall back to one-at-a-time and accept the risk.
    for (const op of valid) {
      try {
        results.push(await reorderListingImage(accessToken, shopId, listingId, op));
      } catch (err: any) {
        if (isMissingEtsyMediaError(err)) {
          results.push({ skipped: true, mediaId: String(op.etsyMediaId), operation: 'reorder', reason: 'image_missing_or_wrong_listing' });
        } else {
          throw err;
        }
      }
    }
    return results;
  }
  const ordered = [...currentImages].sort((a, b) => (a.rank || 0) - (b.rank || 0));

  // Apply each reorder op as a splice on the local list — this matches Etsy's
  // documented "insert at rank, shift others" semantics. After the loop,
  // `ordered` is the final desired order.
  for (const op of valid) {
    const idx = ordered.findIndex((img) => String(img.listing_image_id) === String(op.etsyMediaId));
    if (idx === -1) continue;
    const [moved] = ordered.splice(idx, 1);
    const target = Math.max(0, Math.min(ordered.length, (Number(op.rank) || 1) - 1));
    ordered.splice(target, 0, moved);
  }

  // Compute the diff: for each image whose final position changed, queue a PUT
  // with rank = position + 1. Also collect alt-text updates from the ops, since
  // we strip them out otherwise.
  const altById = new Map<string, string | null | undefined>();
  for (const op of valid) {
    if (op.altText !== undefined) altById.set(String(op.etsyMediaId), op.altText);
  }
  type Move = { etsyMediaId: string; targetRank: number; altText?: string | null };
  const moves: Move[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const img = ordered[i];
    const targetRank = i + 1;
    const currentRank = Number(img.rank) || 0;
    const id = String(img.listing_image_id);
    const wantsAlt = altById.has(id);
    if (currentRank !== targetRank || wantsAlt) {
      moves.push({ etsyMediaId: id, targetRank, altText: wantsAlt ? altById.get(id) : null });
    }
  }
  if (moves.length === 0) {
    return valid.map((op) => ({ skipped: true, mediaId: String(op.etsyMediaId), operation: 'reorder', reason: 'no_change' }));
  }

  // Process highest target rank first. Etsy's reassign-by-listing_image_id is a
  // swap: setting image X to rank R moves whatever was at R into X's old slot.
  // Going N → 1 means each subsequent move targets a slot that will be cleaned
  // up by the next one, so we never leave the listing in a bad state.
  moves.sort((a, b) => b.targetRank - a.targetRank);
  for (const move of moves) {
    try {
      const updated = await reorderListingImage(accessToken, shopId, listingId, {
        etsyMediaId: move.etsyMediaId,
        rank: move.targetRank,
        altText: move.altText ?? null,
      });
      const current = context?.imagesById?.get(move.etsyMediaId);
      context?.imagesById?.set(move.etsyMediaId, { ...(current || {}), ...updated, rank: move.targetRank, alt_text: move.altText ?? updated.alt_text ?? current?.alt_text });
      results.push(updated);
    } catch (err: any) {
      if (isMissingEtsyMediaError(err)) {
        context?.imageIds?.delete(move.etsyMediaId);
        context?.imagesById?.delete(move.etsyMediaId);
        results.push({ skipped: true, mediaId: move.etsyMediaId, operation: 'reorder', reason: 'image_missing_or_wrong_listing' });
        continue;
      }
      throw err;
    }
  }
  return results;
}

async function reorderListingImage(
  accessToken: string,
  shopId: string,
  listingId: bigint,
  opts: { etsyMediaId: number | bigint | string; rank?: number | null; altText?: string | null },
) {
  // DO NOT send `overwrite: 'true'` here. When paired with an `image` binary
  // upload, overwrite=true replaces whatever image lives at the target rank
  // — which is fine when uploading. But when paired with `listing_image_id`
  // alone (i.e. a pure reorder/re-alt), Etsy still interprets overwrite=true
  // as "delete whatever is currently at this rank and put this image there".
  // That silently deletes the neighbour image on every reorder PUT — the
  // very "8 photos collapsed to 5" bug the previous comment claimed was
  // fixed. The reassignment is safe without overwrite.
  const formData = new FormData();
  formData.append('listing_image_id', String(opts.etsyMediaId));
  if (opts.rank !== undefined && opts.rank !== null) formData.append('rank', String(opts.rank));
  if (opts.altText !== undefined && opts.altText !== null) formData.append('alt_text', String(opts.altText));

  const response = await etsyFetch(`${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/images`, {
    method: 'POST',
    headers: etsyAuthHeaders(accessToken),
    body: formData,
  }, 90_000);
  if (!response.ok) throw new Error(`Image reassign failed: ${response.status} - ${await response.text()}`);
  return response.json();
}

async function uploadVideoFromBuffer(accessToken: string, shopId: string, listingId: bigint, buffer: Buffer, contentType: string, filename: string, name?: string) {
  const boundary = '----EtsyDraftVideo' + Date.now();
  const textEncoder = new TextEncoder();
  const videoName = name || filename || `Video for listing ${listingId}`;
  const namePart = textEncoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${videoName}\r\n`);
  const videoHeader = textEncoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: ${contentType || 'video/mp4'}\r\n\r\n`);
  const footer = textEncoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(namePart.length + videoHeader.length + buffer.length + footer.length);
  let offset = 0;
  body.set(namePart, offset); offset += namePart.length;
  body.set(videoHeader, offset); offset += videoHeader.length;
  body.set(new Uint8Array(buffer), offset); offset += buffer.length;
  body.set(footer, offset);

  const response = await etsyFetch(`${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/videos`, {
    method: 'POST',
    headers: {
      ...etsyAuthHeaders(accessToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  }, 300_000);
  if (!response.ok) throw new Error(`Video upload failed: ${response.status} - ${await response.text()}`);
  return response.json();
}

type MediaSyncContext = {
  imageIds?: Set<string>;
  imagesById?: Map<string, any>;
};

function isMissingEtsyMediaError(err: any) {
  const message = String(err?.message || err || '').toLowerCase();
  return (
    message.includes('404') ||
    message.includes('could not find') ||
    message.includes('does not belong to the same shop') ||
    message.includes('not belong')
  );
}

async function getListingImagesSafe(accessToken: string, listingId: bigint) {
  try {
    const images = await callEtsyAPI(`/listings/${listingId}/images`, accessToken);
    return ((images.results || []) as any[]);
  } catch (err: any) {
    logger.warn('Draft sync could not load listing images for media validation', { listingId: String(listingId), error: err.message });
    return [];
  }
}

async function buildMediaSyncContext(accessToken: string, listingId: bigint): Promise<MediaSyncContext> {
  const images = await getListingImagesSafe(accessToken, listingId);
  return {
    imageIds: new Set(images.map((image) => String(image.listing_image_id)).filter(Boolean)),
    imagesById: new Map(images.map((image) => [String(image.listing_image_id), image])),
  };
}

function dedupeMediaOps(media: any[]) {
  const result: any[] = [];
  const deleteKeys = new Set<string>();
  const latestMutableByKey = new Map<string, any>();

  for (const op of media) {
    const key = mediaIdentity(op);
    if (op.operation === 'delete' && key) {
      if (deleteKeys.has(key)) continue;
      deleteKeys.add(key);
      result.push(op);
      continue;
    }
    if (['reorder', 'update_alt'].includes(op.operation) && key) {
      latestMutableByKey.set(key, op);
      continue;
    }
    result.push(op);
  }

  return [...result, ...latestMutableByKey.values()];
}

function isEmptyPatch(value: any) {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function isMediaOnlyDraft(draft: any, queuedActions: any[]) {
  return (
    isEmptyPatch(draft.fieldPatch) &&
    isEmptyPatch(draft.taxonomyPatch) &&
    isEmptyPatch(draft.inventoryPatch) &&
    isEmptyPatch(draft.variationImagesPatch) &&
    isEmptyPatch(draft.personalizationPatch) &&
    queuedActions.length === 0 &&
    Array.isArray(draft.media) &&
    draft.media.length > 0
  );
}

/**
 * Bytes for a staged upload. localPath is only honoured inside the upload
 * root (and is only ever written by createDraftMediaFile); sourceUrl goes
 * through the SSRF-hardened fetcher.
 */
async function loadStagedMediaBuffer(media: any, kind: 'image' | 'video'): Promise<Buffer> {
  if (media.localPath) return readDraftUploadFile(media.localPath);
  if (media.sourceUrl) {
    const { buffer } = await fetchSourceUrlSafely(String(media.sourceUrl), {
      maxBytes: kind === 'video' ? MAX_VIDEO_SOURCE_BYTES : MAX_IMAGE_SOURCE_BYTES,
      expect: kind,
    });
    return buffer;
  }
  throw new EtsyDraftError('MEDIA_SOURCE_MISSING', 'Staged media has neither a file nor a URL', { key: 'draftSync.mediaFileMissing' });
}

async function syncMediaOperation(accessToken: string, draft: any, media: any, syncedListingId?: bigint, syncedShopId?: string, context?: MediaSyncContext) {
  const listingId = syncedListingId || BigInt(media.etsyListingId);
  const shopId = syncedShopId || draft.etsyShopId;
  if (media.kind === 'image' && media.operation === 'delete' && media.etsyMediaId) {
    const mediaId = String(media.etsyMediaId);
    if (context?.imageIds && !context.imageIds.has(mediaId)) {
      return { skipped: true, mediaId, operation: media.operation, reason: 'image_not_on_listing' };
    }
    try {
      const result = await callEtsyAPI(`/shops/${shopId}/listings/${listingId}/images/${media.etsyMediaId}`, accessToken, { method: 'DELETE' });
      context?.imageIds?.delete(mediaId);
      context?.imagesById?.delete(mediaId);
      return result;
    } catch (err: any) {
      if (isMissingEtsyMediaError(err)) {
        context?.imageIds?.delete(mediaId);
        context?.imagesById?.delete(mediaId);
        return { skipped: true, mediaId, operation: media.operation, reason: 'image_missing_or_wrong_listing' };
      }
      throw err;
    }
  }
  if (media.kind === 'video' && media.operation === 'delete' && media.etsyMediaId) {
    try {
      return await callEtsyAPI(`/shops/${shopId}/listings/${listingId}/videos/${media.etsyMediaId}`, accessToken, { method: 'DELETE' });
    } catch (err: any) {
      if (isMissingEtsyMediaError(err)) {
        return { skipped: true, mediaId: String(media.etsyMediaId), operation: media.operation, reason: 'video_missing_or_wrong_listing' };
      }
      throw err;
    }
  }
  if (media.kind === 'image' && ['upload', 'ai_upload'].includes(media.operation)) {
    const buffer = await loadStagedMediaBuffer(media, 'image');
    const uploaded = await uploadImageFromBuffer(accessToken, shopId, listingId, buffer, media.contentType || 'image/jpeg', {
      filename: media.filename,
      rank: media.rank,
      altText: media.altText,
      overwrite: false,
    });
    const uploadedId = uploaded?.listing_image_id || uploaded?.image?.listing_image_id;
    if (uploadedId && context?.imageIds) context.imageIds.add(String(uploadedId));
    if (uploadedId && context?.imagesById) context.imagesById.set(String(uploadedId), uploaded);
    return uploaded;
  }
  if (media.kind === 'image' && ['update_alt', 'reorder'].includes(media.operation) && media.etsyMediaId) {
    const mediaId = String(media.etsyMediaId);
    if (context?.imageIds && !context.imageIds.has(mediaId)) {
      return { skipped: true, mediaId, operation: media.operation, reason: 'image_not_on_listing' };
    }
    const current = context?.imagesById?.get(mediaId);
    try {
      const updated = await reorderListingImage(accessToken, shopId, listingId, {
        etsyMediaId: media.etsyMediaId,
        rank: media.rank,
        altText: media.altText,
      });
      context?.imagesById?.set(mediaId, { ...(current || {}), ...updated, rank: media.rank ?? updated.rank ?? current?.rank, alt_text: media.altText ?? updated.alt_text ?? current?.alt_text });
      return updated;
    } catch (err: any) {
      if (isMissingEtsyMediaError(err)) {
        context?.imageIds?.delete(mediaId);
        context?.imagesById?.delete(mediaId);
        return { skipped: true, mediaId, operation: media.operation, reason: 'image_missing_or_wrong_listing' };
      }
      throw err;
    }
  }
  if (media.kind === 'video' && media.operation === 'upload') {
    const buffer = await loadStagedMediaBuffer(media, 'video');
    return uploadVideoFromBuffer(accessToken, shopId, listingId, buffer, media.contentType || 'video/mp4', media.filename || 'video.mp4', media.payload?.name);
  }
  return { skipped: true, mediaId: media.id, operation: media.operation };
}

function resolveTemporaryIds(fields: JsonMap, idMap: Record<string, number>) {
  const resolved = { ...fields };
  for (const key of ['shop_section_id', 'shipping_profile_id', 'return_policy_id']) {
    const val = resolved[key];
    if (val !== undefined && val !== null && idMap[String(val)] !== undefined) {
      resolved[key] = idMap[String(val)];
    }
  }
  return resolved;
}

// Re-entrancy guard: refreshListingCache delegates to listingCache.refreshListingFull,
// and the W0 stub of refreshListingFull delegates back here. A call that
// re-enters while a delegation is in flight runs the legacy upsert directly.
const refreshDelegation = new AsyncLocalStorage<boolean>();

export type RefreshListingCacheOptions = {
  userId?: string;
  draftId?: string;
  syncAttemptId?: string;
  source?: 'draft_sync' | 'manual_refresh' | 'webhook';
};

/**
 * Refreshes one listing in the EtsyListing cache and returns the raw Etsy
 * listing (signature unchanged). Delegates to listingCache.refreshListingFull
 * (W3: timestamp-guarded upsert, offerings, versions). A deleted listing
 * throws 'Etsy API error: 404 ...' like before. With a syncAttemptId, the
 * post-sync updated_timestamp is stored on the EtsyDraftSyncAttempt for
 * attribution.
 */
export async function refreshListingCache(shopId: string, listingId: bigint, accessToken: string, opts: RefreshListingCacheOptions = {}) {
  if (refreshDelegation.getStore()) return legacyRefreshListingCache(shopId, listingId, accessToken);

  let userId = opts.userId;
  if (!userId) {
    const shop = await prisma.etsyShop.findUnique({ where: { shopId }, select: { userId: true } }).catch(() => null);
    userId = shop?.userId;
  }
  if (!userId) return legacyRefreshListingCache(shopId, listingId, accessToken);

  const { refreshListingFull } = await import('@/lib/etsy/listingCache');
  const result = await refreshDelegation.run(true, () => refreshListingFull({
    userId: userId as string,
    shopId,
    listingId,
    accessToken,
    source: opts.source ?? (opts.draftId || opts.syncAttemptId ? 'draft_sync' : 'manual_refresh'),
    ...(opts.draftId ? { draftId: opts.draftId } : {}),
    ...(opts.syncAttemptId ? { syncAttemptId: opts.syncAttemptId } : {}),
  }));
  if (result.deleted) throw new Error(`Etsy API error: 404 - listing ${listingId} not found`);

  const listing = result.listing;
  const remoteTs = Number(result.remoteUpdatedTs ?? listing?.updated_timestamp ?? 0);
  if (opts.syncAttemptId) {
    await prisma.etsyDraftSyncAttempt.update({
      where: { id: opts.syncAttemptId },
      data: {
        etsyListingId: listingId,
        ...(Number.isFinite(remoteTs) && remoteTs > 0 ? { remoteUpdatedTimestamp: Math.trunc(remoteTs) } : {}),
      },
    }).catch((err: any) => logger.warn('Could not record post-sync timestamp on sync attempt', { error: err?.message }));
  }
  return listing;
}

/** Fetches a listing with its inventory attached as `.inventory`. getListing's
 *  includes enum has no Inventory (Etsy 400s on it), so read it separately. */
async function getListingWithInventory(listingId: bigint | number | string, accessToken: string) {
  const listing = await callEtsyAPI(`/listings/${listingId}`, accessToken);
  try {
    const inventory = await callEtsyAPI(`/listings/${listingId}/inventory`, accessToken);
    if (listing && inventory && Array.isArray(inventory.products)) listing.inventory = inventory;
  } catch (err: any) {
    logger.warn('Etsy inventory fetch for draft snapshot failed', { listingId: String(listingId), error: err?.message });
  }
  return listing;
}

/** Inventory products of a draft's base snapshot (present when the snapshot was taken with includes=Inventory). */
function baseInventoryProducts(baseSnapshot: any): any[] | null {
  const products = baseSnapshot?.inventory?.products;
  return Array.isArray(products) ? products : null;
}

/** Today's listing + images upsert (used directly only as the re-entrancy fallback). */
export async function legacyRefreshListingCache(shopId: string, listingId: bigint, accessToken: string) {
  const listing = await callEtsyAPI(`/listings/${listingId}`, accessToken);
  let firstImage: any = null;
  let imageCount = 0;
  try {
    const images = await callEtsyAPI(`/listings/${listingId}/images`, accessToken);
    const results = images.results || [];
    firstImage = results[0] || null;
    imageCount = results.length;
  } catch (error: any) {
    logger.warn('Etsy image fetch failed during draft', { error: error?.message });
  }

  await prisma.etsyListing.upsert({
    where: { etsyShopId_etsyListingId: { etsyShopId: shopId, etsyListingId: listingId } },
    create: {
      etsyShopId: shopId,
      etsyListingId: listingId,
      title: listing.title || '',
      description: listing.description || '',
      tags: listing.tags || [],
      materials: listing.materials || [],
      priceAmount: listing.price?.amount || 0,
      priceDivisor: listing.price?.divisor || 100,
      priceCurrencyCode: listing.price?.currency_code || 'USD',
      views: listing.views || 0,
      numFavorers: listing.num_favorers || 0,
      quantity: listing.quantity || 0,
      state: listing.state || 'draft',
      url: listing.url || null,
      taxonomyId: listing.taxonomy_id || null,
      shopSectionId: listing.shop_section_id || null,
      whoMade: listing.who_made || null,
      whenMade: listing.when_made || null,
      isSupply: listing.is_supply ?? false,
      processingMin: listing.processing_min || null,
      processingMax: listing.processing_max || null,
      shippingProfileId: listing.shipping_profile_id || null,
      returnPolicyId: listing.return_policy_id || null,
      itemWeight: listing.item_weight ?? null,
      itemWeightUnit: listing.item_weight_unit || null,
      itemLength: listing.item_length ?? null,
      itemWidth: listing.item_width ?? null,
      itemHeight: listing.item_height ?? null,
      itemDimensionsUnit: listing.item_dimensions_unit || null,
      isPersonalizable: listing.is_personalizable ?? false,
      personalizationIsRequired: listing.personalization_is_required ?? false,
      personalizationInstructions: listing.personalization_instructions || null,
      personalizationCharCountMax: listing.personalization_char_count_max || null,
      thumbnailUrl75x75: firstImage?.url_75x75 || null,
      thumbnailUrl170x135: firstImage?.url_170x135 || null,
      thumbnailUrl570xN: firstImage?.url_570xN || null,
      imageCount,
      hasVideo: listing.has_videos ?? false,
      etsyCreatedTimestamp: listing.created_timestamp || 0,
      etsyUpdatedTimestamp: listing.updated_timestamp || 0,
      syncedAt: new Date(),
    },
    update: {
      title: listing.title || '',
      description: listing.description || '',
      tags: listing.tags || [],
      materials: listing.materials || [],
      priceAmount: listing.price?.amount || 0,
      priceDivisor: listing.price?.divisor || 100,
      priceCurrencyCode: listing.price?.currency_code || 'USD',
      quantity: listing.quantity || 0,
      state: listing.state || 'draft',
      url: listing.url || null,
      taxonomyId: listing.taxonomy_id || null,
      shopSectionId: listing.shop_section_id || null,
      thumbnailUrl75x75: firstImage?.url_75x75 || null,
      thumbnailUrl170x135: firstImage?.url_170x135 || null,
      thumbnailUrl570xN: firstImage?.url_570xN || null,
      imageCount,
      hasVideo: listing.has_videos ?? false,
      etsyUpdatedTimestamp: listing.updated_timestamp || 0,
      syncedAt: new Date(),
    },
  });
  // Listing health (listings-grid §9.3): debounced, fire-and-forget, never throws.
  queueHealthRefresh('etsy', shopId, undefined, [listingId]);
  return listing;
}

// A sync in flight when the process dies (deploys restart kolayxport.service)
// leaves the draft orphaned in 'syncing' with no code path to recover it.
// Anything 'syncing' longer than this is treated as interrupted.
export const STALE_SYNCING_MS = 10 * 60 * 1000;

// Flip a user's orphaned 'syncing' drafts to 'failed' so the UI shows a
// retryable state instead of a permanent spinner. Called from the drafts list
// endpoint; syncDraft has its own inline recovery as a second line of defense.
export async function recoverStaleSyncingDrafts(userId: string, shopId?: string) {
  const cutoff = new Date(Date.now() - STALE_SYNCING_MS);
  const stale = await prisma.etsyListingDraft.findMany({
    where: { userId, ...(shopId ? { etsyShopId: shopId } : {}), status: 'syncing', updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const ids = stale.map((s) => s.id);
  logger.warn('Recovering drafts stuck in syncing (interrupted sync)', { userId, draftIds: ids });
  await prisma.etsyDraftSyncAttempt.updateMany({
    where: { draftId: { in: ids }, status: 'running' },
    data: { status: 'failed', finishedAt: new Date(), error: 'Interrupted (process restarted mid-sync)' },
  });
  await prisma.etsyListingDraft.updateMany({
    where: { id: { in: ids } },
    data: { status: 'failed', lastSyncError: ETSY_DRAFT_ERROR.interrupted },
  });
  return ids.length;
}

/**
 * Copy a listing (queued `copy` action). Returns the new listing id. Calls
 * `onCreated` as soon as the new listing + inventory exist so the caller can
 * mark the action completed (idempotent retries).
 */
async function executeCopyAction(
  accessToken: string,
  draft: any,
  action: JsonMap,
  results: any[],
  warnings: SyncWarning[],
  onCreated: (newListingId: bigint) => Promise<void>,
): Promise<bigint> {
    const targetShopId = String(action.targetShopId || draft.etsyShopId);
    if (targetShopId !== String(draft.etsyShopId)) await assertShopOwnership(draft.userId, targetShopId);
    const sourceListingId = String(draft.etsyListingId);
    const [
      source,
      sourceInventoryResult,
      sourcePropertiesResult,
      sourcePersonalizationResult,
      sourceVideosResult,
      sourceVariationImagesResult,
    ] = await Promise.all([
      callEtsyAPI(`/listings/${sourceListingId}`, accessToken),
      callEtsyAPI(`/listings/${sourceListingId}/inventory`, accessToken).catch((err) => {
        logger.warn('Copy listing inventory fetch failed', { sourceListingId, error: err.message });
        return null;
      }),
      callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${sourceListingId}/properties`, accessToken).catch((err) => {
        logger.warn('Copy listing properties fetch failed', { sourceListingId, error: err.message });
        return null;
      }),
      callEtsyAPI(`/listings/${sourceListingId}/personalization?supports_multiple_personalization_questions=true`, accessToken).catch((err) => {
        logger.warn('Copy listing personalization fetch failed', { sourceListingId, error: err.message });
        return null;
      }),
      callEtsyAPI(`/listings/${sourceListingId}/videos`, accessToken).catch((err) => {
        logger.warn('Copy listing videos fetch failed', { sourceListingId, error: err.message });
        return null;
      }),
      callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${sourceListingId}/variation-images`, accessToken).catch((err) => {
        logger.warn('Copy listing variation images fetch failed', { sourceListingId, error: err.message });
        return null;
      }),
    ]);
    const price = source.price ? source.price.amount / (source.price.divisor || 100) : 0;
    const copyPayload: JsonMap = {
      title: (`COPY - ${source.title || ''}`).substring(0, 140),
      description: source.description || '',
      price,
      quantity: source.quantity || 1,
      taxonomy_id: source.taxonomy_id,
      who_made: source.who_made || 'i_did',
      when_made: source.when_made || 'made_to_order',
      is_supply: source.is_supply ?? false,
      state: 'draft',
      type: source.type || 'physical',
    };
    if (source.shipping_profile_id) copyPayload.shipping_profile_id = source.shipping_profile_id;
    if (source.return_policy_id) copyPayload.return_policy_id = source.return_policy_id;
    if (source.tags?.length) copyPayload.tags = source.tags.slice(0, 13);
    if (source.materials?.length) copyPayload.materials = source.materials.slice(0, 13);
    if (source.shop_section_id) copyPayload.shop_section_id = source.shop_section_id;
    if (source.readiness_state_id) copyPayload.readiness_state_id = source.readiness_state_id;
    const created = await callEtsyAPI(`/shops/${targetShopId}/listings?legacy=false`, accessToken, {
      method: 'POST',
      body: JSON.stringify(copyPayload),
    });
    const syncedListingId = BigInt(created.listing_id);
    results.push(created);

    const inventoryPayload = sourceInventoryResult ? buildInventoryCopyPayload(sourceInventoryResult) : null;
    if (inventoryPayload) {
      try {
        const inventoryCopyResult = await callEtsyAPI(`/listings/${syncedListingId}/inventory?max_variations_supported=3`, accessToken, {
          method: 'PUT',
          body: JSON.stringify(inventoryPayload),
        });
        results.push(inventoryCopyResult);
        logger.info('Draft copy inventory copied', {
          sourceListingId,
          newListingId: String(syncedListingId),
          productCount: inventoryPayload.products.length,
          priceOnProperty: inventoryPayload.price_on_property,
          quantityOnProperty: inventoryPayload.quantity_on_property,
          skuOnProperty: inventoryPayload.sku_on_property,
        });
      } catch (inventoryCopyErr: any) {
        logger.error('Draft copy inventory copy failed', inventoryCopyErr, {
          sourceListingId,
          newListingId: String(syncedListingId),
          productCount: inventoryPayload.products.length,
          errorMessage: inventoryCopyErr.message,
        });
        await callEtsyAPI(`/listings/${syncedListingId}`, accessToken, { method: 'DELETE' }).catch((deleteErr: any) => {
          logger.warn('Partial copied listing cleanup failed after inventory copy error', {
            sourceListingId,
            newListingId: String(syncedListingId),
            error: deleteErr.message,
          });
        });
        throw inventoryCopyErr;
      }
    }

    // The new listing now exists with its inventory: persist that fact before
    // the best-effort extras so a retry never creates a second copy.
    await onCreated(syncedListingId);

    const sourceProperties = (sourcePropertiesResult?.results || []) as JsonMap[];
    for (const property of sourceProperties) {
      const propertyPayload = buildListingPropertyCopyPayload(property);
      if (!property.property_id || !propertyPayload) continue;
      try {
        results.push(await callEtsyAPI(`/shops/${targetShopId}/listings/${syncedListingId}/properties/${property.property_id}`, accessToken, {
          method: 'PUT',
          body: JSON.stringify(propertyPayload),
        }));
      } catch (propertyCopyErr: any) {
        logger.warn('Draft copy listing property failed', {
          sourceListingId,
          newListingId: String(syncedListingId),
          propertyId: property.property_id,
          error: propertyCopyErr.message,
        });
      }
    }

    const personalizationPayload = buildPersonalizationCopyPayload(sourcePersonalizationResult);
    if (personalizationPayload) {
      try {
        results.push(await callEtsyAPI(`/shops/${targetShopId}/listings/${syncedListingId}/personalization?supports_multiple_personalization_questions=true`, accessToken, {
          method: 'POST',
          body: JSON.stringify(personalizationPayload),
        }));
      } catch (personalizationCopyErr: any) {
        logger.warn('Draft copy personalization failed', {
          sourceListingId,
          newListingId: String(syncedListingId),
          error: personalizationCopyErr.message,
        });
      }
    }

    const imageIdMap: Record<string, number> = {};
    let imageCopyAttempted = 0;
    let imageCopySucceeded = 0;
    let imageCopyLastError: string | null = null;
    try {
      const images = await callEtsyAPI(`/listings/${sourceListingId}/images`, accessToken);
      const sourceImageList = ((images.results || []) as any[]).sort((a, b) => (a.rank || 1) - (b.rank || 1));
      imageCopyAttempted = sourceImageList.length;
      for (const image of sourceImageList) {
        if (!image.url_fullxfull) continue;
        try {
          const imageResp = await fetch(image.url_fullxfull, { signal: AbortSignal.timeout(60_000) });
          if (!imageResp.ok) {
            imageCopyLastError = `download ${imageResp.status}`;
            logger.warn('Copy listing: source image download failed', { sourceListingId, sourceImageId: image.listing_image_id, status: imageResp.status });
            continue;
          }
          const buffer = Buffer.from(await imageResp.arrayBuffer());
          const uploadedImage = await uploadImageFromBuffer(accessToken, targetShopId, syncedListingId, buffer, imageResp.headers.get('content-type') || 'image/jpeg', {
            filename: 'copy-image.jpg',
            rank: image.rank || 1,
            overwrite: false,
          });
          if (image.listing_image_id && uploadedImage?.listing_image_id) {
            imageIdMap[String(image.listing_image_id)] = Number(uploadedImage.listing_image_id);
          }
          imageCopySucceeded++;
          results.push(uploadedImage);
        } catch (perImageErr: any) {
          imageCopyLastError = perImageErr.message || String(perImageErr);
          logger.warn('Copy listing: per-image upload failed (continuing)', { sourceListingId, sourceImageId: image.listing_image_id, error: imageCopyLastError });
        }
      }
    } catch (copyImageErr: any) {
      imageCopyLastError = copyImageErr.message || String(copyImageErr);
      logger.warn('Copy listing image copy partially failed', { error: imageCopyLastError });
    }
    logger.info('Copy listing image copy summary', {
      sourceListingId,
      newListingId: String(syncedListingId),
      attempted: imageCopyAttempted,
      succeeded: imageCopySucceeded,
      lastError: imageCopyLastError,
    });
    if (imageCopyAttempted > 0 && imageCopySucceeded === 0) {
      // Partial-success semantics aren't honored downstream — surface
      // this on the draft itself so the UI can show a clear warning
      // instead of silently leaving the user with a 0-image listing.
      warnings.push({
        type: 'copy_images_failed',
        key: 'draftSync.copyImagesFailed',
        params: { attempted: imageCopyAttempted },
        message: `Copy: 0 of ${imageCopyAttempted} source images copied${imageCopyLastError ? ` (last error: ${imageCopyLastError.slice(0, 200)})` : ''}`,
      });
    }

    const sourceVariationImages = (sourceVariationImagesResult?.results || []) as JsonMap[];
    const copiedVariationImages = sourceVariationImages
      .map((variationImage) => ({
        ...variationImage,
        listing_image_id: imageIdMap[String(variationImage.listing_image_id)],
      }))
      .filter((variationImage) => variationImage.listing_image_id);
    if (copiedVariationImages.length > 0) {
      try {
        results.push(await callEtsyAPI(`/shops/${targetShopId}/listings/${syncedListingId}/variation-images`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ variation_images: copiedVariationImages }),
        }));
      } catch (variationImageCopyErr: any) {
        logger.warn('Draft copy variation images failed', {
          sourceListingId,
          newListingId: String(syncedListingId),
          count: copiedVariationImages.length,
          error: variationImageCopyErr.message,
        });
      }
    }

    const sourceVideos = (sourceVideosResult?.results || []) as JsonMap[];
    for (const video of sourceVideos.slice(0, 1)) {
      try {
        if (video.video_id) {
          results.push(await linkExistingVideo(accessToken, targetShopId, syncedListingId, video.video_id));
        } else if (video.video_url) {
          const videoResp = await fetch(video.video_url, { signal: AbortSignal.timeout(300_000) });
          if (!videoResp.ok) throw new Error(`Video fetch failed: ${videoResp.status}`);
          const buffer = Buffer.from(await videoResp.arrayBuffer());
          results.push(await uploadVideoFromBuffer(
            accessToken,
            targetShopId,
            syncedListingId,
            buffer,
            videoResp.headers.get('content-type') || 'video/mp4',
            `copy-video-${sourceListingId}.mp4`,
            `Copied video ${sourceListingId}`
          ));
        }
      } catch (videoCopyErr: any) {
        logger.warn('Draft copy video failed', {
          sourceListingId,
          newListingId: String(syncedListingId),
          videoId: video.video_id,
          error: videoCopyErr.message,
        });
      }
    }
  return syncedListingId;
}

export type SyncWarning = {
  type: string;
  /** i18n key relative to the `etsy` namespace. */
  key: string;
  params?: Record<string, string | number>;
  message: string;
};

export type SyncDraftOptions = {
  /**
   * Proceed even if the listing changed on Etsy after the draft was staged
   * (re-bases the draft onto the current remote state first). Default false.
   */
  force?: boolean;
  /** Budget priority for the Etsy calls (default: the enclosing context's, else Interactive). Bulk sends pass Bulk. */
  priority?: EtsyPriority;
};

export type SyncDraftResult = {
  /** `skipped` (+ reason `empty`): the draft held nothing to send; it was cancelled and Etsy was not called. */
  status: 'success' | 'conflict' | 'skipped';
  reason?: 'empty';
  draftId: string;
  count?: number;
  deleted?: boolean;
  etsyListingId?: string;
  warnings?: SyncWarning[];
  code?: string;
  key?: string;
  error?: string;
  changedFields?: string[];
};

// updateListing (PATCH /shops/{shop_id}/listings/{listing_id}) does NOT accept
// these (Etsy OAS, checked 2026-10-14): price/quantity live on inventory
// offerings, and processing time moved to offering.readiness_state_id
// (processing profiles). Etsy silently ignores them on PATCH, so they are
// routed to PUT /listings/{id}/inventory instead.
const INVENTORY_ROUTED_KEYS = ['price', 'quantity', 'readiness_state_id', 'processing_min', 'processing_max'] as const;
const CREATE_ACTION_TYPES = ['create_shop_section', 'create_shipping_profile', 'create_return_policy'];
const STATE_ACTION_BODIES: Record<string, JsonMap> = {
  publish: { state: 'active' },
  deactivate: { state: 'inactive' },
  renew: { state: 'active' },
};

function markActionCompleted(actions: any[], index: number, completedResult: JsonMap = {}) {
  const next = [...actions];
  next[index] = { ...next[index], completedAt: new Date().toISOString(), completedResult };
  return next;
}

async function persistQueuedActions(draftId: string, actions: any[]) {
  await prisma.etsyListingDraft.update({ where: { id: draftId }, data: { queuedActions: actions } });
}

function comparableListingValue(key: string, value: any) {
  if (value === undefined || value === null || value === '') return null;
  if (key === 'price' && typeof value === 'object') return Math.round((Number(value.amount) / (Number(value.divisor) || 100)) * 100);
  if (key === 'price') return Math.round(Number(value) * 100);
  if (Array.isArray(value)) return JSON.stringify(value.map((v) => String(v)));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Which of `keys` differ between the base snapshot and the live listing.
 * Returns null when the base snapshot is not a raw Etsy listing (old drafts
 * snapshotted from the DB cache), i.e. a field-level answer is impossible.
 */
export function remoteChangedKeys(baseSnapshot: any, remote: any, keys: string[]): string[] | null {
  if (!baseSnapshot || typeof baseSnapshot !== 'object' || !('listing_id' in baseSnapshot)) return null;
  return keys.filter((key) => {
    if (!(key in baseSnapshot) || !(key in remote)) return false; // not observable via getListing
    return comparableListingValue(key, baseSnapshot[key]) !== comparableListingValue(key, remote[key]);
  });
}

function firstOfferingReadiness(inventory: any): number | null {
  for (const product of Array.isArray(inventory?.products) ? inventory.products : []) {
    for (const offering of Array.isArray(product?.offerings) ? product.offerings : []) {
      if (offering?.readiness_state_id) return Number(offering.readiness_state_id);
    }
  }
  return null;
}

/** Runs a draft sync at Interactive priority in the Etsy rate budget. */
export async function syncDraft(draftId: string, userId: string, options: SyncDraftOptions = {}): Promise<SyncDraftResult> {
  const priority = options.priority ?? getEtsyBudgetContext()?.priority ?? EtsyPriority.Interactive;
  return withEtsyBudget({ userId, priority }, () => syncDraftInner(draftId, userId, options));
}

async function syncDraftInner(draftId: string, userId: string, options: SyncDraftOptions = {}): Promise<SyncDraftResult> {
  const force = Boolean(options.force);

  // ---- Atomic claim -------------------------------------------------------
  // A single conditional UPDATE so two concurrent sync requests (double click,
  // bulk + single, two tabs) can never both run. A long-stale 'syncing' row
  // (process died mid-sync) is claimable too.
  const before = await prisma.etsyListingDraft.findFirst({ where: { id: draftId, userId }, select: { status: true } });
  if (!before) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  // An open draft with nothing staged (every change undone) is never sent: cancel it instead of calling Etsy.
  if (SYNCABLE_STATUSES.includes(before.status) && (await cancelDraftIfEmpty(draftId, userId, { ignoreSchedule: true }))) {
    return { status: 'skipped', reason: 'empty', draftId };
  }
  const staleCutoff = new Date(Date.now() - STALE_SYNCING_MS);
  const claim = await prisma.etsyListingDraft.updateMany({
    where: {
      id: draftId,
      userId,
      OR: [
        { status: { in: SYNCABLE_STATUSES } },
        { status: 'syncing', updatedAt: { lt: staleCutoff } },
      ],
    },
    data: { status: 'syncing' },
  });
  if (claim.count === 0) {
    const current = await prisma.etsyListingDraft.findFirst({ where: { id: draftId, userId }, select: { status: true } });
    const status = current?.status || before.status;
    throw new EtsyDraftError('DRAFT_NOT_SYNCABLE', `Draft is not syncable (${status})`, {
      status: 409,
      key: 'draftSync.notSyncable',
      params: { status },
    });
  }
  if (before.status === 'syncing') {
    logger.warn('Recovering draft stuck in syncing (interrupted sync)', { draftId });
    await prisma.etsyDraftSyncAttempt.updateMany({
      where: { draftId, status: 'running' },
      data: { status: 'failed', finishedAt: new Date(), error: 'Interrupted (process restarted mid-sync); recovered as stale' },
    });
  }

  const draft = await prisma.etsyListingDraft.findFirst({
    where: { id: draftId, userId },
    include: { media: { orderBy: { createdAt: 'asc' } } },
  });
  if (!draft) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  const budgetCtx = getEtsyBudgetContext();
  if (budgetCtx && !budgetCtx.shopId) budgetCtx.shopId = draft.etsyShopId;

  let queuedActions: any[] = ((draft.queuedActions as any[]) || []);
  const requestPlan = {
    fields: draft.fieldPatch,
    taxonomy: draft.taxonomyPatch,
    personalization: draft.personalizationPatch,
    inventory: draft.inventoryPatch,
    media: draft.media.map((m: any) => ({ id: m.id, kind: m.kind, operation: m.operation, etsyMediaId: m.etsyMediaId, rank: m.rank })),
    variationImages: draft.variationImagesPatch,
    queuedActions,
    force,
  };
  const attempt = await prisma.etsyDraftSyncAttempt.create({
    data: { draftId: draft.id, status: 'running', requestPlan: toSerializable(requestPlan) as any },
  });

  const syncedMediaIds: string[] = [];
  const results: any[] = [];
  const warnings: SyncWarning[] = [];
  let stockOverrides: Array<{ variantKey: string; from: number; to: number }> = [];
  let freshQuantities: Array<{ variantKey: string; from: number; to: number }> = [];
  let syncedListingId = BigInt(draft.etsyListingId);
  let accessToken = '';
  let deletedListing = false;
  try {
    accessToken = await getEtsyAccessToken(draft.etsyShopId, userId);
    const isNewLocalListing = syncedListingId < BigInt(0);
    const pendingActions = () => queuedActions.filter((a) => !a?.completedAt);
    const hasDeleteAction = pendingActions().some((action) => action.type === 'delete');
    const idMap: Record<string, number> = {};
    let fields: JsonMap = { ...((draft.fieldPatch as JsonMap) || {}) };
    const mediaOnlyDraft = isMediaOnlyDraft(draft, pendingActions());
    const copyOnlyDraft = pendingActions().length > 0
      && pendingActions().every((a) => a.type === 'copy')
      && draft.media.length === 0
      && isMediaOnlyDraft({ ...draft, media: [{}] }, []); // i.e. every patch is empty
    const taxonomy = draft.taxonomyPatch as JsonMap | null;
    const personalization = draft.personalizationPatch as JsonMap | null;
    const inventory = draft.inventoryPatch as JsonMap | null;
    const variationImages = draft.variationImagesPatch as JsonMap | null;

    if (hasDeleteAction) {
      // Legacy drafts may predate staging-time exclusivity — never run a
      // delete that would silently drop other staged edits (or vice versa).
      assertDeleteIsExclusive(draft as any, draft.media.length, pendingActions());
    }

    // ---- Remote state + conflict protection ------------------------------
    let remoteListing: any = null;
    if (!isNewLocalListing) {
      try {
        remoteListing = await getListingWithInventory(syncedListingId, accessToken);
      } catch (err: any) {
        if (!(hasDeleteAction && isMissingListingError(err))) throw err;
      }
      const base = draft.baseEtsyUpdatedTimestamp || 0;
      const remoteUpdated = remoteListing?.updated_timestamp || 0;
      if (remoteListing && base && remoteUpdated && remoteUpdated > base) {
        if (force) {
          logger.info('Draft force-sync: re-basing onto current remote listing', { draftId: draft.id, oldBase: base, remoteUpdated });
          await prisma.etsyListingDraft.update({ where: { id: draft.id }, data: { baseEtsyUpdatedTimestamp: remoteUpdated, baseSnapshot: remoteListing } });
        } else if (mediaOnlyDraft || copyOnlyDraft) {
          // Media ops validate live image ids; copy only reads the source.
          logger.info('Draft sync skipping conflict check', { draftId: draft.id, reason: mediaOnlyDraft ? 'media-only' : 'copy-only' });
        } else {
          const fieldOnly = isEmptyPatch(taxonomy) && isEmptyPatch(inventory) && isEmptyPatch(personalization)
            && isEmptyPatch(variationImages) && !hasDeleteAction;
          const changed = fieldOnly ? remoteChangedKeys(draft.baseSnapshot, remoteListing, Object.keys(fields)) : null;
          if (changed && changed.length === 0) {
            // The remote edit didn't touch anything this draft changes (e.g. a
            // sale bumped updated_timestamp) — safe to re-base and continue.
            logger.info('Draft sync: remote changed unrelated fields, re-basing', { draftId: draft.id, oldBase: base, remoteUpdated });
            await prisma.etsyListingDraft.update({ where: { id: draft.id }, data: { baseEtsyUpdatedTimestamp: remoteUpdated } });
          } else {
            const message = 'Listing changed on Etsy after these edits were staged. Review it, then sync again with "apply anyway" to overwrite.';
            await prisma.etsyListingDraft.update({ where: { id: draft.id }, data: { status: 'conflict', lastSyncError: ETSY_DRAFT_ERROR.conflict } });
            notifyDraftProblem(userId, draft, 'draftConflict');
            await prisma.etsyDraftSyncAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'conflict',
                finishedAt: new Date(),
                error: message,
                result: { code: 'REMOTE_CHANGED', baseEtsyUpdatedTimestamp: base, remoteUpdatedTimestamp: remoteUpdated, changedFields: changed ?? null },
              },
            });
            return {
              status: 'conflict',
              draftId: draft.id,
              code: 'REMOTE_CHANGED',
              key: 'draftSync.conflict',
              error: message,
              ...(changed ? { changedFields: changed } : {}),
            };
          }
        }
      }
    }

    // ---- Delete (exclusive) ----------------------------------------------
    if (hasDeleteAction) {
      if (!isNewLocalListing && remoteListing) {
        try {
          results.push(await callEtsyAPI(`/listings/${syncedListingId}`, accessToken, { method: 'DELETE' }));
        } catch (err: any) {
          if (!isMissingListingError(err)) throw err;
          results.push({ skipped: true, operation: 'delete', reason: 'listing_already_missing' });
        }
      } else {
        results.push({ skipped: true, operation: 'delete', reason: isNewLocalListing ? 'local_listing_never_created' : 'listing_already_missing' });
      }
      deletedListing = true;
      if (!isNewLocalListing) {
        await prisma.etsyListing.deleteMany({ where: { etsyShopId: draft.etsyShopId, etsyListingId: syncedListingId } });
      }
      await prisma.etsyListingDraft.update({
        where: { id: draft.id },
        data: { status: 'synced', syncedAt: new Date(), lastSyncError: null },
      });
      await prisma.etsyDraftSyncAttempt.update({
        where: { id: attempt.id },
        data: { status: 'success', finishedAt: new Date(), result: { count: results.length, etsyListingId: String(syncedListingId), deleted: true } },
      });
      for (const media of draft.media) await unlinkDraftUploadFile(media.localPath);
      void resolveNotification(userId, notificationKeys.draft(String(draft.id)));
      return { status: 'success', draftId: draft.id, count: results.length, deleted: true, etsyListingId: String(syncedListingId) };
    }

    // ---- Normalise + validate before touching Etsy -----------------------
    if (fields.when_made) fields.when_made = normalizeWhenMade(fields.when_made);
    // Etsy rejects PATCH /listings if any of who_made / when_made / is_supply
    // is present without the other two. Backfill the missing ones from the
    // current remote listing so a single-field UI edit still syncs cleanly.
    const PROVENANCE_KEYS = ['who_made', 'when_made', 'is_supply'] as const;
    if (PROVENANCE_KEYS.some((k) => k in fields) && remoteListing) {
      for (const key of PROVENANCE_KEYS) {
        if (!(key in fields) && remoteListing[key] != null) fields[key] = remoteListing[key];
      }
    }

    const pendingCreateTempIds = new Set(
      queuedActions.filter((a) => CREATE_ACTION_TYPES.includes(a?.type) && a?.tempId != null).map((a) => String(a.tempId)),
    );
    const sanitizedInventoryPreview = inventory?.products ? sanitizeInventoryForEtsy(inventory, null) : null;
    const syncErrors: FieldError[] = [
      ...validateEtsyFieldPatch(fields),
      ...validateEtsyPersonalization(personalization),
      ...(sanitizedInventoryPreview ? validateEtsyInventory(sanitizedInventoryPreview) : []),
    ];

    // Shop section must still exist on Etsy (recurring "Shop section not found").
    const sectionId = fields.shop_section_id;
    if (sectionId != null && sectionId !== '' && Number(sectionId) > 0 && !pendingCreateTempIds.has(String(sectionId))) {
      try {
        const sections = await callEtsyAPI(`/shops/${draft.etsyShopId}/sections`, accessToken);
        const ids = new Set(((sections?.results || []) as any[]).map((s) => String(s.shop_section_id)));
        if (!ids.has(String(sectionId))) {
          syncErrors.push({
            field: 'shop_section_id',
            severity: 'block_sync',
            key: 'validation.shopSectionNotFound',
            message: 'The selected shop section no longer exists on Etsy. Pick another section or leave it empty.',
          });
        }
      } catch (err: any) {
        logger.warn('Draft sync could not verify shop section', { draftId: draft.id, error: err.message });
      }
    }
    if (syncErrors.length) throwValidation(syncErrors);

    // ---- Readiness (processing profile) helpers --------------------------
    let readinessDefs: any[] | null = null;
    const getReadinessDefs = async () => {
      if (readinessDefs) return readinessDefs;
      try {
        const res = await callEtsyAPI(`/shops/${draft.etsyShopId}/readiness-state-definitions`, accessToken);
        readinessDefs = (res?.results || []) as any[];
      } catch (err: any) {
        logger.warn('Could not load readiness state definitions', { shopId: draft.etsyShopId, error: err.message });
        readinessDefs = [];
      }
      return readinessDefs;
    };
    const readinessForProcessing = async (min: any, max: any): Promise<number | null> => {
      const lo = min == null || min === '' ? null : Number(min);
      const hi = max == null || max === '' ? null : Number(max);
      if (lo == null && hi == null) return null;
      const defs = await getReadinessDefs();
      const match = defs.find((d) => (lo == null || Number(d.min_processing_days) === lo) && (hi == null || Number(d.max_processing_days) === hi));
      return match ? Number(match.readiness_state_id) : null;
    };

    // ---- Split fields: PATCH-able vs inventory-routed --------------------
    const routed: JsonMap = {};
    if (!isNewLocalListing) {
      for (const key of INVENTORY_ROUTED_KEYS) {
        if (key in fields) {
          routed[key] = fields[key];
          delete fields[key];
        }
      }
    }
    let explicitReadinessId: number | null = routed.readiness_state_id ? Number(routed.readiness_state_id) : null;
    if (!explicitReadinessId && ('processing_min' in routed || 'processing_max' in routed)) {
      explicitReadinessId = await readinessForProcessing(routed.processing_min, routed.processing_max);
      if (!explicitReadinessId) {
        warnings.push({
          type: 'processing_time_not_mapped',
          key: 'draftSync.processingNotMapped',
          params: { min: String(routed.processing_min ?? ''), max: String(routed.processing_max ?? '') },
          message: `No Etsy processing profile matches ${routed.processing_min ?? '?'}-${routed.processing_max ?? '?'} days; processing time was not changed. Create the processing profile on Etsy or pick an existing one.`,
        });
      }
    }
    const hasInventoryPatch = Boolean(inventory?.products);
    const routesPriceOrQty = routed.price !== undefined || routed.quantity !== undefined;
    const needsRoutedInventoryWrite = !isNewLocalListing && !hasInventoryPatch && (routesPriceOrQty || Boolean(explicitReadinessId));
    const isPhysical = String(remoteListing?.type || fields.type || 'physical') !== 'download';

    let currentInventory: any = null;
    if (!isNewLocalListing && (hasInventoryPatch || needsRoutedInventoryWrite)) {
      try {
        currentInventory = await callEtsyAPI(`/listings/${syncedListingId}/inventory`, accessToken);
      } catch (err: any) {
        if (needsRoutedInventoryWrite) throw err;
        logger.warn('Could not fetch current inventory before inventory sync', { listingId: String(syncedListingId), error: err.message });
      }
    }
    // Single-offering listing: price/quantity/readiness edited as plain fields
    // are applied onto the live inventory. Built here from the early read for
    // validation (fail before any write), and rebuilt from the fresh read
    // inside the inventory lock right before the PUT.
    const buildRoutedInventory = (source: any): JsonMap => {
      const products = (Array.isArray(source?.products) ? source.products : []).filter((p: any) => !p?.is_deleted);
      const isMultiVariation = products.length > 1 || products.some((p: any) => Array.isArray(p?.property_values) && p.property_values.length > 0);
      if (isMultiVariation && routesPriceOrQty) {
        throw new EtsyDraftError(
          'INVENTORY_PATCH_REQUIRED',
          'This listing has variations — edit price and quantity per variation in the Variations tab instead of the single price/quantity fields.',
          { status: 400, key: 'draftSync.inventoryPatchRequired' },
        );
      }
      return {
        ...source,
        products: products.map((p: any) => ({
          ...p,
          offerings: (Array.isArray(p.offerings) ? p.offerings : []).filter((o: any) => !o?.is_deleted).map((o: any) => ({
            ...o,
            ...(routed.price !== undefined ? { price: Number(String(routed.price).replace(',', '.')) } : {}),
            ...(routed.quantity !== undefined ? { quantity: Math.trunc(Number(routed.quantity)) } : {}),
            ...(explicitReadinessId ? { readiness_state_id: explicitReadinessId } : {}),
          })),
        })),
      };
    };
    let routedInventory: JsonMap | null = null;
    if (needsRoutedInventoryWrite && currentInventory) {
      routedInventory = buildRoutedInventory(currentInventory);
    }
    if (hasInventoryPatch && routesPriceOrQty) {
      logger.info('Draft sync: field price/quantity ignored in favour of inventory patch', { draftId: draft.id });
    }

    // ---- Queued create actions (idempotent) ------------------------------
    for (let i = 0; i < queuedActions.length; i++) {
      const action = queuedActions[i];
      if (!CREATE_ACTION_TYPES.includes(action?.type)) continue;
      if (action.completedAt) {
        const realId = action.completedResult?.realId;
        if (action.tempId && realId) idMap[String(action.tempId)] = Number(realId);
        continue;
      }
      let created: any;
      let realId: any;
      if (action.type === 'create_shop_section') {
        created = await callEtsyAPI(`/shops/${draft.etsyShopId}/sections`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ title: action.payload?.title || action.title }),
        });
        realId = created.shop_section_id || created.section?.shop_section_id;
      } else if (action.type === 'create_shipping_profile') {
        created = await callEtsyAPI(`/shops/${draft.etsyShopId}/shipping-profiles`, accessToken, {
          method: 'POST',
          body: JSON.stringify(action.payload || {}),
        });
        realId = created.shipping_profile_id || created.shipping_profile?.shipping_profile_id;
      } else {
        created = await callEtsyAPI(`/shops/${draft.etsyShopId}/policies/return`, accessToken, {
          method: 'POST',
          body: JSON.stringify(action.payload || {}),
        });
        realId = created.return_policy_id || created.return_policy?.return_policy_id;
      }
      if (action.tempId && realId) idMap[String(action.tempId)] = Number(realId);
      results.push(created);
      queuedActions = markActionCompleted(queuedActions, i, { realId: realId != null ? String(realId) : null });
      await persistQueuedActions(draft.id, queuedActions);
    }

    fields = resolveTemporaryIds(fields, idMap);

    // ---- New local listing: create on Etsy (idempotent) ------------------
    let createdReadinessId: number | null = null;
    if (isNewLocalListing) {
      const createIndex = queuedActions.findIndex((action) => action.type === 'create_listing');
      const createAction = createIndex >= 0 ? queuedActions[createIndex] : null;
      const createPayload: JsonMap = resolveTemporaryIds({
        ...(createAction?.payload || {}),
        ...fields,
        state: 'draft',
      }, idMap);
      if (createPayload.when_made) createPayload.when_made = normalizeWhenMade(createPayload.when_made);
      if (String(createPayload.type || 'physical') !== 'download' && !createPayload.readiness_state_id) {
        const fromProcessing = await readinessForProcessing(createPayload.processing_min, createPayload.processing_max);
        const fallback = fromProcessing ?? (await getReadinessDefs())[0]?.readiness_state_id ?? null;
        if (!fallback) {
          throw new EtsyDraftError(
            'READINESS_STATE_REQUIRED',
            'Etsy requires a processing profile for physical listings. Create one on Etsy (Settings → Processing profiles) and try again.',
            { status: 400, key: 'draftSync.readinessStateRequired' },
          );
        }
        createPayload.readiness_state_id = Number(fallback);
      }
      createdReadinessId = createPayload.readiness_state_id ? Number(createPayload.readiness_state_id) : null;
      const created = await callEtsyAPI(`/shops/${draft.etsyShopId}/listings?legacy=false`, accessToken, {
        method: 'POST',
        body: JSON.stringify(createPayload),
      });
      syncedListingId = BigInt(created.listing_id);
      results.push(created);
      // Persist the real listing id IMMEDIATELY: if anything below fails, a
      // retry must patch this listing rather than create a duplicate.
      if (createIndex >= 0) queuedActions = markActionCompleted(queuedActions, createIndex, { listingId: String(syncedListingId) });
      await prisma.etsyListingDraft.update({
        where: { id: draft.id },
        data: {
          etsyListingId: syncedListingId,
          fieldPatch: {},
          queuedActions,
          baseEtsyUpdatedTimestamp: created.updated_timestamp || 0,
          baseSnapshot: created,
        },
      });
      await prisma.etsyDraftMedia.updateMany({ where: { draftId: draft.id }, data: { etsyListingId: syncedListingId } });
      fields = {};
    }

    // ---- Core listing fields (PATCH) -------------------------------------
    if (fields && Object.keys(fields).length > 0) {
      results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}?legacy=false`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }));
    }

    // ---- Category attributes (partial success is reported, not swallowed)
    if (taxonomy?.properties && Array.isArray(taxonomy.properties)) {
      for (const prop of taxonomy.properties) {
        const hasValues = Array.isArray(prop.values) && prop.values.length > 0;
        const hasValueIds = Array.isArray(prop.value_ids) && prop.value_ids.length > 0;
        const isRemoval = prop.remove || (!hasValues && !hasValueIds);
        try {
          if (isRemoval) {
            results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}/properties/${prop.property_id}`, accessToken, {
              method: 'DELETE',
            }));
          } else {
            const body: JsonMap = {
              values: hasValues ? prop.values : [],
              value_ids: hasValueIds ? prop.value_ids : [],
            };
            if (prop.scale_id != null) body.scale_id = prop.scale_id;
            results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}/properties/${prop.property_id}`, accessToken, {
              method: 'PUT',
              body: JSON.stringify(body),
            }));
          }
        } catch (propErr: any) {
          // Deleting an attribute that isn't set is a no-op for the user.
          if (isRemoval && isMissingListingError(propErr)) continue;
          logger.warn(isRemoval ? 'Draft sync property delete failed' : 'Draft sync property update failed', { draftId: draft.id, propertyId: prop.property_id, error: propErr.message });
          const detail = String(propErr.message || '').replace(/^Etsy API error:\s*/, '').slice(0, 300);
          warnings.push({
            type: isRemoval ? 'property_delete_failed' : 'property_update_failed',
            key: isRemoval ? 'draftSync.propertyDeleteFailed' : 'draftSync.propertyUpdateFailed',
            params: { property: String(prop.property_name || prop.property_id), detail },
            message: `Category detail "${prop.property_name || prop.property_id}" was not ${isRemoval ? 'removed' : 'saved'}: ${detail}`,
          });
        }
      }
    }

    // ---- Personalization -------------------------------------------------
    if (personalization) {
      if (personalization.remove) {
        results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}/personalization?supports_multiple_personalization_questions=true`, accessToken, { method: 'DELETE' }));
      } else if (personalization.personalization_questions) {
        results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}/personalization?supports_multiple_personalization_questions=true`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ personalization_questions: personalization.personalization_questions }),
        }));
      }
    }

    // ---- Inventory -------------------------------------------------------
    // readiness_state_id lives on each offering (updateListingInventory
    // requires it per offering for physical listings). Fallback order:
    // explicit (field/processing time) → current offerings → listing →
    // the shop's first processing profile.
    //
    // The whole read-modify-write runs inside the per-listing inventory lock
    // (shared with stock pushes): fresh GET -> quantities the user did not
    // change take the fresh remote value -> stock-sync hook -> PUT. So a sale
    // that landed after the draft was staged is never overwritten by the
    // staged (older, higher) quantity.
    const inventoryToWrite = hasInventoryPatch ? inventory : routedInventory;
    if (inventoryToWrite?.products) {
      await withListingInventoryLock(String(syncedListingId), async () => {
        let freshInventory: any = null;
        if (!isNewLocalListing) {
          try {
            freshInventory = await callEtsyAPI(`/listings/${syncedListingId}/inventory`, accessToken);
          } catch (err: any) {
            if (needsRoutedInventoryWrite) throw err;
            // Without the fresh read the merge cannot protect quantities that
            // sold since staging: writing the staged list would restore the
            // older, higher quantities (oversell). Fail the attempt and keep
            // the draft for a retry — unless this is a legacy draft whose
            // patch carries neither a base inventory nor loaded quantities
            // (nothing could be merged anyway: previous behaviour).
            const patchProducts = Array.isArray(inventoryToWrite.products) ? inventoryToWrite.products : [];
            const canMerge = Boolean(baseInventoryProducts(draft.baseSnapshot))
              || patchProducts.some((p: any) => p && p.kx_loaded_quantity !== undefined && p.kx_loaded_quantity !== null);
            if (hasInventoryPatch && canMerge) throw err;
            logger.warn('Could not re-read inventory inside the inventory lock', { listingId: String(syncedListingId), error: err.message });
          }
        }

        let working: JsonMap = inventoryToWrite;
        let userChangedVariantKeys = new Set<string>();
        if (!hasInventoryPatch && needsRoutedInventoryWrite && freshInventory) {
          working = buildRoutedInventory(freshInventory);
          if (routed.quantity !== undefined) {
            for (const p of working.products || []) userChangedVariantKeys.add(reportedVariantKey(p));
          }
        } else if (hasInventoryPatch) {
          const merged = mergeFreshInventoryQuantities({
            draftProducts: Array.isArray(inventoryToWrite.products) ? inventoryToWrite.products : [],
            baseProducts: baseInventoryProducts(draft.baseSnapshot),
            freshProducts: freshInventory?.products,
          });
          working = { ...inventoryToWrite, products: merged.products.map((p: any) => stripEditorFields(p)) };
          userChangedVariantKeys = merged.userChangedVariantKeys;
          freshQuantities = merged.refreshed;
          if (merged.refreshed.length) {
            logger.info('Draft sync: kept fresh Etsy quantities for variants the user did not change', {
              draftId: draft.id, listingId: String(syncedListingId), refreshed: merged.refreshed.length,
            });
          }
        }

        // W2 echo markers created by the stock overlay; settled after the PUT
        // (an unsettled marker is verified by the push worker after ~5 min).
        let stockEchoIds: string[] = [];
        if (!isNewLocalListing) {
          try {
            const stock = await applyStockToEtsyDraftInventory({
              userId: draft.userId,
              shopId: draft.etsyShopId,
              listingId: String(syncedListingId),
              actorUserId: userId,
              products: Array.isArray(working.products) ? working.products : [],
              userChangedVariantKeys,
            });
            working = { ...working, products: stock.products };
            stockOverrides = stock.overridden;
            stockEchoIds = Array.isArray(stock.echoPushIds) ? stock.echoPushIds : [];
          } catch (stockErr: any) {
            const managed = await isListingStockManaged(draft.userId, draft.etsyShopId, String(syncedListingId)).catch(() => true);
            if (managed) {
              throw new EtsyDraftError(
                'STOCK_OVERRIDE_FAILED',
                'Stock sync manages this listing and its quantities could not be applied. The draft was kept; try again.',
                { status: 409, key: 'draftSync.stockOverrideFailed' },
              );
            }
            logger.warn('Stock hook failed for an unmanaged listing; continuing', { draftId: draft.id, error: stockErr?.message });
          }
        }

        try {
          let fallbackReadinessStateId: number | null = explicitReadinessId
            ?? firstOfferingReadiness(freshInventory)
            ?? firstOfferingReadiness(currentInventory)
            ?? (remoteListing?.readiness_state_id ? Number(remoteListing.readiness_state_id) : null)
            ?? createdReadinessId;
          if (!fallbackReadinessStateId && isPhysical) {
            const first = (await getReadinessDefs())[0];
            fallbackReadinessStateId = first?.readiness_state_id ? Number(first.readiness_state_id) : null;
          }
          const payload = sanitizeInventoryForEtsy(working, fallbackReadinessStateId);
          if (explicitReadinessId) {
            for (const product of payload.products || []) {
              for (const offering of product.offerings || []) offering.readiness_state_id = explicitReadinessId;
            }
          }
          results.push(await callEtsyAPI(`/listings/${syncedListingId}/inventory?max_variations_supported=3`, accessToken, {
            method: 'PUT',
            body: JSON.stringify(payload),
          }));
          await settleEtsyDraftStockEcho(stockEchoIds, true);
        } catch (putErr) {
          await settleEtsyDraftStockEcho(stockEchoIds, false);
          throw putErr;
        }
      });
    }

    // ---- Media -----------------------------------------------------------
    const mediaOps = dedupeMediaOps(draft.media);
    const mediaContext = mediaOps.length && !isNewLocalListing
      ? await buildMediaSyncContext(accessToken, syncedListingId)
      : undefined;

    const imageDeletes = mediaOps.filter((m: any) => m.kind === 'image' && ['delete', 'replace_all'].includes(m.operation));
    const uploads = mediaOps.filter((m: any) => ['upload', 'ai_upload'].includes(m.operation));
    const nonImageDeletes = mediaOps.filter((m: any) => m.kind !== 'image' && ['delete', 'replace_all'].includes(m.operation));

    for (const op of nonImageDeletes) {
      results.push(await syncMediaOperation(accessToken, draft, op, syncedListingId, draft.etsyShopId, mediaContext));
      if (op.id) syncedMediaIds.push(op.id);
    }
    for (const op of uploads) {
      results.push(await syncMediaOperation(accessToken, draft, op, syncedListingId, draft.etsyShopId, mediaContext));
      if (op.id) syncedMediaIds.push(op.id);
    }
    for (const op of imageDeletes) {
      if (mediaContext?.imageIds && mediaContext.imageIds.size <= 1) {
        results.push({ skipped: true, mediaId: String(op.etsyMediaId || ''), operation: op.operation, reason: 'would_leave_listing_without_images' });
        continue;
      }
      results.push(await syncMediaOperation(accessToken, draft, op, syncedListingId, draft.etsyShopId, mediaContext));
      if (op.id) syncedMediaIds.push(op.id);
    }
    // Image reorders need to be applied as a single batched permutation,
    // otherwise Etsy 400s with "ListingImages ... are in an inconsistent order"
    // when intermediate states collide. update_alt for images runs through the
    // same batch (alt text travels with each move), update_alt for videos
    // remains a per-op call.
    const imageReorderOps = mediaOps.filter((m: any) => m.kind === 'image' && ['reorder', 'update_alt'].includes(m.operation));
    const otherMutables = mediaOps.filter((m: any) => m.kind !== 'image' && ['update_alt', 'reorder'].includes(m.operation));
    if (imageReorderOps.length > 0) {
      const batchResults = await applyImageReorderBatch(accessToken, draft.etsyShopId, syncedListingId, imageReorderOps, mediaContext);
      results.push(...batchResults);
      for (const op of imageReorderOps) {
        if (op.id) syncedMediaIds.push(op.id);
      }
    }
    for (const op of otherMutables) {
      results.push(await syncMediaOperation(accessToken, draft, op, syncedListingId, draft.etsyShopId, mediaContext));
      if (op.id) syncedMediaIds.push(op.id);
    }

    if (variationImages?.variation_images) {
      results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}/variation-images`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ variation_images: variationImages.variation_images }),
      }));
    }

    // ---- State actions + copy (each marked completed once done) ----------
    for (let i = 0; i < queuedActions.length; i++) {
      const action = queuedActions[i];
      if (action?.completedAt) continue;
      if (STATE_ACTION_BODIES[action?.type]) {
        results.push(await callEtsyAPI(`/shops/${draft.etsyShopId}/listings/${syncedListingId}`, accessToken, {
          method: 'PATCH',
          body: JSON.stringify(STATE_ACTION_BODIES[action.type]),
        }));
        queuedActions = markActionCompleted(queuedActions, i);
        await persistQueuedActions(draft.id, queuedActions);
      } else if (action?.type === 'copy') {
        const actionIndex = i;
        syncedListingId = await executeCopyAction(accessToken, draft, action, results, warnings, async (newListingId) => {
          queuedActions = markActionCompleted(queuedActions, actionIndex, { newListingId: String(newListingId) });
          await persistQueuedActions(draft.id, queuedActions);
        });
      }
    }

    // ---- Success ---------------------------------------------------------
    const finalListing = await refreshListingCache(draft.etsyShopId, syncedListingId, accessToken, {
      userId: draft.userId,
      draftId: draft.id,
      syncAttemptId: attempt.id,
      source: 'draft_sync',
    })
      .catch((err) => { logger.warn('Draft sync cache refresh failed', { error: err.message }); return null; });
    const warningSummary = warnings.length ? warnings.map((w) => w.message).join(' | ').slice(0, 2000) : null;
    await prisma.etsyListingDraft.update({
      where: { id: draft.id },
      data: {
        status: 'synced',
        etsyListingId: syncedListingId,
        syncedAt: new Date(),
        lastSyncError: warningSummary,
        queuedActions,
        // Our own writes moved Etsy's updated_timestamp: record the post-sync
        // value so nothing downstream mistakes it for a remote edit.
        ...(finalListing?.updated_timestamp ? { baseEtsyUpdatedTimestamp: finalListing.updated_timestamp, baseSnapshot: finalListing } : {}),
      },
    });
    await prisma.etsyDraftSyncAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        result: toSerializable({
          count: results.length,
          etsyListingId: String(syncedListingId),
          partial: warnings.length > 0,
          warnings,
          ...(stockOverrides.length ? { stockOverrides } : {}),
          ...(freshQuantities.length ? { freshQuantities } : {}),
        }) as any,
      },
    });

    for (const media of draft.media) await unlinkDraftUploadFile(media.localPath);
    void resolveNotification(userId, notificationKeys.draft(String(draft.id)));
    return {
      status: 'success',
      draftId: draft.id,
      count: results.length,
      etsyListingId: String(syncedListingId),
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (err: any) {
    if (syncedMediaIds.length > 0) {
      await prisma.etsyDraftMedia.deleteMany({ where: { id: { in: syncedMediaIds } } }).catch(() => undefined);
      for (const m of draft.media.filter((m: any) => syncedMediaIds.includes(m.id))) {
        await unlinkDraftUploadFile(m.localPath);
      }
      logger.info('Partial media sync: cleaned up completed media before marking draft failed', { draftId: draft.id, syncedCount: syncedMediaIds.length, totalMedia: draft.media.length });
    }
    // If this attempt already changed the listing on Etsy, those changes are
    // OURS — move the conflict base forward so the retry doesn't report a
    // false "remote changed" conflict (the main historical false positive).
    let rebase: JsonMap = {};
    if ((results.length > 0 || syncedMediaIds.length > 0) && syncedListingId > BigInt(0) && !deletedListing && accessToken) {
      try {
        const live = await getListingWithInventory(syncedListingId, accessToken);
        if (live?.updated_timestamp) rebase = { baseEtsyUpdatedTimestamp: live.updated_timestamp, baseSnapshot: live };
      } catch { /* keep old base */ }
    }
    const message = err?.message || 'Sync failed';
    // Stable i18n key in the draft (docs/integration/draft-sync-error-codes.md); the English
    // message stays on the attempt row, params in attempt.result.errorParams.
    const stored = classifyEtsyDraftSyncError(err);
    await prisma.etsyListingDraft.update({
      where: { id: draft.id },
      data: { status: 'failed', lastSyncError: stored.key, queuedActions, ...rebase },
    }).catch(() => undefined);
    notifyDraftProblem(userId, draft, 'draftSyncFailed');
    await prisma.etsyDraftSyncAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: message,
        result: toSerializable({
          count: results.length,
          partial: results.length > 0,
          warnings,
          ...(isEtsyDraftError(err) ? { code: err.code, key: err.key, issues: err.issues } : {}),
          errorKey: stored.key,
          ...(stored.params ? { errorParams: stored.params } : {}),
        }) as any,
      },
    }).catch(() => undefined);
    throw err;
  }
}

export async function discardDraft(draftId: string, userId: string) {
  const draft = await prisma.etsyListingDraft.findFirst({ where: { id: draftId, userId }, include: { media: true } });
  if (!draft) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  if (draft.status === 'syncing') {
    throw new EtsyDraftError('DRAFT_SYNCING', 'Draft is syncing right now — wait for it to finish', { status: 409, key: 'draftSync.draftSyncing' });
  }
  for (const media of draft.media) await unlinkDraftUploadFile(media.localPath);
  await prisma.etsyListingDraft.update({ where: { id: draft.id }, data: { status: 'cancelled' } });
  void resolveNotification(userId, notificationKeys.draft(String(draft.id)));
  return { success: true };
}

// ─── Review differences (listing-editor §6.4, BR-3) ─────────────────────────────────────────────────────────────
// A conflicted draft was a dead end: /api/etsy-drafts/:id/diff and /resolve answered 501 until these existed
// (founder 2026-10-17: "user will get angry if we don't show why and a solution"). Read-only diff against the live
// listing; resolve keeps the seller's picks, drops the rest, re-bases on the live listing and returns the draft to
// `draft`. Neither ever sends to Etsy or touches queued actions.

/** EtsyListing cache column → Etsy listing key, for drafts whose base snapshot came from the cache (older drafts). */
const CACHE_TO_ETSY_KEY: Record<string, string> = {
  title: 'title', description: 'description', tags: 'tags', materials: 'materials', quantity: 'quantity', state: 'state',
  whoMade: 'who_made', whenMade: 'when_made', isSupply: 'is_supply', taxonomyId: 'taxonomy_id', shopSectionId: 'shop_section_id',
  shippingProfileId: 'shipping_profile_id', returnPolicyId: 'return_policy_id', itemWeight: 'item_weight', itemWeightUnit: 'item_weight_unit',
  itemLength: 'item_length', itemWidth: 'item_width', itemHeight: 'item_height', itemDimensionsUnit: 'item_dimensions_unit',
  processingMin: 'processing_min', processingMax: 'processing_max', isPersonalizable: 'is_personalizable',
  personalizationIsRequired: 'personalization_is_required', personalizationCharCountMax: 'personalization_char_count_max',
  personalizationInstructions: 'personalization_instructions',
};

/** The draft's base as Etsy listing keys (raw Etsy snapshot as is; cache snapshot mapped). Exported for tests. */
export function baseAsEtsyListing(base: any): Record<string, unknown> {
  if (!base || typeof base !== 'object') return {};
  if ('listing_id' in base) return base;
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(CACHE_TO_ETSY_KEY)) if (from in base) out[to] = base[from];
  if (base.priceAmount != null) out.price = { amount: Number(base.priceAmount), divisor: Number(base.priceDivisor) || 100, currency_code: base.priceCurrencyCode || 'USD' };
  return out;
}

/** Short, language-neutral summary of an inventory ("$91.00–$118.00 · 91"), for the review row. Exported for tests. */
export function inventorySummary(inv: any): string | null {
  const products = Array.isArray(inv?.products) ? inv.products : null;
  if (!products) return null;
  const prices: number[] = [];
  let currency = 'USD';
  for (const p of products) for (const o of Array.isArray(p?.offerings) ? p.offerings : []) {
    const pr = o?.price;
    const v = typeof pr === 'object' && pr ? Number(pr.amount) / (Number(pr.divisor) || 100) : Number(pr);
    if (Number.isFinite(v)) prices.push(v);
    if (pr?.currency_code) currency = pr.currency_code;
  }
  if (!prices.length) return `${products.length}`;
  const fmt = (n: number) => `${currency === 'USD' ? '$' : ''}${n.toFixed(2)}${currency === 'USD' ? '' : ` ${currency}`}`;
  const min = Math.min(...prices); const max = Math.max(...prices);
  return `${min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`} · ${products.length}`;
}

const PATCH_KEYS = { taxonomyPatch: 'taxonomy', inventoryPatch: 'inventory', personalizationPatch: 'personalization', variationImagesPatch: 'variationImages' } as const;

function diffSameValue(key: string, a: unknown, b: unknown): boolean {
  return comparableListingValue(key, a) === comparableListingValue(key, b);
}

/** Pure diff of a draft vs the live listing (exported for tests). */
export function buildDraftDiff(draft: any, remote: any) {
  const base = baseAsEtsyListing(draft.baseSnapshot);
  const rawBase = !!draft.baseSnapshot && typeof draft.baseSnapshot === 'object' && 'listing_id' in draft.baseSnapshot;
  const fieldPatch = (draft.fieldPatch && typeof draft.fieldPatch === 'object') ? draft.fieldPatch as Record<string, unknown> : {};
  const fields: Array<{ key: string; base: unknown; remote: unknown; draft: unknown; changedRemotely: boolean; inDraft: boolean }> = [];
  for (const [key, mine] of Object.entries(fieldPatch)) {
    const known = key in base;
    fields.push({
      key, base: base[key], remote: remote?.[key], draft: mine, inDraft: true,
      // A base without this field cannot prove Etsy left it alone: show it as changed so the seller decides.
      changedRemotely: known ? !diffSameValue(key, base[key], remote?.[key]) : remote?.[key] !== undefined && !diffSameValue(key, mine, remote?.[key]),
    });
  }
  // Etsy-only edits (no choice, shown so nothing changes silently) — only provable with a raw Etsy base.
  if (rawBase) {
    for (const key of Object.values(CACHE_TO_ETSY_KEY).concat('price')) {
      if (key in fieldPatch || !(key in base) || !(key in (remote ?? {}))) continue;
      if (!diffSameValue(key, base[key], remote[key])) fields.push({ key, base: base[key], remote: remote[key], draft: undefined, inDraft: false, changedRemotely: true });
    }
  }
  for (const [col, key] of Object.entries(PATCH_KEYS)) {
    const patch = draft[col];
    if (isEmptyPatch(patch)) continue;
    if (key === 'inventory') {
      const baseInv = rawBase ? draft.baseSnapshot.inventory : undefined;
      fields.push({
        key, base: inventorySummary(baseInv), remote: inventorySummary(remote?.inventory), draft: inventorySummary(patch), inDraft: true,
        changedRemotely: baseInv ? JSON.stringify(baseInv?.products ?? null) !== JSON.stringify(remote?.inventory?.products ?? null) : true,
      });
    } else {
      fields.push({ key, base: undefined, remote: undefined, draft: undefined, inDraft: true, changedRemotely: false });
    }
  }
  return fields;
}

async function loadOwnedDraft(draftId: string, userId: string) {
  const draft = await prisma.etsyListingDraft.findFirst({ where: { id: draftId, userId } });
  if (!draft) throw new EtsyDraftError('DRAFT_NOT_FOUND', 'Draft not found', { status: 404, key: 'draftSync.draftNotFound' });
  return draft;
}

export async function getDraftDiff(draftId: string, userId: string) {
  const draft: any = await loadOwnedDraft(draftId, userId);
  const token = await getEtsyAccessToken(String(draft.etsyShopId), userId);
  const remote = await getListingWithInventory(draft.etsyListingId, token);
  return { remoteUpdatedAt: remote?.updated_timestamp ?? null, fields: buildDraftDiff(draft, remote), queuedActions: draft.queuedActions };
}

export async function resolveDraft(draftId: string, userId: string, keep: string[]) {
  const draft: any = await loadOwnedDraft(draftId, userId);
  if (draft.status === 'syncing') {
    throw new EtsyDraftError('DRAFT_SYNCING', 'Draft is syncing right now — wait for it to finish', { status: 409, key: 'draftSync.draftSyncing' });
  }
  const token = await getEtsyAccessToken(String(draft.etsyShopId), userId);
  const remote = await getListingWithInventory(draft.etsyListingId, token);
  const keepSet = new Set(keep);
  const conflicted = new Set(buildDraftDiff(draft, remote).filter((f) => f.inDraft && f.changedRemotely).map((f) => f.key));
  const fieldPatch: Record<string, unknown> = { ...((draft.fieldPatch as Record<string, unknown>) || {}) };
  for (const key of Object.keys(fieldPatch)) if (conflicted.has(key) && !keepSet.has(key)) delete fieldPatch[key];
  const data: Record<string, unknown> = {
    fieldPatch,
    baseSnapshot: remote,
    baseEtsyUpdatedTimestamp: remote?.updated_timestamp || 0,
    status: 'draft',
    lastSyncError: null,
  };
  for (const [col, key] of Object.entries(PATCH_KEYS)) if (conflicted.has(key) && !keepSet.has(key)) data[col] = null;
  await prisma.etsyListingDraft.update({ where: { id: draft.id }, data: data as any });
  void resolveNotification(userId, notificationKeys.draft(String(draft.id)));
  const cancelled = await cancelDraftIfEmpty(draft.id, userId);
  return { success: true, cancelled };
}
