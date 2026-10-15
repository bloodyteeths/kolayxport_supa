// components/domain/bulk/useSessionEdits.ts — bulk-grid §6.3 Revert and §6.4 Discard all edits (M7-C).
//
// - `useSessionEdits` remembers which fields THIS session changed per row, so "Discard all edits" reverts only
//   those; drafts that existed before the session keep their earlier patches. When a field already had an unsent
//   value before the session, its first edit records that value (`Baseline`) and Discard all restores it instead
//   of dropping the field. A pre-session value the grid can't read (`unknown`) is never guessed: that edit is kept.
// - `revertDraftFields` rewrites one listing's draft without the given fields. The draft clients merge patches,
//   so a revert re-reads the draft first (edits made elsewhere are kept) and writes the whole remaining patch with
//   `replaceFields: true`; when nothing is left (no fields, inventory, taxonomy, media, personalization or queued
//   actions) the draft is discarded instead. A draft that is `syncing` is never touched.
//
// Safety: nothing here sends. A queued action (including a queued delete) is never removed or added by a revert:
// a draft with queued actions is rewritten, never discarded.
import * as React from 'react';
import { discardEtsyDraft, fetchEtsyDrafts, stageEtsyDraft } from '@/lib/etsy/draftClient';
import { discardEbayDraft, fetchEbayDrafts, stageEbayDraft } from '@/lib/ebay/draftClient';
import { discardCatalogDraft, fetchCatalogDrafts, stageCatalogDraft, type CatalogMarketplace } from '@/lib/catalogDrafts/client';
import type { ListingMarketplace } from '@/lib/listings/types';
import { BULK_FIELDS, type BulkField, type BulkTransportKind } from './config/types';
import { twoDecimals } from '@/components/domain/listings/useStagedChanges';
import { cellKeyOf, ETSY_FIELD_KEY } from './config/fields';

// ─── Session edits ──────────────────────────────────────────────────────────

export type SessionEdits = ReadonlyMap<string, ReadonlySet<BulkField>>;

export function addSessionEdits(prev: SessionEdits, patches: Array<{ rowId: string; field: BulkField }>): SessionEdits {
  if (!patches.length) return prev;
  const next = new Map(prev);
  for (const p of patches) {
    const set = new Set(next.get(p.rowId) ?? []);
    set.add(p.field);
    next.set(p.rowId, set);
  }
  return next;
}

export function removeSessionEdits(prev: SessionEdits, rowId: string, fields?: readonly BulkField[]): SessionEdits {
  const cur = prev.get(rowId);
  if (!cur) return prev;
  const next = new Map(prev);
  if (!fields) {
    next.delete(rowId);
    return next;
  }
  const set = new Set(cur);
  fields.forEach((f) => set.delete(f));
  if (set.size) next.set(rowId, set);
  else next.delete(rowId);
  return next;
}

export function countSessionEdits(edits: SessionEdits): { listings: number; edits: number } {
  let n = 0;
  edits.forEach((s) => (n += s.size));
  return { listings: edits.size, edits: n };
}

/**
 * The unsent value a field had in the listing's draft before this session first edited it. `none` = the draft did
 * not change that field (Discard all drops it); `unknown` = it did, but the value isn't readable from the row.
 */
export type Baseline = { kind: 'none' } | { kind: 'value'; value: unknown } | { kind: 'unknown' };

/** What Discard all does with this session's edits (pure). */
export function planDiscard(
  edits: SessionEdits,
  baselineOf: (rowId: string, field: BulkField) => Baseline,
): { cells: Array<{ rowId: string; field: BulkField }>; restore: Map<string, Partial<Record<BulkField, unknown>>>; kept: Array<{ rowId: string; field: BulkField }> } {
  const cells: Array<{ rowId: string; field: BulkField }> = [];
  const kept: Array<{ rowId: string; field: BulkField }> = [];
  const restore = new Map<string, Partial<Record<BulkField, unknown>>>();
  edits.forEach((fields, rowId) =>
    fields.forEach((field) => {
      const b = baselineOf(rowId, field);
      if (b.kind === 'unknown') {
        kept.push({ rowId, field });
        return;
      }
      cells.push({ rowId, field });
      if (b.kind === 'value') restore.set(rowId, { ...(restore.get(rowId) ?? {}), [field]: b.value });
    }),
  );
  return { cells, restore, kept };
}

