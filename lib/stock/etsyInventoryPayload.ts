/**
 * Quantity-only Etsy inventory payload (W2, T6). Pure — unit tested.
 *
 * Etsy's PUT /listings/{id}/inventory replaces the whole variation set, so a
 * stock push must send back exactly what a fresh GET returned, changing ONLY
 * offering quantity / is_enabled. Never call draftService's
 * sanitizeInventoryForEtsy here: it rewrites property ids (508 -> 513),
 * dedupes and fills cartesian combinations — all legitimate for editor drafts,
 * all structure changes for a stock push.
 *
 * After building, the payload is compared to the GET: property tuples,
 * *_on_property arrays, SKUs and prices must be identical, otherwise
 * StructureChangedError is thrown and the caller marks the link
 * 'unsupported' (reason 'structure').
 */
import { etsyQuantityKey, etsyVariantKeys, pairsFromEtsyProduct, SHARED_QUANTITY_KEY } from '@/lib/etsy/variantKey';

export class StructureChangedError extends Error {
  constructor(public detail: string) {
    super(`Etsy inventory structure would change: ${detail}`);
    this.name = 'StructureChangedError';
  }
}

export type QuantityChange = { quantity?: number; isEnabled?: boolean };

const ON_PROPERTY_KEYS = ['price_on_property', 'quantity_on_property', 'sku_on_property', 'readiness_state_on_property'] as const;

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function priceToDecimal(price: any): number | any {
  if (price && typeof price === 'object' && price.amount !== undefined) {
    const divisor = Number(price.divisor) || 100;
    return Math.round((Number(price.amount) / divisor) * 10000) / 10000;
  }
  return price;
}

function tupleSig(product: any): string {
  return pairsFromEtsyProduct(product)
    .map((p) => `${p.propertyId}:${p.valueId ?? ''}:${String(p.value ?? '')}`)
    .sort()
    .join('|');
}

function priceSig(product: any): string {
  return (Array.isArray(product?.offerings) ? product.offerings : [])
    .map((o: any) => String(priceToDecimal(o?.price)))
    .join(',');
}

function onPropSig(inv: any): string {
  return ON_PROPERTY_KEYS.map((k) => `${k}=${JSON.stringify(Array.isArray(inv?.[k]) ? inv[k].map(Number) : null)}`).join(';');
}

/** variantKey of a GET product (full property tuple). */
export function productVariantKey(product: any): string {
  return etsyVariantKeys(pairsFromEtsyProduct(product)).variantKey;
}

/** Products of a fresh GET as observation rows (quantity of the first non-deleted offering). */
export function productsFromInventory(inv: any): Array<{
  variantKey: string;
  variantValueKey: string;
  quantityKey: string;
  sku: string | null;
  quantity: number;
  isEnabled: boolean;
  productId: string | null;
}> {
  const products = Array.isArray(inv?.products) ? inv.products : [];
  const qop = Array.isArray(inv?.quantity_on_property) ? inv.quantity_on_property.map(Number) : [];
  return products
    .filter((p: any) => !p?.is_deleted)
    .map((p: any) => {
      const pairs = pairsFromEtsyProduct(p);
      const keys = etsyVariantKeys(pairs);
      const offering = (Array.isArray(p?.offerings) ? p.offerings : []).find((o: any) => !o?.is_deleted) || {};
      return {
        variantKey: keys.variantKey,
        variantValueKey: keys.variantValueKey,
        quantityKey: products.length > 1 ? etsyQuantityKey(pairs, qop) : '',
        sku: p?.sku ? String(p.sku) : null,
        quantity: Math.max(0, Math.trunc(Number(offering.quantity) || 0)),
        isEnabled: offering.is_enabled !== false,
        productId: p?.product_id !== undefined && p?.product_id !== null ? String(p.product_id) : null,
      };
    });
}

/**
 * Expand per-link changes to every product of the same quantity group.
 * Etsy requires one quantity across products that differ only by properties
 * NOT in quantity_on_property; a '*' change covers the whole listing.
 * Conflicting targets inside one group resolve to the minimum (oversell-safe).
 */
