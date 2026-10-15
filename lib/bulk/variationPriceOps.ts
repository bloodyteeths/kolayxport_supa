// lib/bulk/variationPriceOps.ts — bulk-grid §7 "Change price" on listings with variations (M7-C).
// Port of `components/etsy/BulkEditor.tsx` `priorOps` / `applyNumberOps` / `buildVariationInventoryPatch`
// (L206–L275). Etsy needs an inventory patch for multi-variation listings (INVENTORY_PATCH_REQUIRED), so the same
// price operation is applied to every offering and the whole inventory is staged.
//
// Pure except `buildVariationPriceInventory`, which reads the live inventory and the open draft through injected
// fetchers (no write happens here; the caller STAGES the result as `inventory` on the listing's draft).

export type NumberOpKind = 'increase_pct' | 'decrease_pct' | 'increase_fixed' | 'decrease_fixed' | 'set';
export type NumberOp = { op: NumberOpKind; amount: number };

/** Etsy's minimum offering price (major units). */
export const ETSY_MIN_PRICE = 0.2;

/** Existing ops for a field; an earlier direct edit becomes an initial 'set' (BulkEditor `priorOps`). */
export function priorOps(pending: { value?: number; ops?: NumberOp[] } | undefined): NumberOp[] {
  if (!pending) return [];
  if (pending.ops?.length) return pending.ops;
  return pending.value !== undefined ? [{ op: 'set', amount: pending.value }] : [];
}

/** Applies the ops left to right (BulkEditor `applyNumberOps`). */
export function applyNumberOps(value: number, ops: NumberOp[]): number {
  return ops.reduce((v, { op, amount }) => {
    switch (op) {
      case 'increase_pct':
        return v * (1 + amount / 100);
      case 'decrease_pct':
        return v * (1 - amount / 100);
      case 'increase_fixed':
        return v + amount;
      case 'decrease_fixed':
        return v - amount;
      default:
        return amount;
    }
  }, value);
}

/** `ChangePriceModal` mode → op (listings-grid §6.3 modes). */
export function priceModeToOp(mode: 'set' | 'incPct' | 'decPct' | 'incAmt' | 'decAmt', value: number): NumberOp {
  switch (mode) {
    case 'set':
      return { op: 'set', amount: value };
    case 'incPct':
      return { op: 'increase_pct', amount: value };
    case 'decPct':
      return { op: 'decrease_pct', amount: value };
    case 'incAmt':
      return { op: 'increase_fixed', amount: value };
    default:
      return { op: 'decrease_fixed', amount: value };
  }
}

type AnyRecord = Record<string, unknown>;

function rec(v: unknown): AnyRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : {};
}

function list(v: unknown): AnyRecord[] {
  return Array.isArray(v) ? v.map(rec) : [];
}

/** Live (non-deleted) products of an Etsy inventory body. */
export function liveProducts(inventory: unknown): AnyRecord[] {
  return list(rec(inventory).products).filter((p) => !p.is_deleted);
}

/** True when the inventory has more than one product or any property values (BulkEditor rule). */
export function isMultiVariation(inventory: unknown): boolean {
  const products = liveProducts(inventory);
  return products.length > 1 || products.some((p) => Array.isArray(p.property_values) && p.property_values.length > 0);
}

/** Optional rounding applied after the ops, like `computeNewPrice` in ChangePriceModal. */
export type PriceRounding = '99' | '00' | 'none';

function roundPrice(value: number, round: PriceRounding): number {
  let next = value;
  if (round === '99') next = Math.floor(next) + 0.99;
  else if (round === '00') next = Math.round(next);
  return Math.round(next * 100) / 100;
}

/**
 * Applies price ops to every live offering of an inventory (pure). Prices never go below `minPrice` (Etsy 0.20).
 * Quantities, SKUs and the `*_on_property` arrays are kept as they are. Returns null for a single-product
 * inventory (the plain `fields.price` patch is correct there).
 */
export function applyPriceOpsToInventory(
  inventory: unknown,
  ops: NumberOp[],
  opts: { round?: PriceRounding; minPrice?: number } = {},
): AnyRecord | null {
  if (!ops.length || !isMultiVariation(inventory)) return null;
  const source = rec(inventory);
  const minPrice = opts.minPrice ?? ETSY_MIN_PRICE;
  const round = opts.round ?? 'none';
  return {
    products: liveProducts(source).map((p) => ({
      ...p,
      offerings: list(p.offerings)
        .filter((o) => !o.is_deleted)
        .map((o) => {
          const price = rec(o.price);
          const divisor = Number(price.divisor) || 100;
          const current = (Number(price.amount) || 0) / divisor;
          const value = Math.max(minPrice, roundPrice(applyNumberOps(current, ops), round));
          return { ...o, price: { ...price, amount: Math.round(value * divisor), divisor } };
        }),
    })),
    price_on_property: Array.isArray(source.price_on_property) ? source.price_on_property : [],
    quantity_on_property: Array.isArray(source.quantity_on_property) ? source.quantity_on_property : [],
    sku_on_property: Array.isArray(source.sku_on_property) ? source.sku_on_property : [],
  };
}

/** An open draft that already carries an inventory patch (it wins over the live inventory, BulkEditor rule). */
export function pendingInventoryOf(drafts: unknown): AnyRecord | null {
  const found = list(drafts).find(
    (d) => ['draft', 'failed', 'conflict'].includes(String(d.status)) && liveProducts(d.inventoryPatch).length > 0,
  );
  return found ? rec(found.inventoryPatch) : null;
}

export type VariationPriceDeps = {
  /** `GET /api/clawd/etsy?action=get_listing_inventory` body, or null when it failed. */
  fetchInventory(shopId: string, listingId: string): Promise<unknown | null>;
  /** `fetchEtsyDrafts(shopId, listingId)`. */
  fetchDrafts(shopId: string, listingId: string): Promise<unknown[]>;
};

/** Default fetchers (read-only). */
export const defaultVariationPriceDeps: VariationPriceDeps = {
  async fetchInventory(shopId, listingId) {
    const qs = new URLSearchParams({ action: 'get_listing_inventory', listing_id: listingId, shop_id: shopId });
    const res = await fetch(`/api/clawd/etsy?${qs.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return res.json();
  },
  async fetchDrafts(shopId, listingId) {
    const { fetchEtsyDrafts } = await import('@/lib/etsy/draftClient');
    try {
      return (await fetchEtsyDrafts(shopId, listingId)) as unknown[];
    } catch {
      return [];
    }
  },
};

/**
 * The inventory patch to STAGE for one variation listing, or null when the listing turned out to be single-product
 * or its inventory could not be read (the caller counts it as skipped; nothing is staged).
 */
export async function buildVariationPriceInventory(
  shopId: string,
  listingId: string,
  ops: NumberOp[],
  opts: { round?: PriceRounding; minPrice?: number } = {},
  deps: VariationPriceDeps = defaultVariationPriceDeps,
): Promise<AnyRecord | null> {
  const [remote, drafts] = await Promise.all([deps.fetchInventory(shopId, listingId), deps.fetchDrafts(shopId, listingId).catch(() => [])]);
  const source = pendingInventoryOf(drafts) ?? (remote ? rec(remote) : null);
  if (!source) return null;
  return applyPriceOpsToInventory(source, ops, opts);
}
