// components/domain/listings/useStagedChanges.ts — listings-grid §9.4 client staging adapter (G5).
// One interface over the three draft backends: Etsy (`lib/etsy/draftClient`), eBay (`lib/ebay/draftClient`)
// and CatalogDraft (`/api/catalog-drafts`, G4) for Trendyol, Wix and Shopify.
//
// Safety rules (CLAUDE.md "Etsy editing", listings-grid §6.2):
// - Every write STAGES a draft. Nothing here writes live except `send`, and `send` is only ever called from
//   an explicit user action ("Send N changes", "Send this change", "Send deletion…" after type-to-confirm).
// - `sendAll` never sends a draft in `conflict`, a draft with a queued `delete`, a draft that creates a new
//   listing, or a draft that is already `syncing`. Those are counted and returned so the page can say why.
// - A conflict is never forced (`force` is never passed).
import * as React from 'react';
import { discardEtsyDraft, fetchEtsyDrafts, stageEtsyDraft, syncEtsyDraft, syncEtsyDrafts } from '@/lib/etsy/draftClient';
import { discardEbayDraft, fetchEbayDrafts, stageEbayDraft, syncEbayDraft, syncEbayDrafts } from '@/lib/ebay/draftClient';
import {
  discardCatalogDraft,
  fetchCatalogDrafts,
  scheduleDraftSend,
  sendCatalogDrafts,
  stageCatalogDraft,
  type CatalogMarketplace,
  type CatalogQueuedActionType,
  type ScheduleMarketplace,
} from '@/lib/catalogDrafts/client';
import {
  SEND_CHUNK_SIZE,
  type ListingDraftOverlay,
  type ListingMarketplace,
  type ListingRow,
  type SendResult,
  type StagedAction,
  type StagePatch,
  type StageOptions,
  type StagingAdapter,
} from '@/lib/listings/types';
import type { ListingsConfig } from './config/types';

// ─── Adapter ────────────────────────────────────────────────────────────────

/** An open (unsent) draft of the current store, as far as "Send N changes" is concerned. */
export type OpenDraft = {
  draftId: string;
  /** Listing id (`ListingRow.id`). */
  id: string;
  status: 'pending' | 'syncing' | 'sync_failed' | 'conflict';
  queuedDelete: boolean;
  /** Etsy "Not on Etsy yet" drafts (create_listing / copy): sent from the editor, never from "Send N". */
  createsListing: boolean;
};

/**
 * A StagePatch plus `description`, which only the one-time legacy-schedule migration carries (the old Etsy
 * scheduler stored description changes). `StagePatch` itself is G0's contract; adapters that can stage a
 * description say so with `stagesDescription`.
 */
export type ExtendedStagePatch = StagePatch & { description?: string; etsy?: EtsyStageExtras };

/**
 * Etsy-only parts of a staged change that the grid's bulk tools write ("Set field…", variation prices). They go
 * into the same draft as every other edit (`stageEtsyDraft`), so nothing reaches Etsy before an explicit send.
 * `fields` keys are the draft service's `fieldPatch` keys (shipping_profile_id, materials, item_weight…).
 */
export type EtsyStageExtras = {
  fields?: Record<string, unknown>;
  /** `taxonomyPatch` (category details: `{ properties: [...] }`). */
  taxonomy?: Record<string, unknown>;
  /** `inventoryPatch` (whole inventory: `{ products, price_on_property, ... }`). */
  inventory?: Record<string, unknown>;
  /** `personalizationPatch` (`{ personalization_questions: [...] }` or `{ remove: true }`, PersonalizationEditor shape). */
  personalization?: Record<string, unknown>;
};

/** An Etsy draft that creates a listing (not on Etsy yet, or a staged copy to a shop). */
export type NewListingDraft = {
  draftId: string;
  /** Local negative id, the real id of a partly created listing, or the source listing of a copy. */
  listingId: string;
  kind: 'create' | 'copy';
  title: string;
  photoCount: number;
  /** First staged photo (staged file preview or its source URL); null when the draft has none. */
  thumbUrl: string | null;
  /** Real Etsy id when an earlier send created the listing and then failed on a later step. */
  partialId: string | null;
  /** A queued `publish`: the listing goes live when it is sent. */
  willPublish: boolean;
  /** Copy target shop id (`kind: 'copy'`). */
  targetShopId: string | null;
  status: OpenDraft['status'];
  queuedDelete: boolean;
  updatedAt: string | null;
};

