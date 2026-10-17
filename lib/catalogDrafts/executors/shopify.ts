/**
 * Shopify executor for catalog drafts. Server-only.
 *
 * Edit (marketplace-editors §6.3), preconditions first, then in this order:
 *   1. product PUT: title, body_html, vendor, product_type, tags, status;
 *   2. single-variant PUT: price, compare-at, SKU, weight (+ unit);
 *   3. single-variant stock at the product's only location;
 *   4. variant table edits (`variants[]`): the per-variant partial-failure
 *      handling and `expectedQuantity` check of `/api/shopify/products`
 *      `updateVariants` are kept: a failed row never blocks the others, and the
 *      failed ids come back in `details.variants`;
 *   5. image ops: delete (ids not on the product are skipped) → add → reorder
 *      (latest per image) → alt (latest per image);
 *   6. SEO through Admin GraphQL `productUpdate`.
 * Price/stock on multi-variant products and stock spread over several
 * locations are refused, never guessed.
 *
 * Create (§5.3): createProduct (status Draft unless the seller picked Active)
 * → stock → images → SEO. A failure after the product exists turns the draft
 * into an edit draft of it (`createdExternalId`), so Retry never creates twice.
 *
 * Image adds are not idempotent: after a failure the stored draft keeps only the adds that did not succeed
 * (`remainingPatch`), so a Retry never uploads a photo twice.
 */
import prisma from '@/lib/prisma';
import { ShopifyClient, getValidAccessToken } from '@/lib/integrations/shopifyClient';
import { resolveImageId } from '@/lib/integrations/shopifyImageIds';
import { assertNoUserErrors, toGid } from '@/lib/integrations/shopifyGraphql';
import { SEO_QUERY, SEO_UPDATE_MUTATION } from '@/lib/integrations/shopifySeo';
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
  type ExecutorFailureDetails,
  type RemoteState,
} from '../service';
import type { ShopifyImageOp, ShopifySeo, ShopifyVariantEdit } from '../schemas';
import { shopifyValuesFromApi, splitShopifyTags } from '../values';

export { splitShopifyTags };

/** Canonical values of a Shopify product in the client's REST shape (kept under its v1 name). */
export function shopifyRemoteValues(p: any, seo?: ShopifySeo | null): CanonicalValues {
  return shopifyValuesFromApi(p, seo);
}

type LevelReader = (inventoryItemId: string) => Promise<{ location_id: number; available: number | null }[]>;
/** SEO read/write (Admin GraphQL). Optional so tests and callers without a token can omit it. */
export type ShopifySeoIO = {
  read(productId: string): Promise<ShopifySeo>;
  write(productId: string, seo: ShopifySeo): Promise<ShopifySeo>;
};
type ShopifyClientLike = Pick<ShopifyClient,
  'getProduct' | 'createProduct' | 'updateProduct' | 'deleteProduct' | 'updateProductVariant' | 'setInventoryLevel'
  | 'createProductImage' | 'updateProductImage' | 'deleteProductImage'>;

/** Shopify REST money string ("13.00") for a non-negative major-unit amount (wire format, not display). */
export function apiMoney(n: number): string {
  const cents = Math.round(Math.abs(n) * 100);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const SINGLE_KEYS = ['price', 'quantity', 'compareAtPrice', 'sku', 'weight', 'weightUnit'] as const;

/** Single-variant PUT body from the patch (only the keys it touches). */
export function singleVariantUpdate(patch: CatalogDraftRecord['fieldPatch']): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.price !== undefined) u.price = String(Math.round(patch.price * 100) / 100);
  if (patch.compareAtPrice !== undefined) u.compare_at_price = patch.compareAtPrice > 0 ? String(patch.compareAtPrice) : null;
  if (patch.sku !== undefined) u.sku = patch.sku;
  if (patch.weight !== undefined) u.weight = patch.weight;
  if (patch.weightUnit !== undefined) u.weight_unit = patch.weightUnit;
  return u;
}

