// components/domain/listing-editor/changeSummary.ts — what is "not sent yet" (listing-editor §5.2 count rule).
// Pure: no React, no fetch. One line per change group (Title, Tags, Photos, Photo order, …) plus one per
// queued state action (publish / deactivate / renew / delete). Drives the footer count, the "Not sent yet"
// list (rail + footer popover) and the section-nav dots.
import {
  FIELD_GROUP,
  GROUP_ORDER,
  GROUP_SECTION,
  sectionForField,
} from '@/lib/listingEditor/sections';
import {
  pendingActions,
  type ChangeGroupKey,
  type ChangeSummary,
  type DraftRow,
  type EditorMode,
  type FieldIssue,
  type FieldMap,
  type FieldValue,
  type SectionId,
} from '@/lib/listingEditor/types';

/** Queued actions that are their own line (state changes). `create_*` ride along with a field change. */
export const STATE_ACTIONS = ['delete', 'deactivate', 'publish', 'renew', 'copy', 'withdraw'] as const;

/** Default change group of a registered section that reports no `changes()`. */
const SECTION_DEFAULT_GROUP: Partial<Record<SectionId, ChangeGroupKey>> = {
  photos: 'photos',
  variations: 'variations',
  personalization: 'personalization',
  details: 'categoryDetails',
  price: 'sku',
  specifics: 'itemSpecifics',
  attributes: 'categoryDetails',
  shipping: 'policies',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Equality
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function isBlank(v: unknown): boolean {
  return v === '' || v === null || v === undefined;
}

/** Numeric-looking value ("12.50", 12.5) → number, else null. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Field equality used for dirty markers and patches: arrays element-wise (order matters: Etsy keeps tag
 * order), blank values ('' / null / undefined) equal each other, and a number equals its decimal string
 * ("12.50" vs 12.5) so a reformatted price is not a change.
 */
export function fieldEquals(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a === b) return true;
  if (isBlank(a) && isBlank(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      const arr = (Array.isArray(a) ? a : b) as readonly unknown[];
      return arr.length === 0 && isBlank(Array.isArray(a) ? b : a);
    }
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === (b as readonly unknown[])[i]);
  }
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return false;
}

/** Keys of `current` (and `base`) whose values differ. `base` null → every non-blank key of `current`. */
export function diffKeys(base: FieldMap | null, current: FieldMap): string[] {
  const keys = new Set<string>([...Object.keys(current), ...(base ? Object.keys(base) : [])]);
  const out: string[] = [];
  keys.forEach((k) => {
    const cur = current[k];
    if (!base) {
      if (!isBlank(cur) && !(Array.isArray(cur) && cur.length === 0)) out.push(k);
      return;
    }
    if (!fieldEquals(base[k], cur)) out.push(k);
  });
  return out;
}

