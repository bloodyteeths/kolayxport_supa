// components/domain/listings/bulk/templatePlan.ts — applying a saved bulk-edit template (lib/bulk/editorTemplates.ts)
// to selected listings (pure). Each step goes through the same helpers as the dialog it was saved from, so a
// template stages exactly what running those dialogs one after another would: Change price (computeNewPrice;
// variation listings are handed back for the variation-price path), Tags (applyTags), Set field
// (buildSetFieldPatch, materials add/remove, description before/after). Steps chain on a per-listing working
// copy (two tag steps, or a description replaced then appended, compose). Listings with an unsent change to a
// field that needs its current value are skipped for that step, like the dialogs do.
import type { TemplateStep } from '@/lib/bulk/editorTemplates';
import type { ListingRow } from '@/lib/listings/types';
import type { ExtendedStagePatch } from '../useStagedChanges';
import { computeNewPrice, type PriceMode, type PriceRound } from './ChangePriceModal';
import { applyTags, type TagMode } from './AddTagsModal';
import {
  applyDescriptionMode,
  applyMaterialsMode,
  buildSetFieldPatch,
  setFieldStagePatch,
  setFieldTargets,
  type SetFieldKey,
  type SetFieldValue,
} from './SetFieldModal';

export interface TemplateNeeds {
  tags: boolean;
  materials: boolean;
  descriptions: boolean;
}

/** Which current values the template needs before planning (pure). */
export function templateNeeds(steps: TemplateStep[]): TemplateNeeds {
  const needs: TemplateNeeds = { tags: false, materials: false, descriptions: false };
  for (const s of steps) {
    if (s.kind === 'tags' && s.mode !== 'replace') needs.tags = true;
    if (s.kind === 'field' && s.key === 'materials' && (s.value.materialsMode === 'add' || s.value.materialsMode === 'remove')) needs.materials = true;
    if (s.kind === 'field' && s.key === 'description' && (s.value.descriptionMode === 'prepend' || s.value.descriptionMode === 'append')) needs.descriptions = true;
  }
  return needs;
}

export interface TemplatePlanContext {
  currentPrice: (r: ListingRow) => number | null;
  priceMin?: number;
  tagMax: number | null;
  tags?: Map<string, string[] | null>;
  materials?: Map<string, string[] | null>;
  descriptions?: Map<string, string | null>;
}

export interface TemplatePlan {
  patches: Array<{ id: string; patch: ExtendedStagePatch }>;
  /** Listings with variations that the price step applies to through the variation-price path. */
  variationPriceRows: ListingRow[];
  /** The price step to run on `variationPriceRows` (null when the template has none). */
  priceStep: Extract<TemplateStep, { kind: 'price' }> | null;
  /** Listings where at least one step could not apply (unknown current value, unsent change, invalid result). */
  skipped: number;
  /** Listings removed from the run because a deletion is queued on them. */
  excludedRemovals: number;
  /** Listings where some tags were not added because the listing is at the tag limit. */
  tagsOverLimit: number;
}

function mergePatch(a: ExtendedStagePatch, b: ExtendedStagePatch): ExtendedStagePatch {
  const out: ExtendedStagePatch = { ...a, ...b };
  if (a.etsy || b.etsy) {
    out.etsy = { ...(a.etsy ?? {}), ...(b.etsy ?? {}) };
    if (a.etsy?.fields || b.etsy?.fields) out.etsy.fields = { ...(a.etsy?.fields ?? {}), ...(b.etsy?.fields ?? {}) };
  }
  return out;
}

const unsent = (r: ListingRow, field: string) => Boolean(r.sync && r.sync.status !== 'synced' && r.sync.changedFields.includes(field));

export function planTemplate(rows: ListingRow[], steps: TemplateStep[], ctx: TemplatePlanContext): TemplatePlan {
  const targets = setFieldTargets(rows);
  const priceStep = (steps.find((s) => s.kind === 'price') as TemplatePlan['priceStep']) ?? null;
  const patches: TemplatePlan['patches'] = [];
  const variationPriceRows: ListingRow[] = [];
  let skipped = 0;
  let tagsOverLimit = 0;

  for (const r of targets) {
    let patch: ExtendedStagePatch = {};
    let missed = false;
    let tags: string[] | null | undefined;
    let tagsBefore: string[] | null = null;
    let overLimit = false;
    let materials: string[] | null | undefined;
    let description: string | null | undefined;

    for (const s of steps) {
      if (s.kind === 'price') {
        if (!r.editable.price) {
          variationPriceRows.push(r);
          continue;
        }
        const cur = ctx.currentPrice(r);
        const next = cur === null ? null : computeNewPrice(cur, s.mode as PriceMode, s.value, s.round as PriceRound);
        if (next === null || (ctx.priceMin !== undefined && next < ctx.priceMin)) missed = true;
        else if (next !== cur) patch = mergePatch(patch, { price: next });
        continue;
      }
      if (s.kind === 'tags') {
        if (tags === undefined) {
          tags = s.mode === 'replace' ? [] : unsent(r, 'tags') ? null : (ctx.tags?.get(r.id) ?? null);
          tagsBefore = s.mode === 'replace' ? (ctx.tags?.get(r.id) ?? null) : tags;
        }
        if (tags === null) {
          missed = true;
          continue;
        }
        const res = applyTags(tags, s.tags, s.mode as TagMode, ctx.tagMax);
        if (res.overLimit) overLimit = true;
        tags = res.next;
        patch = mergePatch(patch, { tags: res.next });
        continue;
      }
      // Set field
      const key = s.key as SetFieldKey;
      const value = s.value as SetFieldValue;
      if (key === 'materials' && (value.materialsMode === 'add' || value.materialsMode === 'remove')) {
        if (materials === undefined) materials = unsent(r, 'materials') ? null : (ctx.materials?.get(r.id) ?? null);
        if (materials === null) {
          missed = true;
          continue;
        }
        const next = applyMaterialsMode(materials, value.materials ?? [], value.materialsMode);
        if (next) {
          materials = next;
          patch = mergePatch(patch, { etsy: { fields: { materials: next } } });
        }
        continue;
      }
      if (key === 'description' && (value.descriptionMode === 'prepend' || value.descriptionMode === 'append')) {
        if (description === undefined) description = unsent(r, 'description') ? null : (ctx.descriptions?.get(r.id) ?? null);
        const next = description === null ? null : applyDescriptionMode(description, value.description ?? '', value.descriptionMode);
        if (next === null) {
          missed = true;
          continue;
        }
        description = next;
        patch = mergePatch(patch, { description: next });
        continue;
      }
      const built = buildSetFieldPatch(key, value);
      if (!built) {
        missed = true;
        continue;
      }
      if (key === 'materials') materials = (built.materials as string[]) ?? materials;
      if (key === 'description') description = String(built.description ?? '');
      patch = mergePatch(patch, setFieldStagePatch(key, built));
    }
    // Tags that end where they started are not staged (the dialog's planTagChanges rule).
    if (patch.tags && tagsBefore && patch.tags.length === tagsBefore.length && patch.tags.every((x, i) => x.toLocaleLowerCase() === tagsBefore![i].toLocaleLowerCase())) {
      const { tags: _same, ...rest } = patch;
      patch = rest;
    }
    if (overLimit) tagsOverLimit += 1;
    if (missed) skipped += 1;
    if (Object.keys(patch).length) patches.push({ id: r.id, patch });
  }
  return { patches, variationPriceRows, priceStep, skipped, excludedRemovals: rows.length - targets.length, tagsOverLimit };
}
