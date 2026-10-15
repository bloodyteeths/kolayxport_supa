/**
 * Shopify executor for catalog drafts. Server-only.
 *
 * Same writes as `/api/shopify/products` `update` and `updateVariants`:
 * title/tags/status through the product PUT, price through the single
 * variant, stock through inventory_levels/set at the product's only location.
 * Price/stock on multi-variant products and stock spread over several
 * locations are refused, never guessed.
 */
import prisma from '@/lib/prisma';
import { ShopifyClient, getValidAccessToken } from '@/lib/integrations/shopifyClient';
import {
  CatalogExecutorError,
  ERR,
  httpStatusOf,
  type CanonicalValues,
  type CatalogExecutor,
  type CatalogExecutorSession,
  type RemoteState,
} from '../service';

const API_VERSION = '2024-10';

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function splitShopifyTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String).map((t) => t.trim()).filter(Boolean);
  return typeof tags === 'string' ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
}

export function shopifyRemoteValues(p: any): CanonicalValues {
  const variants: any[] = Array.isArray(p?.variants) ? p.variants : [];
  const first = variants[0];
  return {
    title: typeof p?.title === 'string' ? p.title : null,
    price: n(first?.price),
    quantity: variants.reduce((s, v) => s + (Number(v?.inventory_quantity) || 0), 0),
    tags: splitShopifyTags(p?.tags),
    status: p?.status ?? null,
    trackInventory: first?.inventory_management === 'shopify',
    variantCount: Math.max(1, variants.length),
  };
}

type LevelReader = (inventoryItemId: string) => Promise<{ location_id: number; available: number | null }[]>;

export function createShopifySession(client: ShopifyClient, userId: string, shopId: string, readLevels: LevelReader): CatalogExecutorSession {
  return {
    async readRemote(externalIds) {
      const map = new Map<string, RemoteState>();
      for (const id of externalIds) {
        try {
          const p = await client.getProduct(id);
          map.set(id, p?.id
            ? { exists: true, updatedAt: p.updated_at ? new Date(p.updated_at) : null, values: shopifyRemoteValues(p), raw: p }
            : { exists: false, updatedAt: null, values: {} });
        } catch (err) {
          if (httpStatusOf(err) === 404) map.set(id, { exists: false, updatedAt: null, values: {} });
          else throw err;
        }
      }
      return map;
    },

    async apply(draft, remote) {
      if (draft.queuedActions.some((a) => a.type === 'delete' && !a.completedAt)) {
        await client.deleteProduct(draft.externalId);
        return { kind: 'synced', applied: {}, deleted: true };
      }
      const patch = draft.fieldPatch;
      const product: any = remote.raw || {};
      const variants: any[] = Array.isArray(product.variants) ? product.variants : [];
      const variant = variants[0];
      const applied: CanonicalValues = {};

      // Phase 1: preconditions, before any write.
      if ((patch.price !== undefined || patch.quantity !== undefined) && variants.length !== 1) {
        throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
      }
      let locationId: string | null = null;
      if (patch.quantity !== undefined) {
        if (variant?.inventory_management !== 'shopify' || !variant?.inventory_item_id) {
          throw new CatalogExecutorError(`${ERR}.notTracked`, 'Stock is not tracked');
        }
        const levels = await readLevels(String(variant.inventory_item_id));
        if (levels.length === 0) throw new CatalogExecutorError(`${ERR}.noLocation`, 'No inventory location');
        if (levels.length > 1) throw new CatalogExecutorError(`${ERR}.multiLocation`, 'Stock is spread over several locations');
        locationId = String(levels[0].location_id);
      }

      // Phase 2: writes.
      const update: Record<string, unknown> = {};
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.tags !== undefined) update.tags = patch.tags.join(', ');
      if (patch.status !== undefined) update.status = patch.status;
      if (Object.keys(update).length) {
        await client.updateProduct(draft.externalId, update);
        if (patch.title !== undefined) applied.title = patch.title;
        if (patch.tags !== undefined) applied.tags = patch.tags;
        if (patch.status !== undefined) applied.status = patch.status;
      }
      if (patch.price !== undefined) {
        await client.updateProductVariant(String(variant.id), { price: String(Math.round(patch.price * 100) / 100) });
        applied.price = patch.price;
      }
      if (patch.quantity !== undefined && locationId) {
        await client.setInventoryLevel(String(variant.inventory_item_id), locationId, patch.quantity);
        applied.quantity = patch.quantity;
      }
      return { kind: 'synced', applied };
    },

    async writeCache(externalId, applied, opts) {
      const where = { userId, shopifyShopId: shopId, shopifyProductId: externalId };
      if (opts?.deleted) {
        await prisma.shopifyProduct.deleteMany({ where });
        return;
      }
      await prisma.shopifyProduct.updateMany({
        where,
        data: {
          ...(applied.title ? { title: applied.title } : {}),
          ...(applied.tags ? { tags: applied.tags } : {}),
          ...(applied.status ? { status: applied.status } : {}),
          ...(applied.price !== undefined && applied.price !== null ? { price: applied.price } : {}),
          ...(applied.quantity !== undefined && applied.quantity !== null ? { totalInventory: applied.quantity } : {}),
        },
      });
    },
  };
}

/** Inventory levels of one item (REST, read_inventory), with a bounded 429 retry. */
function levelReader(shopDomain: string, accessToken: string): LevelReader {
  return async (inventoryItemId) => {
    const url = `https://${shopDomain}/admin/api/${API_VERSION}/inventory_levels.json?limit=50&inventory_item_ids=${encodeURIComponent(inventoryItemId)}`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken }, signal: AbortSignal.timeout(15_000) });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!res || !res.ok) throw new Error(`Shopify inventory read failed: ${res?.status ?? 'no response'}`);
    const json = await res.json();
    const levels: any[] = Array.isArray(json?.inventory_levels) ? json.inventory_levels : [];
    return levels.map((l) => ({ location_id: l.location_id, available: l.available ?? null }));
  };
}

export const shopifyExecutor: CatalogExecutor = {
  async open(userId, storeId) {
    const shop = await prisma.shopifyShop.findFirst({ where: { id: storeId, userId, isActive: true }, select: { id: true, shopDomain: true } });
    if (!shop) throw new CatalogExecutorError(`${ERR}.notConnected`, 'Shopify store not connected');
    const accessToken = await getValidAccessToken(shop.id);
    const client = new ShopifyClient({ accessToken, shopDomain: shop.shopDomain });
    return createShopifySession(client, userId, shop.id, levelReader(shop.shopDomain, accessToken));
  },
};