/** Product PUT body (title, description, vendor, type, tags, status). */
export function productUpdate(patch: CatalogDraftRecord['fieldPatch']): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.title !== undefined) u.title = patch.title;
  if (patch.description !== undefined) u.body_html = patch.description;
  if (patch.vendor !== undefined) u.vendor = patch.vendor;
  if (patch.productType !== undefined) u.product_type = patch.productType;
  if (patch.tags !== undefined) u.tags = patch.tags.join(', ');
  if (patch.status !== undefined) u.status = patch.status;
  return u;
}

/** Image ops → concrete writes against the live image ids. */
export function planShopifyImages(ops: ShopifyImageOp[], currentIds: string[]) {
  const del = Array.from(new Set(ops.filter((o): o is Extract<ShopifyImageOp, { op: 'delete' }> => o.op === 'delete').map((o) => o.id)))
    .filter((id) => currentIds.includes(id));
  const left = new Set(currentIds.filter((id) => !del.includes(id)));
  const seenSrc = new Set<string>();
  const add: Extract<ShopifyImageOp, { op: 'add' }>[] = [];
  for (const o of ops) {
    if (o.op === 'add' && !seenSrc.has(o.src)) {
      seenSrc.add(o.src);
      add.push(o);
    }
  }
  const latest = <T extends { id: string }>(kind: string) => {
    const m = new Map<string, T>();
    for (const o of ops) if (o.op === kind && left.has((o as unknown as T).id)) m.set((o as unknown as T).id, o as unknown as T);
    return Array.from(m.values());
  };
  return {
    del,
    add,
    reorder: latest<Extract<ShopifyImageOp, { op: 'reorder' }>>('reorder'),
    alt: latest<Extract<ShopifyImageOp, { op: 'alt' }>>('alt'),
  };
}

