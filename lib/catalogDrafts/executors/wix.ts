/**
 * Wix executor for catalog drafts. Server-only.
 *
 * Edit (marketplace-editors §6.2), in this order, all preconditions checked
 * before the first write:
 *   1. product PATCH: name, description, price, discount, SKU, weight,
 *      visible, ribbon, custom text fields;
 *   2. inventory: quantity alone (single variant, by difference); tracked
 *      quantity / tracking on (absolute `setInventoryVariantQuantities`); tracking
 *      off / in stock (`updateInventoryItem`, not in the client yet: refused with
 *      `actionUnavailable` before any write);
 *   3. collections: the staged target set is diffed against the live product;
 *   4. media: remove (ids not on the product are skipped) → reorder (latest
 *      op) → add (appended).
 * A failure after the first write fails the draft with
 * `listings.draftError.partial.<step>`; a retry re-runs the (idempotent) steps.
 *
 * Create (§5.2): createProduct → collections → media → inventory. A failure
 * after the product exists turns the draft into an edit draft of it
 * (`createdExternalId`), so Retry never creates a second product; media adds
 * that already ran are dropped from that draft (an add is not idempotent).
 * A new Wix product starts untracked and in stock, so tracking off + in stock
 * needs no inventory write; a staged quantity turns tracking on.
 *
 * Collection and media writes use the M6b-B client methods
 * (`lib/integrations/wixClient.ts`); they are looked up at runtime and a
 * missing one fails the send with `listings.draftError.actionUnavailable`
 * before anything is written. Store id = WixSite.id (as in the stock-sync adapter).
 */
import prisma from '@/lib/prisma';
import { createWixClient, type WixApiClient } from '@/lib/integrations/wixClient';
import { ensureWixCatalogVersion, wixCatalogOptionsForSite } from '@/lib/integrations/wixSiteCatalog';
import {
  CatalogExecutorError,
  ERR,
  httpStatusOf,
  isCreateDraft,
  partialStepError,
  toExecutorError,
  type ApplyOutcome,
  type CanonicalValues,
  type CatalogDraftRecord,
  type CatalogExecutor,
  type CatalogExecutorSession,
  type RemoteState,
} from '../service';
import { createPayloadOf, type WixCreatePayload, type WixMediaOp } from '../schemas';
import { WIX_ALL_PRODUCTS, num, wixValuesFromApi } from '../values';

/** Canonical values of a Wix API product (kept under its v1 name). */
export const wixRemoteValues = wixValuesFromApi;

/** Writes the M6b-B client adds (optional: checked at runtime). */
export type WixWriteMethods = {
  addProductsToCollection?(collectionId: string, productIds: string[]): Promise<unknown>;
  removeProductsFromCollection?(collectionId: string, productIds: string[]): Promise<unknown>;
  addProductMedia?(productId: string, media: ({ url: string } | { mediaId: string })[]): Promise<unknown>;
  removeProductMedia?(productId: string, mediaIds: string[]): Promise<unknown>;
  reorderProductMedia?(productId: string, orderedMediaIds: string[]): Promise<unknown>;
  /**
   * Absolute inventory PATCH with `trackQuantity: false` + `variants[].inStock` (tracking off / in stock).
   * Not in the M6b-B client yet (outOfScopeNeed); tracked quantities use `setInventoryVariantQuantities`.
   */
  updateInventoryItem?(productId: string, item: { trackQuantity?: boolean; variants?: { variantId: string; quantity?: number; inStock?: boolean }[] }): Promise<unknown>;
};
export type WixClientLike = Pick<WixApiClient, 'getProduct' | 'createProduct' | 'updateProduct' | 'deleteProduct' | 'getInventoryItem' | 'updateInventoryVariants' | 'setInventoryVariantQuantities'> & WixWriteMethods;

const unavailable = (what: string) => new CatalogExecutorError(`${ERR}.actionUnavailable`, `Wix client cannot ${what} yet`, { action: what });

function requireMethods(client: WixClientLike, names: (keyof WixWriteMethods)[]) {
  for (const n of names) if (typeof client[n] !== 'function') throw unavailable(n);
}

/** Media ops → the concrete removes, reorder and adds against the live media ids. */
export function planWixMedia(ops: WixMediaOp[], currentIds: string[]): { remove: string[]; order: string[] | null; add: string[] } {
  const remove = Array.from(new Set(ops.filter((o): o is Extract<WixMediaOp, { op: 'remove' }> => o.op === 'remove').map((o) => o.mediaId)))
    .filter((id) => currentIds.includes(id));
  const left = currentIds.filter((id) => !remove.includes(id));
  const reorders = ops.filter((o): o is Extract<WixMediaOp, { op: 'reorder' }> => o.op === 'reorder');
  let order: string[] | null = null;
  if (reorders.length && left.length > 1) {
    const wanted = reorders[reorders.length - 1].ids.filter((id) => left.includes(id));
    const full = [...wanted, ...left.filter((id) => !wanted.includes(id))];
    if (full.some((id, i) => id !== left[i])) order = full;
  }
  const add = Array.from(new Set(ops.filter((o): o is Extract<WixMediaOp, { op: 'add' }> => o.op === 'add').map((o) => o.url)));
  return { remove, order, add };
}