export type UseSessionEdits = {
  edits: SessionEdits;
  counts: { listings: number; edits: number };
  /** `baselineOf` is read once per cell, on its first edit in this session. */
  record(patches: Array<{ rowId: string; field: BulkField }>, baselineOf?: (rowId: string, field: BulkField) => Baseline): void;
  forget(rowId: string, fields?: readonly BulkField[]): void;
  /** The pre-session value of a cell this session edited (`none` when it had none or was never recorded). */
  baseline(rowId: string, field: BulkField): Baseline;
  clear(): void;
};

const NONE: Baseline = { kind: 'none' };

export function useSessionEdits(): UseSessionEdits {
  const [edits, setEdits] = React.useState<SessionEdits>(() => new Map());
  const baselines = React.useRef(new Map<string, Baseline>());
  const record = React.useCallback(
    (patches: Array<{ rowId: string; field: BulkField }>, baselineOf?: (rowId: string, field: BulkField) => Baseline) => {
      for (const p of patches) {
        const key = cellKeyOf(p.rowId, p.field);
        if (!baselines.current.has(key)) baselines.current.set(key, baselineOf?.(p.rowId, p.field) ?? NONE);
      }
      setEdits((prev) => addSessionEdits(prev, patches));
    },
    [],
  );
  const forget = React.useCallback((rowId: string, fields?: readonly BulkField[]) => {
    for (const f of fields ?? BULK_FIELDS) baselines.current.delete(cellKeyOf(rowId, f));
    setEdits((prev) => removeSessionEdits(prev, rowId, fields));
  }, []);
  const baseline = React.useCallback((rowId: string, field: BulkField) => baselines.current.get(cellKeyOf(rowId, field)) ?? NONE, []);
  const clear = React.useCallback(() => {
    baselines.current.clear();
    setEdits(new Map());
  }, []);
  const counts = React.useMemo(() => countSessionEdits(edits), [edits]);
  return { edits, counts, record, forget, baseline, clear };
}

// ─── Remaining patch after a revert (pure) ──────────────────────────────────

type AnyRecord = Record<string, unknown>;

function rec(v: unknown): AnyRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : {};
}

function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as AnyRecord).length > 0;
  return true;
}

/** Queued actions not yet completed (a `delete` among them must never be dropped by a revert). */
export function pendingActions(queued: unknown): AnyRecord[] {
  return (Array.isArray(queued) ? queued : []).map(rec).filter((a) => typeof a.type === 'string' && !a.completedAt);
}

const OPEN = new Set(['draft', 'failed', 'conflict']);

export type RevertPlan = { kind: 'none' } | { kind: 'discard'; draftId: string } | { kind: 'rewrite'; draftId: string; patch: AnyRecord };

/** Pre-session values to put back instead of dropping the field (Discard all, see `Baseline`). */
export type RestoreValues = Partial<Record<BulkField, unknown>>;

const has = (restore: RestoreValues | undefined, f: BulkField) => Boolean(restore && Object.prototype.hasOwnProperty.call(restore, f));