export interface ListingsStagingAdapter extends StagingAdapter {
  /** True when `stage` carries `ExtendedStagePatch.description` into the draft (Etsy). */
  stagesDescription?: boolean;
  /** True when `stage` carries `ExtendedStagePatch.etsy` (fields / taxonomy / inventory) into the draft. */
  stagesEtsyExtras?: boolean;
  /** Queued `copy` to another shop (Etsy). */
  stagesCopyToShop?: boolean;
  /** Drafts that create a listing: shown as "not on Etsy yet" on the grid (they have no grid row). */
  listNewListings?(): Promise<NewListingDraft[]>;
  /** Every open draft of the store (all pages, not only the visible rows). */
  listOpen(): Promise<OpenDraft[]>;
  /**
   * Sends ONE draft that carries a queued delete. Only ever called after the type-to-confirm dialog
   * ("Send deletion…", DS §3.6); `send` / "Send N" never include such drafts.
   */
  sendDeletion(draftId: string): Promise<SendResult>;
}

export class StagingError extends Error {
  status: number;
  /** i18n key relative to the `etsy` namespace when the server gave one (draftErrorI18n contract). */
  key?: string;
  params?: Record<string, string | number>;
  constructor(status: number, message: string, key?: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'StagingError';
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : {};
}

function chunk<T>(items: T[], size = SEND_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Pending queued action entries ({ type } without `completedAt`). */
function pendingActionTypes(queued: unknown): string[] {
  return (Array.isArray(queued) ? queued : [])
    .map(asRecord)
    .filter((a) => typeof a.type === 'string' && !a.completedAt)
    .map((a) => String(a.type));
}

/** Raw draft table status → the sync keys "Send N" reasons about; null for closed drafts. */
export function openStatus(raw: unknown): OpenDraft['status'] | null {
  switch (String(raw ?? '').toLowerCase()) {
    case 'draft':
      return 'pending';
    case 'failed':
      return 'sync_failed';
    case 'conflict':
      return 'conflict';
    case 'syncing':
      return 'syncing';
    default:
      return null;
  }
}

/** Normalises any bulk-send response (`/api/etsy-drafts/bulk-sync`, `/api/ebay-drafts/bulk-sync`, `/api/catalog-drafts/send`). */
export function toSendResult(data: unknown, requested: string[]): SendResult {
  const d = asRecord(data);
  const out: SendResult = { sent: [], failed: [], conflicts: [] };
  if (Array.isArray(d.results)) {
    for (const r of d.results.map(asRecord)) {
      const id = String(r.draftId ?? r.id ?? '');
      if (!id) continue;
      const status = String(r.status ?? '');
      if (status === 'success' || status === 'synced' || status === 'sent') out.sent.push(id);
      else if (status === 'conflict') out.conflicts.push(id);
      else if (status === 'deferred') (out.scheduled ||= []).push(id); // over today's Etsy budget: scheduled, not failed
      else if (status === 'syncing' || status === 'pending') continue; // Trendyol async batch: still in flight
      else if (status === 'skipped' && r.reason === 'empty') continue; // nothing left to send: cancelled server-side, not a failure
      else if (status === 'skipped' && r.reason === 'legacy') continue; // eBay listing created on eBay: not sendable from here, not a failure
      else {
        const key = typeof r.errorKey === 'string' ? r.errorKey : typeof r.key === 'string' ? r.key : '';
        const params = r.errorParams ?? r.params;
        out.failed.push({ id, errorKey: key, ...(params && typeof params === 'object' ? { errorParams: params as Record<string, string | number> } : {}) });
      }
    }
    return out;
  }
  // Already in SendResult shape (catalog send may answer that way).
  if (Array.isArray(d.sent) || Array.isArray(d.failed) || Array.isArray(d.conflicts)) {
    out.sent = (Array.isArray(d.sent) ? d.sent : []).map(String);
    out.conflicts = (Array.isArray(d.conflicts) ? d.conflicts : []).map(String);
    out.failed = (Array.isArray(d.failed) ? d.failed : []).map((f) => {
      const r = asRecord(f);
      return { id: String(r.id ?? r.draftId ?? f), errorKey: typeof r.errorKey === 'string' ? r.errorKey : '' };
    });
    return out;
  }
  // Unknown body: report everything as failed rather than claiming success.
  out.failed = requested.map((id) => ({ id, errorKey: '' }));
  return out;
}

function mergeResults(a: SendResult, b: SendResult): SendResult {
  return { sent: [...a.sent, ...b.sent], failed: [...a.failed, ...b.failed], conflicts: [...a.conflicts, ...b.conflicts], scheduled: [...(a.scheduled || []), ...(b.scheduled || [])] };
}

async function sendChunked(draftIds: string[], sendChunk: (ids: string[]) => Promise<unknown>): Promise<SendResult> {
  let acc: SendResult = { sent: [], failed: [], conflicts: [] };
  for (const ids of chunk(draftIds)) {
    try {
      acc = mergeResults(acc, toSendResult(await sendChunk(ids), ids));
    } catch (err) {
      const e = err as { key?: string; params?: Record<string, string | number> };
      acc = mergeResults(acc, { sent: [], conflicts: [], failed: ids.map((id) => ({ id, errorKey: e?.key ?? '', ...(e?.params ? { errorParams: e.params } : {}) })) });
      // A 402 (usage limit) stops the run: the page shows the limit Banner.
      if ((err as { status?: number })?.status === 402) throw err;
    }
  }
  return acc;
}

/** Sets / clears `scheduledSendAt` through G4's `scheduleDraftSend` (all five marketplaces); throws when any failed. */
async function scheduleOrThrow(marketplace: ScheduleMarketplace, draftIds: string[], at: Date | null): Promise<void> {
  const res = await scheduleDraftSend(marketplace, draftIds, at);
  if (res.failed.length) {
    const first = res.failed[0];
    throw new StagingError(409, `Schedule failed for ${res.failed.length} drafts`, first?.key);
  }
}

/** Etsy queued action names (draftService QUEUED_ACTION_TYPES): `activate` is Etsy's `publish`. */
function etsyAction(a: StagedAction): Record<string, unknown> {
  switch (a.type) {
    case 'activate':
      return { type: 'publish' };
    case 'deactivate':
    case 'renew':
    case 'delete':
      return { type: a.type };
    case 'copy':
      return { type: 'copy', targetShopId: a.targetShopId };
    default:
      throw new StagingError(400, `Unsupported Etsy action ${a.type}`);
  }
}

/** "12.5" → "12.50" (eBay's pricingSummary takes a decimal string; never locale-formatted). */
export function twoDecimals(n: number): string {
  const cents = Math.round(n * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** eBay queued actions (lib/ebay/draftService): publish / withdraw / delete. */
function ebayAction(a: StagedAction): Record<string, unknown> {
  switch (a.type) {
    case 'activate':
      return { type: 'publish' };
    case 'deactivate':
      return { type: 'withdraw' };
    case 'delete':
      return { type: 'delete' };
    default:
      throw new StagingError(400, `Unsupported eBay action ${a.type}`);
  }
}

function fromEtsyError(err: unknown): never {
  const e = err as { status?: number; message?: string; key?: string; params?: Record<string, string | number> };
  throw new StagingError(e?.status ?? 500, e?.message ?? 'Stage failed', e?.key, e?.params);
}

/**
 * `lib/ebay/draftClient` throws a plain `Error(data.error || 'HTTP n')` without `status` (BR request: carry
 * status/key like EtsyDraftClientError). Until then a usage-limit 402 is recognised from its message
 * (`withUsageLimiter` answers `{ error: 'Payment Required' }`) so the page shows the inline usage Banner.
 */
export function fromEbayError(err: unknown): StagingError {
  if (err instanceof StagingError) return err;
  const e = err as { status?: number; message?: string } | null;
  const message = typeof e?.message === 'string' ? e.message : 'eBay draft request failed';
  const httpMatch = /^HTTP (\d{3})$/.exec(message);
  const status = typeof e?.status === 'number' ? e.status : message === 'Payment Required' ? 402 : httpMatch ? Number(httpMatch[1]) : 500;
  return new StagingError(status, message);
}

async function ebayCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw fromEbayError(err);
  }
}

export type AdapterContext = {
  marketplace: ListingMarketplace;
  storeId: string | null;
  /** Price currency per listing id (eBay needs it in `pricingSummary.price`). */
  currencyOf?: (id: string) => string | undefined;
};

/** Images a draft adds (upload / AI upload ops, by rank), same rule as the legacy "pending new listings" panel. */
function draftPhotos(media: unknown): AnyRecord[] {
  return (Array.isArray(media) ? media : [])
    .map(asRecord)
    .filter((m) => m.kind === 'image' && (m.operation === 'upload' || m.operation === 'ai_upload'))
    .sort((a, b) => (Number(a.rank ?? 99) || 99) - (Number(b.rank ?? 99) || 99));
}

function photoUrl(m: AnyRecord | undefined): string | null {
  if (!m) return null;
  if (m.localPath && m.id != null) return `/api/etsy-drafts/media-preview?id=${encodeURIComponent(String(m.id))}`;
  return typeof m.sourceUrl === 'string' && /^https:\/\//i.test(m.sourceUrl) ? m.sourceUrl : null;
}

/**
 * Serialised `EtsyListingDraft` → a "not on Etsy yet" entry, or null when the draft does not create a listing
 * (pure, unit-tested). Same classification as `listOpen().createsListing`.
 */
export function toNewListingDraft(raw: unknown): NewListingDraft | null {
  const d = asRecord(raw);
  const status = openStatus(d.status);
  if (!status || d.id == null) return null;
  const pending = (Array.isArray(d.queuedActions) ? d.queuedActions : []).map(asRecord).filter((a) => typeof a.type === 'string' && !a.completedAt);
  const types = pending.map((a) => String(a.type));
  const listingId = Number(d.etsyListingId);
  const local = !(listingId > 0);
  const copy = pending.find((a) => a.type === 'copy');
  const creates = local || types.includes('create_listing');
  if (!creates && !copy) return null;
  const fields = asRecord(d.fieldPatch);
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  const photos = draftPhotos(d.media);
  return {
    draftId: String(d.id),
    listingId: String(d.etsyListingId ?? ''),
    kind: creates ? 'create' : 'copy',
    title,
    photoCount: photos.length,
    thumbUrl: photoUrl(photos[0]),
    partialId: creates && !local ? String(listingId) : null,
    willPublish: types.includes('publish'),
    targetShopId: copy && copy.targetShopId != null ? String(copy.targetShopId) : null,
    status,
    queuedDelete: types.includes('delete'),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
  };
}

/**
 * Serialised `EbayListingDraft` with a pending `create` (editor or CSV "Create new listings") → a "not on eBay yet"
 * entry, else null (pure). These drafts are keyed by a local SKU with no grid row, so this is the only place the grid
 * shows them. `listingId` is empty: they open in create mode (`/new?draft=`), never the edit route.
 */
export function toNewEbayListingDraft(raw: unknown): NewListingDraft | null {
  const d = asRecord(raw);
  const status = openStatus(d.status);
  if (!status || d.id == null) return null;
  const pending = (Array.isArray(d.queuedActions) ? d.queuedActions : []).map(asRecord).filter((a) => typeof a.type === 'string' && !a.completedAt);
  const create = pending.find((a) => a.type === 'create');
  if (!create) return null;
  const product = asRecord(asRecord(d.inventoryPatch).product);
  const title = typeof product.title === 'string' ? product.title.trim() : '';
  const images = (Array.isArray(product.imageUrls) ? product.imageUrls : []).filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u));
  return {
    draftId: String(d.id),
    listingId: '',
    kind: 'create',
    title: title || (typeof d.sku === 'string' ? d.sku : ''),
    photoCount: images.length,
    thumbUrl: images[0] ?? null,
    partialId: null,
    willPublish: create.publish === true,
    targetShopId: null,
    status,
    queuedDelete: pending.some((a) => a.type === 'delete'),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
  };
}