/** Product PATCH body from the patch (only the keys it touches). */
export function wixProductUpdate(draft: CatalogDraftRecord): Record<string, unknown> {
  const p = draft.fieldPatch;
  const update: Record<string, unknown> = {};
  if (p.title !== undefined) update.name = p.title;
  if (p.description !== undefined) update.description = p.description;
  if (p.price !== undefined) update.priceData = { price: p.price };
  if (p.discount !== undefined) update.discount = { type: p.discount.type, value: p.discount.type === 'NONE' ? 0 : p.discount.value };
  if (p.sku !== undefined) update.sku = p.sku;
  if (p.weight !== undefined) update.weight = p.weight;
  if (p.visible !== undefined) update.visible = p.visible;
  if (p.ribbon !== undefined) update.ribbon = p.ribbon;
  if (p.customTextFields !== undefined) update.customTextFields = p.customTextFields;
  return update;
}

function appliedFromUpdate(draft: CatalogDraftRecord, res: any, applied: CanonicalValues) {
  const p = draft.fieldPatch;
  if (p.title !== undefined) applied.title = p.title;
  if (p.description !== undefined) applied.description = p.description;
  if (p.price !== undefined || p.discount !== undefined) {
    // Prefer what Wix reports back; without a discount the sale price equals the price.
    const back = res?.priceData ?? res?.product?.priceData;
    const price = num(back?.price) ?? p.price ?? null;
    if (price !== null) {
      applied.price = price;
      applied.discountPrice = num(back?.discountedPrice) ?? price;
    }
  }
  if (p.sku !== undefined) applied.sku = p.sku;
  if (p.weight !== undefined) applied.weight = p.weight;
  if (p.visible !== undefined) applied.visible = p.visible;
  if (p.ribbon !== undefined) applied.ribbon = p.ribbon;
  if (p.customTextFields !== undefined) applied.customTextFields = p.customTextFields;
}

/**
 * Which inventory write a patch needs on a product whose live item is `inventory` (null = a product the
 * create just made: untracked and in stock):
 *  - `set`: tracked, and tracking is turned on or a quantity is set on a create (absolute
 *    `setInventoryVariantQuantities`);
 *  - `increment`: tracked already, quantity only (by difference, as before);
 *  - `untracked`: tracking turned off on a tracked product, or in stock set (`updateInventoryItem`);
 *  - `none`: nothing to write (a create left untracked and in stock = the Wix default).
 */
export function wixInventoryPlan(
  p: CatalogDraftRecord['fieldPatch'],
  inventory: { trackQuantity?: boolean } | null,
): 'set' | 'increment' | 'untracked' | 'none' {
  const liveTracked = inventory ? inventory.trackQuantity !== false : false;
  // On a create a staged quantity turns tracking on; on an edit tracking stays as it is unless staged.
  const track = p.trackInventory ?? (inventory === null && p.quantity !== undefined ? true : liveTracked);
  if (track) {
    if (!liveTracked || !inventory) return 'set';
    return p.quantity !== undefined ? 'increment' : 'none';
  }
  if (liveTracked || (p.inStock !== undefined && !(inventory === null && p.inStock === true))) return 'untracked';
  return 'none';
}
const inventoryPlan = wixInventoryPlan;

