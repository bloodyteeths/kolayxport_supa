// lib/listings/csvImport.ts — listings-grid §10 "Import CSV" / "Find & replace" data helpers (M5 G6).
// Pure: parse, map and validate. No React, no fetch, no Prisma. Safe on the client and in tests.
//
// - `parseCSVLine` is the quote-aware line splitter ported from the legacy `pages/app/etsy-listings.tsx`
//   import; `parseCsv` builds on it to read a whole document (BOM, CRLF, quoted newlines, `;`/tab delimiters
//   from Excel's Turkish locale).
// - `detectMapping` guesses which header is which field; the panel lets the seller correct it.
// - `buildImportPlan` diffs the file against the current listings (read from `/api/listings/export`, parsed
//   with `readListingsCsv`) and validates every changed cell. Unchanged rows are dropped from the plan view.
// Nothing here stages or sends: the panel stages through the StagingAdapter, and the seller sends from the page.

import type { ListingEditableReason, ListingMarketplace, ListingRow, ListingSyncKey, StagePatch } from '@/lib/listings/types';
import { TAG_MAX_COUNT, TAG_MAX_LEN, TITLE_MAX } from '@/lib/etsy/seoRules';

// ─── Parsing ────────────────────────────────────────────────────────────────

/** Ported from the legacy Etsy import (quote-aware, `""` = literal quote). */
export function parseCSVLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Splits a document into logical CSV records (a quoted field may contain newlines). */
export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // `""` inside quotes toggles twice, which keeps the state right.
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      records.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length) records.push(current);
  return records;
}

/** Picks the delimiter from the header record: `,` unless `;` or tab clearly dominates (Excel TR/DE exports). */
export function detectDelimiter(headerRecord: string): ',' | ';' | '\t' {
  const count = (d: string) => parseCSVLine(headerRecord, d).length;
  const comma = count(',');
  const semi = count(';');
  const tab = count('\t');
  if (tab > comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

export type ParsedCsv = {
  /** Header cells, trimmed, as written in the file. */
  headers: string[];
  /** Data records (blank lines dropped), each padded/truncated to `headers.length`. */
  rows: string[][];
  /** 1-based file line number of each data record (header = line 1), for the preview. */
  lines: number[];
  delimiter: ',' | ';' | '\t';
};

/**
 * Undoes the export's CSV-injection guard (`lib/listings/csv.ts`): one leading apostrophe in front of
 * `= + - @ tab CR` is removed. Any other apostrophe is the seller's text and is kept.
 */
export function unguardCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = splitCsvRecords(clean);
  const headerIndex = records.findIndex((r) => r.trim() !== '');
  if (headerIndex === -1) return { headers: [], rows: [], lines: [], delimiter: ',' };
  const delimiter = detectDelimiter(records[headerIndex]);
  const headers = parseCSVLine(records[headerIndex], delimiter).map((h) => h.trim());
  const rows: string[][] = [];
  const lines: number[] = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    if (records[i].trim() === '') continue;
    const cells = parseCSVLine(records[i], delimiter);
    rows.push(headers.map((_, idx) => unguardCell((cells[idx] ?? '').trim()).trim()));
    lines.push(i + 1);
  }
  return { headers, rows, lines, delimiter };
}

