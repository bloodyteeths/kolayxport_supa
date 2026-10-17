// pages/api/shopify/products.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import prisma from '../../../lib/prisma';
import { ShopifyClient, getValidAccessToken } from '../../../lib/integrations/shopifyClient';
import { logger } from '../../../lib/logger';
import { refreshHealth } from '@/lib/listings/refreshHealth';
import {
  applyShopifyImageOps,
  parseShopifyImageAdd,
  parseShopifyImageOps,
  type ShopifyImageOp,
} from '@/lib/integrations/shopifyImageOps';
import { OP_KEYS, type ProductOpCode } from '@/lib/integrations/productOpResults';
import { assertNoUserErrors, toGid } from '@/lib/integrations/shopifyGraphql';
import { SEO_QUERY, SEO_UPDATE_MUTATION } from '@/lib/integrations/shopifySeo';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  maxDuration: 60,
};

async function getAuthAndClient(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) {
    return { error: 'Unauthorized', status: 401 };
  }

  const shopId = req.query.shopId as string;

  // Find the shop — either by ID or pick the first active one
  const shop = shopId
    ? await prisma.shopifyShop.findFirst({ where: { id: shopId, userId: user.id, isActive: true } })
    : await prisma.shopifyShop.findFirst({ where: { userId: user.id, isActive: true }, orderBy: { createdAt: 'desc' } });

  if (!shop) {
    return { error: 'No active Shopify store connected', status: 400 };
  }

  const accessToken = await getValidAccessToken(shop.id);
  const client = new ShopifyClient({
    accessToken,
    shopDomain: shop.shopDomain,
  });

  return { userId: user.id, shop, client, accessToken };
}

/**
 * Write a product's SEO title/description (Admin GraphQL `productUpdate`).
 */
async function updateProductSeo(
  client: ShopifyClient,
  productId: string,
  seo: { title?: string; description?: string }
): Promise<{ title: string | null; description: string | null }> {
  const data = await client.graphql(SEO_UPDATE_MUTATION, { product: { id: toGid('Product', productId), seo } });
  assertNoUserErrors(data?.productUpdate, 'productUpdate(seo)');
  const saved = data?.productUpdate?.product?.seo || {};
  return { title: saved.title ?? null, description: saved.description ?? null };
}

/**
 * Read a product's current SEO title/description through Admin GraphQL.
 */
async function getProductSeo(
  client: ShopifyClient,
  productId: string
): Promise<{ title: string | null; description: string | null }> {
  const data = await client.graphql(SEO_QUERY, { id: toGid('Product', productId) });
  const seo = data?.product?.seo || {};
  return { title: seo.title ?? null, description: seo.description ?? null };
}

type VariantEditInput = {
  id: string;
  price?: string;
  inventoryQuantity?: number;
  /** Quantity the user saw when editing; the write is refused if Shopify differs. */
  expectedQuantity?: number;
};

type VariantEditResult = {
  id: string;
  ok: boolean;
  code?: 'NOT_FOUND' | 'INVALID_PRICE' | 'INVALID_QUANTITY' | 'NOT_TRACKED' | 'MULTI_LOCATION' | 'NO_LOCATION' | 'STOCK_CHANGED' | 'FAILED';
  /** True when the price change reached Shopify (even if the stock step then failed). */
  priceApplied?: boolean;
  error?: string;
};

