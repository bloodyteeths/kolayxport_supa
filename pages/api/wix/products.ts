import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createWixClient } from '@/lib/integrations/wixClient';
import { logger } from '@/lib/logger';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  maxDuration: 60,
};

async function getAuthAndClient(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return { error: 'Unauthorized', status: 401 };

  // Try WixSite first, fall back to Credential
  const wixSite = await prisma.wixSite.findFirst({
    where: { userId: user.id, isActive: true },
  });

  const cred = await prisma.credential.findUnique({ where: { userId: user.id } });
  const credential = wixSite
    ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: wixSite.instanceId || cred?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
    : cred;

  if (!credential?.wixInstanceId || !credential?.wixSiteId) {
    return { error: 'Wix credentials not configured', status: 400 };
  }

  const siteId = credential.wixSiteId;

  // Token refresh callback
  const onTokenRefresh = async (creds: any) => {
    try {
      if (wixSite) {
        await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
      }
      await prisma.credential.update({ where: { userId: user.id }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
    } catch (e) {
      logger.warn('[WIX PRODUCTS] Failed to persist refreshed tokens');
    }
  };

  const client = createWixClient(credential, onTokenRefresh);
  return { userId: user.id, siteId, client, wixSiteDbId: wixSite?.id || siteId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    const auth = await getAuthAndClient(req, res);
    if ('error' in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { userId, siteId, client, wixSiteDbId } = auth;

    // ── LIST ─────────────────────────────────────────────
    if (action === 'list' && req.method === 'GET') {
      const page = parseInt(req.query.page as string) || 0;
      const size = parseInt(req.query.size as string) || 50;
      const fromCache = req.query.fromCache === 'true';

      if (fromCache) {
        const [products, total] = await Promise.all([
          prisma.wixProduct.findMany({
            where: { userId, wixSiteId: wixSiteDbId },
            skip: page * size,
            take: size,
            orderBy: { syncedAt: 'desc' },
          }),
          prisma.wixProduct.count({ where: { userId, wixSiteId: wixSiteDbId } }),
        ]);
        return res.status(200).json({
          content: products,
          page, size,
          totalElements: total,
          totalPages: Math.ceil(total / size),
          source: 'cache',
        });
      }

      const data = await client.queryProducts({ limit: size, offset: page * size });

      // Upsert to cache
      for (const p of data.products) {
        try {
          await upsertWixProduct(userId, wixSiteDbId, p);
        } catch (e) {
          logger.warn(`[WIX PRODUCTS] Failed to cache product ${p.id}`);
        }
      }

      return res.status(200).json({
        content: data.products,
        page, size,
        totalElements: data.totalResults,
        totalPages: Math.ceil(data.totalResults / size),
        source: 'api',
      });
    }

    // ── SYNC (full) ─────────────────────────────────────
    if (action === 'sync' && req.method === 'POST') {
      let offset = 0;
      const limit = 100;
      let synced = 0;

      while (true) {
        const { products, totalResults } = await client.queryProducts({ limit, offset });
        for (const p of products) {
          try {
            await upsertWixProduct(userId, wixSiteDbId, p);
            synced++;
          } catch (e) {
            logger.warn(`[WIX PRODUCTS] Sync upsert failed for ${p.id}`);
          }
        }
        offset += limit;
        if (offset >= totalResults || products.length === 0) break;
      }

      return res.status(200).json({ success: true, synced });
    }

    // ── CREATE ───────────────────────────────────────────
    if (action === 'create' && req.method === 'POST') {
      const product = await client.createProduct(req.body);
      if (product?.id) {
        try { await upsertWixProduct(userId, wixSiteDbId, product); } catch (e) { /* cache fail ok */ }
      }
      return res.status(201).json({ product });
    }

    // ── UPDATE ───────────────────────────────────────────
    if (action === 'update' && req.method === 'PUT') {
      const { productId, ...updateData } = req.body;
      if (!productId) return res.status(400).json({ error: 'Missing productId' });
      logger.info('[WIX PRODUCTS] Update request', { productId, fields: Object.keys(updateData) });
      const product = await client.updateProduct(productId, updateData);
      if (product?.id) {
        try { await upsertWixProduct(userId, wixSiteDbId, product); } catch (e) { /* cache fail ok */ }
      }
      return res.status(200).json({ product });
    }

    // ── DELETE ────────────────────────────────────────────
    if (action === 'delete' && req.method === 'DELETE') {
      const productId = req.query.productId as string;
      if (!productId) return res.status(400).json({ error: 'Missing productId' });
      await client.deleteProduct(productId);
      await prisma.wixProduct.deleteMany({ where: { userId, wixSiteId: wixSiteDbId, wixProductId: productId } });
      return res.status(200).json({ success: true });
    }

    // ── INVENTORY ────────────────────────────────────────
    if (action === 'inventory' && req.method === 'PUT') {
      const { productId, quantity } = req.body;
      if (!productId) return res.status(400).json({ error: 'Missing productId' });
      logger.info('[WIX PRODUCTS] Inventory update', { productId, quantity });
      const inventory = await client.getInventoryItem(productId);
      if (!inventory?.id) {
        return res.status(400).json({ error: 'Inventory item not found for this product' });
      }
      const defaultVariant = inventory.variants?.[0];
      if (!defaultVariant?.variantId) {
        return res.status(400).json({ error: 'No variant found for this product' });
      }
      const currentQty = defaultVariant.quantity || 0;
      const diff = quantity - currentQty;
      if (diff !== 0) {
        await client.updateInventoryVariants(inventory.id, [{ variantId: defaultVariant.variantId, quantity: diff }]);
      }
      // Update cache
      await prisma.wixProduct.updateMany({
        where: { userId, wixSiteId: wixSiteDbId, wixProductId: productId },
        data: { quantity, inStock: quantity > 0 },
      });
      return res.status(200).json({ success: true });
    }

    // ── CACHED PRODUCTS (DB-only with status/collection counts) ────
    if (action === 'cached_products' && req.method === 'GET') {
      const page = parseInt(req.query.page as string) || 0;
      const size = parseInt(req.query.size as string) || 100;
      const visibleParam = req.query.visible as string;
      const collectionIdParam = req.query.collectionId as string | undefined;

      const baseWhere: any = { userId, wixSiteId: wixSiteDbId };
      if (visibleParam === 'true') baseWhere.visible = true;
      else if (visibleParam === 'false') baseWhere.visible = false;
      // 'all' or undefined = no filter

      // If collectionId filter, we need to fetch all matching first, then filter in JS
      let products: any[];
      let count: number;

      if (collectionIdParam) {
        const allMatching = await prisma.wixProduct.findMany({
          where: baseWhere,
          orderBy: { syncedAt: 'desc' },
        });
        const filtered = allMatching.filter((p: any) => {
          const ids = Array.isArray(p.collectionIds) ? p.collectionIds : [];
          return ids.includes(collectionIdParam);
        });
        count = filtered.length;
        products = filtered.slice(page * size, page * size + size);
      } else {
        [products, count] = await Promise.all([
          prisma.wixProduct.findMany({
            where: baseWhere,
            skip: page * size,
            take: size,
            orderBy: { syncedAt: 'desc' },
          }),
          prisma.wixProduct.count({ where: baseWhere }),
        ]);
      }

      // Status counts
      const [visibleCount, hiddenCount, allCount] = await Promise.all([
        prisma.wixProduct.count({ where: { userId, wixSiteId: wixSiteDbId, visible: true } }),
        prisma.wixProduct.count({ where: { userId, wixSiteId: wixSiteDbId, visible: false } }),
        prisma.wixProduct.count({ where: { userId, wixSiteId: wixSiteDbId } }),
      ]);

      // Collection counts
      const allProducts = await prisma.wixProduct.findMany({
        where: { userId, wixSiteId: wixSiteDbId },
        select: { collectionIds: true },
      });
      const collectionCounts: Record<string, number> = {};
      for (const p of allProducts) {
        const ids = Array.isArray(p.collectionIds) ? p.collectionIds : [];
        for (const cid of ids) {
          if (typeof cid === 'string') {
            collectionCounts[cid] = (collectionCounts[cid] || 0) + 1;
          }
        }
      }

      return res.status(200).json({
        products,
        count,
        statusCounts: { visible: visibleCount, hidden: hiddenCount, all: allCount },
        collectionCounts,
      });
    }

    // ── BULK UPDATE ──────────────────────────────────────
    if (action === 'bulk_update' && req.method === 'PUT') {
      const { productIds, updates } = req.body;
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ error: 'Missing productIds array' });
      }

      let succeeded = 0;
      let failed = 0;

      for (const productId of productIds) {
        try {
          // Build Wix API update payload
          const mappedUpdates: Record<string, any> = {};
          if (updates.price != null) mappedUpdates.priceData = { price: updates.price };
          if (updates.visible != null) mappedUpdates.visible = updates.visible;
          if (updates.customTextFields !== undefined) mappedUpdates.customTextFields = updates.customTextFields;

          if (Object.keys(mappedUpdates).length > 0) {
            await client.updateProduct(productId, mappedUpdates);
          }

          // Handle inventory/quantity separately
          if (updates.quantity != null) {
            const inventory = await client.getInventoryItem(productId);
            if (inventory?.id) {
              const defaultVariant = inventory.variants?.[0];
              if (defaultVariant) {
                const currentQty = defaultVariant.quantity || 0;
                const diff = updates.quantity - currentQty;
                if (diff !== 0) {
                  await client.updateInventoryVariants(inventory.id, [
                    { variantId: defaultVariant.variantId, quantity: diff },
                  ]);
                }
              }
            }
          }

          // Update DB cache
          const dbData: any = {};
          if (updates.price != null) dbData.price = updates.price;
          if (updates.visible != null) dbData.visible = updates.visible;
          if (updates.quantity != null) {
            dbData.quantity = updates.quantity;
            dbData.inStock = updates.quantity > 0;
          }
          if (updates.customTextFields !== undefined) dbData.customTextFields = updates.customTextFields;
          if (Object.keys(dbData).length > 0) {
            await prisma.wixProduct.updateMany({
              where: { wixProductId: productId, userId },
              data: dbData,
            });
          }

          succeeded++;
        } catch (err: any) {
          logger.warn(`[WIX PRODUCTS] bulk_update failed for ${productId}: ${err.message}`);
          failed++;
        }

        // Rate limit delay
        await new Promise((r) => setTimeout(r, 100));
      }

      return res.status(200).json({ succeeded, failed });
    }

    // ── BULK DELETE ──────────────────────────────────────
    if (action === 'bulk_delete' && req.method === 'DELETE') {
      const { productIds } = req.body;
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ error: 'Missing productIds array' });
      }

      let succeeded = 0;
      let failed = 0;

      for (const productId of productIds) {
        try {
          await client.deleteProduct(productId);
          await prisma.wixProduct.deleteMany({
            where: { wixProductId: productId, userId },
          });
          succeeded++;
        } catch (err: any) {
          logger.warn(`[WIX PRODUCTS] bulk_delete failed for ${productId}: ${err.message}`);
          failed++;
        }

        // Rate limit delay
        await new Promise((r) => setTimeout(r, 100));
      }

      return res.status(200).json({ succeeded, failed });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    logger.error('[WIX PRODUCTS] Handler error', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

/** Upsert a Wix product into the local cache */
async function upsertWixProduct(userId: string, wixSiteId: string, p: any) {
  const images = (p.media?.items?.length || p.media?.mainMedia) ? [p.media.mainMedia, ...(p.media.items || [])].filter(Boolean) : [];
  let thumbnailUrl = images[0]?.image?.url || images[0]?.url || images[0]?.thumbnail?.url || '';
  // Convert wix:image:// URIs to actual URLs
  if (thumbnailUrl.includes('wix:image')) {
    thumbnailUrl = `https://static.wixstatic.com/media/${thumbnailUrl.replace('wix:image://v1/', '').split('/')[0]}`;
  }

  await prisma.wixProduct.upsert({
    where: { userId_wixSiteId_wixProductId: { userId, wixSiteId, wixProductId: p.id } },
    update: {
      title: p.name || p.title || '',
      description: p.description || null,
      productType: p.productType || null,
      brand: p.brand || null,
      collectionIds: p.collectionIds || undefined,
      price: p.priceData?.price != null ? p.priceData.price : null,
      discountPrice: p.priceData?.discountedPrice != null ? p.priceData.discountedPrice : null,
      currency: p.priceData?.currency || 'USD',
      trackInventory: p.stock?.trackInventory ?? true,
      inStock: p.stock?.inStock ?? true,
      quantity: p.stock?.quantity ?? 0,
      images: images.length > 0 ? images : undefined,
      thumbnailUrl,
      imageCount: images.length,
      variants: p.variants || undefined,
      options: p.productOptions || undefined,
      customTextFields: p.customTextFields || null,
      visible: p.visible ?? true,
      ribbon: p.ribbon || null,
      weight: p.weight || null,
      sku: p.sku || null,
      slug: p.slug || null,
      wixUpdatedDate: p.lastUpdated ? new Date(p.lastUpdated) : null,
      syncedAt: new Date(),
    },
    create: {
      userId,
      wixSiteId,
      wixProductId: p.id,
      title: p.name || p.title || '',
      description: p.description || null,
      productType: p.productType || null,
      brand: p.brand || null,
      collectionIds: p.collectionIds || undefined,
      price: p.priceData?.price != null ? p.priceData.price : null,
      discountPrice: p.priceData?.discountedPrice != null ? p.priceData.discountedPrice : null,
      currency: p.priceData?.currency || 'USD',
      trackInventory: p.stock?.trackInventory ?? true,
      inStock: p.stock?.inStock ?? true,
      quantity: p.stock?.quantity ?? 0,
      images: images.length > 0 ? images : undefined,
      thumbnailUrl,
      imageCount: images.length,
      variants: p.variants || undefined,
      options: p.productOptions || undefined,
      customTextFields: p.customTextFields || null,
      visible: p.visible ?? true,
      ribbon: p.ribbon || null,
      weight: p.weight || null,
      sku: p.sku || null,
      slug: p.slug || null,
      wixCreatedDate: p.createdDate ? new Date(p.createdDate) : null,
      wixUpdatedDate: p.lastUpdated ? new Date(p.lastUpdated) : null,
      syncedAt: new Date(),
    },
  });
}