export function etsyAdapter(ctx: AdapterContext): ListingsStagingAdapter {
  const shopId = ctx.storeId ?? '';
  return {
    stagesDescription: true,
    stagesEtsyExtras: true,
    stagesCopyToShop: true,
    async stage(id, patch, opts) {
      const extras = (patch as ExtendedStagePatch).etsy;
      // Extra fields first: the grid's own keys (price, title…) win when both are set.
      const fields: Record<string, unknown> = { ...(extras?.fields ?? {}) };
      if (patch.price !== undefined) fields.price = patch.price;
      if (patch.qty !== undefined) fields.quantity = patch.qty;
      if (patch.title !== undefined) fields.title = patch.title;
      if (patch.tags !== undefined) fields.tags = patch.tags;
      const description = (patch as ExtendedStagePatch).description;
      if (description !== undefined) fields.description = description;
      let draft: AnyRecord;
      try {
        draft = asRecord(
          await stageEtsyDraft({
            shopId,
            listingId: id,
            fields: Object.keys(fields).length ? fields : undefined,
            taxonomy: extras?.taxonomy,
            inventory: extras?.inventory,
            personalization: extras?.personalization,
            queuedActions: opts?.queuedActions?.map(etsyAction),
          }),
        );
      } catch (err) {
        fromEtsyError(err);
      }
      if (opts?.scheduledSendAt !== undefined && typeof draft.id === 'string') {
        await scheduleOrThrow('etsy', [draft.id], opts.scheduledSendAt ? new Date(opts.scheduledSendAt) : null);
      }
    },
    async discard(draftIds) {
      for (const id of draftIds) await discardEtsyDraft(id);
    },
    send(draftIds) {
      return sendChunked(draftIds, (ids) => syncEtsyDrafts(ids));
    },
    async sendDeletion(draftId) {
      return toSendResult({ results: [await syncEtsyDraft(draftId)] }, [draftId]);
    },
    schedule(draftIds, at) {
      return scheduleOrThrow('etsy', draftIds, at);
    },
    async listOpen() {
      if (!shopId) return [];
      const drafts = ((await fetchEtsyDrafts(shopId)) as unknown[]).map(asRecord);
      return drafts.flatMap((d) => {
        const status = openStatus(d.status);
        if (!status) return [];
        const actions = pendingActionTypes(d.queuedActions);
        const listingId = Number(d.etsyListingId);
        return [
          {
            draftId: String(d.id),
            id: String(d.etsyListingId ?? ''),
            status,
            queuedDelete: actions.includes('delete'),
            createsListing: !(listingId > 0) || actions.includes('create_listing') || actions.includes('copy'),
          },
        ];
      });
    },
    async listNewListings() {
      if (!shopId) return [];
      const drafts = (await fetchEtsyDrafts(shopId)) as unknown[];
      return drafts.map(toNewListingDraft).filter((d): d is NewListingDraft => Boolean(d));
    },
  };
}

