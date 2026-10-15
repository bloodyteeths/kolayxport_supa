/**
 * Wix executor for catalog drafts. Server-only.
 *
 * Same Wix calls as `/api/wix/products` `update` / `inventory` / `delete`.
 * Store id = WixSite.id (as in the stock-sync adapter). Stock on products with
 * more than one variant is refused (the grid shows it read-only).
 */
import prisma from '@/lib/prisma';
import { createWixClient, type WixApiClient } from '@/lib/integrations/wixClient';
import {
  CatalogExecutorError,
  ERR,
  httpStatusOf,
  type CanonicalValues,
  type CatalogExecutor,
  type CatalogExecutorSession,
  type RemoteState,
} from '../service';

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function wixRemoteValues(p: any): CanonicalValues {
  const variants = Array.isArray(p?.variants) ? p.variants : [];
  const price = n(p?.priceData?.price ?? p?.price?.price);
  const sale = n(p?.priceData?.discountedPrice ?? p?.price?.discountedPrice);
  return {
    title: typeof p?.name === 'string' ? p.name : null,
    price,
    discounted: sale !== null && price !== null && Math.round(sale * 100) !== Math.round(price * 100),
    quantity: n(p?.stock?.quantity),
    visible: p?.visible !== false,
    trackInventory: p?.stock?.trackInventory !== false,
    variantCount: Math.max(1, variants.length),
  };
}

export function createWixSession(client: WixApiClient, userId: string, wixSiteDbId: string): CatalogExecutorSession {
  return {
    async readRemote(externalIds) {
      const map = new Map<string, RemoteState>();
      for (const id of externalIds) {
        try {
          const p = await client.getProduct(id);
          map.set(id, {
            exists: Boolean(p?.id),
            updatedAt: p?.lastUpdated ? new Date(p.lastUpdated) : null,
            values: wixRemoteValues(p),
            raw: p,
          });
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
      const applied: CanonicalValues = {};

      // Validate stock preconditions before any write, so a refused stock
      // change never leaves a half-applied title/price behind.
      let inventory: any = null;
      if (patch.quantity !== undefined) {
        if ((remote.values.variantCount ?? 1) > 1) throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
        inventory = await client.getInventoryItem(draft.externalId);
        if (!inventory?.id) throw new CatalogExecutorError(`${ERR}.notTracked`, 'Inventory item not found');
        if (inventory.trackQuantity === false) throw new CatalogExecutorError(`${ERR}.notTracked`, 'Stock is not tracked');
        const variants: any[] = Array.isArray(inventory.variants) ? inventory.variants : [];
        if (variants.length !== 1 || !variants[0]?.variantId) throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
      }
      if (patch.price !== undefined && (remote.values.variantCount ?? 1) > 1) {
        throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
      }
      if (patch.price !== undefined && remote.values.discounted) {
        // Wix discounts priceData.price: writing the shown sale price there
        // would be discounted again. Edited in Wix until the grid supports it.
        throw new CatalogExecutorError(`${ERR}.wixDiscounted`, 'Product has a sale price');
      }

      const update: Record<string, unknown> = {};
      if (patch.title !== undefined) update.name = patch.title;
      if (patch.price !== undefined) update.priceData = { price: patch.price };
      if (patch.visible !== undefined) update.visible = patch.visible;
      if (Object.keys(update).length) {
        const res: any = await client.updateProduct(draft.externalId, update);
        if (patch.title !== undefined) applied.title = patch.title;
        if (patch.price !== undefined) {
          // Prefer what Wix reports back; without a discount the sale price equals the price.
          const back = res?.priceData ?? res?.product?.priceData;
          applied.price = n(back?.price) ?? patch.price;
          applied.discountPrice = n(back?.discountedPrice) ?? applied.price;
        }
        if (patch.visible !== undefined) applied.visible = patch.visible;
      }

      if (patch.quantity !== undefined && inventory) {
        const v = inventory.variants[0];
        const current = Number(v.quantity) || 0;
        const diff = patch.quantity - current;
        if (diff !== 0) await client.updateInventoryVariants(inventory.id, [{ variantId: v.variantId, quantity: diff }]);
        applied.quantity = patch.quantity;
      }
      return { kind: 'synced', applied };
    },

    async writeCache(externalId, applied, opts) {
      const where = { userId, wixSiteId: wixSiteDbId, wixProductId: externalId };
      if (opts?.deleted) {
        await prisma.wixProduct.deleteMany({ where });
        return;
      }
      await prisma.wixProduct.updateMany({
        where,
        data: {
          ...(applied.title ? { title: applied.title } : {}),
          ...(applied.price !== undefined && applied.price !== null
            // The grid shows discountPrice ?? price: keep both in step.
            ? { price: applied.price, discountPrice: applied.discountPrice ?? applied.price }
            : {}),
          ...(applied.visible !== undefined ? { visible: applied.visible } : {}),
          ...(applied.quantity !== undefined && applied.quantity !== null ? { quantity: applied.quantity, inStock: applied.quantity > 0 } : {}),
        },
      });
    },
  };
}

export const wixExecutor: CatalogExecutor = {
  async open(userId, storeId) {
    const site = await prisma.wixSite.findFirst({ where: { id: storeId, userId, isActive: true } });
    if (!site) throw new CatalogExecutorError(`${ERR}.notConnected`, 'Wix site not connected');
    const client = createWixClient(
      { wixAccessToken: site.accessToken, wixSiteId: site.siteId, wixInstanceId: site.instanceId || site.siteId, wixTokenExpiresAt: site.tokenExpiresAt },
      async (creds) => {
        try {
          await prisma.wixSite.update({ where: { id: site.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
        } catch {
          /* token persistence is best effort */
        }
      },
    );
    return createWixSession(client, userId, site.id);
  },
};