/** Etsy: the draft minus the reverted `fieldPatch` keys (or with their pre-session values restored). */
export function planEtsyRevert(draft: unknown, fields: readonly BulkField[], restore?: RestoreValues): RevertPlan {
  const d = rec(draft);
  if (!d.id || !OPEN.has(String(d.status))) return { kind: 'none' };
  const fieldPatch = { ...rec(d.fieldPatch) };
  const keys = fields.map((f) => ETSY_FIELD_KEY[f]);
  if (!keys.some((k) => k in fieldPatch)) return { kind: 'none' };
  fields.forEach((f) => {
    if (has(restore, f)) {
      const v = restore![f];
      fieldPatch[ETSY_FIELD_KEY[f]] = f === 'section' && v !== null ? Number(v) : v;
    } else delete fieldPatch[ETSY_FIELD_KEY[f]];
  });
  const others =
    hasContent(d.taxonomyPatch) ||
    hasContent(d.inventoryPatch) ||
    hasContent(d.variationImagesPatch) ||
    hasContent(d.personalizationPatch) ||
    hasContent(d.media) ||
    pendingActions(d.queuedActions).length > 0;
  if (!Object.keys(fieldPatch).length && !others) return { kind: 'discard', draftId: String(d.id) };
  return { kind: 'rewrite', draftId: String(d.id), patch: { fields: fieldPatch } };
}

/** eBay: title / quantity live in `inventoryPatch`, price in `offerPatch.pricingSummary`. */
export function planEbayRevert(draft: unknown, fields: readonly BulkField[], restore?: RestoreValues): RevertPlan {
  const d = rec(draft);
  if (!d.id || !OPEN.has(String(d.status))) return { kind: 'none' };
  const inventory = { ...rec(d.inventoryPatch) };
  const offer = { ...rec(d.offerPatch) };
  let touched = false;
  if (fields.includes('title') && 'product' in inventory) {
    const product = { ...rec(inventory.product) };
    if ('title' in product) {
      if (has(restore, 'title')) product.title = restore!.title;
      else delete product.title;
      touched = true;
      if (Object.keys(product).length) inventory.product = product;
      else delete inventory.product;
    }
  }
  if (fields.includes('qty') && 'availability' in inventory) {
    if (has(restore, 'qty')) {
      const availability = rec(inventory.availability);
      inventory.availability = { ...availability, shipToLocationAvailability: { ...rec(availability.shipToLocationAvailability), quantity: restore!.qty } };
    } else delete inventory.availability;
    touched = true;
  }
  if (fields.includes('price') && 'pricingSummary' in offer) {
    if (has(restore, 'price') && typeof restore!.price === 'number') {
      const pricing = rec(offer.pricingSummary);
      offer.pricingSummary = { ...pricing, price: { ...rec(pricing.price), value: twoDecimals(restore!.price) } };
    } else delete offer.pricingSummary;
    touched = true;
  }
  if (!touched) return { kind: 'none' };
  const others = hasContent(d.variationPatch) || hasContent(d.media) || pendingActions(d.queuedActions).length > 0;
  if (!Object.keys(inventory).length && !Object.keys(offer).length && !others) return { kind: 'discard', draftId: String(d.id) };
  return { kind: 'rewrite', draftId: String(d.id), patch: { inventoryFields: inventory, offerFields: offer } };
}

/** CatalogDraft: `fields: { key: null }` drops a field; an empty draft without queued actions is discarded. */
export function planCatalogRevert(draft: unknown, fields: readonly BulkField[], restore?: RestoreValues): RevertPlan {
  const d = rec(draft);
  if (!d.id || !OPEN.has(String(d.status))) return { kind: 'none' };
  const fp = { ...rec(d.fieldPatch) };
  const keyOf = (f: BulkField) => (f === 'qty' ? 'quantity' : f);
  const touched = fields.filter((f) => keyOf(f) in fp);
  if (!touched.length) return { kind: 'none' };
  const patch: AnyRecord = {};
  touched.forEach((f) => {
    const k = keyOf(f);
    if (has(restore, f)) fp[k] = patch[k] = restore![f];
    else {
      delete fp[k];
      patch[k] = null;
    }
  });
  const queued = pendingActions(d.queuedActions).length > 0 || d.queuedDelete === true;
  if (!Object.keys(fp).length && !queued) return { kind: 'discard', draftId: String(d.id) };
  return { kind: 'rewrite', draftId: String(d.id), patch: { fields: patch } };
}