export function createShopifySession(
  client: ShopifyClientLike,
  userId: string,
  shopId: string,
  readLevels: LevelReader,
  seoIO?: ShopifySeoIO,
): CatalogExecutorSession {
  /** Single location of one inventory item, or a stable error. */
  async function onlyLocation(inventoryItemId: string): Promise<{ locationId: string; available: number | null }> {
    const levels = await readLevels(inventoryItemId);
    if (levels.length === 0) throw new CatalogExecutorError(`${ERR}.noLocation`, 'No inventory location');
    if (levels.length > 1) throw new CatalogExecutorError(`${ERR}.multiLocation`, 'Stock is spread over several locations');
    return { locationId: String(levels[0].location_id), available: levels[0].available };
  }

  /** Variant-table edits: every row on its own; failures are collected, never thrown. */
  async function writeVariants(edits: ShopifyVariantEdit[], liveVariants: any[], failures: { id: string; code: string }[]) {
    let wrote = false;
    for (const edit of edits) {
      const variant = liveVariants.find((v) => String(v?.id) === edit.id);
      if (!variant) {
        failures.push({ id: edit.id, code: 'NOT_FOUND' });
        continue;
      }
      let location: { locationId: string; available: number | null } | null = null;
      if (edit.inventoryQuantity !== undefined) {
        if (variant.inventory_management !== 'shopify' || !variant.inventory_item_id) {
          failures.push({ id: edit.id, code: 'NOT_TRACKED' });
          continue;
        }
        try {
          location = await onlyLocation(String(variant.inventory_item_id));
        } catch (err) {
          const key = (err as CatalogExecutorError).errorKey;
          failures.push({ id: edit.id, code: key === `${ERR}.multiLocation` ? 'MULTI_LOCATION' : key === `${ERR}.noLocation` ? 'NO_LOCATION' : 'FAILED' });
          continue;
        }
        const current = location.available ?? 0;
        // Our own earlier, partly failed send may already have written the target: not a change by someone else.
        if (edit.expectedQuantity !== undefined && current !== edit.expectedQuantity && current !== edit.inventoryQuantity) {
          failures.push({ id: edit.id, code: 'STOCK_CHANGED' });
          continue;
        }
      }
      try {
        const u: Record<string, unknown> = {};
        if (edit.price !== undefined) u.price = apiMoney(edit.price);
        if (edit.compareAtPrice !== undefined) u.compare_at_price = edit.compareAtPrice === null || edit.compareAtPrice === 0 ? null : apiMoney(edit.compareAtPrice);
        if (edit.sku !== undefined) u.sku = edit.sku;
        if (Object.keys(u).length) {
          await client.updateProductVariant(edit.id, u);
          wrote = true;
        }
        if (location && edit.inventoryQuantity !== undefined && (location.available ?? 0) !== edit.inventoryQuantity) {
          await client.setInventoryLevel(String(variant.inventory_item_id), location.locationId, edit.inventoryQuantity);
          wrote = true;
        }
      } catch {
        failures.push({ id: edit.id, code: 'FAILED' });
      }
    }
    return wrote;
  }

  /**
   * Image ops; failures are collected in `failed` (index into `ops` as sent). `remaining`: `ops` without the adds
   * that succeeded (an add is not idempotent: a Retry must not upload it twice). Deletes, reorders and alt
   * edits stay, as re-running them is harmless (a deleted id is skipped).
   */
  async function writeImages(productId: string, ops: ShopifyImageOp[], currentIds: string[], failed: NonNullable<ExecutorFailureDetails['ops']>) {
    const plan = planShopifyImages(ops, currentIds);
    const indexOf = (o: ShopifyImageOp) => ops.indexOf(o);
    let wrote = false;
    const added = new Set<string>();
    const run = async (o: ShopifyImageOp, fn: () => Promise<unknown>) => {
      try {
        await fn();
        wrote = true;
        if (o.op === 'add') added.add(o.src);
      } catch (err) {
        failed.push({ index: indexOf(o), op: o.op, key: toExecutorError(err).errorKey });
      }
    };
    for (const id of plan.del) {
      const o = ops.find((x) => x.op === 'delete' && x.id === id) as ShopifyImageOp;
      await run(o, () => client.deleteProductImage(productId, id));
    }
    for (const o of plan.add) {
      await run(o, () => client.createProductImage(productId, { src: o.src, ...(o.alt !== undefined ? { alt: o.alt } : {}), ...(o.position ? { position: o.position } : {}) }));
    }
    for (const o of plan.reorder) await run(o, () => client.updateProductImage(productId, o.id, { position: o.position }));
    for (const o of plan.alt) await run(o, () => client.updateProductImage(productId, o.id, { alt: o.alt }));
    const remaining = ops.filter((o) => !(o.op === 'add' && added.has(o.src)));
    return { wrote, remaining };
  }

  async function create(draft: CatalogDraftRecord): Promise<ApplyOutcome> {
    const p = draft.fieldPatch;
    if (p.title === undefined) throw new CatalogExecutorError(`${ERR}.createIncomplete`, 'Shopify create needs a title', { fields: 'title', count: 1 });
    if (p.seo && !seoIO) throw new CatalogExecutorError(`${ERR}.actionUnavailable`, 'SEO writer missing', { action: 'seo' });
    if (Array.isArray(p.variants) && p.variants.length) {
      throw new CatalogExecutorError(`${ERR}.invalidVariants`, 'Variant options are added in Shopify after creating');
    }
    const variant = singleVariantUpdate(p);
    if (p.quantity !== undefined) variant.inventory_management = 'shopify';
    const product: any = await client.createProduct({
      ...(productUpdate(p) as { title: string }),
      status: p.status ?? 'draft',
      ...(Object.keys(variant).length ? { variants: [variant] } : {}),
    });
    const id = product?.id ? String(product.id) : '';
    if (!id) throw new CatalogExecutorError(`${ERR}.remoteFailed`, 'Shopify returned no product id');
    const applied: CanonicalValues = { title: p.title, status: p.status ?? 'draft' };

    if (p.quantity !== undefined) {
      try {
        const v = Array.isArray(product.variants) ? product.variants[0] : null;
        if (!v?.inventory_item_id) throw new CatalogExecutorError(`${ERR}.notTracked`, 'Stock is not tracked');
        const loc = await onlyLocation(String(v.inventory_item_id));
        await client.setInventoryLevel(String(v.inventory_item_id), loc.locationId, p.quantity);
        applied.quantity = p.quantity;
      } catch (err) {
        throw partialStepError('inventory', err, { createdExternalId: id });
      }
    }
    const images = (Array.isArray(p.images) ? p.images : []) as ShopifyImageOp[];
    const adds = images.filter((o) => o.op === 'add');
    // Once images were added, the draft left for Retry keeps only the ones that were not.
    let remainingPatch: Record<string, unknown> | undefined;
    if (adds.length) {
      const failed: NonNullable<ExecutorFailureDetails['ops']> = [];
      const res = await writeImages(id, adds, [], failed);
      remainingPatch = { images: res.remaining };
      if (failed.length) throw partialStepError('images', null, { createdExternalId: id, details: { ops: failed }, remainingPatch });
    }
    if (p.seo && seoIO) {
      try {
        applied.seo = await seoIO.write(id, p.seo);
      } catch (err) {
        throw partialStepError('seo', err, { createdExternalId: id, remainingPatch });
      }
    }
    return { kind: 'synced', applied, externalId: id };
  }

  return {
    async readRemote(externalIds, opts) {
      const wantSeo = Boolean(seoIO && opts?.keys?.includes('seo'));
      const map = new Map<string, RemoteState>();
      for (const id of externalIds) {
        try {
          const p = await client.getProduct(id);
          if (!p?.id) {
            map.set(id, { exists: false, updatedAt: null, values: {} });
            continue;
          }
          const seo = wantSeo ? await seoIO!.read(id) : null;
          map.set(id, { exists: true, updatedAt: p.updated_at ? new Date(p.updated_at) : null, values: shopifyValuesFromApi(p, seo), raw: p });
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
      const product: any = remote.raw || {};
      const variants: any[] = Array.isArray(product.variants) ? product.variants : [];
      const variant = variants[0];
      const applied: CanonicalValues = {};

      // Phase 1: preconditions, before any write.
      if (SINGLE_KEYS.some((k) => patch[k] !== undefined) && variants.length !== 1) {
        throw new CatalogExecutorError('listings.cell.variationsReadOnly', 'Product has variants');
      }
      let locationId: string | null = null;
      if (patch.quantity !== undefined) {
        if (variant?.inventory_management !== 'shopify' || !variant?.inventory_item_id) {
          throw new CatalogExecutorError(`${ERR}.notTracked`, 'Stock is not tracked');
        }
        locationId = (await onlyLocation(String(variant.inventory_item_id))).locationId;
      }
      if (patch.seo && !seoIO) throw new CatalogExecutorError(`${ERR}.actionUnavailable`, 'SEO writer missing', { action: 'seo' });

      // Phase 2: writes.
      let wrote = false;
      /** Set once image ops ran: the ops a Retry still has to run (see writeImages). */
      let remainingPatch: Record<string, unknown> | undefined;
      const step = async (name: 'variants' | 'images' | 'seo' | 'price' | 'inventory', fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (err) {
          throw wrote ? partialStepError(name, err, { remainingPatch }) : toExecutorError(err);
        }
        wrote = true;
      };
      const update = productUpdate(patch);
      if (Object.keys(update).length) {
        await client.updateProduct(draft.externalId, update);
        wrote = true;
        if (patch.title !== undefined) applied.title = patch.title;
        if (patch.tags !== undefined) applied.tags = patch.tags;
        if (patch.status !== undefined) applied.status = patch.status;
        if (patch.description !== undefined) applied.description = patch.description;
        if (patch.vendor !== undefined) applied.vendor = patch.vendor;
        if (patch.productType !== undefined) applied.productType = patch.productType;
      }
      const single = singleVariantUpdate(patch);
      if (Object.keys(single).length) {
        await step('price', async () => {
          await client.updateProductVariant(String(variant.id), single);
        });
        if (patch.price !== undefined) applied.price = patch.price;
        if (patch.compareAtPrice !== undefined) applied.compareAtPrice = patch.compareAtPrice > 0 ? patch.compareAtPrice : null;
      }
      if (patch.quantity !== undefined && locationId) {
        await step('inventory', async () => {
          await client.setInventoryLevel(String(variant.inventory_item_id), locationId as string, patch.quantity as number);
        });
        applied.quantity = patch.quantity;
      }

      const details: ExecutorFailureDetails = {};
      let firstFailed: 'variants' | 'images' | null = null;
      if (Array.isArray(patch.variants) && patch.variants.length) {
        const failures: { id: string; code: string }[] = [];
        if (await writeVariants(patch.variants, variants, failures)) wrote = true;
        if (failures.length) {
          details.variants = failures;
          firstFailed = 'variants';
        }
      }
      const imageOps = (Array.isArray(patch.images) ? patch.images : []) as ShopifyImageOp[];
      if (imageOps.length) {
        const failed: NonNullable<ExecutorFailureDetails['ops']> = [];
        const currentIds = (remote.values.mediaItems || []).map((m) => m.id);
        // Ids staged before the GraphQL migration are REST ProductImage ids: map them to the MediaImage id.
        const liveImages: any[] = Array.isArray(product.images) ? product.images : [];
        const resolvedOps = imageOps.map((o) => {
          if (o.op === 'add') return o;
          const id = resolveImageId(o.id, liveImages);
          return id && id !== o.id ? { ...o, id } : o;
        });
        const res = await writeImages(draft.externalId, resolvedOps, currentIds, failed);
        if (res.wrote) wrote = true;
        if (res.remaining.length !== imageOps.length) remainingPatch = { images: res.remaining };
        if (failed.length) {
          details.ops = failed;
          firstFailed = firstFailed || 'images';
        }
      }
      if (patch.seo && seoIO) {
        await step('seo', async () => {
          applied.seo = await seoIO.write(draft.externalId, patch.seo as ShopifySeo);
        });
      }
      if (firstFailed) {
        if (wrote) throw partialStepError(firstFailed, null, { details, remainingPatch });
        throw new CatalogExecutorError(`${ERR}.${firstFailed === 'variants' ? 'variantsFailed' : 'imagesFailed'}`, `Shopify ${firstFailed} failed`, undefined, { details, remainingPatch });
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
          ...(typeof applied.description === 'string' ? { description: applied.description } : {}),
          ...(typeof applied.vendor === 'string' ? { vendor: applied.vendor || null } : {}),
          ...(typeof applied.productType === 'string' ? { productType: applied.productType || null } : {}),
          ...(applied.compareAtPrice !== undefined ? { compareAtPrice: applied.compareAtPrice } : {}),
          ...(applied.seo ? { seoTitle: applied.seo.title ?? null, seoDescription: applied.seo.description ?? null } : {}),
        },
      });
    },
  };
}

