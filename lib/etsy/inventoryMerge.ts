/**
 * Fresh-quantity merge for draft inventory writes (owner W1). Pure.
 *
 * A staged inventory draft carries the full product list as the user saw it
 * when editing. Between staging and sync, sales (or a stock push) may have
 * lowered quantities on Etsy. Writing the staged list verbatim would restore
 * the old, higher quantities (oversell). So, inside the listing inventory
 * lock, right before the PUT:
 *
 *   for every draft product, find the quantity the user STARTED FROM:
 *     - preferred: the product's `kx_loaded_quantity` — the quantity the
 *       editor loaded for that variant when the user edited it (stamped by
 *       the variation editor; stripped before the PUT);
 *     - legacy fallback: the matching product of the draft's BASE snapshot.
 *   draft qty == started-from qty -> the user did not touch it -> take the fresh qty
 *   otherwise                     -> user-changed -> keep the draft qty
 *
 * The base snapshot is taken when the draft is created and is not moved by
 * later edits, so without the marker a deliberate "restock back to the old
 * base quantity" is indistinguishable from "untouched" and resolves to the
 * fresh (lower) quantity — the oversell-safe side. The marker removes that
 * ambiguity. (Re-basing onto the live listing on force-sync would NOT help:
 * every untouched variant would then differ from the base and be written
 * verbatim — the oversell this merge exists to stop.)
 *
 * Products that cannot be matched (new variations, or a draft without a base
 * inventory and no marker) count as user-changed: today's behaviour.
 *
 * Identity is the variant property/value tuple (etsyVariantKeys); Etsy
 * regenerates product_id on every PUT, so it is never used. For matching
 * base/draft/fresh, property 508 (deprecated "Style") is folded to 513 like
 * sanitizeInventoryForEtsy does (Etsy returns 513 after the first PUT).
 * The REPORTED userChangedVariantKeys are the UNFOLDED keys of the draft
 * products as passed on (reportedVariantKey), because the stock-sync hook
 * (lib/stock/etsyInventoryPayload productVariantKey) keys the same,
 * still-unsanitized products without folding.
 */
import { etsyVariantKeys, pairsFromEtsyProduct } from './variantKey';

type Product = Record<string, any>;

function foldPid(product: Product): Product {
  const pvs = Array.isArray(product?.property_values) ? product.property_values : [];
  if (!pvs.some((pv: any) => Number(pv?.property_id) === 508)) return product;
  return {
    ...product,
    property_values: pvs.map((pv: any) => (Number(pv?.property_id) === 508 ? { ...pv, property_id: 513 } : pv)),
  };
}

/** Matching identity (508 folded to 513). Internal to base/draft/fresh matching. */
export function productKeys(product: Product): { variantKey: string; variantValueKey: string } {
  return etsyVariantKeys(pairsFromEtsyProduct(foldPid(product)));
}

/**
 * The key reported in userChangedVariantKeys: unfolded, identical to
 * lib/stock/etsyInventoryPayload productVariantKey() for the same product.
 */
export function reportedVariantKey(product: Product): string {
  return etsyVariantKeys(pairsFromEtsyProduct(product)).variantKey;
}

/**
 * Product field the variation editor stamps with the quantity it loaded for
 * that variant (before the user's edit). Never sent to Etsy.
 */
export const LOADED_QUANTITY_FIELD = 'kx_loaded_quantity';