function parseVariantEdits(body: any): VariantEditInput[] | null {
  const list = body?.variants;
  if (!Array.isArray(list) || list.length === 0 || list.length > 100) return null;
  const out: VariantEditInput[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id != null ? String(raw.id) : '';
    if (!/^\d+$/.test(id)) return null;
    const edit: VariantEditInput = { id };
    if (raw.price !== undefined) edit.price = String(raw.price);
    if (raw.inventoryQuantity !== undefined) edit.inventoryQuantity = Number(raw.inventoryQuantity);
    if (raw.expectedQuantity !== undefined && raw.expectedQuantity !== null) edit.expectedQuantity = Number(raw.expectedQuantity);
    out.push(edit);
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    const auth = await getAuthAndClient(req, res);
    if ('error' in auth) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }
    const { userId, shop, client } = auth;

    // ================================================================
    // LIST PRODUCTS (from cache or API)
    // ================================================================
    if (action === 'list' && req.method === 'GET') {
      const page = parseInt(req.query.page as string) || 0;
      const size = parseInt(req.query.size as string) || 50;
      const fromCache = req.query.fromCache === 'true';
      const status = req.query.status as string | undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      if (fromCache) {
        const where: any = { userId, shopifyShopId: shop.id };
        if (status) where.status = status;
        if (q) {
          // Prisma has no case-insensitive substring filter for String[], so
          // match tags in SQL and fold the matching ids into the OR.
          const likeQ = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          const tagMatches = await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "ShopifyProduct"
            WHERE "userId" = ${userId} AND "shopifyShopId" = ${shop.id}
              AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE ${likeQ})`;
          where.OR = [
            { title: { contains: q, mode: 'insensitive' } },
            { vendor: { contains: q, mode: 'insensitive' } },
            { id: { in: tagMatches.map((r) => r.id) } },
          ];
        }

        const [products, total] = await Promise.all([
          prisma.shopifyProduct.findMany({
            where,
            skip: page * size,
            take: size,
            orderBy: { syncedAt: 'desc' },
          }),
          prisma.shopifyProduct.count({ where }),
        ]);

        return res.status(200).json({
          content: products,
          page,
          size,
          totalElements: total,
          totalPages: Math.ceil(total / size),
          source: 'cache',
        });
      }

      // Fetch from Shopify API
      const products = await client.getProducts({ status });
      return res.status(200).json({
        content: products,
        totalElements: products.length,
        source: 'api',
      });
    }

    // ================================================================
    // GET SINGLE PRODUCT
    // ================================================================
    if (action === 'get' && req.method === 'GET') {
      const productId = req.query.id as string;
      if (!productId) return res.status(400).json({ error: 'Missing product id' });

      const product = await client.getProduct(productId);
      return res.status(200).json({ product });
    }

    // ================================================================
    // GET PRODUCT SEO (live from Shopify, Admin GraphQL)
    // ================================================================
    if (action === 'seo' && req.method === 'GET') {
      const productId = req.query.id as string;
      if (!productId) return res.status(400).json({ error: 'Missing product id' });

      const seo = await getProductSeo(client, productId);
      return res.status(200).json({ seo });
    }

    // ================================================================
    // CREATE PRODUCT
    // ================================================================
    if (action === 'create' && req.method === 'POST') {
      const product = await client.createProduct(req.body);

      // Cache the new product
      await upsertProductCache(userId, shop.id, product);

      return res.status(201).json({ product });
    }

    // ================================================================
    // UPDATE PRODUCT
    // ================================================================
    if (action === 'update' && req.method === 'PUT') {
      const productId = req.query.id as string || req.body.id;
      if (!productId) return res.status(400).json({ error: 'Missing product id' });

      // `seo` is written separately (its own productUpdate, read back for the cache).
      const { seo, ...restUpdates } = req.body || {};
      const product = await client.updateProduct(String(productId), restUpdates);

      // Update cache
      await upsertProductCache(userId, shop.id, product);

      if (seo && typeof seo === 'object') {
        const savedSeo = await updateProductSeo(client, String(product.id), {
          title: typeof seo.title === 'string' ? seo.title : undefined,
          description: typeof seo.description === 'string' ? seo.description : undefined,
        });
        await prisma.shopifyProduct.updateMany({
          where: { userId, shopifyShopId: shop.id, shopifyProductId: String(product.id) },
          data: { seoTitle: savedSeo.title, seoDescription: savedSeo.description },
        });
      }

      return res.status(200).json({ product });
    }

    // ================================================================
    // DELETE PRODUCT
    // ================================================================
    if (action === 'delete' && req.method === 'DELETE') {
      const productId = req.query.id as string;
      if (!productId) return res.status(400).json({ error: 'Missing product id' });

      await client.deleteProduct(productId);

      // Remove from cache
      await prisma.shopifyProduct.deleteMany({
        where: { userId, shopifyShopId: shop.id, shopifyProductId: productId },
      });

      return res.status(200).json({ success: true });
    }

    // ================================================================
    // SYNC ALL PRODUCTS (Shopify API → DB cache)
    // ================================================================
    if (action === 'sync' && req.method === 'POST') {
      const products = await client.getProducts();
      let synced = 0;

      for (const product of products) {
        await upsertProductCache(userId, shop.id, product);
        synced++;
      }

      // Update last product sync timestamp
      await prisma.shopifyShop.update({
        where: { id: shop.id },
        data: { lastProductSyncAt: new Date() },
      });

      logger.info('Shopify products synced to cache', { userId, shop: shop.shopDomain, synced });

      // Listing health (listings-grid §9.3); store key = ShopifyShop.id. Never fails the pull.
      try {
        const healthResult = await refreshHealth('shopify', { storeId: shop.id, userId });
        if (healthResult.error || healthResult.skipped === 'bad_scope') {
          logger.warn('Shopify sync: health refresh failed', { shop: shop.shopDomain, error: healthResult.error ?? null, skipped: healthResult.skipped });
        } else if (healthResult.skipped) {
          logger.debug('Shopify sync: health refresh skipped', { shop: shop.shopDomain, skipped: healthResult.skipped });
        }
      } catch (err: any) {
        logger.warn('Shopify sync: health refresh failed', { shop: shop.shopDomain, error: String(err?.message || err).substring(0, 300) });
      }

      return res.status(200).json({ synced, total: products.length });
    }

    // ================================================================
    // UPDATE IMAGE
    // ================================================================
    if (action === 'updateImage' && req.method === 'POST') {
      const productId = req.query.id as string;
      if (!productId) return res.status(400).json({ error: 'Missing product id' });

      const image = await client.createProductImage(productId, req.body);
      return res.status(200).json({ image });
    }

    if (action === 'deleteImage' && req.method === 'DELETE') {
      const productId = req.query.id as string;
      const imageId = req.query.imageId as string;
      if (!productId || !imageId) return res.status(400).json({ error: 'Missing product or image id' });

      await client.deleteProductImage(productId, imageId);
      return res.status(200).json({ success: true });
    }

    // ================================================================
    // PRODUCT IMAGES (M6b-B, marketplace-editors §7.2)
    //   GET    ?action=images&id=                        → { images }
    //   POST   ?action=images&id=  { src | attachment, filename?, alt?, position? }
    //          or                  { ops: ShopifyImageOp[] }  (staged batch)
    //   PUT    ?action=images&id=&imageId=  { alt?, position? }
    //   DELETE ?action=images&id=&imageId=
    // Writes answer { ok, results, images, product }; per-op failures are 200
    // with `results[].ok === false` and an i18n `key`.
    // ================================================================
    if (action === 'images') {
      const productId = String(req.query.id || '');
      if (!/^\d{1,20}$/.test(productId)) return badImageRequest(res, 'Missing product id');

      if (req.method === 'GET') {
        const images = await client.getProductImages(productId);
        return res.status(200).json({ images });
      }

      let ops: ShopifyImageOp[];
      if (req.method === 'POST') {
        if (Array.isArray(req.body?.ops)) {
          const parsed = parseShopifyImageOps(req.body.ops);
          if (!parsed.ok) return badImageRequest(res, parsed.error, parsed.code ?? 'INVALID_INPUT');
          ops = parsed.value;
        } else {
          const parsed = parseShopifyImageAdd(req.body);
          if (!parsed.ok) return badImageRequest(res, parsed.error, parsed.code ?? 'INVALID_INPUT');
          ops = [parsed.value];
        }
      } else if (req.method === 'PUT' || req.method === 'DELETE') {
        const imageId = String(req.query.imageId || '');
        if (!/^\d{1,20}$/.test(imageId)) return badImageRequest(res, 'Missing image id');
        if (req.method === 'DELETE') {
          ops = [{ op: 'delete', id: imageId }];
        } else {
          const raw: unknown[] = [];
          if (req.body?.alt !== undefined) raw.push({ op: 'alt', id: imageId, alt: req.body.alt });
          if (req.body?.position !== undefined) raw.push({ op: 'reorder', id: imageId, position: req.body.position });
          const parsed = raw.length ? parseShopifyImageOps(raw) : { ok: false as const, error: 'Nothing to update (alt or position)' };
          if (!parsed.ok) return badImageRequest(res, parsed.error);
          ops = parsed.value;
        }
      } else {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const { results, images } = await applyShopifyImageOps(client, productId, ops);

      // Refresh the cache row (thumbnail, image count). Best effort.
      let product: any = null;
      try {
        product = await client.getProduct(productId);
        if (product?.id) await upsertProductCache(userId, shop.id, product);
      } catch (err: any) {
        logger.error('Shopify cache refresh after image write failed', err as Error, { productId });
      }

      return res.status(200).json({ ok: results.every((r) => r.ok), results, images, product });
    }

    // ================================================================
    // UPDATE VARIANT
    // ================================================================
    if (action === 'updateVariant' && req.method === 'PUT') {
      const variantId = req.query.variantId as string;
      if (!variantId) return res.status(400).json({ error: 'Missing variant id' });

      const variant = await client.updateProductVariant(variantId, req.body);
      return res.status(200).json({ variant });
    }

    // ================================================================
    // UPDATE VARIANT PRICE / STOCK (explicit Save in the editor)
    // Body: { variants: [{ id, price?, inventoryQuantity?, expectedQuantity? }] }
    // Each variant is applied independently; per-variant results are returned.
    // ================================================================
    if (action === 'updateVariants' && req.method === 'PUT') {
      const productId = req.query.id as string;
      if (!productId || !/^\d+$/.test(productId)) return res.status(400).json({ error: 'Missing product id' });
      const edits = parseVariantEdits(req.body);
      if (!edits) return res.status(400).json({ error: 'Invalid variants payload' });

      // Fresh read: confirms each variant belongs to this product (of this shop)
      // and gives the current inventory_item_id / tracking mode.
      const live = await client.getProduct(productId);
      const liveVariants: any[] = Array.isArray(live?.variants) ? live.variants : [];
      const results: VariantEditResult[] = [];

      // Phase 1: validate every edit and check stock preconditions BEFORE any
      // write, so a refused stock change never leaves a half-applied price.
      type Planned = { edit: VariantEditInput; variant: any; price?: string; qty?: number; locationId?: string };
      const planned: Planned[] = [];
      const needLevels: string[] = [];
      for (const edit of edits) {
        const variant = liveVariants.find((v) => String(v.id) === edit.id);
        if (!variant) {
          results.push({ id: edit.id, ok: false, code: 'NOT_FOUND' });
          continue;
        }
        const plan: Planned = { edit, variant };
        if (edit.price !== undefined) {
          const n = Number(edit.price);
          if (edit.price.trim() === '' || !Number.isFinite(n) || n < 0 || n > 1_000_000_000) {
            results.push({ id: edit.id, ok: false, code: 'INVALID_PRICE' });
            continue;
          }
          const price = n.toFixed(2);
          if (price !== Number(variant.price).toFixed(2)) plan.price = price;
        }
        if (edit.inventoryQuantity !== undefined) {
          const qty = edit.inventoryQuantity;
          if (!Number.isInteger(qty) || qty < 0 || qty > 1_000_000_000) {
            results.push({ id: edit.id, ok: false, code: 'INVALID_QUANTITY' });
            continue;
          }
          if (variant.inventory_management !== 'shopify' || !variant.inventory_item_id) {
            results.push({ id: edit.id, ok: false, code: 'NOT_TRACKED' });
            continue;
          }
          plan.qty = qty;
          needLevels.push(String(variant.inventory_item_id));
        }
        planned.push(plan);
      }

      let levelsByItem = new Map<string, { location_id: number; available: number | null }[]>();
      let levelsFailed = false;
      if (needLevels.length > 0) {
        try {
          levelsByItem = await client.getInventoryLevelsForItems(needLevels);
        } catch (err: any) {
          levelsFailed = true;
          logger.error('Shopify inventory levels read failed', err as Error, { productId });
        }
      }

      for (const plan of planned) {
        const { edit, variant } = plan;
        if (plan.qty !== undefined) {
          if (levelsFailed) {
            results.push({ id: edit.id, ok: false, code: 'FAILED' });
            continue;
          }
          const levels = levelsByItem.get(String(variant.inventory_item_id)) || [];
          if (levels.length === 0) {
            results.push({ id: edit.id, ok: false, code: 'NO_LOCATION' });
            continue;
          }
          if (levels.length > 1) {
            // Which location to change is ambiguous; never guess.
            results.push({ id: edit.id, ok: false, code: 'MULTI_LOCATION' });
            continue;
          }
          const current = levels[0].available ?? 0;
          if (edit.expectedQuantity !== undefined && Number.isFinite(edit.expectedQuantity) && current !== edit.expectedQuantity) {
            results.push({ id: edit.id, ok: false, code: 'STOCK_CHANGED' });
            continue;
          }
          if (current === plan.qty) plan.qty = undefined;
          else plan.locationId = String(levels[0].location_id);
        }

        // Phase 2: writes.
        let priceApplied = false;
        try {
          if (plan.price !== undefined) {
            await client.updateProductVariant(edit.id, { price: plan.price });
            priceApplied = true;
          }
          if (plan.qty !== undefined && plan.locationId) {
            await client.setInventoryLevel(String(variant.inventory_item_id), plan.locationId, plan.qty);
          }
          results.push({ id: edit.id, ok: true, ...(priceApplied ? { priceApplied } : {}) });
        } catch (err: any) {
          logger.error('Shopify variant update failed', err as Error, { productId, variantId: edit.id });
          results.push({ id: edit.id, ok: false, code: 'FAILED', ...(priceApplied ? { priceApplied } : {}) });
        }
      }

      // Refresh the cache row so the list shows the new price/stock.
      let product = live;
      try {
        product = await client.getProduct(productId);
        await upsertProductCache(userId, shop.id, product);
      } catch (err: any) {
        logger.error('Shopify cache refresh after variant update failed', err as Error, { productId });
      }

      return res.status(200).json({ product, results });
    }

    if (action === 'createVariant' && req.method === 'POST') {
      const productId = req.query.id as string;
      if (!productId) return res.status(400).json({ error: 'Missing product id' });

      const variant = await client.createProductVariant(productId, req.body);
      return res.status(200).json({ variant });
    }

    if (action === 'deleteVariant' && req.method === 'DELETE') {
      const productId = req.query.id as string;
      const variantId = req.query.variantId as string;
      if (!productId || !variantId) return res.status(400).json({ error: 'Missing product or variant id' });

      await client.deleteProductVariant(productId, variantId);
      return res.status(200).json({ success: true });
    }

    // ================================================================
    // GET COLLECTIONS
    // ================================================================
    if (action === 'collections' && req.method === 'GET') {
      const collections = await client.getCollections();
      return res.status(200).json({ collections });
    }

    // ================================================================
    // INVENTORY
    // ================================================================
    if (action === 'locations' && req.method === 'GET') {
      const locations = await client.getLocations();
      return res.status(200).json({ locations });
    }

    if (action === 'setInventory' && req.method === 'POST') {
      const { inventoryItemId, locationId, available } = req.body;
      if (!inventoryItemId || !locationId || available === undefined) {
        return res.status(400).json({ error: 'Missing inventoryItemId, locationId, or available' });
      }
      const result = await client.setInventoryLevel(inventoryItemId, locationId, available);
      return res.status(200).json({ inventory_level: result });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error: any) {
    logger.error('Shopify products API error', error as Error, { action });
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/** 400 for the `images` action: `{ error, code, key }` (key = next-intl key). */
function badImageRequest(res: NextApiResponse, error: string, code: ProductOpCode = 'INVALID_INPUT') {
  return res.status(400).json({ error, code, key: OP_KEYS[code] });
}

/**
 * Upsert a Shopify product into the local cache.
 */
async function upsertProductCache(userId: string, shopifyShopId: string, product: any) {
  const defaultVariant = product.variants?.[0];
  const firstImage = product.images?.[0];

  await prisma.shopifyProduct.upsert({
    where: {
      userId_shopifyShopId_shopifyProductId: {
        userId,
        shopifyShopId,
        shopifyProductId: String(product.id),
      },
    },
    create: {
      userId,
      shopifyShopId,
      shopifyProductId: String(product.id),
      title: product.title || '',
      description: product.body_html || null,
      vendor: product.vendor || null,
      productType: product.product_type || null,
      status: product.status || 'active',
      tags: product.tags ? product.tags.split(', ').filter(Boolean) : [],
      handle: product.handle || null,
      price: defaultVariant?.price ? parseFloat(defaultVariant.price) : null,
      compareAtPrice: defaultVariant?.compare_at_price ? parseFloat(defaultVariant.compare_at_price) : null,
      currency: product.currency || 'USD',
      trackInventory: defaultVariant?.inventory_management === 'shopify',
      totalInventory: product.variants?.reduce((sum: number, v: any) => sum + (v.inventory_quantity || 0), 0) || 0,
      images: product.images || null,
      thumbnailUrl: firstImage?.src || null,
      imageCount: product.images?.length || 0,
      variants: product.variants || null,
      options: product.options || null,
      variantCount: product.variants?.length || 0,
      seoTitle: product.metafields_global_title_tag || null,
      seoDescription: product.metafields_global_description_tag || null,
      shopifyCreatedAt: product.created_at ? new Date(product.created_at) : null,
      shopifyUpdatedAt: product.updated_at ? new Date(product.updated_at) : null,
      syncedAt: new Date(),
    },
    update: {
      title: product.title || '',
      description: product.body_html || null,
      vendor: product.vendor || null,
      productType: product.product_type || null,
      status: product.status || 'active',
      tags: product.tags ? product.tags.split(', ').filter(Boolean) : [],
      handle: product.handle || null,
      price: defaultVariant?.price ? parseFloat(defaultVariant.price) : null,
      compareAtPrice: defaultVariant?.compare_at_price ? parseFloat(defaultVariant.compare_at_price) : null,
      trackInventory: defaultVariant?.inventory_management === 'shopify',
      totalInventory: product.variants?.reduce((sum: number, v: any) => sum + (v.inventory_quantity || 0), 0) || 0,
      images: product.images || null,
      thumbnailUrl: firstImage?.src || null,
      imageCount: product.images?.length || 0,
      variants: product.variants || null,
      options: product.options || null,
      variantCount: product.variants?.length || 0,
      shopifyUpdatedAt: product.updated_at ? new Date(product.updated_at) : null,
      syncedAt: new Date(),
    },
  });
}
