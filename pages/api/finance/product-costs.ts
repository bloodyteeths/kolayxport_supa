import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

// ---------------------------------------------------------------------------
// GET — list product costs
// ---------------------------------------------------------------------------

async function handleGet(userId: string, query: NextApiRequest['query'], res: NextApiResponse) {
  const marketplace = (query.marketplace as string) || undefined;
  const search = (query.search as string) || undefined;
  const page = Math.max(0, parseInt(query.page as string) || 0);
  const size = Math.min(500, Math.max(1, parseInt(query.size as string) || 50));

  const where: any = { userId };

  if (marketplace) {
    where.marketplace = marketplace;
  }

  if (search) {
    where.OR = [
      { productName: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [costs, total] = await Promise.all([
    prisma.productCost.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: page * size,
      take: size,
    }),
    prisma.productCost.count({ where }),
  ]);

  return res.status(200).json({
    costs,
    total,
    page,
    size,
    totalPages: Math.ceil(total / size),
  });
}

// ---------------------------------------------------------------------------
// POST — create single cost entry
// ---------------------------------------------------------------------------

async function handleCreate(userId: string, body: any, res: NextApiResponse) {
  const { marketplace, sku, barcode, marketplaceId, productName, costAmount, costCurrency, shippingCost, notes } = body;

  if (!marketplace || !productName || costAmount === undefined) {
    return res.status(400).json({ error: 'marketplace, productName, and costAmount are required.' });
  }

  const cost = await prisma.productCost.create({
    data: {
      userId,
      marketplace,
      sku: sku || null,
      barcode: barcode || null,
      marketplaceId: marketplaceId || null,
      productName,
      costAmount,
      costCurrency: costCurrency || 'TRY',
      shippingCost: shippingCost ?? null,
      notes: notes || null,
    },
  });

  return res.status(201).json(cost);
}

// ---------------------------------------------------------------------------
// POST action: "bulk" — bulk create/update costs
// ---------------------------------------------------------------------------

async function handleBulk(userId: string, body: any, res: NextApiResponse) {
  const { items } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty.' });
  }

  if (items.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 items per bulk request.' });
  }

  const results: { created: number; updated: number; errors: string[] } = { created: 0, updated: 0, errors: [] };

  for (const item of items) {
    try {
      if (!item.marketplace || !item.productName || item.costAmount === undefined) {
        results.errors.push(`Missing required fields for item: ${item.barcode || item.sku || 'unknown'}`);
        continue;
      }

      // Use barcode as the unique key for upsert if available
      if (item.barcode) {
        const existing = await prisma.productCost.findUnique({
          where: {
            userId_marketplace_barcode: {
              userId,
              marketplace: item.marketplace,
              barcode: item.barcode,
            },
          },
        });

        if (existing) {
          await prisma.productCost.update({
            where: { id: existing.id },
            data: {
              sku: item.sku ?? existing.sku,
              marketplaceId: item.marketplaceId ?? existing.marketplaceId,
              productName: item.productName,
              costAmount: item.costAmount,
              costCurrency: item.costCurrency || existing.costCurrency,
              shippingCost: item.shippingCost ?? existing.shippingCost,
              notes: item.notes ?? existing.notes,
            },
          });
          results.updated++;
        } else {
          await prisma.productCost.create({
            data: {
              userId,
              marketplace: item.marketplace,
              sku: item.sku || null,
              barcode: item.barcode,
              marketplaceId: item.marketplaceId || null,
              productName: item.productName,
              costAmount: item.costAmount,
              costCurrency: item.costCurrency || 'TRY',
              shippingCost: item.shippingCost ?? null,
              notes: item.notes || null,
            },
          });
          results.created++;
        }
      } else {
        // No barcode — just create
        await prisma.productCost.create({
          data: {
            userId,
            marketplace: item.marketplace,
            sku: item.sku || null,
            barcode: null,
            marketplaceId: item.marketplaceId || null,
            productName: item.productName,
            costAmount: item.costAmount,
            costCurrency: item.costCurrency || 'TRY',
            shippingCost: item.shippingCost ?? null,
            notes: item.notes || null,
          },
        });
        results.created++;
      }
    } catch (err: any) {
      results.errors.push(`Error for ${item.barcode || item.sku || 'unknown'}: ${err.message}`);
    }
  }

  return res.status(200).json({
    success: true,
    ...results,
    total: results.created + results.updated,
  });
}

// ---------------------------------------------------------------------------
// PUT — update single cost entry by id
// ---------------------------------------------------------------------------

async function handleUpdate(userId: string, body: any, res: NextApiResponse) {
  const { id, ...updates } = body;
  if (!id) {
    return res.status(400).json({ error: 'id is required for update.' });
  }

  // Verify ownership
  const existing = await prisma.productCost.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Product cost not found.' });
  }

  const allowedFields = ['marketplace', 'sku', 'barcode', 'marketplaceId', 'productName', 'costAmount', 'costCurrency', 'shippingCost', 'notes'];
  const data: any = {};
  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      data[key] = updates[key];
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  const updated = await prisma.productCost.update({
    where: { id },
    data,
  });

  return res.status(200).json(updated);
}

// ---------------------------------------------------------------------------
// GET action: "sold_products" — distinct barcode+productName from transactions
// ---------------------------------------------------------------------------

async function handleSoldProducts(userId: string, query: NextApiRequest['query'], res: NextApiResponse) {
  const marketplace = (query.marketplace as string) || undefined;

  const where: any = {
    userId,
    productName: { not: null },
  };

  if (marketplace) {
    where.marketplace = marketplace;
  }

  // Use groupBy to get distinct barcode+productName pairs
  const rows = await prisma.financialTransaction.groupBy({
    by: ['barcode', 'productName'],
    where,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 500,
  });

  const products = rows.map((r) => ({
    barcode: r.barcode || '',
    productName: r.productName || '',
  }));

  return res.status(200).json({ products });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }

    const userId = user.id;

    if (req.method === 'GET') {
      const action = req.query.action as string | undefined;
      if (action === 'sold_products') {
        return await handleSoldProducts(userId, req.query, res);
      }
      return await handleGet(userId, req.query, res);
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'bulk') {
        return await handleBulk(userId, req.body, res);
      }
      return await handleCreate(userId, req.body, res);
    }

    if (req.method === 'PUT') {
      return await handleUpdate(userId, req.body, res);
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err: any) {
    if (err.status && err.message) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    logger.error('Finance product-costs API error', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