export function expandChangesToQuantityGroups(inv: any, changes: Map<string, QuantityChange>): Map<string, QuantityChange> {
  const rows = productsFromInventory(inv);
  const byGroup = new Map<string, QuantityChange>();
  const merge = (group: string, ch: QuantityChange) => {
    const prev = byGroup.get(group);
    if (!prev) return byGroup.set(group, { ...ch });
    const q = prev.quantity === undefined ? ch.quantity : ch.quantity === undefined ? prev.quantity : Math.min(prev.quantity, ch.quantity);
    const e = prev.isEnabled === undefined ? ch.isEnabled : ch.isEnabled === undefined ? prev.isEnabled : prev.isEnabled && ch.isEnabled;
    byGroup.set(group, { quantity: q, isEnabled: e });
  };
  for (const [key, ch] of Array.from(changes.entries())) {
    if (key === SHARED_QUANTITY_KEY) {
      for (const r of rows) merge(r.quantityKey, ch);
      continue;
    }
    const row = rows.find((r) => r.variantKey === key);
    if (row) merge(row.quantityKey, ch);
  }
  const out = new Map<string, QuantityChange>();
  for (const r of rows) {
    const ch = byGroup.get(r.quantityKey);
    if (ch) out.set(r.variantKey, ch);
  }
  return out;
}

/**
 * Deep-copy the GET, strip only server-side ids (product_id, offering_id,
 * is_deleted, scale_name), convert price objects to decimals, and set only
 * quantity / is_enabled for products in `changes` (keyed by full variantKey;
 * '' for a single-product listing). Asserts the structure is unchanged.
 */
export function buildQuantityOnlyInventoryPayload(freshGet: any, changes: Map<string, QuantityChange>): any {
  if (!freshGet || !Array.isArray(freshGet.products) || freshGet.products.length === 0) {
    throw new StructureChangedError('no_products');
  }
  const src = deepCopy(freshGet);
  const products = src.products.filter((p: any) => !p?.is_deleted);
  const outProducts = products.map((p: any) => {
    const vk = productVariantKey(p);
    const ch = changes.get(vk) ?? (products.length === 1 ? changes.get('') ?? changes.get(SHARED_QUANTITY_KEY) : undefined);
    const { product_id: _pid, is_deleted: _del, ...rest } = p;
    const next: any = { ...rest };
    next.property_values = (Array.isArray(p.property_values) ? p.property_values : []).map((pv: any) => {
      const { scale_name: _sn, ...pvRest } = pv || {};
      return pvRest;
    });
    next.offerings = (Array.isArray(p.offerings) ? p.offerings : [])
      .filter((o: any) => !o?.is_deleted)
      .map((o: any) => {
        const { offering_id: _oid, is_deleted: _odel, ...oRest } = o || {};
        const off: any = { ...oRest, price: priceToDecimal(o?.price) };
        if (ch?.quantity !== undefined) off.quantity = Math.max(0, Math.trunc(ch.quantity));
        if (ch?.isEnabled !== undefined) off.is_enabled = !!ch.isEnabled;
        return off;
      });
    return next;
  });

  const payload: any = { products: outProducts };
  for (const k of ON_PROPERTY_KEYS) {
    if (Array.isArray(src[k])) payload[k] = src[k];
  }

  assertSameStructure(freshGet, payload);
  return payload;
}

/** Throws StructureChangedError unless tuples, *_on_property, SKUs and prices match. */
export function assertSameStructure(freshGet: any, payload: any): void {
  const a = (freshGet?.products || []).filter((p: any) => !p?.is_deleted);
  const b = payload?.products || [];
  if (a.length !== b.length) throw new StructureChangedError(`product_count ${a.length}->${b.length}`);
  const sigA = a.map((p: any) => `${tupleSig(p)}#${p?.sku ?? ''}#${priceSig(p)}`).sort();
  const sigB = b.map((p: any) => `${tupleSig(p)}#${p?.sku ?? ''}#${priceSig(p)}`).sort();
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] !== sigB[i]) throw new StructureChangedError('tuple_sku_or_price');
  }
  if (onPropSig(freshGet) !== onPropSig(payload)) throw new StructureChangedError('on_property');
  const offA = a.map((p: any) => (p.offerings || []).filter((o: any) => !o?.is_deleted).length).join(',');
  const offB = b.map((p: any) => (p.offerings || []).length).join(',');
  if (offA !== offB) throw new StructureChangedError('offering_count');
}

/** True when the payload would leave no enabled offering with quantity > 0. */
export function payloadAllZero(payload: any): boolean {
  for (const p of payload?.products || []) {
    for (const o of p.offerings || []) {
      if (o.is_enabled !== false && Number(o.quantity) > 0) return false;
    }
  }
  return true;
}