export function ebayAdapter(ctx: AdapterContext): ListingsStagingAdapter {
  return {
    async stage(id, patch, opts) {
      const inventoryFields: Record<string, unknown> = {};
      const offerFields: Record<string, unknown> = {};
      if (patch.title !== undefined) inventoryFields.product = { title: patch.title.slice(0, 80) };
      if (patch.qty !== undefined) inventoryFields.availability = { shipToLocationAvailability: { quantity: patch.qty } };
      if (patch.price !== undefined) {
        offerFields.pricingSummary = { price: { value: twoDecimals(patch.price), currency: ctx.currencyOf?.(id) ?? 'USD' } };
      }
      const draft = asRecord(
        await ebayCall(() =>
          stageEbayDraft({
            sku: id,
            inventoryFields: Object.keys(inventoryFields).length ? inventoryFields : undefined,
            offerFields: Object.keys(offerFields).length ? offerFields : undefined,
            queuedActions: opts?.queuedActions?.map(ebayAction),
          }),
        ),
      );
      if (opts?.scheduledSendAt !== undefined && typeof draft.id === 'string') {
        await scheduleOrThrow('ebay', [draft.id], opts.scheduledSendAt ? new Date(opts.scheduledSendAt) : null);
      }
    },
    async discard(draftIds) {
      for (const id of draftIds) await ebayCall(() => discardEbayDraft(id));
    },
    send(draftIds) {
      return sendChunked(draftIds, (ids) => ebayCall(() => syncEbayDrafts(ids)));
    },
    async sendDeletion(draftId) {
      return toSendResult({ results: [{ draftId, ...(await ebayCall(() => syncEbayDraft(draftId))) }] }, [draftId]);
    },
    schedule(draftIds, at) {
      return scheduleOrThrow('ebay', draftIds, at);
    },
    async listOpen() {
      const drafts = ((await ebayCall(() => fetchEbayDrafts())) as unknown[]).map(asRecord);
      return drafts.flatMap((d) => {
        const status = openStatus(d.status);
        if (!status) return [];
        const actions = pendingActionTypes(d.queuedActions);
        // A queued `create` (editor / CSV "Create new listings") is a new listing: sent from its editor, never from "Send N".
        return [{ draftId: String(d.id), id: String(d.sku ?? ''), status, queuedDelete: actions.includes('delete'), createsListing: actions.includes('create') }];
      });
    },
    async listNewListings() {
      const drafts = (await ebayCall(() => fetchEbayDrafts())) as unknown[];
      return drafts.map(toNewEbayListingDraft).filter((d): d is NewListingDraft => Boolean(d));
    },
  };
}

