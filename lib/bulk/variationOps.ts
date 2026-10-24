// lib/bulk/variationOps.ts — bulk edits on Etsy listings WITH variations: price, quantity and SKU per variation,
// optionally only for variations where <property> = <value>. Builds on lib/bulk/variationPriceOps.ts (number ops,
// the match filter, reading the open draft before the live inventory). Pure except buildVariationEdits, which only
// READS (the caller stages the result as the listing's inventory draft; nothing is written to Etsy here).
//
// Etsy rule kept here: when a field's values differ between products, that field's `*_on_property` must list the
// property ids that vary (otherwise Etsy rejects the inventory). After an edit that makes values differ, the array is
// widened to every property id present on the products (union with what the seller had); uniform values keep it.
import {
  ETSY_MIN_PRICE,
  activeMatch,
  applyNumberOps,
  defaultVariationPriceDeps,
  liveProducts,
  isMultiVariation,
  pendingInventoryOf,
  productMatches,
  type NumberOp,
  type PriceRounding,
  type VariationMatch,
  type VariationPriceDeps,
} from './variationPriceOps';
import { LOADED_QUANTITY_FIELD } from '@/lib/etsy/inventoryMerge';

type AnyRecord = Record<string, unknown>;
const rec = (v: unknown): AnyRecord => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : {});
const list = (v: unknown): AnyRecord[] => (Array.isArray(v) ? v.map(rec) : []);

export const ETSY_SKU_MAX = 32;
export const ETSY_QTY_MAX = 999;

export type SkuEdit =
  | { mode: 'set'; value: string }
  | { mode: 'prefix'; value: string }
  | { mode: 'suffix'; value: string }
  | { mode: 'replace'; find: string; with: string }
  /** Tokens: {sku} current SKU, {n} 1-based variation number, {<Property name>} that variation's value (e.g. {Color}). */
  | { mode: 'template'; value: string };

export interface VariationEdits {
  price?: { ops: NumberOp[]; round?: PriceRounding };
  quantity?: NumberOp[];
  sku?: SkuEdit;
}

export interface VariationEditOptions {
  match?: VariationMatch | null;
  minPrice?: number;
  /**
   * The source is the LIVE inventory: stamp each product with the quantity it had (kx_loaded_quantity), so the sync
   * keeps Etsy's fresh quantity for variants this edit did not change (sales since staging are never overwritten).
   * Never set it for an open draft's inventory: its quantities may already be the seller's own edits.
   */
  stampLoaded?: boolean;
}

export type VariationEditResult =
  | { ok: true; inventory: AnyRecord; changed: number }
  | { ok: false; reason: 'single' | 'noMatch' | 'skuTooLong' | 'nothing' };

const roundPrice = (v: number, round: PriceRounding) => {
  let n = v;
  if (round === '99') n = Math.floor(n) + 0.99;
  else if (round === '00') n = Math.round(n);
  return Math.round(n * 100) / 100;
};

/** Pure: a property value of a product by property name (case-insensitive). */
function valueOf(product: AnyRecord, propertyName: string): string {
  const key = propertyName.trim().toLocaleLowerCase('tr');
  const pv = list(product.property_values).find((p) => String(p.property_name ?? '').trim().toLocaleLowerCase('tr') === key);
  const v = pv && Array.isArray(pv.values) ? pv.values[0] : undefined;
  return v === undefined ? '' : String(v);
}

/** Pure: the new SKU for one product. */
export function applySkuEdit(current: string, edit: SkuEdit, product: AnyRecord, index: number): string {
  const cur = current ?? '';
  switch (edit.mode) {
    case 'set':
      return edit.value.trim();
    case 'prefix':
      return `${edit.value}${cur}`.trim();
    case 'suffix':
      return `${cur}${edit.value}`.trim();
    case 'replace':
      return edit.find ? cur.split(edit.find).join(edit.with) : cur;
    default:
      return edit.value
        .replace(/\{sku\}/gi, cur)
        .replace(/\{n\}/gi, String(index + 1))
        .replace(/\{([^{}]+)\}/g, (_, name: string) => valueOf(product, name))
        .replace(/\s+/g, '-')
        .trim();
  }
}

const moneyOf = (o: AnyRecord): number => {
  const plain = typeof o.price === 'number' || typeof o.price === 'string' ? Number(String(o.price).replace(',', '.')) : null;
  if (plain !== null) return Number.isFinite(plain) ? plain : 0;
  const p = rec(o.price);
  return (Number(p.amount) || 0) / (Number(p.divisor) || 100);
};

/** Property ids present on the products (for a `*_on_property` that must list what varies). */
function propertyIds(products: AnyRecord[]): number[] {
  const ids = new Set<number>();
  for (const p of products) for (const pv of list(p.property_values)) if (Number.isFinite(Number(pv.property_id))) ids.add(Number(pv.property_id));
  return Array.from(ids);
}

const varies = (vals: Array<string | number>) => new Set(vals.map(String)).size > 1;

/**
 * Pure: applies the edits to every live product (or only to those `match` selects). Returns the whole inventory to
 * stage, or why nothing was produced. SKUs longer than Etsy's 32 characters fail the listing (no silent truncation).
 */
