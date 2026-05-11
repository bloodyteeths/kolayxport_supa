// pages/api/shopify/products.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import prisma from '../../../lib/prisma';
import { ShopifyClient, getValidAccessToken } from '../../../lib/integrations/shopifyClient';
import { logger } from '../../../lib/logger';

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

  return { userId: user.id, shop, client };
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

      if (fromCache) {
        const where: any = { userId, shopifyShopId: shop.id };
        if (status) where.status = status;

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

      const product = await client.updateProduct(String(productId), req.body);

      // Update cache
      await upsertProductCache(userId, shop.id, product);

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
    // UPDATE VARIANT
    // ================================================================
    if (action === 'updateVariant' && req.method === 'PUT') {
      const variantId = req.query.variantId as string;
      if (!variantId) return res.status(400).json({ error: 'Missing variant id' });

      const variant = await client.updateProductVariant(variantId, req.body);
      return res.status(200).json({ variant });
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