/** CatalogDraft (G4, listings-grid §9.4) through `lib/catalogDrafts/client` (import only). */
export function catalogAdapter(ctx: AdapterContext): ListingsStagingAdapter {
  const marketplace = ctx.marketplace as CatalogMarketplace;
  const storeId = ctx.storeId ?? undefined;
  return {
    async stage(id, patch, opts) {
      const fields: { title?: string; price?: number; listPrice?: number; quantity?: number; tags?: string[]; visible?: boolean } = {};
      if (patch.price !== undefined) fields.price = patch.price;
      if (patch.listPrice !== undefined) fields.listPrice = patch.listPrice;
      if (patch.qty !== undefined) fields.quantity = patch.qty;
      if (patch.title !== undefined) fields.title = patch.title;
      if (patch.tags !== undefined) fields.tags = patch.tags;
      const queuedActions: { type: CatalogQueuedActionType }[] = [];
      for (const a of opts?.queuedActions ?? []) {
        if (a.type === 'show') fields.visible = true;
        else if (a.type === 'hide') fields.visible = false;
        else if (a.type === 'archive' || a.type === 'unarchive' || a.type === 'delete') queuedActions.push({ type: a.type });
        else throw new StagingError(400, `Unsupported ${ctx.marketplace} action ${a.type}`);
      }
      try {
        await stageCatalogDraft({
          marketplace,
          storeId,
          externalId: id,
          ...(Object.keys(fields).length ? { fields } : {}),
          ...(queuedActions.length ? { queuedActions } : {}),
          ...(opts?.scheduledSendAt !== undefined ? { scheduledSendAt: opts.scheduledSendAt } : {}),
        });
      } catch (err) {
        fromEtsyError(err);
      }
    },
    async discard(draftIds) {
      for (const id of draftIds) await discardCatalogDraft(id);
    },
    send(draftIds) {
      return sendChunked(draftIds, (ids) => sendCatalogDrafts(ids));
    },
    async sendDeletion(draftId) {
      return toSendResult(await sendCatalogDrafts([draftId], { confirmDeleteIds: [draftId] }), [draftId]);
    },
    async schedule(draftIds, at) {
      await scheduleOrThrow(marketplace, draftIds, at);
    },
    async listOpen() {
      const drafts = await fetchCatalogDrafts({ marketplace, storeId });
      return drafts.flatMap((d) => {
        const status = openStatus(d.status);
        if (!status) return [];
        return [{ draftId: String(d.id), id: String(d.externalId ?? ''), status, queuedDelete: Boolean(d.queuedDelete), createsListing: false }];
      });
    },
  };
}