/** Inventory levels of one item (Admin GraphQL, read_inventory); throttling handled by the client. */
function levelReader(client: Pick<ShopifyClient, 'getInventoryLevelsForItems'>): LevelReader {
  return async (inventoryItemId) => {
    const byItem = await client.getInventoryLevelsForItems([inventoryItemId]);
    return byItem.get(String(inventoryItemId)) || [];
  };
}

/**
 * Product SEO over Admin GraphQL. Same documents as the `/api/shopify/products` `seo` / `update` actions.
 */
export function shopifySeoIO(client: Pick<ShopifyClient, 'graphql'>): ShopifySeoIO {
  return {
    async read(productId) {
      const data = await client.graphql(SEO_QUERY, { id: toGid('Product', productId) });
      const seo = data?.product?.seo || {};
      return { title: seo.title ?? '', description: seo.description ?? '' };
    },
    async write(productId, seo) {
      const data = await client.graphql(SEO_UPDATE_MUTATION, { product: { id: toGid('Product', productId), seo } });
      assertNoUserErrors(data?.productUpdate, 'productUpdate(seo)');
      const saved = data?.productUpdate?.product?.seo || {};
      return { title: saved.title ?? '', description: saved.description ?? '' };
    },
  };
}

export const shopifyExecutor: CatalogExecutor = {
  async open(userId, storeId) {
    const shop = await prisma.shopifyShop.findFirst({ where: { id: storeId, userId, isActive: true }, select: { id: true, shopDomain: true } });
    if (!shop) throw new CatalogExecutorError(`${ERR}.notConnected`, 'Shopify store not connected');
    const accessToken = await getValidAccessToken(shop.id);
    const client = new ShopifyClient({ accessToken, shopDomain: shop.shopDomain });
    return createShopifySession(client, userId, shop.id, levelReader(client), shopifySeoIO(client));
  },
};
