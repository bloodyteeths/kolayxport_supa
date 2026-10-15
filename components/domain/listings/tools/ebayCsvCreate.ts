// components/domain/listings/tools/ebayCsvCreate.ts — eBay "Import CSV → Create new listings" (listings-grid §10).
// Legacy EbayListingsLegacy `handleCSVImportConfirm` wrote each row LIVE (create_inventory_item + create_offer, no
// category / policies). Here each row becomes a staged create draft, the same draft `/app/ebay-listings/new` stages
// (`ebayAdapter.stageFields` mode `create`: local SKU + queued `create` carrying the seller's SKU). Nothing reaches
// eBay until the seller sends it from the editor. Columns: sku, title, price, quantity, condition, description.
// Remembered policies (the editor's last-used defaults) are applied; photos and category always need the editor, so
// such rows are staged and flagged "Finish in the editor" (validation `block_sync`). `block_save` issues, a missing
// SKU / title, a SKU already on eBay or repeated in the file make the row invalid (not staged).
import { normalizeSellerSku } from '@/lib/ebay/draftPlan';
import { parseMoney, type ParsedCsv } from '@/lib/listings/csvImport';
import {
  EBAY_EDITOR_SHOP,
  ebayAdapter,
  blankEbayFields,
  newEbayLocalSku,
  validateEbayEditorFields,
  plainTextToHtml,
  toPriceString,
  type EbayEditorFields,
} from '@/components/domain/listing-editor/adapters/ebay';
import type { DraftRow } from '@/lib/listingEditor/types';
import { EBAY_CONDITIONS } from '../config/ebay';

export const EBAY_CREATE_FIELDS = ['sku', 'title', 'price', 'quantity', 'condition', 'description'] as const;
export type EbayCreateField = (typeof EBAY_CREATE_FIELDS)[number];
/** Column index → field (null = not imported). */
export type EbayCreateMapping = (EbayCreateField | null)[];

const ALIASES: Record<EbayCreateField, string[]> = {
  sku: ['sku', 'customlabel', 'customlabelsku', 'stokkodu', 'stockcode'],
  title: ['title', 'baslik', 'başlık', 'name', 'itemtitle'],
  price: ['price', 'fiyat', 'startprice', 'buyitnowprice'],
  quantity: ['quantity', 'qty', 'adet', 'stock', 'stok', 'availablequantity'],
  condition: ['condition', 'durum', 'conditionid'],
  description: ['description', 'aciklama', 'açıklama'],
};

const norm = (h: string) => h.toLowerCase().replace(/[\s_\-()*.]/g, '');

/** Header → field by name (pure). Each field is matched once, first column wins. */
export function detectEbayCreateMapping(headers: readonly string[]): EbayCreateMapping {
  const used = new Set<EbayCreateField>();
  return headers.map((h) => {
    const n = norm(h);
    const f = EBAY_CREATE_FIELDS.find((k) => !used.has(k) && ALIASES[k].includes(n));
    if (!f) return null;
    used.add(f);
    return f;
  });
}

/** Sets column `index` to `field`, clearing any other column that had it (pure). */
export function setEbayCreateMapping(m: EbayCreateMapping, index: number, field: EbayCreateField | null): EbayCreateMapping {
  return m.map((v, i) => (i === index ? field : field !== null && v === field ? null : v));
}

/** `New`, `used good`, `3000`… → ConditionEnum; '' when empty; null when not recognised. */
export function parseEbayCondition(raw: string): string | null | '' {
  const v = raw.trim();
  if (!v) return '';
  const key = v.toUpperCase().replace(/[\s-]+/g, '_');
  if ((EBAY_CONDITIONS as readonly string[]).includes(key)) return key;
  const byId: Record<string, string> = {
    '1000': 'NEW',
    '1500': 'NEW_OTHER',
    '1750': 'NEW_WITH_DEFECTS',
    '2000': 'CERTIFIED_REFURBISHED',
    '2500': 'SELLER_REFURBISHED',
    '2750': 'LIKE_NEW',
    '3000': 'USED_EXCELLENT',
    '4000': 'USED_VERY_GOOD',
    '5000': 'USED_GOOD',
    '6000': 'USED_ACCEPTABLE',
    '7000': 'FOR_PARTS_OR_NOT_WORKING',
  };
  if (byId[key]) return byId[key];
  if (key === 'USED') return 'USED_EXCELLENT';
  return null;
}

/** One message: full i18n key under `listings.` (e.g. `csv.create.skuMissing`) or an editor key (`ebay.validation.*`). */
export type EbayCreateIssue = { key: string; params?: Record<string, string | number>; root?: boolean };

