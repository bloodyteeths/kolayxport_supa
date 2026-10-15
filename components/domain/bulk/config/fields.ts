// components/domain/bulk/config/fields.ts — per-field rules of the bulk grid (bulk-grid §1.2, §5.3 step 7, §6.1).
// Pure: live/draft values, read-only reasons, validation (invalid values stay local, never staged) and the
// mapping between draft patch keys and grid fields. No React, no fetch.
import { decodeEntities } from '@/lib/text/decodeEntities';
import { validateEtsyFieldPatch } from '@/lib/etsy/validation';
import { MARKETPLACE_NAME } from '@/components/domain/listings/config';
import { validatePrice, validateQty, type ListingsT } from '@/components/domain/listings/columns';
import type { ListingRow } from '@/lib/listings/types';
import type { BulkConfig, BulkField } from './types';

export type CellKey = `${string}:${string}`;

export const cellKeyOf = (rowId: string, field: string): CellKey => `${rowId}:${field}`;

export function splitCellKey(key: string): { rowId: string; field: string } {
  const i = key.lastIndexOf(':');
  return { rowId: key.slice(0, i), field: key.slice(i + 1) };
}

/** Draft patch key (Etsy `fieldPatch`, overlay `changedFields`) → grid field; null for keys the grid can't show. */
export function draftKeyToField(key: string): BulkField | null {
  switch (key) {
    case 'title':
      return 'title';
    case 'price':
      return 'price';
    case 'quantity':
    case 'qty':
      return 'qty';
    case 'shop_section_id':
    case 'section':
      return 'section';
    case 'tags':
      return 'tags';
    default:
      return null;
  }
}

/** Etsy `fieldPatch` key of each grid field (also the server's revert key). */
export const ETSY_FIELD_KEY: Record<BulkField, string> = {
  title: 'title',
  price: 'price',
  qty: 'quantity',
  section: 'shop_section_id',
  tags: 'tags',
};

/** True while the row's draft is open (not synced). */
export function hasOpenDraft(row: ListingRow): boolean {
  return Boolean(row.sync && row.sync.status !== 'synced');
}

/** Live value of a field (what the marketplace has, per the DB cache). */
export function liveValue(row: ListingRow, field: BulkField): unknown {
  switch (field) {
    case 'title':
      return row.title;
    case 'price':
      return row.price?.amount ?? null;
    case 'qty':
      return row.qty;
    case 'section': {
      const v = row.extra.section;
      return v === null || v === undefined || v === '' ? null : String(v);
    }
    default:
      return undefined;
  }
}

/** Value the row's open server draft holds for a field (overlay values only: title, price, qty). */
export function serverDraftValue(row: ListingRow, field: BulkField): unknown {
  if (!hasOpenDraft(row)) return undefined;
  const d = row.sync!.draft;
  if (field === 'title') return d.title;
  if (field === 'price') return d.price;
  if (field === 'qty') return d.qty;
  return undefined;
}

/** Grid fields the row's open server draft changes (from `sync.changedFields`). */
export function serverDirtyFields(row: ListingRow, fields: readonly BulkField[]): BulkField[] {
  if (!hasOpenDraft(row)) return [];
  const out = new Set<BulkField>();
  for (const k of row.sync!.changedFields) {
    const f = draftKeyToField(k);
    if (f && fields.includes(f)) out.add(f);
  }
  return Array.from(out);
}

export type FieldRuleContext = {
  config: Pick<BulkConfig, 'marketplace' | 'listings' | 'fields' | 'titleMax'>;
  t: ListingsT;
  formatMoney(amount: number, currency: string): string;
  /** Listing ids currently being sent from this tab. */
  sendingIds: ReadonlySet<string>;
  /** Known section ids (Etsy); undefined = not loaded, any id accepted. */
  sectionIds?: ReadonlySet<string>;
};

/**
 * Why this cell can't be edited for this row, or null (bulk-grid §1.2): sending, queued deletion, variations,
 * stock-managed quantity, not tracked, or a field this marketplace's grid can't edit.
 */
export function cellReadOnlyReason(row: ListingRow, field: BulkField, ctx: FieldRuleContext): string | null {
  const { t, config } = ctx;
  const to = t('listings.mp.to', { marketplace: config.marketplace });
  if (ctx.sendingIds.has(row.id) || row.sync?.status === 'syncing') return t('bulk.readOnly.sending', { to });
  if (row.sync?.queuedDelete && row.sync.status !== 'synced') return t('listings.cell.willDelete');
  if (!config.fields.includes(field)) return t('bulk.readOnly.notEditable', { marketplace: MARKETPLACE_NAME[config.marketplace] });
  if (field === 'price' || field === 'qty') {
    if (row.editable[field]) return null;
    switch (row.editable.reason) {
      case 'variations':
        return t('bulk.readOnly.variations');
      case 'stock_managed':
        return t('bulk.readOnly.stockManaged', { qty: row.qty ?? 0 });
      case 'not_tracked':
        return t('listings.cell.notTracked');
      default:
        return t('bulk.readOnly.notEditable', { marketplace: MARKETPLACE_NAME[config.marketplace] });
    }
  }
  return null;
}