function loadedQuantity(product: Product): number | null {
  const raw = product?.[LOADED_QUANTITY_FIELD];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** True for an inventory with exactly one live product and no variation values (a listing without variations). */
export function isSingleProductInventory(inventory: unknown): boolean {
  const products = (Array.isArray((inventory as any)?.products) ? (inventory as any).products : []).filter((p: any) => p && !p.is_deleted);
  return products.length === 1 && !(Array.isArray(products[0].property_values) && products[0].property_values.length > 0);
}

/**
 * Plain price / quantity / processing-profile edits applied onto a whole inventory (pure). Everything else is kept
 * as it is (Etsy's PUT replaces the whole inventory): product sku and property values, offering is_enabled and
 * readiness_state_id (unless one is given), *_on_property arrays and any bookkeeping fields. Deleted products and
 * offerings are dropped. The caller decides single vs multi-variation.
 */
export function applyPlainFieldsToInventory(
  source: unknown,
  plain: { price?: unknown; quantity?: unknown; readinessStateId?: number | null },
): Record<string, any> {
  const src = (source && typeof source === 'object' ? source : {}) as Record<string, any>;
  const products = (Array.isArray(src.products) ? src.products : []).filter((p: any) => p && !p.is_deleted);
  return {
    ...src,
    products: products.map((p: any) => ({
      ...p,
      offerings: (Array.isArray(p.offerings) ? p.offerings : []).filter((o: any) => o && !o.is_deleted).map((o: any) => ({
        ...o,
        ...(plain.price !== undefined ? { price: Number(String(plain.price).replace(',', '.')) } : {}),
        ...(plain.quantity !== undefined ? { quantity: Math.trunc(Number(plain.quantity)) } : {}),
        ...(plain.readinessStateId ? { readiness_state_id: plain.readinessStateId } : {}),
      })),
    })),
  };
}

/** Removes editor-only bookkeeping fields from a product (before any PUT). */
export function stripEditorFields<T extends Product>(product: T): T {
  if (!product || typeof product !== 'object' || !(LOADED_QUANTITY_FIELD in product)) return product;
  const { [LOADED_QUANTITY_FIELD]: _drop, ...rest } = product as Product;
  void _drop;
  return rest as T;
}

/** Quantity of a product's first live offering (Etsy products have one offering). */
export function productQuantity(product: Product): number | null {
  const offerings = Array.isArray(product?.offerings) ? product.offerings : [];
  const live = offerings.find((o: any) => !o?.is_deleted) ?? offerings[0];
  if (!live || live.quantity === undefined || live.quantity === null || live.quantity === '') return null;
  const n = Number(live.quantity);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function withQuantity(product: Product, qty: number): Product {
  const offerings = Array.isArray(product?.offerings) ? product.offerings : [];
  return {
    ...product,
    offerings: offerings.map((o: any) => (o?.is_deleted ? o : { ...o, quantity: qty })),
  };
}

function liveProducts(list: unknown): Product[] {
  return (Array.isArray(list) ? list : []).filter((p: any) => p && !p.is_deleted);
}

function index(list: Product[]) {
  const byId = new Map<string, Product>();
  const byValue = new Map<string, Product>();
  for (const p of list) {
    const k = productKeys(p);
    if (!byId.has(k.variantKey)) byId.set(k.variantKey, p);
    if (!byValue.has(k.variantValueKey)) byValue.set(k.variantValueKey, p);
  }
  return {
    find(k: { variantKey: string; variantValueKey: string }): Product | undefined {
      return byId.get(k.variantKey) ?? byValue.get(k.variantValueKey);
    },
  };
}

export type FreshMergeResult = {
  products: Product[];
  /** Unfolded variantKey (reportedVariantKey) of every draft product the user changed (or that could not be matched). */
  userChangedVariantKeys: Set<string>;
  /** Quantities replaced by the fresh remote value. */
  refreshed: Array<{ variantKey: string; from: number; to: number }>;
  /** false when no base inventory was available (nothing merged). */
  hadBase: boolean;
};

export function mergeFreshInventoryQuantities(a: {
  draftProducts: Product[];
  baseProducts: Product[] | null | undefined;
  freshProducts: Product[] | null | undefined;
}): FreshMergeResult {
  const draft = Array.isArray(a.draftProducts) ? a.draftProducts : [];
  const base = liveProducts(a.baseProducts);
  const fresh = liveProducts(a.freshProducts);
  const userChangedVariantKeys = new Set<string>();
  const refreshed: FreshMergeResult['refreshed'] = [];

  const hasMarker = draft.some((p) => p && !p.is_deleted && loadedQuantity(p) !== null);
  if ((base.length === 0 && !hasMarker) || fresh.length === 0) {
    for (const p of draft) if (p && !p.is_deleted) userChangedVariantKeys.add(reportedVariantKey(p));
    return { products: draft, userChangedVariantKeys, refreshed, hadBase: base.length > 0 };
  }

  const baseIdx = index(base);
  const freshIdx = index(fresh);
  const products = draft.map((p) => {
    if (!p || p.is_deleted) return p;
    const keys = productKeys(p);
    const draftQty = productQuantity(p);
    // What the user started from: the editor's loaded quantity, else the base snapshot.
    const marker = loadedQuantity(p);
    const baseP = marker === null ? baseIdx.find(keys) : undefined;
    const startQty = marker !== null ? marker : (baseP ? productQuantity(baseP) : null);
    if (draftQty === null || startQty === null || draftQty !== startQty) {
      userChangedVariantKeys.add(reportedVariantKey(p));
      return p;
    }
    const freshP = freshIdx.find(keys);
    const freshQty = freshP ? productQuantity(freshP) : null;
    if (freshQty === null || freshQty === draftQty) return p;
    refreshed.push({ variantKey: reportedVariantKey(p), from: draftQty, to: freshQty });
    return withQuantity(p, freshQty);
  });
  return { products, userChangedVariantKeys, refreshed, hadBase: base.length > 0 };
}
