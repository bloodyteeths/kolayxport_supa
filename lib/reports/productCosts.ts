// lib/reports/productCosts.ts — product cost fetch wrappers for Reports › Profit (finance-analytics §4.6, §6.3;
// M9 group D). Lifted from `useFinanceStore` with the same payloads, plus the fixes this surface needs:
//   - `costCurrency` is always sent (B15: the bulk import no longer forces TRY; the single-cell edit uses the
//     dashboard currency).
//   - `upsertCost` finds the saved cost first (by barcode, else by exact SKU) and updates amount + currency in one
//     PUT, or creates one (`upsert_by_barcode` / POST). A saved shipping cost is stored in the cost's currency and
//     the API never converts it, so a currency change over a non-zero saved shipping cost is refused
//     (`CostCurrencyConflictError`): the seller re-enters shipping in the new currency (no FX on the client).
//   - Codes are sent as `barcode` only (the bulk upsert key); `sku` is left out so a saved SKU is never overwritten.
//   - `listCosts` reads `costs` (the API's field; the store read `items` and always showed an empty list).
// A product cost is KolayXport-only data with no marketplace side effect, so it is saved directly (§4.6:
// staging would add a button with no purpose).
import { financeFetchJson } from './useFinanceReport';

export const PRODUCT_COSTS_PATH = '/api/finance/product-costs';

export interface ProductCostEntry {
  id: string;
  marketplace: string;
  barcode: string | null;
  sku: string | null;
  marketplaceId: string | null;
  productName: string;
  costAmount: number;
  costCurrency: string;
  shippingCost: number | null;
  notes: string | null;
}

export interface SoldProduct {
  barcode: string;
  productName: string;
}

export interface CostInput {
  productName: string;
  barcode?: string | null;
  sku?: string | null;
  costAmount: number;
  costCurrency: string;
  shippingCost?: number | null;
  notes?: string | null;
}

type Raw = Record<string, unknown>;
const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function normalizeCost(raw: unknown): ProductCostEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Raw;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    marketplace: String(o.marketplace ?? ''),
    barcode: typeof o.barcode === 'string' && o.barcode ? o.barcode : null,
    sku: typeof o.sku === 'string' && o.sku ? o.sku : null,
    marketplaceId: typeof o.marketplaceId === 'string' ? o.marketplaceId : null,
    productName: String(o.productName ?? ''),
    costAmount: toNum(o.costAmount) ?? 0,
    costCurrency: typeof o.costCurrency === 'string' && o.costCurrency ? o.costCurrency : 'TRY',
    shippingCost: toNum(o.shippingCost),
    notes: typeof o.notes === 'string' ? o.notes : null,
  };
}

/** One page of the saved costs (`page` is 0-based, `size` ≤ 500). */
async function listCostsPage(mp: string, page: number): Promise<{ costs: ProductCostEntry[]; totalPages: number }> {
  const q = new URLSearchParams({ marketplace: mp, size: '500', page: String(page) });
  const body = (await financeFetchJson(`${PRODUCT_COSTS_PATH}?${q}`)) as Raw | null;
  const list = Array.isArray(body?.costs) ? (body?.costs as unknown[]) : [];
  return { costs: list.map(normalizeCost).filter((c): c is ProductCostEntry => c !== null), totalPages: toNum(body?.totalPages) ?? 1 };
}

/** Every saved cost of the marketplace (pages of 500, capped at 20 pages). */
export async function listAllCosts(mp: string): Promise<ProductCostEntry[]> {
  const out: ProductCostEntry[] = [];
  for (let page = 0; page < 20; page += 1) {
    const res = await listCostsPage(mp, page);
    out.push(...res.costs);
    if (page + 1 >= res.totalPages || res.costs.length === 0) break;
  }
  return out;
}

export const costsListKey = (mp: string, search?: string) =>
  `${PRODUCT_COSTS_PATH}?${new URLSearchParams({ marketplace: mp, size: '500', ...(search ? { search } : {}) })}`;

export async function listCosts(mp: string, search?: string): Promise<ProductCostEntry[]> {
  const body = (await financeFetchJson(costsListKey(mp, search))) as Raw | null;
  const list = Array.isArray(body?.costs) ? body?.costs : Array.isArray(body?.items) ? body?.items : [];
  return (list as unknown[]).map(normalizeCost).filter((c): c is ProductCostEntry => c !== null);
}

export const soldProductsKey = (mp: string) => `${PRODUCT_COSTS_PATH}?${new URLSearchParams({ marketplace: mp, action: 'sold_products' })}`;