/** Text cell parse: entities decoded (DS P5, CRITIQUE V2), trimmed. */
export function parseText(text: string): string {
  return decodeEntities(String(text ?? '')).trim();
}

/** Etsy keys are relative to the `etsy` namespace; everything else is a full key. */
export function translateServerKey(t: ListingsT, key: string | undefined, params?: Record<string, string | number>): string | null {
  if (!key) return null;
  if (t.has?.(key)) return t(key, params);
  if (t.has?.(`etsy.${key}`)) return t(`etsy.${key}`, params);
  return null;
}

/**
 * Etsy rules for one self-contained field, mirroring the batch endpoint (`sanitizeEtsyBatchFields`, M7-B): ANY
 * validator error on title / price / quantity / tags means the value is wrong (e.g. quantity 0, a title with two
 * "&"), so it stays local instead of coming back as a rejected field.
 */
function etsyFieldError(key: 'title' | 'price' | 'quantity' | 'tags', value: unknown, t: ListingsT): string | null {
  const err = validateEtsyFieldPatch({ [key]: value }).find((e) => e.field === key);
  return err ? translateServerKey(t, err.key, err.params) ?? t('listings.draftError.invalidInput') : null;
}

/** Translated validation error or null (bulk-grid §5.3 step 7). Invalid values are never staged. */
export function validateField(field: BulkField, value: unknown, row: ListingRow, ctx: FieldRuleContext): string | null {
  const { t, config } = ctx;
  switch (field) {
    case 'title': {
      if (typeof value !== 'string' || !value.trim()) return t('listings.validate.titleRequired');
      const title = value.trim();
      if (config.titleMax !== null && title.length > config.titleMax) return t('listings.draftError.invalidTitle', { max: config.titleMax });
      return config.marketplace === 'etsy' ? etsyFieldError('title', title, t) : null;
    }
    case 'price': {
      const v = typeof value === 'number' && Number.isFinite(value) ? value : null;
      const currency = row.price?.currency ?? 'USD';
      return (
        validatePrice(v, t, { config: config.listings, marketplaceName: MARKETPLACE_NAME[config.marketplace], formatMoney: ctx.formatMoney }, currency) ??
        (config.marketplace === 'etsy' ? etsyFieldError('price', v, t) : null)
      );
    }
    case 'qty': {
      const v = typeof value === 'number' && Number.isFinite(value) ? value : null;
      return validateQty(v, t, { config: config.listings }) ?? (config.marketplace === 'etsy' ? etsyFieldError('quantity', v, t) : null);
    }
    case 'section': {
      if (value === null || value === undefined || value === '') return null;
      const id = String(value);
      if (!/^\d{1,20}$/.test(id)) return t('listings.draftError.invalidInput');
      if (ctx.sectionIds && !ctx.sectionIds.has(id)) return t('listings.draftError.invalidInput');
      return null;
    }
    case 'tags': {
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) return t('listings.draftError.invalidTags');
      const limits = config.listings.tags;
      if (!limits) return t('bulk.readOnly.notEditable', { marketplace: MARKETPLACE_NAME[config.marketplace] });
      if (limits.max !== null && value.length > limits.max) return t('listings.csv.tagsTooMany', { max: limits.max });
      const long = limits.maxLength !== null ? (value as string[]).find((tag) => tag.length > (limits.maxLength as number)) : undefined;
      if (long !== undefined) return t('listings.csv.tagTooLong', { tag: long, max: limits.maxLength as number });
      return config.marketplace === 'etsy' ? etsyFieldError('tags', value, t) : null;
    }
    default:
      return t('listings.draftError.invalidInput');
  }
}

/** Normalises a value before staging (title trimmed + decoded, price to cents, qty integer, section id). */
export function normalizeValue(field: BulkField, value: unknown): unknown {
  switch (field) {
    case 'title':
      return typeof value === 'string' ? parseText(value) : value;
    case 'price':
      return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
    case 'qty':
      return typeof value === 'number' ? Math.trunc(value) : value;
    case 'section':
      return value === undefined || value === '' ? null : value === null ? null : String(value);
    case 'tags':
      return Array.isArray(value) ? value.map((x) => String(x).trim()).filter(Boolean) : value;
    default:
      return value;
  }
}

/** Same value? (no-op edits are not staged). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (typeof a === 'number' && typeof b === 'number') return Math.round(a * 100) === Math.round(b * 100);
  return (a ?? null) === (b ?? null);
}