// ─── Revert (I/O through the draft clients; injectable for tests) ───────────

export type RevertDeps = {
  etsy: { fetch: typeof fetchEtsyDrafts; stage: typeof stageEtsyDraft; discard: typeof discardEtsyDraft };
  ebay: { fetch: typeof fetchEbayDrafts; stage: typeof stageEbayDraft; discard: typeof discardEbayDraft };
  catalog: { fetch: typeof fetchCatalogDrafts; stage: typeof stageCatalogDraft; discard: typeof discardCatalogDraft };
};

export const defaultRevertDeps: RevertDeps = {
  etsy: { fetch: fetchEtsyDrafts, stage: stageEtsyDraft, discard: discardEtsyDraft },
  ebay: { fetch: fetchEbayDrafts, stage: stageEbayDraft, discard: discardEbayDraft },
  catalog: { fetch: fetchCatalogDrafts, stage: stageCatalogDraft, discard: discardCatalogDraft },
};

export type RevertContext = { kind: BulkTransportKind; marketplace: ListingMarketplace; storeId: string | null };

export type RevertOutcome = 'none' | 'discarded' | 'rewritten';

function openDraft(drafts: unknown[], match: (d: AnyRecord) => boolean): AnyRecord | null {
  return drafts.map(rec).find((d) => match(d) && OPEN.has(String(d.status))) ?? null;
}

/** Rewrites (or discards) one listing's draft without `fields`. Throws on a failed request. */
export async function revertDraftFields(
  ctx: RevertContext,
  rowId: string,
  fields: readonly BulkField[],
  deps: RevertDeps = defaultRevertDeps,
  restore?: RestoreValues,
): Promise<RevertOutcome> {
  if (!fields.length) return 'none';
  if (ctx.kind === 'etsy') {
    const shopId = ctx.storeId ?? '';
    const draft = openDraft((await deps.etsy.fetch(shopId, rowId)) as unknown[], (d) => String(d.etsyListingId) === rowId);
    const plan = planEtsyRevert(draft, fields, restore);
    if (plan.kind === 'none') return 'none';
    if (plan.kind === 'discard') {
      await deps.etsy.discard(plan.draftId);
      return 'discarded';
    }
    await deps.etsy.stage({ shopId, listingId: rowId, fields: plan.patch.fields as Record<string, unknown>, replaceFields: true });
    return 'rewritten';
  }
  if (ctx.kind === 'ebay') {
    const draft = openDraft((await deps.ebay.fetch(rowId)) as unknown[], (d) => String(d.sku) === rowId);
    const plan = planEbayRevert(draft, fields, restore);
    if (plan.kind === 'none') return 'none';
    if (plan.kind === 'discard') {
      await deps.ebay.discard(plan.draftId);
      return 'discarded';
    }
    await deps.ebay.stage({
      sku: rowId,
      inventoryFields: plan.patch.inventoryFields as Record<string, unknown>,
      offerFields: plan.patch.offerFields as Record<string, unknown>,
      replaceFields: true,
      preserveConflict: true,
    });
    return 'rewritten';
  }
  const marketplace = ctx.marketplace as CatalogMarketplace;
  const storeId = ctx.storeId ?? undefined;
  const drafts = await deps.catalog.fetch({ marketplace, storeId, ids: [rowId] });
  const draft = openDraft(drafts as unknown[], (d) => String(d.externalId) === rowId);
  const plan = planCatalogRevert(draft, fields, restore);
  if (plan.kind === 'none') return 'none';
  if (plan.kind === 'discard') {
    await deps.catalog.discard(plan.draftId);
    return 'discarded';
  }
  await deps.catalog.stage({
    marketplace,
    storeId,
    externalId: rowId,
    fields: plan.patch.fields as Parameters<typeof stageCatalogDraft>[0]['fields'],
  });
  return 'rewritten';
}