/** RFC 4180 field escaping (for the template file). */
export function csvField(value: string): string {
  return /[",\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ─── Values ─────────────────────────────────────────────────────────────────

/**
 * "12.50", "12,50", "$1,234.50", "1.234,50 ₺", "₺ 40" → number; anything else → null.
 * The last `.` or `,` followed by 1–2 digits is the decimal mark; other separators are thousands.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s) || s.lastIndexOf('-') > 0) return null;
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let normalized: string;
  if (lastSep === -1) normalized = s;
  else {
    const decimals = s.slice(lastSep + 1);
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    normalized = decimals.length > 0 && decimals.length <= 2 ? `${intPart}.${decimals}` : `${intPart}${decimals}`;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Whole numbers only ("12", "12.0"); "12.5", "abc" → null. */
export function parseQty(input: string): number | null {
  const s = input.trim().replace(/\s/g, '');
  if (!/^-?\d+(?:[.,]0+)?$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** `a|b|c` (export format, legacy import) or `a, b, c` / `a; b`. Trimmed, empty dropped, order kept, no case dupes. */
export function parseTags(input: string): string[] {
  const sep = input.includes('|') ? '|' : input.includes(';') ? ';' : ',';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(sep)) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    const key = tag.toLocaleLowerCase('tr');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function parseBool(input: string | undefined): boolean {
  const s = (input ?? '').trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'evet' || s === '1') return true;
  const n = Number(s);
  return Number.isFinite(n) && n > 1; // a variant count above one
}

// ─── Per-marketplace rules ──────────────────────────────────────────────────

export type ImportField = 'id' | 'title' | 'price' | 'quantity' | 'tags' | 'description';
export type EditableImportField = Exclude<ImportField, 'id'>;

export type MarketplaceLimits = {
  titleMax: number;
  /** null = the marketplace has no listing tags. */
  tags: { max: number; maxLen: number } | null;
  priceMin: number;
  qtyMin: number;
  qtyMax: number;
};

export const MARKETPLACE_LIMITS: Record<ListingMarketplace, MarketplaceLimits> = {
  etsy: { titleMax: TITLE_MAX, tags: { max: TAG_MAX_COUNT, maxLen: TAG_MAX_LEN }, priceMin: 0.2, qtyMin: 0, qtyMax: 999 },
  ebay: { titleMax: 80, tags: null, priceMin: 0.99, qtyMin: 0, qtyMax: 99999 },
  trendyol: { titleMax: 100, tags: null, priceMin: 0.01, qtyMin: 0, qtyMax: 99999 },
  wix: { titleMax: 80, tags: null, priceMin: 0, qtyMin: 0, qtyMax: 99999 },
  shopify: { titleMax: 255, tags: { max: 250, maxLen: 255 }, priceMin: 0, qtyMin: 0, qtyMax: 999999 },
};

/** The id column the template and the mapping step name (`listing_id` for Etsy, as the legacy import). */
export const ID_COLUMN: Record<ListingMarketplace, string> = {
  etsy: 'listing_id',
  ebay: 'sku',
  trendyol: 'barcode',
  wix: 'id',
  shopify: 'id',
};

/**
 * StagePatch fields each marketplace's draft accepts. Trendyol, Wix and Shopify mirror the CatalogDraft
 * `ALLOWED_FIELDS` in `lib/catalogDrafts/service.ts` (server-only, so it cannot be imported here; the G6 test
 * asserts the two stay equal). Trendyol titles are not stageable in v1 (they need the full product payload and
 * send the product back to approval).
 */
export const STAGEABLE_FIELDS: Record<ListingMarketplace, readonly Exclude<EditableImportField, 'description'>[]> = {
  etsy: ['title', 'price', 'quantity', 'tags'],
  ebay: ['title', 'price', 'quantity'],
  trendyol: ['price', 'quantity'],
  wix: ['title', 'price', 'quantity'],
  shopify: ['title', 'price', 'quantity', 'tags'],
};

/**
 * Fields the grid can stage through `StagingAdapter.stage` (StagePatch: price, qty, title, tags).
 * `description` is not in StagePatch yet (BR to G0/G5), so it is offered only when the caller opts in.
 */
export function stageableFields(marketplace: ListingMarketplace, opts: { description?: boolean } = {}): EditableImportField[] {
  const out: EditableImportField[] = [...STAGEABLE_FIELDS[marketplace]];
  if (opts.description && (marketplace === 'etsy' || marketplace === 'ebay')) out.push('description');
  return out;
}

const normalizeHeader = (h: string) =>
  h
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/[çğöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ö: 'o', ş: 's', ü: 'u' })[c] ?? c)
    .replace(/[\s\-.]+/g, '_');

const HEADER_ALIASES: Record<EditableImportField, string[]> = {
  title: ['title', 'name', 'product_name', 'product_title', 'baslik', 'urun_adi', 'ad'],
  price: ['price', 'sale_price', 'fiyat', 'satis_fiyati'],
  quantity: ['quantity', 'qty', 'stock', 'inventory', 'stok', 'adet', 'miktar'],
  tags: ['tags', 'tag', 'etiketler', 'etiket'],
  description: ['description', 'aciklama', 'body', 'body_html'],
};

function idAliases(marketplace: ListingMarketplace): string[] {
  const base = ['id', normalizeHeader(ID_COLUMN[marketplace])];
  const extra: Record<ListingMarketplace, string[]> = {
    etsy: ['listing_id', 'listingid', 'etsy_listing_id'],
    ebay: ['sku', 'custom_label'],
    trendyol: ['barcode', 'barkod'],
    wix: ['product_id', 'wix_product_id'],
    shopify: ['product_id', 'shopify_product_id'],
  };
  return Array.from(new Set([...base, ...extra[marketplace]]));
}

/** Column index → field (or null = ignored). Each field is used at most once; the first matching header wins. */
export type ColumnMapping = (ImportField | null)[];

export function detectMapping(headers: string[], marketplace: ListingMarketplace, fields: EditableImportField[]): ColumnMapping {
  const used = new Set<ImportField>();
  const ids = idAliases(marketplace);
  return headers.map((h) => {
    const key = normalizeHeader(h);
    if (!used.has('id') && ids.includes(key)) {
      used.add('id');
      return 'id';
    }
    for (const f of fields) {
      if (!used.has(f) && HEADER_ALIASES[f].includes(key)) {
        used.add(f);
        return f;
      }
    }
    return null;
  });
}

/** Sets column `index` to `field`, clearing any other column that held the same field. */
export function setMapping(mapping: ColumnMapping, index: number, field: ImportField | null): ColumnMapping {
  return mapping.map((f, i) => (i === index ? field : field !== null && f === field ? null : f));
}

// ─── Current listings (from the export CSV) ─────────────────────────────────

export type CurrentListing = {
  id: string;
  title: string;
  price: number | null;
  quantity: number | null;
  tags: string[] | null;
  description: string | null;
  /** From an optional `has_variations` / `variations` / `variants` column: price and qty are edited per variation. */
  hasVariations: boolean;
  /**
   * `ListingRow.editable` from `/api/listings` (`applyListingRows`). The export has no editability column, so
   * until this is set the plan cannot prove that price/qty are editable (variations, stock sync, not tracked).
   */
  editable?: { price: boolean; qty: boolean; reason?: ListingEditableReason };
  /** The open draft (`ListingRow.sync`), set by `applyListingRows`. Title/price/qty above already show its values. */
  draft?: { status: ListingSyncKey; fields: string[]; overlaid: string[] };
};

/** `ListingRow.sync.changedFields` uses `quantity`; normalise the few aliases the adapters may report. */
const draftFieldKey = (f: string) => (f === 'qty' ? 'quantity' : f);

/**
 * Overlays `/api/listings` rows on the export's live values: the open draft's title/price/qty become the
 * "current" value (so a tool never computes from, and silently replaces, an unsent edit), the draft's changed
 * fields and status are kept for the warnings, and `editable` is copied. Returns a new map.
 */
export function applyListingRows(
  current: Map<string, CurrentListing>,
  rows: readonly Pick<ListingRow, 'id' | 'editable' | 'sync'>[],
): Map<string, CurrentListing> {
  const out = new Map(current);
  for (const r of rows) {
    const cur = out.get(r.id);
    if (!cur) continue;
    const next: CurrentListing = { ...cur, editable: r.editable };
    if (r.editable && !r.editable.price && r.editable.reason === 'variations') next.hasVariations = true;
    const sync = r.sync;
    if (sync && sync.status !== 'synced') {
      const overlaid: string[] = [];
      if (sync.draft.title !== undefined) {
        next.title = sync.draft.title;
        overlaid.push('title');
      }
      if (sync.draft.price !== undefined) {
        next.price = sync.draft.price;
        overlaid.push('price');
      }
      if (sync.draft.qty !== undefined) {
        next.quantity = sync.draft.qty;
        overlaid.push('quantity');
      }
      next.draft = { status: sync.status, fields: sync.changedFields.map(draftFieldKey), overlaid };
    }
    out.set(r.id, next);
  }
  return out;
}

/** Draft fields whose unsent value is NOT overlaid (the overlay carries at most title, price and qty). */
export function unsentFieldsWithoutValue(cur: CurrentListing): string[] {
  const d = cur.draft;
  if (!d) return [];
  return d.fields.filter((f) => !d.overlaid.includes(f));
}

/**
 * Reads `/api/listings/export` output (`id, title, price, currency, quantity, status, sku, tags, health, url`
 * [+ description] [+ per-marketplace extras]) into a map by id.
 */
export function readListingsCsv(text: string): Map<string, CurrentListing> {
  const { headers, rows } = parseCsv(text);
  const col = (name: string) => headers.findIndex((h) => normalizeHeader(h) === name);
  const iId = col('id');
  const iTitle = col('title');
  const iPrice = col('price');
  const iQty = col('quantity');
  const iTags = col('tags');
  const iDesc = col('description');
  const iVar = ['has_variations', 'variations', 'variants'].map(col).find((i) => i >= 0) ?? -1;
  // Optional (requested from G1): `editable_price` / `editable_qty`, from ListingRow.editable.
  const iEdPrice = col('editable_price');
  const iEdQty = col('editable_qty');
  const out = new Map<string, CurrentListing>();
  if (iId < 0) return out;
  for (const r of rows) {
    const id = r[iId];
    if (!id) continue;
    out.set(id, {
      id,
      title: iTitle >= 0 ? r[iTitle] : '',
      price: iPrice >= 0 ? parseMoney(r[iPrice]) : null,
      quantity: iQty >= 0 ? parseQty(r[iQty]) : null,
      tags: iTags >= 0 ? parseTags(r[iTags]) : null,
      description: iDesc >= 0 ? r[iDesc] : null,
      hasVariations: iVar >= 0 ? parseBool(r[iVar]) : false,
      ...(iEdPrice >= 0 && iEdQty >= 0 ? { editable: { price: parseBool(r[iEdPrice]), qty: parseBool(r[iEdQty]) } } : {}),
    });
  }
  return out;
}

// ─── Plan ───────────────────────────────────────────────────────────────────

/** i18n key (namespace `listings`) + params for one invalid cell. */
export type ImportIssue = { field: ImportField; key: string; params?: Record<string, string | number> };

export type ImportPatch = StagePatch & { description?: string };

export type ImportPlanRow = {
  /** 1-based file line. */
  line: number;
  id: string;
  kind: 'change' | 'unchanged' | 'not_found' | 'invalid';
  current: CurrentListing | null;
  patch: ImportPatch;
  /** Fields that differ from the current listing (subset of patch keys, `qty` reported as `quantity`). */
  changed: EditableImportField[];
  issues: ImportIssue[];
  /** Non-blocking: e.g. a changed field that replaces the listing's unsent staged value (`csv.replacesUnsent`). */
  warnings: ImportIssue[];
};

export type ImportPlan = {
  rows: ImportPlanRow[];
  summary: { rows: number; change: number; unchanged: number; missing: number; invalid: number };
};

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t.toLocaleLowerCase('tr') === b[i].toLocaleLowerCase('tr'));

