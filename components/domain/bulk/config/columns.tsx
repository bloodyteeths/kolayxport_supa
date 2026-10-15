// components/domain/bulk/config/columns.tsx — BulkGrid columns per marketplace (bulk-grid §3.1 table; M7-C).
// Built against the M7-A `GridColumn<T>` contract (bulk-grid §5.1). Live values come from `value(row)`; the draft
// overlay (staged + local) is the `values` prop of BulkGrid, so columns never read the queue.
import * as React from 'react';
import { StatusPill } from '@/components/ds/data/StatusPill';
import type { GridColumn } from '@/components/ds/data/BulkGrid';
import type { ListingRow, ListingSyncKey } from '@/lib/listings/types';
import type { ListingsT } from '@/components/domain/listings/columns';
import type { BulkColumnKey, BulkConfig, BulkField } from './types';
import { cellReadOnlyReason, liveValue, parseText, validateField, type FieldRuleContext } from './fields';

export type BulkColumnsContext = FieldRuleContext & {
  config: BulkConfig;
  /** Etsy shop sections (select-edit options). */
  sectionOptions: { value: string; label: string }[];
  /** The row's change pill (`pending` while edits are queued in this session, `syncing` while sending). */
  syncKeyOf(row: ListingRow): ListingSyncKey | null;
};

function editable(field: BulkField, ctx: BulkColumnsContext) {
  return (row: ListingRow): true | { reason: string } => {
    const reason = cellReadOnlyReason(row, field, ctx);
    return reason ? { reason } : true;
  };
}

function validator(field: BulkField, ctx: BulkColumnsContext) {
  return (value: unknown, row: ListingRow): string | null => validateField(field, value, row, ctx);
}

/** Header i18n key per column. */
export const BULK_COLUMN_HEADER: Record<BulkColumnKey, string> = {
  thumb: '',
  title: 'bulk.col.title',
  price: 'bulk.col.price',
  qty: 'bulk.col.qty',
  section: 'bulk.col.section',
  health: 'bulk.col.health',
  photos: 'bulk.col.photos',
  status: 'bulk.col.status',
  changes: 'bulk.col.changes',
};

/** Columns that are read-only as a whole (paste refuses to start there, bulk-grid §5.3 step 5). */
export const READ_ONLY_COLUMNS: ReadonlySet<BulkColumnKey> = new Set(['thumb', 'health', 'photos', 'status', 'changes']);

export function bulkColumns(t: ListingsT, ctx: BulkColumnsContext): GridColumn<ListingRow>[] {
  const { config } = ctx;
  const hidden = new Set(config.hiddenByDefault);
  const cols: GridColumn<ListingRow>[] = [];
  const sectionLabel = new Map(ctx.sectionOptions.map((o) => [o.value, o.label]));
  for (const key of config.columns) {
    const header = BULK_COLUMN_HEADER[key] ? t(BULK_COLUMN_HEADER[key]) : '';
    const defaultHidden = hidden.has(key) || undefined;
    switch (key) {
      case 'thumb':
        cols.push({ key, field: 'thumb', header, type: 'thumb', width: 48, frozen: true, hideable: false, value: (r) => r.thumbUrl, thumbAlt: (r) => r.title, mobile: 'media' });
        break;
      case 'title':
        cols.push({
          key,
          field: 'title',
          header,
          type: 'text-edit',
          width: 320,
          frozen: true,
          hideable: false,
          mobile: 'title',
          value: (r) => liveValue(r, 'title'),
          editable: editable('title', ctx),
          parse: (text) => parseText(text),
          format: (v) => (typeof v === 'string' ? v : ''),
          validate: validator('title', ctx),
          ...(config.titleMax !== null ? { counter: config.titleMax } : {}),
        });
        break;
      case 'price':
        cols.push({
          key,
          field: 'price',
          header,
          type: 'money-edit',
          width: 104,
          align: 'right',
          mobile: 'hidden',
          value: (r) => liveValue(r, 'price'),
          currency: (r) => r.price?.currency,
          editable: editable('price', ctx),
          validate: validator('price', ctx),
        });
        break;
      case 'qty':
        cols.push({
          key,
          field: 'qty',
          header,
          type: 'int-edit',
          width: 72,
          align: 'right',
          mobile: 'hidden',
          value: (r) => liveValue(r, 'qty'),
          editable: editable('qty', ctx),
          validate: validator('qty', ctx),
        });
        break;
      case 'section':
        cols.push({
          key,
          field: 'section',
          header,
          type: 'select-edit',
          width: 140,
          mobile: 'hidden',
          defaultHidden,
          value: (r) => liveValue(r, 'section'),
          options: ctx.sectionOptions,
          editable: editable('section', ctx),
          // Paste accepts a section name or id; unknown names stay as text and fail validation (never staged).
          parse: (text) => {
            const s = parseText(text);
            if (!s) return null;
            const byName = ctx.sectionOptions.find((o) => o.label.toLocaleLowerCase() === s.toLocaleLowerCase());
            return byName ? byName.value : s;
          },
          format: (v) => (v === null || v === undefined ? '' : sectionLabel.get(String(v)) ?? String(v)),
          validate: validator('section', ctx),
        });
        break;
      case 'health':
        cols.push({ key, field: 'health', header, type: 'score', width: 88, align: 'right', mobile: 'hidden', defaultHidden, value: (r) => r.health.score });
        break;
      case 'photos':
        cols.push({ key, field: 'photos', header, type: 'number', width: 88, align: 'right', mobile: 'hidden', defaultHidden, value: (r) => (typeof r.extra.photos === 'number' ? r.extra.photos : null) });
        break;
      case 'status':
        cols.push({
          key,
          field: 'status',
          header,
          type: 'status',
          width: 104,
          mobile: 'hidden',
          defaultHidden,
          value: (r) => ({ domain: 'listing', status: r.status, raw: r.statusNote ?? r.statusRaw }),
        });
        break;
      case 'changes':
        cols.push({
          key,
          field: 'changes',
          header,
          width: 120,
          mobile: 'hidden',
          defaultHidden,
          render: (r) => {
            const k = ctx.syncKeyOf(r);
            return k ? <StatusPill domain="sync" status={k} /> : null;
          },
        });
        break;
      default:
        break;
    }
  }
  return cols;
}
