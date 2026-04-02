import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

const TRENDYOL_API_BASE = 'https://apigw.trendyol.com/integration';

// Allow longer timeout for settlement sync (can take a while with many windows)
export const config = { maxDuration: 120 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TrendyolCredentials {
  apiKey: string;
  apiSecret: string;
  supplierId: string;
}

async function getTrendyolCredentials(userId: string): Promise<TrendyolCredentials> {
  const cred = await prisma.credential.findUnique({ where: { userId } });
  if (!cred?.trendyolApiKey || !cred?.trendyolApiSecret || !cred?.trendyolSupplierId) {
    throw { status: 400, message: 'Trendyol credentials not configured. Please add your API key, secret, and supplier ID in settings.' };
  }
  return {
    apiKey: cred.trendyolApiKey,
    apiSecret: cred.trendyolApiSecret,
    supplierId: cred.trendyolSupplierId,
  };
}

async function callTrendyolSettlements(
  credentials: TrendyolCredentials,
  params: { startDate: string; endDate: string; page: number; size: number }
): Promise<any> {
  const auth = 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const qs = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    page: String(params.page),
    size: String(params.size),
  });
  // Try both endpoint paths — Trendyol uses /finance/che/ for some accounts
  const paths = [
    `/finance/che/sellers/${credentials.supplierId}/settlements`,
    `/finance/sellers/${credentials.supplierId}/settlements`,
  ];

  let lastError: any = null;
  for (const path of paths) {
    const url = `${TRENDYOL_API_BASE}${path}?${qs}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `${credentials.supplierId} - SelfIntegration`,
      },
    });

    if (response.ok) {
      const text = await response.text();
      if (!text) return { content: [], totalPages: 0, totalElements: 0 };
      try { return JSON.parse(text); } catch { return { content: [], totalPages: 0, totalElements: 0 }; }
    }

    const errorText = await response.text();
    let errorBody;
    try { errorBody = JSON.parse(errorText); } catch { errorBody = { rawError: errorText }; }
    lastError = { status: response.status, path, details: errorBody };
    // If 556 or 404, try next path
    if (response.status === 556 || response.status === 404) continue;
    // Other errors — don't retry
    throw { status: response.status, message: `Trendyol API error: ${response.status}`, details: errorBody };
  }

  throw { status: lastError?.status || 500, message: `Trendyol API error: ${lastError?.status} on both paths`, details: lastError?.details }
}

/**
 * Split a date range into 15-day windows (Trendyol limitation).
 * Dates are epoch ms strings as Trendyol expects.
 */
function splitDateRange(startMs: number, endMs: number): Array<{ startDate: string; endDate: string }> {
  const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const windowEnd = Math.min(cursor + FIFTEEN_DAYS_MS, endMs);
    windows.push({
      startDate: String(cursor),
      endDate: String(windowEnd),
    });
    cursor = windowEnd;
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Sync action — fetch from Trendyol and upsert into DB
// ---------------------------------------------------------------------------

async function handleSync(userId: string, body: any, res: NextApiResponse) {
  const { startDate, endDate } = body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (epoch ms)' });
  }

  const startMs = Number(startDate);
  const endMs = Number(endDate);
  if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
    return res.status(400).json({ error: 'Invalid date range. startDate must be before endDate (epoch ms).' });
  }

  const credentials = await getTrendyolCredentials(userId);
  const windows = splitDateRange(startMs, endMs);

  let totalUpserted = 0;
  let totalFetched = 0;

  for (const window of windows) {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const data = await callTrendyolSettlements(credentials, {
        startDate: window.startDate,
        endDate: window.endDate,
        page,
        size: 200,
      });

      const items = Array.isArray(data.content) ? data.content : [];
      totalFetched += items.length;

      // Upsert each transaction
      for (const item of items) {
        const externalId = item.id ? String(item.id) : `${item.transactionType}_${item.orderNumber || ''}_${item.transactionDate || Date.now()}`;

        await prisma.financialTransaction.upsert({
          where: {
            userId_marketplace_externalId: {
              userId,
              marketplace: 'trendyol',
              externalId,
            },
          },
          update: {
            transactionType: item.transactionType || 'unknown',
            orderNumber: item.orderNumber || null,
            barcode: item.barcode || null,
            productName: item.productName || null,
            quantity: item.quantity ?? 1,
            amount: item.amount ?? 0,
            currency: item.currency || 'TRY',
            commission: item.commissionAmount ?? null,
            shippingAmount: item.shippingAmount ?? null,
            transactionDate: item.transactionDate ? new Date(item.transactionDate) : new Date(),
            rawData: item,
            syncedAt: new Date(),
          },
          create: {
            userId,
            marketplace: 'trendyol',
            externalId,
            transactionType: item.transactionType || 'unknown',
            orderNumber: item.orderNumber || null,
            barcode: item.barcode || null,
            productName: item.productName || null,
            quantity: item.quantity ?? 1,
            amount: item.amount ?? 0,
            currency: item.currency || 'TRY',
            commission: item.commissionAmount ?? null,
            shippingAmount: item.shippingAmount ?? null,
            transactionDate: item.transactionDate ? new Date(item.transactionDate) : new Date(),
            rawData: item,
          },
        });
        totalUpserted++;
      }

      // Check if more pages
      const totalPages = data.totalPages ?? 0;
      page++;
      hasMore = items.length === 200 && page < totalPages;
    }
  }

  // Update sync cursor
  await prisma.financialSyncCursor.upsert({
    where: {
      userId_marketplace: { userId, marketplace: 'trendyol' },
    },
    update: {
      lastSyncedTo: new Date(endMs),
      totalSynced: { increment: totalUpserted },
    },
    create: {
      userId,
      marketplace: 'trendyol',
      lastSyncedTo: new Date(endMs),
      totalSynced: totalUpserted,
    },
  });

  logger.info('Settlement sync complete', { userId, totalFetched, totalUpserted, windows: windows.length });

  return res.status(200).json({
    success: true,
    totalFetched,
    totalUpserted,
    windows: windows.length,
    syncedTo: new Date(endMs).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// GET — query cached transactions from DB
// ---------------------------------------------------------------------------

async function handleGet(userId: string, query: NextApiRequest['query'], res: NextApiResponse) {
  const marketplace = (query.marketplace as string) || 'trendyol';
  const startDate = query.startDate as string | undefined;
  const endDate = query.endDate as string | undefined;
  const transactionType = query.transactionType as string | undefined;
  const page = Math.max(0, parseInt(query.page as string) || 0);
  const size = Math.min(500, Math.max(1, parseInt(query.size as string) || 50));

  const where: any = { userId, marketplace };

  if (startDate || endDate) {
    where.transactionDate = {};
    if (startDate) where.transactionDate.gte = new Date(Number(startDate) || startDate);
    if (endDate) where.transactionDate.lte = new Date(Number(endDate) || endDate);
  }

  if (transactionType) {
    where.transactionType = transactionType;
  }

  const [transactions, total] = await Promise.all([
    prisma.financialTransaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      skip: page * size,
      take: size,
    }),
    prisma.financialTransaction.count({ where }),
  ]);

  // Also fetch sync cursor for metadata
  const cursor = await prisma.financialSyncCursor.findUnique({
    where: { userId_marketplace: { userId, marketplace } },
  });

  return res.status(200).json({
    transactions,
    total,
    page,
    size,
    totalPages: Math.ceil(total / size),
    syncCursor: cursor
      ? { lastSyncedTo: cursor.lastSyncedTo, totalSynced: cursor.totalSynced, updatedAt: cursor.updatedAt }
      : null,
  });
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

    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'sync') {
        return await handleSync(userId, req.body, res);
      }
      return res.status(400).json({ error: 'Unknown action. Use action: "sync".' });
    }

    if (req.method === 'GET') {
      return await handleGet(userId, req.query, res);
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err: any) {
    // Structured API errors
    if (err.status && err.message) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    logger.error('Finance settlements API error', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