export async function listSoldProducts(mp: string): Promise<SoldProduct[]> {
  const body = (await financeFetchJson(soldProductsKey(mp))) as Raw | null;
  const list = Array.isArray(body?.products) ? (body?.products as unknown[]) : [];
  return list
    .map((p) => (p && typeof p === 'object' ? (p as Raw) : {}))
    .map((p) => ({ barcode: String(p.barcode ?? ''), productName: String(p.productName ?? '') }))
    .filter((p) => p.productName || p.barcode);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function createCost(mp: string, input: CostInput): Promise<ProductCostEntry | null> {
  return normalizeCost(await financeFetchJson(PRODUCT_COSTS_PATH, json('POST', { ...input, marketplace: mp })));
}

export async function updateCost(id: string, patch: Partial<CostInput>): Promise<ProductCostEntry | null> {
  return normalizeCost(await financeFetchJson(PRODUCT_COSTS_PATH, json('PUT', { id, ...patch })));
}

export interface BulkResult { created: number; updated: number; errors: string[]; total: number }

/** Bulk upsert (barcode key), max 500 per request: split into chunks, sequential. */
export async function bulkCreateCosts(mp: string, items: CostInput[]): Promise<BulkResult> {
  const out: BulkResult = { created: 0, updated: 0, errors: [], total: 0 };
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((it) => ({ ...it, marketplace: mp }));
    const body = (await financeFetchJson(PRODUCT_COSTS_PATH, json('POST', { action: 'bulk', marketplace: mp, items: chunk }))) as Raw | null;
    out.created += toNum(body?.created) ?? 0;
    out.updated += toNum(body?.updated) ?? 0;
    out.total += toNum(body?.total) ?? 0;
    if (Array.isArray(body?.errors)) out.errors.push(...(body?.errors as unknown[]).map(String));
  }
  return out;
}

/**
 * Saving `costCurrency` over `saved` would leave its shipping cost (a number in the old currency) to be read in the
 * new one. True when the currency changes, the saved shipping is non-zero and no new shipping value is given.
 */
export function shippingNeedsReentry(
  saved: Pick<ProductCostEntry, 'costCurrency' | 'shippingCost'> | null | undefined,
  costCurrency: string,
  shippingCost?: number | null,
): boolean {
  if (!saved || (shippingCost !== null && shippingCost !== undefined)) return false;
  return saved.costCurrency.toUpperCase() !== costCurrency.toUpperCase() && (saved.shippingCost ?? 0) !== 0;
}

/** The cost refused by `upsertCost`: `saved` holds the currency and shipping the seller must re-enter. */
export class CostCurrencyConflictError extends Error {
  saved: ProductCostEntry;
  constructor(saved: ProductCostEntry) {
    super(`shipping cost is saved in ${saved.costCurrency}`);
    this.name = 'CostCurrencyConflictError';
    this.saved = saved;
  }
}

/** The saved cost the bulk upsert would update for `code` (exact barcode match). */
export async function findSavedCostByBarcode(mp: string, code: string): Promise<ProductCostEntry | null> {
  return (await listCosts(mp, code)).find((c) => c.barcode === code) ?? null;
}

export class MissingProductCodeError extends Error {
  constructor() {
    super('missing barcode or sku');
    this.name = 'MissingProductCodeError';
  }
}

/**
 * Save one unit cost from the "Profit by product" cell (§4.6). The saved cost is looked up first (barcode rows by
 * exact barcode, SKU-only rows by exact SKU) and updated with one PUT {costAmount, costCurrency}; none saved →
 * `upsert_by_barcode` (barcode) or a create (SKU). A currency change over a non-zero saved shipping cost throws
 * `CostCurrencyConflictError` and sends nothing. Rows with neither code throw `MissingProductCodeError` (the cell
 * is read-only for them).
 */
export async function upsertCost(
  mp: string,
  row: { barcode: string | null; sku: string | null; productName: string },
  costAmount: number,
  costCurrency: string,
): Promise<ProductCostEntry | null> {
  if (!row.barcode && !row.sku) throw new MissingProductCodeError();
  const existing = row.barcode
    ? await findSavedCostByBarcode(mp, row.barcode)
    : (await listCosts(mp, row.sku as string)).find((c) => c.sku === row.sku) ?? null;
  if (existing) {
    if (shippingNeedsReentry(existing, costCurrency)) throw new CostCurrencyConflictError(existing);
    return updateCost(existing.id, { costAmount, costCurrency });
  }
  if (row.barcode) {
    return normalizeCost(
      await financeFetchJson(
        PRODUCT_COSTS_PATH,
        json('POST', { action: 'upsert_by_barcode', marketplace: mp, barcode: row.barcode, productName: row.productName, costAmount, costCurrency }),
      ),
    );
  }
  return createCost(mp, { productName: row.productName, sku: row.sku, costAmount, costCurrency });
}