export function createWixSession(client: WixClientLike, userId: string, wixSiteDbId: string): CatalogExecutorSession {
  /** Inventory writes for an existing product (edit, or after create). Returns what changed. */
  async function writeInventory(
    productId: string,
    draft: CatalogDraftRecord,
    inventory: any,
    applied: CanonicalValues,
    plan: ReturnType<typeof inventoryPlan> = inventoryPlan(draft.fieldPatch, inventory),
  ) {
    const p = draft.fieldPatch;
    const variants: any[] = Array.isArray(inventory?.variants) ? inventory.variants : [];
    if (plan === 'set') {
      // Absolute tracked quantities (this also turns tracking on). A staged quantity is for the single
      // variant (checked before any write); without one every variant keeps its current quantity.
      const list = variants.filter((v) => typeof v?.variantId === 'string' && v.variantId);
      if (!list.length || (p.quantity !== undefined && list.length !== 1)) {
        throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
      }
      const rows = list.map((v) => ({ variantId: v.variantId as string, quantity: p.quantity ?? (Number(v.quantity) || 0) }));
      await client.setInventoryVariantQuantities(productId, rows);
      applied.trackInventory = true;
      if (rows.length === 1) applied.quantity = rows[0].quantity;
      return;
    }
    if (plan === 'untracked') {
      await client.updateInventoryItem!(productId, {
        trackQuantity: false,
        ...(p.inStock !== undefined && variants.length ? { variants: variants.map((v) => ({ variantId: v.variantId, inStock: p.inStock as boolean })) } : {}),
      });
      applied.trackInventory = false;
      if (p.inStock !== undefined) applied.inStock = p.inStock;
      return;
    }
    if (plan === 'increment' && p.quantity !== undefined) {
      const v = variants[0];
      const diff = p.quantity - (Number(v.quantity) || 0);
      if (diff !== 0) await client.updateInventoryVariants(inventory.id, [{ variantId: v.variantId, quantity: diff }]);
      applied.quantity = p.quantity;
    }
  }

  /** Inventory preconditions (before any write). Returns the inventory item or null when not needed. */
  async function checkInventory(productId: string, draft: CatalogDraftRecord, variantCount: number): Promise<any> {
    const p = draft.fieldPatch;
    if (p.quantity === undefined && p.inStock === undefined && p.trackInventory === undefined) return null;
    if ((p.quantity !== undefined || p.inStock !== undefined) && variantCount > 1) {
      throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
    }
    const inventory = await client.getInventoryItem(productId);
    if (!inventory?.id) throw new CatalogExecutorError(`${ERR}.notTracked`, 'Inventory item not found');
    if (inventoryPlan(p, inventory) === 'untracked') requireMethods(client, ['updateInventoryItem']);
    const track = p.trackInventory ?? inventory.trackQuantity !== false;
    if (p.quantity !== undefined) {
      if (!track) throw new CatalogExecutorError(`${ERR}.notTracked`, 'Stock is not tracked');
      const variants: any[] = Array.isArray(inventory.variants) ? inventory.variants : [];
      if (variants.length !== 1 || !variants[0]?.variantId) throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
    }
    if (p.inStock !== undefined && track) throw new CatalogExecutorError(`${ERR}.inStockTracked`, 'In stock is set by the quantity while stock is tracked');
    return inventory;
  }

  async function writeCollections(productId: string, target: string[], current: string[], applied: CanonicalValues) {
    const wanted = target.filter((id) => id !== WIX_ALL_PRODUCTS);
    for (const id of wanted.filter((c) => !current.includes(c))) await client.addProductsToCollection!(id, [productId]);
    for (const id of current.filter((c) => !wanted.includes(c) && c !== WIX_ALL_PRODUCTS)) await client.removeProductsFromCollection!(id, [productId]);
    applied.collectionIds = wanted;
  }

  async function writeMedia(productId: string, ops: WixMediaOp[], currentIds: string[]) {
    const plan = planWixMedia(ops, currentIds);
    if (plan.remove.length) await client.removeProductMedia!(productId, plan.remove);
    if (plan.order) await client.reorderProductMedia!(productId, plan.order);
    if (plan.add.length) await client.addProductMedia!(productId, plan.add.map((url) => ({ url })));
  }

  async function create(draft: CatalogDraftRecord): Promise<ApplyOutcome> {
    const p = draft.fieldPatch;
    const payload = createPayloadOf(draft.queuedActions) as WixCreatePayload;
    const missing = [p.title === undefined ? 'title' : null, p.price === undefined ? 'price' : null].filter(Boolean) as string[];
    if (missing.length) throw new CatalogExecutorError(`${ERR}.createIncomplete`, 'Wix create is missing required values', { fields: missing.join(', '), count: missing.length });
    if (p.inStock !== undefined && p.trackInventory !== false) throw new CatalogExecutorError(`${ERR}.inStockTracked`, 'In stock needs tracking off');
    // A staged quantity with no tracking value turns tracking on (stage refuses quantity with tracking off).
    if (p.quantity !== undefined && p.trackInventory === false) throw new CatalogExecutorError(`${ERR}.notTracked`, 'Quantity needs tracking on');
    const inventoryWrite = inventoryPlan(p, null);
    // Every method a later step needs must exist before the product is created.
    if (inventoryWrite === 'untracked') requireMethods(client, ['updateInventoryItem']);
    if (p.collectionIds?.length) requireMethods(client, ['addProductsToCollection']);
    const adds = (p.media || []).filter((o) => o.op === 'add');
    if (adds.length) requireMethods(client, ['addProductMedia']);

    const body = { ...wixProductUpdate(draft), productType: payload.productType || 'physical' } as Parameters<WixApiClient['createProduct']>[0];
    const product: any = await client.createProduct(body);
    const id = typeof product?.id === 'string' ? product.id : '';
    if (!id) throw new CatalogExecutorError(`${ERR}.remoteFailed`, 'Wix returned no product id');
    const applied: CanonicalValues = {};
    appliedFromUpdate(draft, product, applied);

    // Once the media adds ran, the draft left for Retry must not hold them again (an add is not idempotent).
    let remainingPatch: Record<string, unknown> | undefined;
    const step = async (name: 'inventory' | 'collections' | 'media', fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        throw partialStepError(name, err, { createdExternalId: id, remainingPatch });
      }
    };
    // §5.2 order: collections → media → inventory.
    if (p.collectionIds?.length) await step('collections', () => writeCollections(id, p.collectionIds as string[], [], applied));
    if (adds.length) {
      await step('media', () => writeMedia(id, adds, []));
      remainingPatch = { media: (p.media || []).filter((o) => o.op !== 'add') };
    }
    if (inventoryWrite !== 'none') {
      await step('inventory', async () => writeInventory(id, draft, await client.getInventoryItem(id), applied, inventoryWrite));
    } else if (p.trackInventory === false) {
      applied.trackInventory = false;
    }
    return { kind: 'synced', applied, externalId: id };
  }

  return {
    async readRemote(externalIds) {
      const map = new Map<string, RemoteState>();
      for (const id of externalIds) {
        try {
          const p = await client.getProduct(id);
          map.set(id, {
            exists: Boolean(p?.id),
            updatedAt: p?.lastUpdated ? new Date(p.lastUpdated) : null,
            values: wixValuesFromApi(p),
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
      if (isCreateDraft(draft)) return create(draft);
      const patch = draft.fieldPatch;
      const applied: CanonicalValues = {};
      const variantCount = remote.values.variantCount ?? 1;

      // Phase 1: preconditions, before any write, so a refused change never
      // leaves a half-applied product behind.
      if (patch.price !== undefined && variantCount > 1) {
        throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
      }
      if (patch.price !== undefined && remote.values.discounted && patch.discount === undefined) {
        // Wix discounts priceData.price: writing the shown sale price there
        // would be discounted again. The editor stages price + discount together.
        throw new CatalogExecutorError(`${ERR}.wixDiscounted`, 'Product has a sale price');
      }
      if (patch.collectionIds !== undefined) requireMethods(client, ['addProductsToCollection', 'removeProductsFromCollection']);
      const media = patch.media || [];
      const currentMedia = (remote.values.mediaItems || []).map((m) => m.id);
      const mediaPlan = planWixMedia(media, currentMedia);
      if (mediaPlan.remove.length) requireMethods(client, ['removeProductMedia']);
      if (mediaPlan.order) requireMethods(client, ['reorderProductMedia']);
      if (mediaPlan.add.length) requireMethods(client, ['addProductMedia']);
      const inventory = await checkInventory(draft.externalId, draft, variantCount);

      // Phase 2: writes.
      let wrote = false;
      const step = async (name: 'inventory' | 'collections' | 'media', fn: () => Promise<void>) => {
        try {
          await fn();
          wrote = true;
        } catch (err) {
          throw wrote ? partialStepError(name, err) : toExecutorError(err);
        }
      };
      const update = wixProductUpdate(draft);
      if (Object.keys(update).length) {
        const res: any = await client.updateProduct(draft.externalId, update);
        appliedFromUpdate(draft, res, applied);
        wrote = true;
      }
      if (inventory) await step('inventory', () => writeInventory(draft.externalId, draft, inventory, applied));
      if (patch.collectionIds !== undefined) {
        await step('collections', () => writeCollections(draft.externalId, patch.collectionIds as string[], remote.values.collectionIds || [], applied));
      }
      if (media.length) await step('media', () => writeMedia(draft.externalId, media, currentMedia));
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
          ...(typeof applied.trackInventory === 'boolean' ? { trackInventory: applied.trackInventory } : {}),
          ...(typeof applied.inStock === 'boolean' ? { inStock: applied.inStock } : {}),
          ...(typeof applied.description === 'string' ? { description: applied.description } : {}),
          ...(typeof applied.sku === 'string' ? { sku: applied.sku || null } : {}),
          ...(typeof applied.weight === 'number' ? { weight: applied.weight } : {}),
          ...(typeof applied.ribbon === 'string' ? { ribbon: applied.ribbon || null } : {}),
          ...(Array.isArray(applied.customTextFields) ? { customTextFields: applied.customTextFields as any } : {}),
          ...(Array.isArray(applied.collectionIds) ? { collectionIds: applied.collectionIds as any } : {}),
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
      wixCatalogOptionsForSite(site),
    );
    await ensureWixCatalogVersion(client);
    return createWixSession(client as WixApiClient & WixWriteMethods, userId, site.id);
  },
};