/** Case-insensitive added / removed counts between two string lists (tags, materials). */
export function listDelta(before: readonly string[] | null | undefined, after: readonly string[] | null | undefined) {
  const norm = (s: string) => s.trim().toLowerCase();
  const b = new Set((before ?? []).map(norm));
  const a = new Set((after ?? []).map(norm));
  let added = 0;
  let removed = 0;
  a.forEach((x) => {
    if (!b.has(x)) added += 1;
  });
  b.forEach((x) => {
    if (!a.has(x)) removed += 1;
  });
  return { added, removed };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RegisteredSectionState {
  id: SectionId;
  dirty: boolean;
  changes?: Array<{ group: ChangeGroupKey | null; added?: number; removed?: number }>;
}

export interface ChangeSummaryInput {
  mode: EditorMode;
  /** Values on the marketplace (edit) or the blank workspace (create). */
  remote: FieldMap | null;
  current: FieldMap;
  /** Field keys that differ from `remote` (adapter.changedKeys). Default: `diffKeys(remote, current)`. */
  changedKeys?: string[];
  /** Field keys whose current value is not in the DB draft yet. */
  unsavedKeys?: string[];
  /** Draft `fieldPatch` keys the form has no input for (they still count). */
  extraKeys?: string[];
  draft: DraftRow | null;
  sections?: RegisteredSectionState[];
}

function isEmptyPatch(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Single product with no property values → a SKU / qty edit, otherwise a variations edit. */
function inventoryGroup(patch: unknown): ChangeGroupKey {
  const products = (patch as { products?: unknown })?.products;
  if (Array.isArray(products) && products.length === 1) {
    const pv = (products[0] as { property_values?: unknown })?.property_values;
    if (!Array.isArray(pv) || pv.length === 0) return 'sku';
  }
  return 'variations';
}

function mediaGroup(kind: string, operation: string): ChangeGroupKey | null {
  if (kind === 'video') return 'video';
  if (kind !== 'image') return null;
  if (operation === 'reorder') return 'photoOrder';
  if (operation === 'update_alt') return 'altText';
  // 'ai_upload' (ImageManager / BulkPhotoStudio AI photos) is an upload on the server (UPLOAD_OPERATIONS).
  if (operation === 'upload' || operation === 'ai_upload' || operation === 'delete') return 'photos';
  return null;
}

export function summarizeChanges(input: ChangeSummaryInput): ChangeSummary[] {
  const { remote, current, draft } = input;
  const changed = input.changedKeys ?? diffKeys(remote, current);
  const unsaved = new Set(input.unsavedKeys ?? []);
  const byGroup = new Map<ChangeGroupKey, ChangeSummary>();

  const add = (
    group: ChangeGroupKey,
    source: 'form' | 'draft',
    opts: { field?: string; added?: number; removed?: number; revertable?: boolean } = {},
  ) => {
    const prev = byGroup.get(group);
    if (prev) {
      if (opts.field && !prev.fields.includes(opts.field)) prev.fields.push(opts.field);
      if (source === 'form') prev.source = 'form';
      if (opts.revertable) prev.revertable = true;
      if (opts.added !== undefined) prev.added = (prev.added ?? 0) + opts.added;
      if (opts.removed !== undefined) prev.removed = (prev.removed ?? 0) + opts.removed;
      return;
    }
    byGroup.set(group, {
      id: group,
      kind: 'field',
      group,
      section: GROUP_SECTION[group] ?? null,
      fields: opts.field ? [opts.field] : [],
      added: opts.added,
      removed: opts.removed,
      source,
      revertable: Boolean(opts.revertable),
    });
  };

  // 1. Form fields (edit: vs the marketplace; create: vs blank).
  for (const key of changed) {
    const group = FIELD_GROUP[key];
    if (!group) continue;
    const source = unsaved.has(key) ? 'form' : 'draft';
    if ((key === 'tags' || key === 'materials') && input.mode === 'edit') {
      const d = listDelta(remote?.[key] as readonly string[] | undefined, current[key] as readonly string[] | undefined);
      add(group, source, { field: key, added: d.added, removed: d.removed, revertable: input.mode === 'edit' });
    } else {
      add(group, source, { field: key, revertable: input.mode === 'edit' });
    }
  }

  // 2. Draft-only content (staged by sub-editors, or keys without an input).
  for (const key of input.extraKeys ?? []) {
    const group = FIELD_GROUP[key];
    if (group) add(group, 'draft', { field: key });
  }
  if (draft) {
    if (!isEmptyPatch(draft.taxonomyPatch)) add('categoryDetails', 'draft');
    if (!isEmptyPatch(draft.inventoryPatch)) add(inventoryGroup(draft.inventoryPatch), 'draft');
    if (!isEmptyPatch(draft.variationImagesPatch)) add('variations', 'draft');
    if (draft.personalizationPatch != null && !isEmptyPatch(draft.personalizationPatch)) add('personalization', 'draft');
    for (const m of draft.media ?? []) {
      const group = mediaGroup(String(m.kind), String(m.operation));
      if (group) add(group, 'draft');
    }
  }

  // 3. Registered sections with unsaved edits.
  for (const s of input.sections ?? []) {
    if (!s.dirty) continue;
    const reported = s.changes?.filter((c) => c.group) ?? [];
    if (reported.length) {
      for (const c of reported) add(c.group as ChangeGroupKey, 'form', { added: c.added, removed: c.removed });
    } else {
      const group = SECTION_DEFAULT_GROUP[s.id];
      if (group) add(group, 'form');
    }
  }

  const fields = GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => byGroup.get(g) as ChangeSummary);

  // 4. Queued state actions, one line each (delete first: it is the one that must never be missed).
  const actions: ChangeSummary[] = [];
  const seen = new Set<string>();
  const pending = pendingActions(draft);
  const ordered = [...STATE_ACTIONS].filter((type) => pending.some((a) => a.type === type));
  for (const type of ordered) {
    if (seen.has(type)) continue;
    seen.add(type);
    actions.push({
      id: `action:${type}`,
      kind: 'action',
      group: null,
      action: type,
      section: null,
      fields: [],
      source: 'draft',
      revertable: false,
    });
  }
  const deleteLine = actions.filter((a) => a.action === 'delete');
  return [...deleteLine, ...fields, ...actions.filter((a) => a.action !== 'delete')];
}

/** Number of changes for "Send N changes" / "N edits not sent yet". */
export function changeCount(changes: readonly ChangeSummary[]): number {
  return changes.length;
}

export interface SectionNavState {
  changes: number;
  error: boolean;
}

/** Per-section dot state: `attention` when changes are not sent, `danger` when a block_sync issue exists. */
export function sectionStates(
  changes: readonly ChangeSummary[],
  issues: readonly FieldIssue[],
): Partial<Record<SectionId, SectionNavState>> {
  const out: Partial<Record<SectionId, SectionNavState>> = {};
  const bump = (id: SectionId | null) => {
    if (!id) return null;
    const cur = out[id] ?? { changes: 0, error: false };
    out[id] = cur;
    return cur;
  };
  for (const c of changes) {
    const s = bump(c.section);
    if (s) s.changes += 1;
  }
  for (const i of issues) {
    if (i.severity === 'warn') continue;
    const s = bump(i.section ?? sectionForField(i.field));
    if (s) s.error = true;
  }
  return out;
}