// ---------------------------------------------------------------------------
// "Paste a list" parser (pure)
// ---------------------------------------------------------------------------

export type CostListReason = 'noCode' | 'badCost';
export interface ParsedCostRow { line: number; code: string; productName: string; costAmount: number; shippingCost: number | null }
export interface CostListParse { valid: ParsedCostRow[]; invalid: Array<{ line: number; reason: CostListReason }> }

/** Locale-tolerant number: "11,50", "11.50", "1.109,30", "1,109.30", "₺12" → number | null. */
export function parseCostNumber(raw: string | undefined): number | null {
  let s = String(raw ?? '').trim().replace(/[\s ₺$€£¥]/g, '').replace(/^(TRY|USD|EUR|GBP|TL)/i, '').replace(/(TRY|USD|EUR|GBP|TL)$/i, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = /,\d{3}$/.test(s) && s.indexOf(',') !== lastComma ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(';')) return line.split(';');
  return line.split(',');
}

/**
 * One product per line: barcode or SKU, name, unit cost, shipping (optional). Tab (Excel / Sheets paste),
 * semicolon or comma separated; a header row (first line whose cost column is not a number) is skipped.
 * With commas as separators a decimal comma is ambiguous, so paste from a spreadsheet (tabs) or use ";".
 */
export function parseCostList(text: string): CostListParse {
  const out: CostListParse = { valid: [], invalid: [] };
  const lines = text.split(/\r?\n/);
  let first = true;
  lines.forEach((rawLine, idx) => {
    if (!rawLine.trim()) return;
    // Split the untrimmed line: a leading tab is an empty first cell (no code), not whitespace.
    const cells = splitLine(rawLine).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    const [code = '', name = '', cost, ship] = cells;
    const amount = parseCostNumber(cost);
    if (first) {
      first = false;
      if (amount === null && !/\d/.test(cost ?? '')) return; // header row
    }
    if (!code) { out.invalid.push({ line: idx + 1, reason: 'noCode' }); return; }
    if (amount === null) { out.invalid.push({ line: idx + 1, reason: 'badCost' }); return; }
    out.valid.push({ line: idx + 1, code, productName: name || code, costAmount: amount, shippingCost: parseCostNumber(ship) });
  });
  return out;
}

/**
 * Parsed rows → bulk payload. Codes are sent as barcode only (the bulk upsert key): the upsert keeps
 * `sku ?? existing.sku`, so sending the code as SKU too would overwrite a saved SKU with the barcode.
 */
export function costListToItems(rows: ParsedCostRow[], costCurrency: string): CostInput[] {
  return rows.map((r) => ({ productName: r.productName, barcode: r.code, costAmount: r.costAmount, costCurrency, shippingCost: r.shippingCost }));
}

/** Split bulk items: the ones whose saved shipping would be re-read in another currency are held back. */
export function splitShippingConflicts(items: CostInput[], saved: ProductCostEntry[]): { ok: CostInput[]; conflicts: Array<{ item: CostInput; saved: ProductCostEntry }> } {
  const byBarcode = new Map(saved.filter((c) => c.barcode).map((c) => [c.barcode as string, c]));
  const ok: CostInput[] = [];
  const conflicts: Array<{ item: CostInput; saved: ProductCostEntry }> = [];
  for (const item of items) {
    const hit = item.barcode ? byBarcode.get(item.barcode) : undefined;
    if (hit && shippingNeedsReentry(hit, item.costCurrency, item.shippingCost)) conflicts.push({ item, saved: hit });
    else ok.push(item);
  }
  return { ok, conflicts };
}

/**
 * Codes named in the bulk endpoint's per-item errors ("Error for BB-01: …", "Missing required fields for item:
 * BB-01"). An error that names no known code still counts in `unmatched`.
 */
export function failedCodesFrom(errors: string[], codes: string[]): { codes: Set<string>; unmatched: number } {
  const out = new Set<string>();
  let unmatched = 0;
  for (const e of errors) {
    const hit = codes.find((c) => e.includes(`for ${c}:`) || e.endsWith(`: ${c}`));
    if (hit) out.add(hit);
    else unmatched += 1;
  }
  return { codes: out, unmatched };
}
