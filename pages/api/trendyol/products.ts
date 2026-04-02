import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { createTrendyolClient } from '../../../lib/integrations/trendyolApiClient';
import { logger } from '../../../lib/logger';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  maxDuration: 60,
};

async function getAuthAndClient(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: 'Unauthorized', status: 401 };
  }

  const credential = await prisma.credential.findUnique({
    where: { userId: user.id },
    select: {
      trendyolSupplierId: true,
      trendyolApiKey: true,
      trendyolApiSecret: true,
    },
  });

  if (!credential?.trendyolSupplierId || !credential?.trendyolApiKey || !credential?.trendyolApiSecret) {
    return { error: 'Trendyol credentials not configured', status: 400 };
  }

  const client = createTrendyolClient(credential);
  return { userId: user.id, supplierId: credential.trendyolSupplierId, client };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    const auth = await getAuthAndClient(req, res);
    if ('error' in auth) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }
    const { userId, supplierId, client } = auth;

    // ================================================================
    // LIST PRODUCTS (from Trendyol API, upsert to cache)
    // ================================================================
    if (action === 'list' && req.method === 'GET') {
      const page = parseInt(req.query.page as string) || 0;
      const size = parseInt(req.query.size as string) || 50;
      const fromCache = req.query.fromCache === 'true';

      if (fromCache) {
        // Return from DB cache
        const [products, total] = await Promise.all([
          prisma.trendyolProduct.findMany({
            where: { userId, supplierId },
            skip: page * size,
            take: size,
            orderBy: { syncedAt: 'desc' },
          }),
          prisma.trendyolProduct.count({ where: { userId, supplierId } }),
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

      // Fetch from Trendyol API
      const data = await client.getProducts({
        page,
        size,
        approved: req.query.approved === 'true' ? true : req.query.approved === 'false' ? false : undefined,
        onSale: req.query.onSale === 'true' ? true : req.query.onSale === 'false' ? false : undefined,
        rejected: req.query.rejected === 'true' ? true : undefined,
        barcode: req.query.barcode as string,
        stockCode: req.query.stockCode as string,
      });

      // Upsert to cache
      if (data.content?.length > 0) {
        const upserts = data.content.map((p: any) => {
          const barcode = p.barcode || p.stockCode || '';
          if (!barcode) return null;

          return prisma.trendyolProduct.upsert({
            where: {
              userId_supplierId_barcode: { userId, supplierId, barcode },
            },
            create: {
              userId,
              supplierId,
              barcode,
              stockCode: p.stockCode || null,
              productMainId: p.productMainId || null,
              trendyolId: p.id ? String(p.id) : null,
              title: p.title || '',
              description: p.description || null,
              brandId: p.brandId || null,
              brandName: p.brand || null,
              categoryId: p.categoryId || null,
              categoryName: p.categoryName || null,
              listPrice: p.listPrice || null,
              salePrice: p.salePrice || null,
              currencyType: p.currencyType || 'TRY',
              quantity: p.quantity || 0,
              vatRate: p.vatRate || 10,
              images: p.images || null,
              thumbnailUrl: p.images?.[0]?.url || null,
              imageCount: p.images?.length || 0,
              attributes: p.attributes || null,
              approved: p.approved || false,
              onSale: p.onSale || false,
              rejected: p.rejected || false,
              blacklisted: p.blacklisted || false,
              archived: p.archived || false,
              rejectReasons: p.rejectReasonDetails || null,
              dimensionalWeight: p.dimensionalWeight || null,
              cargoCompanyId: p.cargoCompanyId || null,
              syncedAt: new Date(),
            },
            update: {
              title: p.title || '',
              description: p.description || null,
              brandId: p.brandId || null,
              brandName: p.brand || null,
              categoryId: p.categoryId || null,
              categoryName: p.categoryName || null,
              listPrice: p.listPrice || null,
              salePrice: p.salePrice || null,
              quantity: p.quantity || 0,
              vatRate: p.vatRate || 10,
              images: p.images || null,
              thumbnailUrl: p.images?.[0]?.url || null,
              imageCount: p.images?.length || 0,
              attributes: p.attributes || null,
              approved: p.approved || false,
              onSale: p.onSale || false,
              rejected: p.rejected || false,
              blacklisted: p.blacklisted || false,
              archived: p.archived || false,
              rejectReasons: p.rejectReasonDetails || null,
              dimensionalWeight: p.dimensionalWeight || null,
              cargoCompanyId: p.cargoCompanyId || null,
              syncedAt: new Date(),
            },
          });
        }).filter(Boolean);

        await Promise.allSettled(upserts);
      }

      return res.status(200).json({ ...data, source: 'api' });
    }

    // ================================================================
    // DETAIL (single product from DB cache)
    // ================================================================
    if (action === 'detail' && req.method === 'GET') {
      const productId = req.query.id as string;
      if (!productId) return res.status(400).json({ error: 'id is required' });

      const product = await prisma.trendyolProduct.findFirst({
        where: { id: productId, userId, supplierId },
      });
      if (!product) return res.status(404).json({ error: 'Product not found' });

      return res.status(200).json({ product });
    }

    // ================================================================
    // FULL SYNC (all products to DB cache — batched for speed)
    // ================================================================
    if (action === 'sync' && req.method === 'POST') {
      let totalSynced = 0;
      let page = 0;
      let totalPages = 1;
      const MAX_PAGES = 25; // Safety limit to stay within serverless timeout
      const allProducts: any[] = [];

      // Phase 1: Fetch all products from Trendyol API
      while (page < totalPages && page < MAX_PAGES) {
        const data = await client.getProducts({ page, size: 200 });
        totalPages = data.totalPages || 1;
        if (data.content?.length) allProducts.push(...data.content);
        page++;
      }

      logger.info(`Trendyol sync: fetched ${allProducts.length} products from ${page} pages`);

      // Phase 2: Batch upsert to DB (chunks of 50 to avoid huge transactions)
      const CHUNK_SIZE = 50;
      for (let i = 0; i < allProducts.length; i += CHUNK_SIZE) {
        const chunk = allProducts.slice(i, i + CHUNK_SIZE);
        const upserts = chunk
          .filter((p: any) => p.barcode || p.stockCode)
          .map((p: any) => {
            const barcode = p.barcode || p.stockCode;
            const productData = {
              stockCode: p.stockCode || null,
              productMainId: p.productMainId || null,
              trendyolId: p.id ? String(p.id) : null,
              title: p.title || '',
              description: p.description || null,
              brandId: p.brandId || null,
              brandName: p.brand || null,
              categoryId: p.categoryId || null,
              categoryName: p.categoryName || null,
              listPrice: p.listPrice || null,
              salePrice: p.salePrice || null,
              currencyType: p.currencyType || 'TRY',
              quantity: p.quantity || 0,
              vatRate: p.vatRate || 10,
              images: p.images || null,
              thumbnailUrl: p.images?.[0]?.url || null,
              imageCount: p.images?.length || 0,
              attributes: p.attributes || null,
              approved: p.approved || false,
              onSale: p.onSale || false,
              rejected: p.rejected || false,
              blacklisted: p.blacklisted || false,
              archived: p.archived || false,
              rejectReasons: p.rejectReasonDetails || null,
              dimensionalWeight: p.dimensionalWeight || null,
              cargoCompanyId: p.cargoCompanyId || null,
              syncedAt: new Date(),
            };
            return prisma.trendyolProduct.upsert({
              where: {
                userId_supplierId_barcode: { userId, supplierId, barcode },
              },
              create: { userId, supplierId, barcode, ...productData },
              update: productData,
            });
          });

        try {
          await prisma.$transaction(upserts);
          totalSynced += upserts.length;
        } catch (err) {
          logger.warn('Batch upsert failed, falling back to individual', { error: String(err) });
          // Fallback: try individually
          for (const op of upserts) {
            try { await op; totalSynced++; } catch {}
          }
        }
      }

      return res.status(200).json({
        success: true,
        totalSynced,
        totalPages,
        pagesProcessed: page,
      });
    }

    // ================================================================
    // CREATE PRODUCTS
    // ================================================================
    if (action === 'create' && req.method === 'POST') {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const data = await client.createProducts(items);
      return res.status(200).json(data);
    }

    // ================================================================
    // UPDATE PRODUCTS
    // ================================================================
    if (action === 'update' && req.method === 'PUT') {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const data = await client.updateProducts(items);
      return res.status(200).json(data);
    }

    // ================================================================
    // UPDATE PRICE & INVENTORY (BULK)
    // ================================================================
    if (action === 'update_price_inventory' && req.method === 'PUT') {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const data = await client.updatePriceAndInventory(items);
      return res.status(200).json(data);
    }

    // ================================================================
    // ARCHIVE PRODUCTS
    // ================================================================
    if (action === 'archive' && req.method === 'PUT') {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array with barcode(s) is required' });
      }
      const data = await client.archiveProducts(items);
      return res.status(200).json(data);
    }

    // ================================================================
    // BATCH STATUS
    // ================================================================
    if ((action === 'batch_status' || action === 'batch-status') && req.method === 'GET') {
      const batchRequestId = req.query.batchRequestId as string;
      if (!batchRequestId) {
        return res.status(400).json({ error: 'batchRequestId is required' });
      }
      const data = await client.getBatchStatus(batchRequestId);
      return res.status(200).json(data);
    }

    // ================================================================
    // BULK UPDATE CACHE (local DB only, no Trendyol API call)
    // Used by find/replace and backup restore
    // ================================================================
    if (action === 'update_cache' && req.method === 'PUT') {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'items array is required' });
      }
      let updated = 0;
      for (const item of items) {
        if (!item.barcode) continue;
        try {
          await prisma.trendyolProduct.updateMany({
            where: { userId, supplierId, barcode: item.barcode },
            data: {
              ...(item.title !== undefined && { title: item.title }),
              ...(item.description !== undefined && { description: item.description }),
              ...(item.stockCode !== undefined && { stockCode: item.stockCode }),
              ...(item.listPrice !== undefined && { listPrice: item.listPrice }),
              ...(item.salePrice !== undefined && { salePrice: item.salePrice }),
              ...(item.quantity !== undefined && { quantity: item.quantity }),
              ...(item.vatRate !== undefined && { vatRate: item.vatRate }),
            },
          });
          updated++;
        } catch {}
      }
      return res.status(200).json({ success: true, updated });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error: any) {
    if (error.status && error.body) {
      return res.status(error.status).json({ error: 'Trendyol API Error', details: error.body });
    }
    logger.error('Trendyol products API error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