export function applyVariationEdits(inventory: unknown, edits: VariationEdits, opts: VariationEditOptions = {}): VariationEditResult {
  if (!edits.price?.ops.length && !edits.quantity?.length && !edits.sku) return { ok: false, reason: 'nothing' };
  const source = rec(inventory);
  const products = liveProducts(source);
  // A listing without variations: only the SKU is edited here (its price and stock are plain fields elsewhere).
  if (!isMultiVariation(inventory) && (products.length !== 1 || edits.price?.ops.length || edits.quantity?.length)) return { ok: false, reason: 'single' };
  const match = isMultiVariation(inventory) ? activeMatch(opts.match) : null;
  if (match && !products.some((p) => productMatches(p, match))) return { ok: false, reason: 'noMatch' };
  const minPrice = opts.minPrice ?? ETSY_MIN_PRICE;
  let changed = 0;
  let tooLong = false;
  const stamp = (p: AnyRecord): AnyRecord => {
    if (!opts.stampLoaded || p[LOADED_QUANTITY_FIELD] !== undefined) return p;
    const first = list(p.offerings).find((o) => !o.is_deleted);
    const q = Number(first?.quantity);
    return Number.isFinite(q) ? { ...p, [LOADED_QUANTITY_FIELD]: Math.trunc(q) } : p;
  };
  const next = products.map(stamp).map((p, i) => {
    if (match && !productMatches(p, match)) return p;
    changed += 1;
    const out: AnyRecord = { ...p };
    if (edits.sku) {
      const sku = applySkuEdit(String(p.sku ?? ''), edits.sku, p, i);
      if (sku.length > ETSY_SKU_MAX) tooLong = true;
      out.sku = sku;
    }
    out.offerings = list(p.offerings)
      .filter((o) => !o.is_deleted)
      .map((o) => {
        const offering: AnyRecord = { ...o };
        if (edits.price?.ops.length) {
          const price = typeof o.price === 'object' && o.price ? rec(o.price) : {};
          const divisor = Number(price.divisor) || 100;
          const value = Math.max(minPrice, roundPrice(applyNumberOps(moneyOf(o), edits.price.ops), edits.price.round ?? 'none'));
          offering.price = { ...price, amount: Math.round(value * divisor), divisor };
        }
        if (edits.quantity?.length) {
          const q = Math.round(applyNumberOps(Number(o.quantity) || 0, edits.quantity));
          offering.quantity = Math.min(ETSY_QTY_MAX, Math.max(0, q));
        }
        return offering;
      });
    return out;
  });
  if (tooLong) return { ok: false, reason: 'skuTooLong' };

  const ids = propertyIds(next);
  const onProperty = (key: 'price_on_property' | 'quantity_on_property' | 'sku_on_property', vals: Array<string | number>) => {
    const had = Array.isArray(source[key]) ? (source[key] as unknown[]).map(Number).filter(Number.isFinite) : [];
    // Varying values: the array must cover every property they can vary by (union, so an existing array that named
    // only Size still works after an edit that also varies by Color). Uniform values: keep what the seller had.
    return varies(vals) ? Array.from(new Set([...had, ...ids])) : had;
  };
  const offeringsOf = (p: AnyRecord) => list(p.offerings);
  return {
    ok: true,
    changed,
    inventory: {
      products: next,
      price_on_property: onProperty('price_on_property', next.flatMap((p) => offeringsOf(p).map(moneyOf))),
      quantity_on_property: onProperty('quantity_on_property', next.flatMap((p) => offeringsOf(p).map((o) => Number(o.quantity) || 0))),
      sku_on_property: onProperty('sku_on_property', next.map((p) => String(p.sku ?? ''))),
    },
  };
}

/**
 * Reads each listing's inventory (open draft first, then live) and applies the edits; at most `concurrency` reads
 * at a time. Returns the patches to stage and the skipped listings with their reason.
 */
export async function buildVariationEdits(
  shopId: string,
  listingIds: string[],
  edits: VariationEdits,
  opts: Omit<VariationEditOptions, 'stampLoaded'> = {},
  deps: VariationPriceDeps = defaultVariationPriceDeps,
  concurrency = 4,
): Promise<{ patches: Array<{ id: string; inventory: AnyRecord; changed: number }>; skipped: Array<{ id: string; reason: string }> }> {
  const patches: Array<{ id: string; inventory: AnyRecord; changed: number }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let next = 0;
  const lane = async () => {
    while (next < listingIds.length) {
      const id = listingIds[next++];
      try {
        const [remote, drafts] = await Promise.all([deps.fetchInventory(shopId, id), deps.fetchDrafts(shopId, id).catch(() => [])]);
        const pending = pendingInventoryOf(drafts);
        const source = pending ?? (remote ? rec(remote) : null);
        if (!source) { skipped.push({ id, reason: 'unreadable' }); continue; }
        const r = applyVariationEdits(source, edits, { ...opts, stampLoaded: !pending });
        if (r.ok) patches.push({ id, inventory: r.inventory, changed: r.changed });
        else skipped.push({ id, reason: r.reason });
      } catch {
        skipped.push({ id, reason: 'unreadable' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, listingIds.length)) }, lane));
  return { patches, skipped };
}