export function createStagingAdapter(kind: ListingsConfig['drafts'], ctx: AdapterContext): ListingsStagingAdapter {
  if (kind === 'etsy') return etsyAdapter(ctx);
  if (kind === 'ebay') return ebayAdapter(ctx);
  return catalogAdapter(ctx);
}

// ─── "Send N changes" partition (pure, unit-tested) ─────────────────────────

export type SendPlan = {
  /** Drafts "Send N" sends: pending or failed, no queued delete, not a new-listing draft. */
  sendable: OpenDraft[];
  /** Etsy "Not on Etsy yet" drafts: sent from the editor, never from "Send N". */
  newListings: OpenDraft[];
  /** Waiting for "Review differences" (never forced). */
  conflicts: OpenDraft[];
  /** Waiting for "Send deletion…" with type-to-confirm. */
  deletes: OpenDraft[];
  /** Already sending. */
  syncing: OpenDraft[];
};

export function planSend(drafts: OpenDraft[]): SendPlan {
  const plan: SendPlan = { sendable: [], newListings: [], conflicts: [], deletes: [], syncing: [] };
  for (const d of drafts) {
    if (d.createsListing) plan.newListings.push(d);
    else if (d.status === 'syncing') plan.syncing.push(d);
    else if (d.status === 'conflict') plan.conflicts.push(d);
    else if (d.queuedDelete) plan.deletes.push(d);
    else plan.sendable.push(d);
  }
  return plan;
}

