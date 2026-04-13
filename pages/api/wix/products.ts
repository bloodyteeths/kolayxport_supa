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
    ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: cred?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
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
      const inventory = await client.getInventoryItem(productId);
      if (inventory?.id) {
        const defaultVariant = inventory.variants?.[0];
        if (defaultVariant) {
          const currentQty = defaultVariant.quantity || 0;
          const diff = quantity - currentQty;
          if (diff !== 0) {
            await client.updateInventoryVariants(inventory.id, [{ variantId: defaultVariant.variantId, quantity: diff }]);
          }
        }
      }
      // Update cache
      await prisma.wixProduct.updateMany({
        where: { userId, wixSiteId: wixSiteDbId, wixProductId: productId },
        data: { quantity, inStock: quantity > 0 },
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    logger.error('[WIX PRODUCTS] Handler error', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

/** Upsert a Wix product into the local cache */
async function upsertWixProduct(userId: string, wixSiteId: string, p: any) {
  const images = p.media?.items || p.media?.mainMedia ? [p.media.mainMedia, ...(p.media.items || [])].filter(Boolean) : [];
  const thumbnailUrl = images[0]?.image?.url || images[0]?.url || '';

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