export type EbayCreatePlanRow = {
  line: number;
  sku: string;
  title: string;
  /** ready: complete; incomplete: staged, finish in the editor; invalid: not staged. */
  kind: 'ready' | 'incomplete' | 'invalid';
  fields: EbayEditorFields;
  /** Invalid reasons (kind `invalid`). */
  issues: EbayCreateIssue[];
  /** What the editor still needs (kind `incomplete`): `ebay.validation.*` keys. */
  missing: EbayCreateIssue[];
};

export type EbayCreatePlan = {
  rows: EbayCreatePlanRow[];
  summary: { rows: number; ready: number; incomplete: number; invalid: number };
};

export function buildEbayCreatePlan(input: {
  csv: ParsedCsv;
  mapping: EbayCreateMapping;
  /** SKUs already on eBay (the store's listings). */
  existingSkus: ReadonlySet<string>;
  /** Remembered create defaults (policies). */
  defaults?: Partial<EbayEditorFields>;
}): EbayCreatePlan {
  const col = (f: EbayCreateField) => input.mapping.indexOf(f);
  const idx = Object.fromEntries(EBAY_CREATE_FIELDS.map((f) => [f, col(f)])) as Record<EbayCreateField, number>;
  const cell = (r: string[], f: EbayCreateField) => (idx[f] >= 0 ? String(r[idx[f]] ?? '').trim() : '');
  const counts = new Map<string, number>();
  for (const r of input.csv.rows) {
    const s = cell(r, 'sku');
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const rows: EbayCreatePlanRow[] = input.csv.rows.map((r, i) => {
    const issues: EbayCreateIssue[] = [];
    const sku = cell(r, 'sku');
    const title = cell(r, 'title');
    const fields = blankEbayFields(input.defaults ?? {});
    fields.sku = sku;
    fields.title = title;
    if (!sku) issues.push({ key: 'csv.create.skuMissing' });
    else if (!normalizeSellerSku(sku)) issues.push({ key: 'ebay.validation.skuInvalid', params: { max: 50 }, root: true });
    else if ((counts.get(sku) ?? 0) > 1) issues.push({ key: 'csv.create.skuDuplicate' });
    else if (input.existingSkus.has(sku)) issues.push({ key: 'csv.create.skuExists' });
    if (!title) issues.push({ key: 'ebay.validation.titleRequired', root: true });

    const priceRaw = cell(r, 'price');
    if (priceRaw) {
      const p = parseMoney(priceRaw);
      if (p === null || !(p > 0)) issues.push({ key: 'ebay.validation.priceInvalid', root: true });
      else fields.price = toPriceString(p);
    }
    const qtyRaw = cell(r, 'quantity');
    if (qtyRaw) {
      const q = Number(qtyRaw.replace(/\s/g, ''));
      if (!Number.isInteger(q) || q < 0) issues.push({ key: 'ebay.validation.quantityInvalid', root: true });
      else fields.quantity = q;
    }
    const cond = parseEbayCondition(cell(r, 'condition'));
    if (cond === null) issues.push({ key: 'csv.create.conditionInvalid' });
    else if (cond) fields.condition = cond;
    const desc = cell(r, 'description');
    if (desc) fields.description = plainTextToHtml(desc);

    const v = validateEbayEditorFields(fields, 'create');
    for (const it of v) {
      if (it.severity !== 'block_save') continue;
      if (issues.some((x) => x.key === it.key)) continue;
      issues.push({ key: it.key, params: it.params, root: true });
    }
    const missing = issues.length
      ? []
      : v.filter((it) => it.severity === 'block_sync' && it.key !== 'ebay.validation.titleRequired').map((it) => ({ key: it.key, params: it.params, root: true }));
    const kind: EbayCreatePlanRow['kind'] = issues.length ? 'invalid' : missing.length ? 'incomplete' : 'ready';
    return { line: input.csv.lines[i] ?? i + 2, sku, title, kind, fields, issues, missing };
  });
  const summary = { rows: rows.length, ready: 0, incomplete: 0, invalid: 0 };
  for (const r of rows) summary[r.kind] += 1;
  return { rows, summary };
}

/** Local SKUs for one import run: unique per row (the editor's `KX-<time>` plus the row position). */
export function localSkusFor(count: number, base: string = newEbayLocalSku()): string[] {
  return Array.from({ length: count }, (_, i) => `${base}-${i + 1}`);
}

/** Stages one row as an eBay create draft (same call as the create workspace's first save). */
export async function stageEbayCreateRow(row: EbayCreatePlanRow, localSku: string): Promise<DraftRow | null> {
  return ebayAdapter.stageFields({
    ctx: { shopId: EBAY_EDITOR_SHOP, listingId: localSku },
    mode: 'create',
    remote: null,
    current: row.fields,
    extra: {},
    draft: null,
  });
}