/** Rows whose draft can be sent by "Send this change" / "Send selected changes" (same exclusions as Send N). */
export function sendableDraftIds(rows: ListingRow[]): string[] {
  return rows
    .filter((r) => r.sync && (r.sync.status === 'pending' || r.sync.status === 'sync_failed') && !r.sync.queuedDelete)
    .map((r) => r.sync!.draftId);
}

/** Merges a staged patch into the overlay shown before the refetch lands (§8 "Optimistic staging"). */
export function mergeOverlay(prev: ListingDraftOverlay | undefined, patch: StagePatch): ListingDraftOverlay {
  const next: ListingDraftOverlay = { ...(prev ?? {}) };
  if (patch.price !== undefined) next.price = patch.price;
  if (patch.qty !== undefined) next.qty = patch.qty;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.listPrice !== undefined) next.listPrice = patch.listPrice;
  return next;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export type SendOutcome = SendResult & {
  /** Drafts left out of "Send N" and why (for the confirm and the toast). */
  skipped: { conflicts: number; deletes: number };
};

export type UseStagedChanges = {
  adapter: ListingsStagingAdapter;
  /** Local overlays per listing id until the refetch shows the staged draft. */
  overlays: ReadonlyMap<string, ListingDraftOverlay>;
  /** Listing ids currently being sent from this tab. */
  sendingIds: ReadonlySet<string>;
  sending: boolean;
  /** Stages a patch with an optimistic overlay; reverts and rethrows on error. */
  stage(id: string, patch: StagePatch, opts?: StageOptions): Promise<void>;
  /** Stages queued actions (deactivate, renew, delete…) for many listings; returns ids that failed. */
  stageActions(ids: string[], action: StagedAction): Promise<{ ok: string[]; failed: string[] }>;
  /** Stages one patch per listing (bulk modals); returns ids that failed. */
  stageMany(patches: Array<{ id: string; patch: StagePatch }>, onProgress?: (done: number, total: number) => void): Promise<{ ok: string[]; failed: string[] }>;
  discard(draftIds: string[]): Promise<void>;
  /** Sends one queued deletion (after type-to-confirm only). */
  sendDeletion(draft: { draftId: string; id: string }): Promise<SendResult>;
  /** Plan for "Send N" over every open draft of the store. */
  planAll(): Promise<SendPlan>;
  /** Sends the given drafts (already filtered by the caller or by `planAll`). */
  send(drafts: Array<{ draftId: string; id: string }>): Promise<SendResult>;
  schedule(draftIds: string[], at: Date | null): Promise<void>;
};

export type UseStagedChangesOptions = {
  config: Pick<ListingsConfig, 'drafts' | 'marketplace'>;
  storeId: string | null;
  /** Current rows (currency lookup for eBay prices). */
  rows: ListingRow[];
  /** Revalidates the list (DB-only); called after every successful write. */
  onChanged: () => Promise<unknown> | void;
  /** Test seam. */
  adapter?: ListingsStagingAdapter;
};

const STAGE_CONCURRENCY = 4;

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, onDone?: () => void): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(STAGE_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
      onDone?.();
    }
  });
  await Promise.all(lanes);
}