export function buildImportPlan(input: {
  csv: ParsedCsv;
  mapping: ColumnMapping;
  current: Map<string, CurrentListing>;
  marketplace: ListingMarketplace;
  /** Fields the seller may stage (`stageableFields`). Mapped columns outside this list are ignored. */
  fields: EditableImportField[];
  /**
   * Price/qty are staged only when `current.editable` proves them editable (the panel passes true after
   * `applyListingRows`). Off for pure callers that have only the export.
   */
  requireEditable?: boolean;
}): ImportPlan {
  const { csv, mapping, current, marketplace, fields, requireEditable = false } = input;
  /** Why price/qty cannot be staged for this listing, as an i18n key; null = editable. */
  const lockKey = (cur: CurrentListing, f: 'price' | 'qty'): string | null => {
    if (cur.editable) {
      if (cur.editable[f]) return null;
      const reason = cur.editable.reason ?? (cur.hasVariations ? 'variations' : undefined);
      return reason === 'not_tracked' ? 'cell.notTracked' : reason === 'stock_managed' ? 'cell.stockManaged' : 'cell.variationsReadOnly';
    }
    if (cur.hasVariations) return 'cell.variationsReadOnly';
    return requireEditable ? 'csv.editableUnknown' : null;
  };
  const limits = MARKETPLACE_LIMITS[marketplace];
  const idCol = mapping.indexOf('id');
  const colOf = (f: EditableImportField) => (fields.includes(f) ? mapping.indexOf(f) : -1);
  const cols = { title: colOf('title'), price: colOf('price'), quantity: colOf('quantity'), tags: colOf('tags'), description: colOf('description') };
  const seen = new Set<string>();
  const rows: ImportPlanRow[] = [];

  csv.rows.forEach((cells, idx) => {
    const line = csv.lines[idx] ?? idx + 2;
    const id = idCol >= 0 ? (cells[idCol] ?? '').trim() : '';
    if (!id) return; // a row without an id cannot be matched; it is not counted (legacy behaviour)
    const cur = current.get(id) ?? null;
    const row: ImportPlanRow = { line, id, kind: 'unchanged', current: cur, patch: {}, changed: [], issues: [], warnings: [] };
    rows.push(row);
    if (!cur) {
      row.kind = 'not_found';
      return;
    }
    if (seen.has(id)) {
      row.kind = 'invalid';
      row.issues.push({ field: 'id', key: 'csv.duplicateRow' });
      return;
    }
    seen.add(id);

    const read = (c: number) => (c >= 0 ? (cells[c] ?? '') : '');

    // Empty cells mean "leave as is" (legacy import semantics), never "clear".
    const titleRaw = read(cols.title).replace(/\s+/g, ' ').trim();
    if (titleRaw && titleRaw !== cur.title) {
      if (titleRaw.length > limits.titleMax) row.issues.push({ field: 'title', key: 'fr.overLimit', params: { max: limits.titleMax } });
      else {
        row.patch.title = titleRaw;
        row.changed.push('title');
      }
    }

    const priceRaw = read(cols.price);
    if (priceRaw) {
      const price = parseMoney(priceRaw);
      if (price === null || price <= 0) row.issues.push({ field: 'price', key: 'validate.priceInvalid' });
      else if (price < limits.priceMin) row.issues.push({ field: 'price', key: 'validate.priceMin', params: { marketplace, min: limits.priceMin } });
      else if (price !== cur.price) {
        const lock = lockKey(cur, 'price');
        if (lock) row.issues.push({ field: 'price', key: lock });
        else {
          row.patch.price = price;
          row.changed.push('price');
        }
      }
    }

    const qtyRaw = read(cols.quantity);
    if (qtyRaw) {
      const qty = parseQty(qtyRaw);
      if (qty === null || qty < limits.qtyMin || qty > limits.qtyMax) {
        row.issues.push({ field: 'quantity', key: 'validate.qtyInvalid', params: { min: limits.qtyMin, max: limits.qtyMax } });
      } else if (qty !== cur.quantity) {
        const lock = lockKey(cur, 'qty');
        if (lock) row.issues.push({ field: 'quantity', key: lock });
        else {
          row.patch.qty = qty;
          row.changed.push('quantity');
        }
      }
    }

    const tagsRaw = read(cols.tags);
    if (tagsRaw && limits.tags) {
      const tags = parseTags(tagsRaw);
      const long = tags.find((t) => t.length > limits.tags!.maxLen);
      if (tags.length > limits.tags.max) row.issues.push({ field: 'tags', key: 'csv.tagsTooMany', params: { max: limits.tags.max } });
      else if (long) row.issues.push({ field: 'tags', key: 'csv.tagTooLong', params: { tag: long, max: limits.tags.maxLen } });
      else if (!cur.tags || !sameTags(tags, cur.tags)) {
        row.patch.tags = tags;
        row.changed.push('tags');
      }
    }

    const descRaw = read(cols.description);
    if (descRaw && descRaw !== (cur.description ?? '')) {
      row.patch.description = descRaw;
      row.changed.push('description');
    }

    // A draft that is being sent right now cannot take another change; an unsent value is replaced (warned).
    if (row.changed.length && cur.draft?.status === 'syncing') row.issues.push({ field: 'id', key: 'csv.sending' });
    else if (cur.draft) {
      for (const f of row.changed) if (cur.draft.fields.includes(f)) row.warnings.push({ field: f, key: 'csv.replacesUnsent' });
    }

    row.kind = row.issues.length ? 'invalid' : row.changed.length ? 'change' : 'unchanged';
  });

  const count = (k: ImportPlanRow['kind']) => rows.filter((r) => r.kind === k).length;
  return {
    rows,
    summary: { rows: csv.rows.length, change: count('change'), unchanged: count('unchanged'), missing: count('not_found'), invalid: count('invalid') },
  };
}

/** Header-only template with the same columns as Export (UTF-8 BOM so Excel reads Turkish characters). */
export function importTemplateCsv(marketplace: ListingMarketplace): string {
  const cols = [ID_COLUMN[marketplace], ...stageableFields(marketplace)];
  return `﻿${cols.map(csvField).join(',')}\r\n`;
}

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