export function useStagedChanges({ config, storeId, rows, onChanged, adapter: injected }: UseStagedChangesOptions): UseStagedChanges {
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const onChangedRef = React.useRef(onChanged);
  onChangedRef.current = onChanged;

  const adapter = React.useMemo<ListingsStagingAdapter>(
    () =>
      injected ??
      createStagingAdapter(config.drafts, {
        marketplace: config.marketplace,
        storeId,
        currencyOf: (id) => rowsRef.current.find((r) => r.id === id)?.price?.currency,
      }),
    [injected, config.drafts, config.marketplace, storeId],
  );

  const [overlays, setOverlays] = React.useState<Map<string, ListingDraftOverlay>>(() => new Map());
  const overlaysRef = React.useRef(overlays);
  overlaysRef.current = overlays;
  const [sendingIds, setSendingIds] = React.useState<Set<string>>(() => new Set());

  // An overlay is dropped once the refetched row carries the same draft values.
  React.useEffect(() => {
    if (!overlays.size) return;
    let changed = false;
    const next = new Map(overlays);
    for (const [id, o] of overlays) {
      const d = rows.find((r) => r.id === id)?.sync?.draft;
      if (!d) continue;
      const settled =
        (o.price === undefined || d.price === o.price) && (o.qty === undefined || d.qty === o.qty) && (o.title === undefined || d.title === o.title);
      if (settled) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) setOverlays(next);
  }, [rows, overlays]);

  const refresh = React.useCallback(async () => {
    try {
      await onChangedRef.current();
    } catch {
      /* the list shows its own stale state */
    }
  }, []);

  const stage = React.useCallback(
    async (id: string, patch: StagePatch, opts?: StageOptions) => {
      const before = overlaysRef.current.get(id);
      setOverlays((prev) => {
        const next = new Map(prev);
        next.set(id, mergeOverlay(prev.get(id), patch));
        return next;
      });
      try {
        await adapter.stage(id, patch, opts);
      } catch (err) {
        setOverlays((prev) => {
          const next = new Map(prev);
          if (before) next.set(id, before);
          else next.delete(id);
          return next;
        });
        throw err;
      }
      await refresh();
    },
    [adapter, refresh],
  );

  const stageMany = React.useCallback(
    async (patches: Array<{ id: string; patch: StagePatch }>, onProgress?: (done: number, total: number) => void) => {
      const ok: string[] = [];
      const failed: string[] = [];
      let done = 0;
      await runPool(
        patches,
        async ({ id, patch }) => {
          try {
            await adapter.stage(id, patch);
            ok.push(id);
          } catch {
            failed.push(id);
          }
        },
        () => onProgress?.(++done, patches.length),
      );
      await refresh();
      return { ok, failed };
    },
    [adapter, refresh],
  );

  const stageActions = React.useCallback(
    async (ids: string[], action: StagedAction) => {
      const ok: string[] = [];
      const failed: string[] = [];
      await runPool(ids, async (id) => {
        try {
          await adapter.stage(id, {}, { queuedActions: [action] });
          ok.push(id);
        } catch {
          failed.push(id);
        }
      });
      await refresh();
      return { ok, failed };
    },
    [adapter, refresh],
  );

  const discard = React.useCallback(
    async (draftIds: string[]) => {
      await adapter.discard(draftIds);
      await refresh();
    },
    [adapter, refresh],
  );

  const planAll = React.useCallback(async () => planSend(await adapter.listOpen()), [adapter]);

  const send = React.useCallback(
    async (drafts: Array<{ draftId: string; id: string }>) => {
      const ids = new Set(drafts.map((d) => d.id));
      setSendingIds((prev) => new Set([...prev, ...ids]));
      try {
        return await adapter.send(drafts.map((d) => d.draftId));
      } finally {
        setSendingIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        await refresh();
      }
    },
    [adapter, refresh],
  );

  const sendDeletion = React.useCallback(
    async (draft: { draftId: string; id: string }) => {
      setSendingIds((prev) => new Set([...prev, draft.id]));
      try {
        return await adapter.sendDeletion(draft.draftId);
      } finally {
        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(draft.id);
          return next;
        });
        await refresh();
      }
    },
    [adapter, refresh],
  );

  const schedule = React.useCallback(
    async (draftIds: string[], at: Date | null) => {
      await adapter.schedule(draftIds, at);
      await refresh();
    },
    [adapter, refresh],
  );

  return {
    adapter,
    overlays,
    sendingIds,
    sending: sendingIds.size > 0,
    stage,
    stageActions,
    stageMany,
    discard,
    sendDeletion,
    planAll,
    send,
    schedule,
  };
}

export default useStagedChanges;
