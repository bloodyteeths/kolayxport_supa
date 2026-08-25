import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { EtsyClient } from '../../../lib/integrations/etsyClient';
import type { EtsyCredentials } from '../../../lib/integrations/etsyClient';
import { getUserAccessToken, EbayNotConnectedError } from '../../../lib/integrations/ebayClient';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';

const TRENDYOL_API_BASE = 'https://apigw.trendyol.com/integration';
const EBAY_FINANCES_BASE = 'https://apiz.ebay.com';

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

// Settlement transaction types — queried separately (Trendyol requires single transactionType param)
// Only types that actually return data for this seller:
const SETTLEMENT_TYPES_PRIMARY = [
  'Sale', 'Return', 'Discount', 'DiscountCancel',
  'Coupon', 'CouponCancel',
];
// Rare types — only fetch if primary succeeds quickly
const SETTLEMENT_TYPES_SECONDARY = [
  'CommissionPositive', 'CommissionNegative',
];

async function callTrendyolSettlements(
  credentials: TrendyolCredentials,
  params: { startDate: string; endDate: string; transactionType: string; page: number; size: number }
): Promise<any> {
  const auth = 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const qs = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    transactionType: params.transactionType,
    page: String(params.page),
    size: String(params.size),
  });

  const url = `${TRENDYOL_API_BASE}/finance/che/sellers/${credentials.supplierId}/settlements?${qs}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `${credentials.supplierId} - SelfIntegration`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorBody;
    try { errorBody = JSON.parse(errorText); } catch { errorBody = { rawError: errorText }; }
    // Skip 400 errors for unsupported transaction types
    if (response.status === 400) return { content: [], totalPages: 0, totalElements: 0 };
    throw { status: response.status, message: `Trendyol API error: ${response.status}`, details: errorBody };
  }

  const text = await response.text();
  if (!text) return { content: [], totalPages: 0, totalElements: 0 };
  try { return JSON.parse(text); } catch { return { content: [], totalPages: 0, totalElements: 0 }; }
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
// Other Financials — cargo invoices live here
// ---------------------------------------------------------------------------

async function callTrendyolOtherFinancials(
  credentials: TrendyolCredentials,
  params: { startDate: string; endDate: string; transactionType: string; page: number; size: number }
): Promise<any> {
  const auth = 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const qs = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    transactionType: params.transactionType,
    page: String(params.page),
    size: String(params.size),
  });

  const url = `${TRENDYOL_API_BASE}/finance/che/sellers/${credentials.supplierId}/otherfinancials?${qs}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `${credentials.supplierId} - SelfIntegration`,
    },
  });

  if (!response.ok) {
    if (response.status === 400) return { content: [], totalPages: 0 };
    return { content: [], totalPages: 0 };
  }

  const text = await response.text();
  if (!text) return { content: [], totalPages: 0 };
  try { return JSON.parse(text); } catch { return { content: [], totalPages: 0 }; }
}

/**
 * Fetch cargo invoice line items for a given invoice serial number.
 * Returns per-order shipping costs with fields: orderNumber, amount, shipmentPackageType, desi.
 */
async function fetchCargoInvoiceItems(
  credentials: TrendyolCredentials,
  invoiceSerialNumber: string
): Promise<any[]> {
  const auth = 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const url = `${TRENDYOL_API_BASE}/finance/che/sellers/${credentials.supplierId}/cargo-invoice/${encodeURIComponent(invoiceSerialNumber)}/items`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `${credentials.supplierId} - SelfIntegration`,
    },
  });

  if (!response.ok) return [];
  const text = await response.text();
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : (data.content || data.items || []);
  } catch {
    return [];
  }
}

/**
 * Sync cargo/shipping costs from Trendyol's Other Financials + Cargo Invoice APIs.
 * Returns a map of orderNumber → total shipping cost.
 */
async function syncCargoInvoices(
  credentials: TrendyolCredentials,
  windows: Array<{ startDate: string; endDate: string }>
): Promise<{ orderShippingMap: Map<string, number>; totalCargoItems: number; deductionItems: any[] }> {
  const orderShippingMap = new Map<string, number>();
  let totalCargoItems = 0;
  // Every deduction invoice (kargo, komisyon, platform hizmet, reklam,
  // kusurlu/yanlış ürün, kesinti, kontör...) — stored as FinancialTransaction
  // rows so the dashboard matches the official Cari Hesap Ekstresi.
  const deductionItems: any[] = [];

  for (const window of windows) {
    // Fetch DeductionInvoices from otherfinancials
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const data = await callTrendyolOtherFinancials(credentials, {
        startDate: window.startDate,
        endDate: window.endDate,
        transactionType: 'DeductionInvoices',
        page,
        size: 500,
      });

      const items = Array.isArray(data.content) ? data.content : [];
      if (items.length === 0) { hasMore = false; break; }
      deductionItems.push(...items);

      // Filter for cargo invoices (Kargo Faturasi / Kargo Fatura)
      const cargoInvoices = items.filter((item: any) => {
        const txType = (item.transactionType || '').toLowerCase();
        return txType.includes('kargo') || txType.includes('cargo');
      });

      // Fetch line items for each cargo invoice in parallel
      const BATCH = 10;
      for (let i = 0; i < cargoInvoices.length; i += BATCH) {
        const batch = cargoInvoices.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map((inv: any) => {
            const serialNo = inv.id || inv.invoiceSerialNumber || inv.Id;
            if (!serialNo) return Promise.resolve([]);
            return fetchCargoInvoiceItems(credentials, String(serialNo));
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            for (const lineItem of result.value) {
              totalCargoItems++;
              const orderNum = lineItem.orderNumber ? String(lineItem.orderNumber) : null;
              const amount = Math.abs(Number(lineItem.amount || 0));
              if (orderNum && amount > 0) {
                orderShippingMap.set(orderNum, (orderShippingMap.get(orderNum) || 0) + amount);
              }
            }
          }
        }
      }

      hasMore = page < (data.totalPages || 0) - 1;
      page++;
    }
  }

  return { orderShippingMap, totalCargoItems, deductionItems };
}

/**
 * Fetch withholding-tax rows (E-ticaret Stopajı, 7524 sayılı kanun) from
 * otherfinancials. These are real deductions on every payout and must be in
 * the dashboard for it to reconcile with the Cari Hesap Ekstresi.
 */
async function fetchStoppageItems(
  credentials: TrendyolCredentials,
  windows: Array<{ startDate: string; endDate: string }>
): Promise<any[]> {
  const items: any[] = [];
  for (const window of windows) {
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const data = await callTrendyolOtherFinancials(credentials, {
        startDate: window.startDate,
        endDate: window.endDate,
        transactionType: 'Stoppage',
        page,
        size: 500,
      });
      const content = Array.isArray(data.content) ? data.content : [];
      if (content.length === 0) break;
      items.push(...content);
      hasMore = page < (data.totalPages || 0) - 1;
      page++;
    }
  }
  return items;
}

// Fetch PaymentOrder rows (Ödeme — accrual payments Trendyol made to the
// seller's bank) from otherfinancials. This is Trendyol's payout data, used
// for the banked panel.
async function fetchPaymentOrders(
  credentials: TrendyolCredentials,
  windows: Array<{ startDate: string; endDate: string }>
): Promise<any[]> {
  const items: any[] = [];
  for (const window of windows) {
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const data = await callTrendyolOtherFinancials(credentials, {
        startDate: window.startDate,
        endDate: window.endDate,
        transactionType: 'PaymentOrder',
        page,
        size: 500,
      });
      const content = Array.isArray(data.content) ? data.content : [];
      if (content.length === 0) break;
      items.push(...content);
      hasMore = page < (data.totalPages || 0) - 1;
      page++;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Resolve product names from Trendyol Products API by barcode
// ---------------------------------------------------------------------------

async function fetchProductNamesByBarcodes(
  credentials: TrendyolCredentials,
  barcodes: string[]
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (barcodes.length === 0) return nameMap;

  const auth = 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const headers = {
    Authorization: auth,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `${credentials.supplierId} - SelfIntegration`,
  };

  // Trendyol products API supports single barcode filter per request.
  // Batch in parallel — 20 concurrent for speed.
  const BATCH_SIZE = 20;
  for (let i = 0; i < barcodes.length; i += BATCH_SIZE) {
    const batch = barcodes.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (barcode) => {
        const qs = new URLSearchParams({ barcode, size: '1' });
        const url = `${TRENDYOL_API_BASE}/product/sellers/${credentials.supplierId}/products?${qs}`;
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.content && data.content.length > 0) {
          const product = data.content[0];
          // Trendyol product title is in the 'title' field
          const name = product.title || product.productName || product.name || null;
          if (name) return { barcode, name };
        }
        return null;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        nameMap.set(result.value.barcode, result.value.name);
      }
    }
  }

  logger.info('Resolved product names from barcodes', { total: barcodes.length, resolved: nameMap.size });
  return nameMap;
}

// ---------------------------------------------------------------------------
// Sync action — fetch from Trendyol and upsert into DB
// ---------------------------------------------------------------------------

export async function handleSync(userId: string, body: any, res: NextApiResponse) {
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

  // ---- PHASE 1: Fetch all data in parallel ----
  // Build all settlement fetch promises across ALL windows × ALL types at once.
  // Each window×type is paginated — page 0 alone silently truncates busy
  // stores at 500 rows.
  const allTypes = [...SETTLEMENT_TYPES_PRIMARY, ...SETTLEMENT_TYPES_SECONDARY];
  const fetchAllSettlementPages = async (window: { startDate: string; endDate: string }, txType: string): Promise<any[]> => {
    const out: any[] = [];
    for (let page = 0; page < 10; page++) {
      const data = await callTrendyolSettlements(credentials, {
        startDate: window.startDate,
        endDate: window.endDate,
        transactionType: txType,
        page,
        size: 500,
      }).catch(() => null);
      if (!data) break;
      const items = Array.isArray(data.content) ? data.content : [];
      out.push(...items);
      if (page >= (data.totalPages || 0) - 1) break;
    }
    return out;
  };
  const settlementPromises = windows.flatMap(window =>
    allTypes.map(txType => fetchAllSettlementPages(window, txType))
  );

  // Fetch settlements + deduction invoices + stopaj + payouts in parallel
  const [settlementResults, cargoResult, stoppageItems, paymentOrders] = await Promise.all([
    Promise.all(settlementPromises),
    syncCargoInvoices(credentials, windows),
    fetchStoppageItems(credentials, windows).catch(() => [] as any[]),
    fetchPaymentOrders(credentials, windows).catch(() => [] as any[]),
  ]);

  // Collect all settlement items
  const allSettlementItems: any[] = settlementResults.flat();
  const totalFetched = allSettlementItems.length;
  const { orderShippingMap, totalCargoItems, deductionItems } = cargoResult;

  // ---- PHASE 2: Resolve product names (parallel with bigger batches) ----
  const uniqueBarcodes = [...new Set(
    allSettlementItems
      .map((item: any) => item.barcode)
      .filter((b: any): b is string => !!b)
  )];

  const productNameMap = await fetchProductNamesByBarcodes(credentials, uniqueBarcodes);

  // ---- PHASE 3: Bulk upsert (batched for speed) ----
  // Trendyol has no balance API, so derive "pending payout" = net of settlement
  // rows whose paymentDate (vade) is still in the future = money earned but not
  // yet disbursed. Approximate (only within the synced window) and labelled as such.
  const nowMs = Date.now();
  let pendingPayout = 0;
  const UPSERT_BATCH = 20;
  for (let i = 0; i < allSettlementItems.length; i += UPSERT_BATCH) {
    const batch = allSettlementItems.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(item => {
      const externalId = item.id ? String(item.id) : `${item.transactionType}_${item.orderNumber || ''}_${item.transactionDate || Date.now()}`;
      const credit = Number(item.credit || 0);
      const debt = Number(item.debt || 0);
      const amount = credit - debt;
      const payMs = item.paymentDate ? Number(item.paymentDate) : 0;
      if (payMs > nowMs) pendingPayout += amount;
      const resolvedName = item.barcode ? productNameMap.get(item.barcode) : undefined;
      const orderNum = item.orderNumber ? String(item.orderNumber) : null;
      const shippingFromCargo = orderNum ? (orderShippingMap.get(orderNum) || null) : null;

      const txData = {
        transactionType: item.transactionType || 'unknown',
        orderNumber: orderNum,
        barcode: item.barcode || null,
        productName: resolvedName || item.productName || item.description || null,
        quantity: item.quantity ?? 1,
        amount,
        currency: 'TRY',
        commission: item.commissionAmount != null ? Number(item.commissionAmount) : null,
        shippingAmount: shippingFromCargo,
        transactionDate: item.transactionDate ? new Date(item.transactionDate) : new Date(),
        rawData: item,
      };

      return prisma.financialTransaction.upsert({
        where: {
          userId_marketplace_externalId: {
            userId,
            marketplace: 'trendyol',
            externalId,
          },
        },
        update: { ...txData, syncedAt: new Date() },
        create: { userId, marketplace: 'trendyol', externalId, ...txData },
      });
    }));
    totalUpserted += batch.length;
  }

  // ---- PHASE 4: store deduction invoices + stopaj as transactions ----
  // These are the official cost side of the Cari Hesap Ekstresi (komisyon,
  // kargo, platform hizmet, reklam, kusurlu/yanlış ürün, kesinti, stopaj...).
  // Without them the dashboard overstates profit.
  const invoiceRows = [
    ...deductionItems.map((it: any) => ({ it, prefix: 'inv' })),
    ...stoppageItems.map((it: any) => ({ it, prefix: 'stopaj' })),
  ];
  for (let i = 0; i < invoiceRows.length; i += UPSERT_BATCH) {
    const batch = invoiceRows.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(({ it, prefix }) => {
      const externalId = `${prefix}_${it.id ?? `${it.transactionType || prefix}_${it.transactionDate || ''}`}`;
      const credit = Number(it.credit || 0);
      const debt = Number(it.debt || 0);
      const txData = {
        transactionType: it.transactionType || (prefix === 'stopaj' ? 'E-ticaret Stopajı' : 'DeductionInvoice'),
        orderNumber: it.orderNumber ? String(it.orderNumber) : null,
        barcode: null,
        productName: it.description || null,
        quantity: 1,
        amount: credit - debt,
        currency: 'TRY',
        commission: null,
        shippingAmount: null,
        transactionDate: it.transactionDate ? new Date(it.transactionDate) : new Date(),
        rawData: it,
      };
      return prisma.financialTransaction.upsert({
        where: {
          userId_marketplace_externalId: { userId, marketplace: 'trendyol', externalId },
        },
        update: { ...txData, syncedAt: new Date() },
        create: { userId, marketplace: 'trendyol', externalId, ...txData },
      });
    }));
    totalUpserted += batch.length;
  }

  // ---- PHASE 5: store PaymentOrder rows as bank payouts (Disbursement) ----
  // Ödeme = money Trendyol paid to the seller's bank. In the cari hesap it's a
  // debit (reduces balance); store negative like the other marketplaces so the
  // banked panel shows it and it's excluded from P&L.
  for (let i = 0; i < paymentOrders.length; i += UPSERT_BATCH) {
    const batch = paymentOrders.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map((it: any) => {
      const payout = Math.abs(Number(it.debt || 0) || Number(it.credit || 0));
      const externalId = `payout_${it.id ?? it.paymentOrderId ?? `${it.transactionDate || ''}_${payout}`}`;
      const txData = {
        transactionType: 'Disbursement',
        orderNumber: it.paymentOrderId ? String(it.paymentOrderId) : null,
        barcode: null,
        productName: it.description || 'Ödeme',
        quantity: 1,
        amount: -payout,
        currency: 'TRY',
        commission: null,
        shippingAmount: null,
        transactionDate: it.transactionDate ? new Date(Number(it.transactionDate)) : new Date(),
        rawData: it,
      };
      return prisma.financialTransaction.upsert({
        where: { userId_marketplace_externalId: { userId, marketplace: 'trendyol', externalId } },
        update: { ...txData, syncedAt: new Date() },
        create: { userId, marketplace: 'trendyol', externalId, ...txData },
      });
    }));
    totalUpserted += batch.length;
  }

  // Update sync cursor (+ derived pending-payout balance)
  const balanceData = pendingPayout !== 0
    ? { currentBalance: Math.round(pendingPayout * 100) / 100, balanceCurrency: 'TRY' }
    : {};
  await prisma.financialSyncCursor.upsert({
    where: {
      userId_marketplace: { userId, marketplace: 'trendyol' },
    },
    update: {
      lastSyncedTo: new Date(endMs),
      totalSynced: { increment: totalUpserted },
      ...balanceData,
    },
    create: {
      userId,
      marketplace: 'trendyol',
      lastSyncedTo: new Date(endMs),
      totalSynced: totalUpserted,
      ...balanceData,
    },
  });

  logger.info('Settlement sync complete', {
    userId, totalFetched, totalUpserted,
    windows: windows.length,
    uniqueBarcodes: uniqueBarcodes.length,
    resolvedNames: productNameMap.size,
    cargoItems: totalCargoItems,
    ordersWithShipping: orderShippingMap.size,
  });

  return res.status(200).json({
    success: true,
    totalFetched,
    totalUpserted,
    windows: windows.length,
    productsResolved: productNameMap.size,
    cargoItemsSynced: totalCargoItems,
    ordersWithShipping: orderShippingMap.size,
    syncedTo: new Date(endMs).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Etsy — credentials & settlement sync
// ---------------------------------------------------------------------------

interface EtsyShopCredentials {
  accessToken: string;
  refreshToken: string;
  shopId: string;
  tokenExpiresAt: Date | null;
  dbId: string; // EtsyShop record id for token refresh updates
}

async function getEtsyCredentials(userId: string): Promise<EtsyShopCredentials> {
  const shop = await prisma.etsyShop.findFirst({
    where: { userId, isActive: true, isDefault: true },
  });

  // Fallback: if no default shop, try any active shop for this user
  const resolved = shop || await prisma.etsyShop.findFirst({
    where: { userId, isActive: true },
  });

  if (!resolved?.accessToken || !resolved?.shopId) {
    throw {
      status: 400,
      message: 'Etsy credentials not configured. Please connect your Etsy shop in settings.',
    };
  }

  if (!resolved.refreshToken) {
    throw {
      status: 400,
      message: 'Etsy refresh token missing. Please reconnect your Etsy shop in settings.',
    };
  }

  // Tokens are stored as `enc:v1:...` envelopes by the OAuth callback.
  // Etsy's API rejects encrypted blobs as "not a Bearer token" → 403, so
  // decrypt here and let onTokenRefresh re-encrypt on write.
  const accessTokenPlain = decryptIfNeeded(resolved.accessToken) as string;
  const refreshTokenPlain = decryptIfNeeded(resolved.refreshToken) as string;
  if (!accessTokenPlain || !refreshTokenPlain) {
    throw {
      status: 400,
      message: 'Etsy credentials could not be decrypted. Please reconnect your Etsy shop in settings.',
    };
  }
  return {
    accessToken: accessTokenPlain,
    refreshToken: refreshTokenPlain,
    shopId: resolved.shopId,
    tokenExpiresAt: resolved.tokenExpiresAt,
    dbId: resolved.id,
  };
}

export async function handleEtsySync(userId: string, body: any, res: NextApiResponse) {
  const { startDate, endDate } = body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (epoch ms)' });
  }

  const startMs = Number(startDate);
  const endMs = Number(endDate);
  if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
    return res.status(400).json({ error: 'Invalid date range. startDate must be before endDate (epoch ms).' });
  }

  const etsyCreds = await getEtsyCredentials(userId);

  // Token refresh callback — persists new tokens (encrypted) to DB
  const onTokenRefresh = async (newCreds: EtsyCredentials) => {
    await prisma.etsyShop.update({
      where: { id: etsyCreds.dbId },
      data: {
        accessToken: encryptIfNeeded(newCreds.accessToken) as string,
        refreshToken: newCreds.refreshToken
          ? (encryptIfNeeded(newCreds.refreshToken) as string)
          : undefined,
        tokenExpiresAt: newCreds.tokenExpiresAt || undefined,
      },
    });
    logger.info('Etsy token refreshed and saved to DB', { shopId: etsyCreds.shopId });
  };

  const client = new EtsyClient(
    {
      accessToken: etsyCreds.accessToken,
      refreshToken: etsyCreds.refreshToken,
      shopId: etsyCreds.shopId,
      tokenExpiresAt: etsyCreds.tokenExpiresAt || undefined,
    },
    onTokenRefresh
  );

  // Convert epoch ms → unix seconds for Etsy API
  const minCreated = Math.floor(startMs / 1000);
  const maxCreated = Math.floor(endMs / 1000);

  // ---- PHASE 1: Fetch all receipts with pagination ----
  const allReceipts: any[] = [];
  let offset = 0;
  const PAGE_LIMIT = 100;
  let hasMore = true;

  while (hasMore) {
    const data = await client.getReceipts({
      min_created: minCreated,
      max_created: maxCreated,
      limit: PAGE_LIMIT,
      offset,
    });

    const results = Array.isArray(data.results) ? data.results : [];
    allReceipts.push(...results);

    if (results.length < PAGE_LIMIT) {
      hasMore = false;
    } else {
      offset += PAGE_LIMIT;
    }
  }

  const totalFetched = allReceipts.length;

  // Phase 2 (getShopPayments) was removed: that endpoint requires payment_ids
  // and 400s with a date range, so it never returned fee data. Real fees now
  // come from the ledger in Phase 4.

  // ---- PHASE 3: Map receipts to FinancialTransaction records & upsert ----
  let totalUpserted = 0;
  const UPSERT_BATCH = 20;

  for (let i = 0; i < allReceipts.length; i += UPSERT_BATCH) {
    const batch = allReceipts.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(receipt => {
      const receiptId = String(receipt.receipt_id);
      const status = (receipt.status || '').toLowerCase();

      // Determine transaction type from receipt status
      const isRefund = status === 'refunded' || status === 'returned';
      const transactionType = isRefund ? 'Return' : 'Sale';

      // Product name: first transaction title or concatenated
      let productName: string | null = null;
      if (Array.isArray(receipt.transactions) && receipt.transactions.length > 0) {
        if (receipt.transactions.length === 1) {
          productName = receipt.transactions[0].title || null;
        } else {
          productName = receipt.transactions.map((t: any) => t.title).filter(Boolean).join(', ') || null;
        }
      }

      // Revenue = grandtotal MINUS sales tax. Etsy's grandtotal bundles the
      // marketplace-facilitator sales tax it collects and remits to tax
      // authorities — that money is never the seller's, so it must not inflate
      // revenue. total_tax_cost is the exact tax portion (matches the ledger's
      // sales_tax entries). Remaining amount = items + buyer-paid shipping.
      const taxCost = EtsyClient.etsyMoney(receipt.total_tax_cost || { amount: 0, divisor: 100 });
      let amount = EtsyClient.etsyMoney(receipt.grandtotal || { amount: 0, divisor: 100 }) - taxCost;
      if (isRefund) amount = -Math.abs(amount);

      // Etsy shipping is buyer-paid — NOT a seller expense.
      // Real Etsy fees are NOT estimated here anymore. They come from the
      // ledger in Phase 4 (transaction/processing/listing fees), which is
      // authoritative. The old 13% estimate overstated commissions by ~50%
      // because the payments API (getShopPayments) requires payment_ids and
      // always 400s — so real fee data never arrived. commission stays null.
      const commission: number | null = null;

      // Currency
      const currency = receipt.grandtotal?.currency_code || 'USD';

      // Transaction date
      const transactionDate = receipt.create_timestamp
        ? new Date(receipt.create_timestamp * 1000)
        : new Date();

      // Use first listing_id as barcode for product P&L breakdown
      const barcode = Array.isArray(receipt.transactions) && receipt.transactions.length > 0
        ? String(receipt.transactions[0].listing_id || '')
        : null;

      const txData = {
        transactionType,
        orderNumber: receiptId,
        barcode: barcode || null,
        productName,
        quantity: Array.isArray(receipt.transactions)
          ? receipt.transactions.reduce((sum: number, t: any) => sum + (t.quantity || 1), 0)
          : 1,
        amount,
        currency,
        commission,
        shippingAmount: null as number | null, // Etsy shipping is buyer-paid, not a seller expense
        transactionDate,
        rawData: receipt,
      };

      return prisma.financialTransaction.upsert({
        where: {
          userId_marketplace_externalId: {
            userId,
            marketplace: 'etsy',
            externalId: receiptId,
          },
        },
        update: { ...txData, syncedAt: new Date() },
        create: { userId, marketplace: 'etsy', externalId: receiptId, ...txData },
      });
    }));
    totalUpserted += batch.length;
  }

  // ---- PHASE 4: Fetch ledger entries for ad spend ----
  // We persist ONE FinancialTransaction per Etsy ledger entry (keyed by
  // entry_id), not one summary per sync window. The old summary approach
  // produced overlapping rows (`adspend_<min>_<max>`) for every distinct date
  // range the user picked — and the dashboard summed all of them, inflating
  // ad spend by 4-5x. Keying by entry_id makes re-sync idempotent.
  let adSpendTotal = 0;
  let adSpendEntries = 0;
  let latestBalance = 0;
  let latestBalanceSeq = -1;
  let balanceCurrency = 'USD';
  try {
    // Etsy's ledger endpoint rejects any window wider than 31 days (400 "Time
    // window between min_created and max_created must be no more than
    // 2678400"). The 35-day cron window silently failed this every run — so
    // fees/ads/refunds/balance only updated on manual ≤31-day syncs. Chunk the
    // range into ≤30-day sub-windows so ANY range works.
    const LEDGER_WINDOW_SEC = 30 * 24 * 60 * 60;
    for (let winStart = minCreated; winStart < maxCreated; winStart += LEDGER_WINDOW_SEC) {
      const winEnd = Math.min(winStart + LEDGER_WINDOW_SEC, maxCreated);
      let ledgerOffset = 0;
      let ledgerHasMore = true;

    while (ledgerHasMore) {
      const ledgerData = await client.getLedgerEntries({
        min_created: winStart,
        max_created: winEnd,
        limit: PAGE_LIMIT,
        offset: ledgerOffset,
      });

      const entries = Array.isArray(ledgerData.results) ? ledgerData.results : [];

      // Log first batch of ledger types for debugging
      if (ledgerOffset === 0 && entries.length > 0) {
        const typeSample = new Map<string, number>();
        for (const e of entries) {
          const lt = e.ledger_type || 'unknown';
          typeSample.set(lt, (typeSample.get(lt) || 0) + 1);
        }
        logger.info('Etsy ledger entry types sample', {
          types: Object.fromEntries(typeSample),
          sampleEntry: {
            ledger_type: entries[0].ledger_type,
            description: entries[0].description,
            amount: entries[0].amount,
            currency_code: entries[0].currency_code,
          },
          totalInBatch: entries.length,
        });
      }

      for (const entry of entries) {
        const ledgerType = (entry.ledger_type || '').toLowerCase();
        const description = (entry.description || '').toLowerCase();

        // Ledger amounts are integers in cents, not Money objects. Sign is
        // meaningful: negative = money out (fee/refund/ad/disbursement),
        // positive = money in (fee refund, seller credit).
        const rawAmount = typeof entry.amount === 'object'
          ? EtsyClient.etsyMoney(entry.amount)
          : (Number(entry.amount) || 0) / 100;

        // Track running balance (highest sequence_number = current).
        const seq = Number(entry.sequence_number) || 0;
        const balAmt = typeof entry.balance === 'object'
          ? EtsyClient.etsyMoney(entry.balance)
          : (Number(entry.balance) || 0) / 100;
        if (seq > latestBalanceSeq) { latestBalanceSeq = seq; latestBalance = balAmt; balanceCurrency = entry.currency_code || balanceCurrency; }

        // Classify by ledger_type into a dashboard bucket. Revenue and sales
        // tax come from receipts (Phase 3), so skip those here to avoid
        // double-counting; PAYMENT_GROSS/DISBURSE2 are balance mechanics.
        const isAdSpend = ledgerType === 'prolist'
          || ledgerType === 'offsite_ads_fee' || ledgerType === 'offsite_ads'
          || description.includes('offsite ads') || description.includes('etsy ads')
          || description.includes('promoted listing');

        // Real Etsy seller fees (and their refunds, which arrive positive).
        const isFee = ledgerType === 'transaction' || ledgerType === 'transaction_refund'
          || ledgerType === 'payment_processing_fee' || ledgerType === 'refund_processing_fee'
          || ledgerType === 'listing' || ledgerType === 'listing_private'
          || ledgerType === 'renew' || ledgerType === 'renew_sold' || ledgerType === 'renew_sold_auto'
          || ledgerType === 'renew_expired' || ledgerType === 'renew_refund'
          || ledgerType === 'renew_sold_refund' || ledgerType === 'renew_sold_auto_refund'
          || ledgerType === 'shipping_transaction' || ledgerType === 'shipping_transaction_refund'
          || ledgerType === 'buyer_fee' || ledgerType === 'gift_wrap_fees';

        // Money refunded to the buyer (the actual return cost to the seller).
        const isRefund = ledgerType === 'refund_gross' || ledgerType === 'refund'
          || ledgerType === 'refund_dispute' || ledgerType === 'seller_paid_for_return_shipping';

        // Actual bank disbursements — recorded for the "banked" panel; excluded
        // from P&L (they move money already earned, they don't earn/spend it).
        const isDisbursement = ledgerType === 'disburse2' || ledgerType === 'disburse'
          || description === 'disbursement';

        // Etsy credits to the seller (positive) — a revenue adjustment.
        const isSellerCredit = ledgerType === 'seller_credit';

        // Sales tax collected/refunded — a pass-through (Etsy remits it).
        // Revenue already excludes tax, so these must NOT hit any P&L bucket.
        // Captured (not skipped) so stale rows the old sync mislabeled as
        // 'Refund' get reclassified to the neutral SalesTax type on re-sync.
        const isSalesTax = ledgerType === 'sales_tax' || ledgerType === 'sales_tax_refund';

        if (!isAdSpend && !isFee && !isRefund && !isDisbursement && !isSellerCredit && !isSalesTax) continue;

        const entryId = entry.entry_id ?? entry.ledger_entry_id ?? entry.id;
        if (entryId == null) continue; // can't dedup safely — skip
        const externalId = `etsy_ledger_${entryId}`;
        const txDate = entry.create_date ? new Date(entry.create_date * 1000) : new Date();

        let txType: string;
        let storedAmount: number;
        if (isAdSpend) { txType = 'AdSpend'; storedAmount = -Math.abs(rawAmount); }
        else if (isFee) { txType = 'EtsyFee'; storedAmount = rawAmount; } // signed: charge<0, refund>0
        else if (isRefund) { txType = 'Refund'; storedAmount = -Math.abs(rawAmount); }
        else if (isDisbursement) { txType = 'Disbursement'; storedAmount = rawAmount; } // negative = to bank
        else if (isSalesTax) { txType = 'SalesTax'; storedAmount = rawAmount; } // pass-through, excluded from P&L
        else { txType = 'SellerCredit'; storedAmount = Math.abs(rawAmount); } // positive revenue adj

        await prisma.financialTransaction.upsert({
          where: { userId_marketplace_externalId: { userId, marketplace: 'etsy', externalId } },
          update: { amount: storedAmount, transactionDate: txDate, syncedAt: new Date(), transactionType: txType },
          create: {
            userId, marketplace: 'etsy', externalId, transactionType: txType,
            orderNumber: null, barcode: null,
            productName: description || txType,
            quantity: 1, amount: storedAmount,
            currency: entry.currency_code || 'USD',
            commission: null, shippingAmount: null, transactionDate: txDate,
          },
        });

        if (isAdSpend) { adSpendTotal += Math.abs(rawAmount); adSpendEntries++; }
        totalUpserted++;
      }

      if (entries.length < PAGE_LIMIT) {
        ledgerHasMore = false;
      } else {
        ledgerOffset += PAGE_LIMIT;
      }
    }
    } // end per-window loop
  } catch (err) {
    logger.warn('Failed to fetch Etsy ledger entries for ad spend', {
      error: err instanceof Error ? err.message : String(err),
      shopId: etsyCreds.shopId,
    });
  }

  // Update sync cursor. Persist the latest ledger balance (current Etsy
  // account balance) so the dashboard can show it without a live API call.
  const balanceData = latestBalanceSeq >= 0
    ? { currentBalance: Math.round(latestBalance * 100) / 100, balanceCurrency }
    : {};
  await prisma.financialSyncCursor.upsert({
    where: {
      userId_marketplace: { userId, marketplace: 'etsy' },
    },
    update: {
      lastSyncedTo: new Date(endMs),
      totalSynced: { increment: totalUpserted },
      ...balanceData,
    },
    create: {
      userId,
      marketplace: 'etsy',
      lastSyncedTo: new Date(endMs),
      totalSynced: totalUpserted,
      ...balanceData,
    },
  });

  logger.info('Etsy settlement sync complete', {
    userId,
    totalFetched,
    totalUpserted,
    adSpendTotal: Math.round(adSpendTotal * 100) / 100,
    adSpendEntries,
    currentBalance: latestBalanceSeq >= 0 ? Math.round(latestBalance * 100) / 100 : null,
    shopId: etsyCreds.shopId,
  });

  return res.status(200).json({
    success: true,
    totalFetched,
    totalUpserted,
    adSpend: Math.round(adSpendTotal * 100) / 100,
    currentBalance: latestBalanceSeq >= 0 ? Math.round(latestBalance * 100) / 100 : null,
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

// ---------------------------------------------------------------------------
// Debug: fetch raw ledger entries to inspect types
// ---------------------------------------------------------------------------
async function handleDebugLedger(userId: string, body: any, res: NextApiResponse) {
  const etsyCreds = await getEtsyCredentials(userId);
  const onTokenRefresh = async (newCreds: EtsyCredentials) => {
    await prisma.etsyShop.update({
      where: { id: etsyCreds.dbId },
      data: {
        accessToken: encryptIfNeeded(newCreds.accessToken) as string,
        refreshToken: newCreds.refreshToken
          ? (encryptIfNeeded(newCreds.refreshToken) as string)
          : undefined,
        tokenExpiresAt: newCreds.tokenExpiresAt || undefined,
      },
    });
  };

  const client = new EtsyClient(
    {
      accessToken: etsyCreds.accessToken,
      refreshToken: etsyCreds.refreshToken,
      shopId: etsyCreds.shopId,
      tokenExpiresAt: etsyCreds.tokenExpiresAt || undefined,
    },
    onTokenRefresh
  );

  const startMs = Number(body.startDate || Date.now() - 30 * 86400000);
  const endMs = Number(body.endDate || Date.now());
  const minCreated = Math.floor(startMs / 1000);
  const maxCreated = Math.floor(endMs / 1000);

  const ledgerData = await client.getLedgerEntries({
    min_created: minCreated,
    max_created: maxCreated,
    limit: 25,
    offset: 0,
  });

  const entries = Array.isArray(ledgerData.results) ? ledgerData.results : [];

  // Summarize types
  const typeCounts: Record<string, number> = {};
  for (const e of entries) {
    const t = e.ledger_type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  return res.status(200).json({
    debug: 'ledger',
    totalEntries: ledgerData.count || entries.length,
    returnedEntries: entries.length,
    typeCounts,
    sample: entries.slice(0, 10).map((e: any) => ({
      entry_id: e.entry_id,
      ledger_type: e.ledger_type,
      description: e.description,
      amount: e.amount,
      currency_code: e.currency_code,
      balance: e.balance,
      create_date: e.create_date,
      ledger_id: e.ledger_id,
    })),
  });
}

// ---------------------------------------------------------------------------
// eBay helpers
// ---------------------------------------------------------------------------

async function getEbayAccessToken(userId: string): Promise<string> {
  try {
    return await getUserAccessToken(userId);
  } catch (err) {
    if (err instanceof EbayNotConnectedError) {
      // Preserve the { status, message } error shape that existing callers rely on.
      throw { status: 400, message: err.message };
    }
    throw err;
  }
}

async function callEbayFinancesAPI(endpoint: string, accessToken: string): Promise<any> {
  const url = endpoint.startsWith('http') ? endpoint : `${EBAY_FINANCES_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`eBay Finances API error: ${response.status} - ${errorText}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// eBay settlement sync
// ---------------------------------------------------------------------------

function ebayAmount(money: { value: string; currency: string } | null | undefined): number {
  if (!money || !money.value) return 0;
  return parseFloat(money.value) || 0;
}

// Fetch eBay bank payouts (banked money) and the seller funds summary (current
// balance + held funds), store payouts as Disbursement rows, and return the
// balance/held figures for the sync cursor. Best-effort — a failure here must
// not fail the whole sync.
async function syncEbayPayoutsAndFunds(
  userId: string,
  accessToken: string,
  startMs: number,
  endMs: number,
): Promise<{ bankedTotal: { count: number; amount: number }; currentBalance: number | null; heldFunds: number | null }> {
  let count = 0;
  let amount = 0;
  try {
    // Payouts — chunk by 88 days to stay under the 90-day filter cap.
    const WINDOW = 88 * 24 * 60 * 60 * 1000;
    for (let ws = startMs; ws < endMs; ws += WINDOW) {
      const we = Math.min(ws + WINDOW, endMs);
      const filter = `payoutDate:[${new Date(ws).toISOString()}..${new Date(we).toISOString()}]`;
      let offset = 0;
      while (true) {
        const data = await callEbayFinancesAPI(
          `/sell/finances/v1/payout?filter=${encodeURIComponent(filter)}&limit=200&offset=${offset}`,
          accessToken,
        );
        const payouts = Array.isArray(data.payouts) ? data.payouts : [];
        for (const p of payouts) {
          const val = ebayAmount(p.amount);
          if (!p.payoutId) continue;
          amount += val;
          count++;
          await prisma.financialTransaction.upsert({
            where: { userId_marketplace_externalId: { userId, marketplace: 'ebay', externalId: `payout_${p.payoutId}` } },
            update: { amount: -Math.abs(val), transactionDate: p.payoutDate ? new Date(p.payoutDate) : new Date(), syncedAt: new Date(), transactionType: 'Disbursement' },
            create: {
              userId, marketplace: 'ebay', externalId: `payout_${p.payoutId}`,
              transactionType: 'Disbursement', orderNumber: null, barcode: null,
              productName: `Payout${p.payoutStatus ? ` (${p.payoutStatus})` : ''}`,
              quantity: p.transactionCount || 1, amount: -Math.abs(val),
              currency: p.amount?.currency || 'USD', commission: null, shippingAmount: null,
              transactionDate: p.payoutDate ? new Date(p.payoutDate) : new Date(),
            },
          });
        }
        if (payouts.length < 200) break;
        offset += 200;
      }
    }
  } catch (err) {
    logger.warn('eBay payout sync failed (continuing)', { error: err instanceof Error ? err.message : String(err) });
  }

  // Funds summary — current snapshot (available + processing + on-hold). Returns
  // HTTP 204 (empty) when there are no pending funds.
  let currentBalance: number | null = null;
  let heldFunds: number | null = null;
  try {
    const url = `${EBAY_FINANCES_BASE}/sell/finances/v1/seller_funds_summary`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (resp.status === 204) { currentBalance = 0; heldFunds = 0; }
    else if (resp.ok) {
      const f = await resp.json();
      currentBalance = Math.round(ebayAmount(f.totalFunds) * 100) / 100;
      heldFunds = Math.round(ebayAmount(f.fundsOnHold) * 100) / 100;
    }
  } catch (err) {
    logger.warn('eBay funds summary failed (continuing)', { error: err instanceof Error ? err.message : String(err) });
  }

  return { bankedTotal: { count, amount: Math.round(amount * 100) / 100 }, currentBalance, heldFunds };
}

export async function handleEbaySync(userId: string, body: any, res: NextApiResponse) {
  const { startDate, endDate } = body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (epoch ms)' });
  }

  const startMs = Number(startDate);
  const endMs = Number(endDate);
  if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
    return res.status(400).json({ error: 'Invalid date range.' });
  }

  const accessToken = await getEbayAccessToken(userId);

  // ---- PHASE 1: Fetch all transactions with pagination ----
  // eBay's transaction endpoint caps the date filter at 90 days, so chunk the
  // range into <=88-day sub-windows (the cron's 35-day window is fine, but the
  // "Last 90 Days" preset would hit the cap).
  const allTransactions: any[] = [];
  const PAGE_LIMIT = 1000;
  const TX_WINDOW_MS = 88 * 24 * 60 * 60 * 1000;
  for (let winStart = startMs; winStart < endMs; winStart += TX_WINDOW_MS) {
    const winEnd = Math.min(winStart + TX_WINDOW_MS, endMs);
    const filter = `transactionDate:[${new Date(winStart).toISOString()}..${new Date(winEnd).toISOString()}]`;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const data = await callEbayFinancesAPI(
        `/sell/finances/v1/transaction?filter=${encodeURIComponent(filter)}&limit=${PAGE_LIMIT}&offset=${offset}`,
        accessToken
      );
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      allTransactions.push(...txs);
      if (txs.length < PAGE_LIMIT) hasMore = false;
      else offset += PAGE_LIMIT;
    }
  }

  logger.info('eBay finance: fetched transactions', { total: allTransactions.length });

  // ---- PHASE 1b: Fetch item titles from Fulfillment API ----
  // Collect unique orderIds from SALE transactions to get real product names
  const orderIds = [...new Set(
    allTransactions
      .filter(tx => tx.transactionType === 'SALE' && tx.orderId)
      .map(tx => tx.orderId as string)
  )];

  // Map: lineItemId → item title
  const itemTitleMap = new Map<string, string>();

  // Fetch orders in batches of 10 to avoid rate limits
  const ORDER_BATCH = 10;
  for (let i = 0; i < orderIds.length; i += ORDER_BATCH) {
    const batch = orderIds.slice(i, i + ORDER_BATCH);
    const results = await Promise.allSettled(
      batch.map(async (orderId) => {
        try {
          const resp = await fetch(`https://api.ebay.com/sell/fulfillment/v1/order/${orderId}`, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          });
          if (!resp.ok) return null;
          const order = await resp.json();
          if (Array.isArray(order.lineItems)) {
            for (const li of order.lineItems) {
              if (li.lineItemId && li.title) {
                itemTitleMap.set(String(li.lineItemId), li.title);
              }
            }
          }
        } catch {
          // Skip — product name will fall back to buyer username
        }
      })
    );
  }

  logger.info('eBay finance: fetched item titles', { orders: orderIds.length, titles: itemTitleMap.size });

  // ---- PHASE 2: Process transactions ----
  const upsertBatch: Array<{
    externalId: string;
    transactionType: string;
    orderNumber: string | null;
    barcode: string | null;
    productName: string | null;
    quantity: number;
    amount: number;
    currency: string;
    commission: number | null;
    shippingAmount: number | null;
    transactionDate: Date;
    rawData: any;
  }> = [];

  let adSpendTotal = 0;
  let adSpendCount = 0;

  for (const tx of allTransactions) {
    const txType = tx.transactionType || '';
    const txId = tx.transactionId || '';
    const txDate = tx.transactionDate ? new Date(tx.transactionDate) : new Date();
    const currency = tx.amount?.currency || 'USD';
    const memo = tx.transactionMemo || '';

    switch (txType) {
      case 'SALE': {
        // totalFeeBasisAmount = item + shipping + sales tax. eBay collects and
        // remits the tax (marketplace facilitator), so it's never the seller's
        // money — exclude it from revenue, exactly like Etsy's grandtotal.
        const salesTax = ebayAmount(tx.salesTax);
        const gross = ebayAmount(tx.totalFeeBasisAmount) - salesTax;
        const totalFees = ebayAmount(tx.totalFeeAmount);
        const lineItem = Array.isArray(tx.orderLineItems) && tx.orderLineItems[0];
        const lineItemId = lineItem?.lineItemId || null;

        // Get real product name: fulfillment API title > buyer username > null
        const itemTitle = lineItemId ? itemTitleMap.get(String(lineItemId)) : undefined;
        const productLabel = itemTitle || (tx.buyer?.username ? `Order from ${tx.buyer.username}` : null);

        upsertBatch.push({
          externalId: txId,
          transactionType: 'Sale',
          orderNumber: tx.orderId || txId,
          barcode: lineItemId ? String(lineItemId) : null,
          productName: productLabel,
          quantity: Array.isArray(tx.orderLineItems) ? tx.orderLineItems.length : 1,
          amount: gross,
          currency,
          commission: totalFees > 0 ? totalFees : null,
          shippingAmount: null, // buyer-paid on eBay
          transactionDate: txDate,
          rawData: tx,
        });
        break;
      }

      case 'REFUND': {
        // Exclude the refunded sales tax so returns stay tax-consistent with
        // revenue (which also excludes tax).
        const refundTax = ebayAmount(tx.salesTax);
        const refundAmt = ebayAmount(tx.amount) - refundTax;
        upsertBatch.push({
          externalId: txId,
          transactionType: 'Return',
          orderNumber: tx.orderId || null,
          barcode: null,
          productName: memo || 'Refund',
          quantity: 1,
          amount: -Math.abs(refundAmt), // ensure negative
          currency,
          commission: null,
          shippingAmount: null,
          transactionDate: txDate,
          rawData: tx,
        });
        break;
      }

      case 'NON_SALE_CHARGE': {
        const chargeAmt = ebayAmount(tx.amount);
        const feeType = tx.feeType || '';

        if (feeType === 'PREMIUM_AD_FEES' || feeType === 'AD_FEE' || feeType === 'DYNAMIC_AD_RATE_FEE'
            || memo.toLowerCase().includes('promoted') || memo.toLowerCase().includes('ad fee')) {
          // Promoted Listings ad fee — store PER TRANSACTION (keyed by txId).
          // The old `adspend_<start>_<end>` summary created overlapping rows for
          // every date range the user synced, and the dashboard summed them all,
          // inflating ad spend 4-5x. Per-tx keying makes re-sync idempotent.
          adSpendTotal += Math.abs(chargeAmt);
          adSpendCount++;
          upsertBatch.push({
            externalId: txId,
            transactionType: 'AdSpend',
            orderNumber: tx.orderId || null,
            barcode: null,
            productName: memo || feeType || 'eBay Promoted Listings',
            quantity: 1,
            amount: -Math.abs(chargeAmt),
            currency,
            commission: null,
            shippingAmount: null,
            transactionDate: txDate,
            rawData: tx,
          });
        } else {
          // Store subscription, insertion fees, etc.
          upsertBatch.push({
            externalId: txId,
            transactionType: 'StoreFee',
            orderNumber: null,
            barcode: null,
            productName: memo || feeType || 'eBay Fee',
            quantity: 1,
            amount: -Math.abs(chargeAmt),
            currency,
            commission: null,
            shippingAmount: null,
            transactionDate: txDate,
            rawData: tx,
          });
        }
        break;
      }

      case 'SHIPPING_LABEL': {
        const labelAmt = ebayAmount(tx.amount);
        upsertBatch.push({
          externalId: txId,
          transactionType: 'ShippingLabel',
          orderNumber: tx.orderId || null,
          barcode: null,
          productName: memo || 'eBay Shipping Label',
          quantity: 1,
          amount: -Math.abs(labelAmt),
          currency,
          commission: null,
          shippingAmount: Math.abs(labelAmt),
          transactionDate: txDate,
          rawData: tx,
        });
        break;
      }

      case 'CREDIT': {
        const creditAmt = ebayAmount(tx.amount);
        upsertBatch.push({
          externalId: txId,
          transactionType: 'Credit',
          orderNumber: tx.orderId || null,
          barcode: null,
          productName: memo || 'eBay Credit',
          quantity: 1,
          amount: Math.abs(creditAmt),
          currency,
          commission: null,
          shippingAmount: null,
          transactionDate: txDate,
          rawData: tx,
        });
        break;
      }

      // TRANSFER, DISPUTE, etc. — skip for now
      default:
        break;
    }
  }

  // ---- PHASE 3: Batch upsert to DB ----
  let totalUpserted = 0;
  const UPSERT_BATCH = 20;

  for (let i = 0; i < upsertBatch.length; i += UPSERT_BATCH) {
    const batch = upsertBatch.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(txData =>
      prisma.financialTransaction.upsert({
        where: {
          userId_marketplace_externalId: {
            userId,
            marketplace: 'ebay',
            externalId: txData.externalId,
          },
        },
        update: { ...txData, syncedAt: new Date() },
        create: { userId, marketplace: 'ebay', ...txData },
      })
    ));
    totalUpserted += batch.length;
  }

  // Ad spend is now stored per-transaction in Phase 2 (idempotent), replacing
  // the old overlapping `adspend_<start>_<end>` summary row. A stale summary
  // row from before this change would double-count — delete any that exist.
  await prisma.financialTransaction.deleteMany({
    where: { userId, marketplace: 'ebay', externalId: { startsWith: 'adspend_' } },
  }).catch(() => undefined);

  // ---- PHASE 4: payouts (banked) + funds summary (balance / held) ----
  const { bankedTotal, currentBalance, heldFunds } = await syncEbayPayoutsAndFunds(
    userId, accessToken, startMs, endMs,
  );
  totalUpserted += bankedTotal.count;

  // Update sync cursor
  await prisma.financialSyncCursor.upsert({
    where: { userId_marketplace: { userId, marketplace: 'ebay' } },
    update: {
      lastSyncedTo: new Date(endMs),
      totalSynced: { increment: totalUpserted },
      ...(currentBalance != null ? { currentBalance, balanceCurrency: 'USD' } : {}),
      ...(heldFunds != null ? { heldFunds } : {}),
    },
    create: {
      userId, marketplace: 'ebay', lastSyncedTo: new Date(endMs), totalSynced: totalUpserted,
      ...(currentBalance != null ? { currentBalance, balanceCurrency: 'USD' } : {}),
      ...(heldFunds != null ? { heldFunds } : {}),
    },
  });

  logger.info('eBay settlement sync complete', {
    userId,
    totalFetched: allTransactions.length,
    totalUpserted,
    adSpend: Math.round(adSpendTotal * 100) / 100,
    adSpendCount,
  });

  return res.status(200).json({
    success: true,
    totalFetched: allTransactions.length,
    totalUpserted,
    adSpend: Math.round(adSpendTotal * 100) / 100,
    syncedTo: new Date(endMs).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Amazon settlement sync
// ---------------------------------------------------------------------------

async function getAmazonCredentials(userId: string) {
  const cred = await prisma.credential.findUnique({ where: { userId } }) as any;
  if (!cred?.amazonAccessToken || !cred?.amazonRefreshToken) {
    throw { status: 400, message: 'Amazon credentials not configured. Please connect your Amazon account in settings.' };
  }
  return cred;
}

// Fetch Amazon settlement groups and record CLOSED ones (actual bank payouts)
// as Disbursement rows; the OPEN group's total is the current unpaid balance
// (Amazon has no real-time balance/reserve endpoint). Best-effort.
async function syncAmazonPayouts(
  userId: string,
  token: string,
  region: any,
  startMs: number,
  endMs: number,
  callSpApiWithRetry: (path: string, token: string, region: any) => Promise<any>,
): Promise<{ bankedCount: number; currentBalance: number | null; balanceCurrency: string | null }> {
  const money = (m: any): number => (m && (m.CurrencyAmount ?? m.Amount) != null ? parseFloat(String(m.CurrencyAmount ?? m.Amount)) : 0);
  let bankedCount = 0;
  // Balance must be tracked PER CURRENCY — a seller can have USD/CAD/MXN open
  // groups, and summing them as one number is meaningless (the old bug).
  const openByCur: Record<string, number> = {};
  try {
    // Groups filter caps at 180 days; end must be >2 min in the past.
    const gStart = new Date(Math.max(startMs, Date.now() - 175 * 86400_000)).toISOString();
    const gEnd = new Date(Date.now() - 3 * 60_000).toISOString();
    let nextToken: string | null = null;
    let pages = 0;
    do {
      const qs = nextToken
        ? `NextToken=${encodeURIComponent(nextToken)}`
        : `FinancialEventGroupStartedAfter=${encodeURIComponent(gStart)}&FinancialEventGroupStartedBefore=${encodeURIComponent(gEnd)}&MaxResultsPerPage=100`;
      const data: any = await callSpApiWithRetry(`/finances/v0/financialEventGroups?${qs}`, token, region);
      const groups = data?.payload?.FinancialEventGroupList || [];
      for (const g of groups) {
        const total = money(g.ConvertedTotal || g.OriginalTotal);
        if (g.ProcessingStatus === 'Open') {
          // Open settled balance ("Standard Orders" in Seller Central), per currency.
          const cc = (g.ConvertedTotal || g.OriginalTotal)?.CurrencyCode || 'USD';
          openByCur[cc] = (openByCur[cc] || 0) + total;
          continue;
        }
        // Closed = settled/paid out. Record as a bank disbursement.
        if (!g.FinancialEventGroupId || !total) continue;
        bankedCount++;
        const date = g.FundTransferDate || g.FinancialEventGroupEnd || null;
        await prisma.financialTransaction.upsert({
          where: { userId_marketplace_externalId: { userId, marketplace: 'amazon', externalId: `amz_payout_${g.FinancialEventGroupId}` } },
          update: { amount: -Math.abs(total), transactionDate: date ? new Date(date) : new Date(), syncedAt: new Date(), transactionType: 'Disbursement' },
          create: {
            userId, marketplace: 'amazon', externalId: `amz_payout_${g.FinancialEventGroupId}`,
            transactionType: 'Disbursement', orderNumber: null, barcode: null,
            productName: `Payout${g.FundTransferStatus ? ` (${g.FundTransferStatus})` : ''}`,
            quantity: 1, amount: -Math.abs(total),
            currency: (g.ConvertedTotal || g.OriginalTotal)?.CurrencyCode || 'USD',
            commission: null, shippingAmount: null,
            transactionDate: date ? new Date(date) : new Date(),
          },
        });
      }
      nextToken = data?.payload?.NextToken || null;
      pages++;
    } while (nextToken && pages < 50);
  } catch (err) {
    logger.warn('Amazon payout sync failed (continuing)', { error: err instanceof Error ? err.message : String(err) });
  }

  // Deferred funds — the bulk of the real Seller Central balance, which
  // financialEventGroups misses. Comes from the 2024-06-19 transactions
  // endpoint (lowercase currencyAmount, unlike v0). status DEFERRED = held,
  // not yet available; DEFERRED_RELEASED/RELEASED have already moved into a
  // group so must NOT be added again.
  const deferredByCur: Record<string, number> = {};
  try {
    const newAmt = (m: any) => (m && (m.currencyAmount ?? m.CurrencyAmount) != null ? parseFloat(String(m.currencyAmount ?? m.CurrencyAmount)) : 0);
    const after = new Date(Date.now() - 45 * 86400_000).toISOString();
    let nt: string | null = null;
    let p = 0;
    do {
      const qs = nt ? `nextToken=${encodeURIComponent(nt)}` : `postedAfter=${encodeURIComponent(after)}`;
      const data: any = await callSpApiWithRetry(`/finances/2024-06-19/transactions?${qs}`, token, region);
      const txs = data?.transactions || data?.payload?.transactions || [];
      for (const tx of txs) {
        if ((tx.transactionStatus || tx.status) !== 'DEFERRED') continue;
        const m = tx.totalAmount || tx.netAmount;
        const cc = m?.currencyCode || m?.CurrencyCode || 'USD';
        deferredByCur[cc] = (deferredByCur[cc] || 0) + newAmt(m);
      }
      nt = data?.nextToken || data?.payload?.nextToken || null;
      p++;
    } while (nt && p < 30);
  } catch (err) {
    logger.warn('Amazon deferred-balance fetch failed (continuing)', { error: err instanceof Error ? err.message : String(err) });
  }

  // Current balance = open settled + deferred, in the dominant currency
  // (matches Seller Central "Total Balance"). Pick the currency with the
  // largest deferred/open magnitude (defaults to USD).
  const currencies = new Set([...Object.keys(openByCur), ...Object.keys(deferredByCur)]);
  let balanceCurrency: string | null = null;
  let currentBalance: number | null = null;
  if (currencies.size > 0) {
    balanceCurrency = [...currencies].sort((a, b) =>
      (Math.abs(deferredByCur[b] || 0) + Math.abs(openByCur[b] || 0)) -
      (Math.abs(deferredByCur[a] || 0) + Math.abs(openByCur[a] || 0)))[0];
    currentBalance = Math.round(((openByCur[balanceCurrency] || 0) + (deferredByCur[balanceCurrency] || 0)) * 100) / 100;
  }
  return { bankedCount, currentBalance, balanceCurrency };
}

export async function handleAmazonSync(userId: string, body: any, res: NextApiResponse) {
  const { startDate, endDate } = body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (epoch ms)' });
  }

  const startMs = Number(startDate);
  const endMs = Number(endDate);
  if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
    return res.status(400).json({ error: 'Invalid date range.' });
  }

  const cred = await getAmazonCredentials(userId);
  const region = (cred.amazonRegion || 'eu') as any;

  // Dynamic import to avoid loading Amazon modules when not needed
  const { getValidToken, callSpApiWithRetry } = await import('../../../lib/integrations/amazonClient');

  const token = await getValidToken(cred);
  if (!token) {
    return res.status(400).json({ error: 'Amazon token expired. Please reconnect your Amazon account.' });
  }

  const startISO = new Date(startMs).toISOString();
  const endISO = new Date(endMs).toISOString();

  // ---- PHASE 1: Fetch via Finances v0 ListFinancialEvents ----
  //
  // We previously used /finances/2024-06-19/transactions but it returns 0 rows
  // for many sellers (the new endpoint has gaps depending on account type and
  // region). The v0 ListFinancialEvents endpoint exposes the full event log:
  //   ShipmentEventList, RefundEventList, ServiceFeeEventList,
  //   AdjustmentEventList, ProductAdsPaymentEventList, ...
  // It paginates via NextToken (separate parameter; not allowed alongside
  // PostedAfter / PostedBefore on follow-up pages).
  type EventMap = Record<string, any[]>;
  const allEvents: EventMap = {};
  let v0NextToken: string | null = null;
  let pages = 0;

  do {
    const qs = v0NextToken
      ? `NextToken=${encodeURIComponent(v0NextToken)}`
      : `PostedAfter=${encodeURIComponent(startISO)}&PostedBefore=${encodeURIComponent(endISO)}&MaxResultsPerPage=100`;
    const data = await callSpApiWithRetry(
      `/finances/v0/financialEvents?${qs}`,
      token,
      region,
    );
    const events = (data as any)?.payload?.FinancialEvents || {};
    for (const k of Object.keys(events)) {
      if (!Array.isArray(events[k])) continue;
      (allEvents[k] = allEvents[k] || []).push(...events[k]);
    }
    v0NextToken = (data as any)?.payload?.NextToken || (data as any)?.NextToken || null;
    pages++;
    if (pages > 100) break; // safety cap
  } while (v0NextToken);

  const eventTotal = Object.values(allEvents).reduce(
    (s: number, a: any) => s + (Array.isArray(a) ? a.length : 0),
    0,
  );
  // Keep allTransactions name for downstream stats logging.
  const allTransactions = { pages, eventTotal } as any;
  logger.info('Amazon finance v0: fetched events', { pages, eventTotal, perType: Object.fromEntries(Object.entries(allEvents).map(([k, v]) => [k, (v as any[]).length])) });

  // ---- PHASE 2: Process transactions ----
  const upsertBatch: Array<{
    externalId: string;
    transactionType: string;
    orderNumber: string | null;
    barcode: string | null;
    productName: string | null;
    quantity: number;
    amount: number;
    currency: string;
    commission: number | null;
    shippingAmount: number | null;
    transactionDate: Date;
    rawData: any;
  }> = [];

  let adSpendTotal = 0;
  let adSpendCount = 0;

  const amt = (m: any): number =>
    m && (m.CurrencyAmount ?? m.Amount) != null
      ? parseFloat(String(m.CurrencyAmount ?? m.Amount))
      : 0;
  const curr = (m: any): string => (m && (m.CurrencyCode || 'USD')) || 'USD';

  // ---- 2a. Shipment events → ProductCharges, AmazonCommission, FBAFee
  for (const ev of (allEvents.ShipmentEventList || [])) {
    const orderId = ev.AmazonOrderId || null;
    const txDate = ev.PostedDate ? new Date(ev.PostedDate) : new Date();
    const items = ev.ShipmentItemList || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const asin = item.SellerSKU || item.OrderItemId || null;
      const charges = item.ItemChargeList || [];
      const fees = item.ItemFeeList || [];
      // Revenue = item + shipping + giftwrap + promotions, EXCLUDING sales tax.
      // Amazon collects Tax/ShippingTax/GiftWrapTax from the buyer and remits it
      // (marketplace facilitator) — it's offset 1:1 by ItemTaxWithheldList, so
      // it's never seller money. Excluding the tax charge types nets it out
      // (we don't read the withheld list, so leaving tax out entirely is
      // correct and self-consistent). Note: the charge type is "ShippingCharge"
      // (the old "Shipping" never matched, dropping buyer-paid shipping revenue).
      const REVENUE_CHARGES = ['Principal', 'GiftWrap', 'Giftwrap', 'ShippingCharge', 'Promotion', 'ShippingDiscount', 'PromotionShipping'];
      let revenue = 0;
      let currency = 'USD';
      for (const c of charges) {
        if (REVENUE_CHARGES.includes(c.ChargeType)) {
          revenue += amt(c.ChargeAmount);
          currency = curr(c.ChargeAmount);
        }
      }
      if (revenue !== 0) {
        upsertBatch.push({
          externalId: `amz_ship_${orderId}_${item.OrderItemId || i}`,
          transactionType: 'ProductCharges',
          orderNumber: orderId,
          barcode: asin,
          productName: item.SellerSKU || null,
          quantity: item.QuantityShipped || 1,
          amount: revenue,
          currency,
          commission: null,
          shippingAmount: null,
          transactionDate: txDate,
          rawData: item,
        });
      }
      // Fees per item
      for (let j = 0; j < fees.length; j++) {
        const fee = fees[j];
        const feeAmt = amt(fee.FeeAmount);
        const feeCur = curr(fee.FeeAmount);
        const feeType = fee.FeeType || '';
        const lower = feeType.toLowerCase();
        let kind = 'AmazonOther';
        if (lower.includes('commission') || lower.includes('referral')) kind = 'AmazonCommission';
        else if (lower.includes('fba') || lower.includes('fulfillment')) kind = 'FBAFee';
        upsertBatch.push({
          externalId: `amz_shipfee_${orderId}_${item.OrderItemId || i}_${feeType}_${j}`,
          transactionType: kind,
          orderNumber: orderId,
          barcode: asin,
          productName: feeType,
          quantity: 1,
          amount: feeAmt,
          currency: feeCur,
          commission: kind === 'AmazonCommission' ? Math.abs(feeAmt) : null,
          shippingAmount: kind === 'FBAFee' ? Math.abs(feeAmt) : null,
          transactionDate: txDate,
          rawData: fee,
        });
      }
    }
  }

  // ---- 2b. Refund events → AmazonRefund
  for (const ev of (allEvents.RefundEventList || [])) {
    const orderId = ev.AmazonOrderId || null;
    const txDate = ev.PostedDate ? new Date(ev.PostedDate) : new Date();
    const items = ev.ShipmentItemAdjustmentList || ev.ShipmentItemList || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const asin = item.SellerSKU || item.OrderItemId || null;
      const charges = item.ItemChargeAdjustmentList || item.ItemChargeList || [];
      // Exclude refunded sales tax so returns stay tax-consistent with revenue.
      const TAX_TYPES = ['Tax', 'ShippingTax', 'GiftWrapTax', 'GiftwrapTax'];
      let refund = 0;
      let currency = 'USD';
      for (const c of charges) {
        if (TAX_TYPES.includes(c.ChargeType)) continue;
        refund += amt(c.ChargeAmount);
        currency = curr(c.ChargeAmount);
      }
      if (refund !== 0) {
        upsertBatch.push({
          externalId: `amz_refund_${orderId}_${item.OrderItemId || i}`,
          transactionType: 'AmazonRefund',
          orderNumber: orderId,
          barcode: asin,
          productName: item.SellerSKU || 'Refund',
          quantity: item.QuantityShipped || 1,
          amount: refund,
          currency,
          commission: null,
          shippingAmount: null,
          transactionDate: txDate,
          rawData: item,
        });
      }
    }
  }

  // ---- 2c. Service Fee events → FBAFee / FBAStorage / AmazonOther
  for (let i = 0; i < (allEvents.ServiceFeeEventList || []).length; i++) {
    const ev = allEvents.ServiceFeeEventList[i];
    const orderId = ev.AmazonOrderId || null;
    const reason = (ev.FeeReason || ev.FeeDescription || '').toString();
    const reasonLower = reason.toLowerCase();
    const txDate = ev.PostedDate ? new Date(ev.PostedDate) : new Date();
    const fees = ev.FeeList || [];
    for (let j = 0; j < fees.length; j++) {
      const fee = fees[j];
      const feeAmt = amt(fee.FeeAmount);
      const feeCur = curr(fee.FeeAmount);
      let kind: string = 'AmazonOther';
      if (reasonLower.includes('storage')) kind = 'FBAStorage';
      else if (reasonLower.includes('fba') || reasonLower.includes('fulfillment')) kind = 'FBAFee';
      else if (reasonLower.includes('sponsored') || reasonLower.includes('advertising') || reasonLower.includes('cost of advertising')) {
        // Ad fee — store PER EVENT (keyed by svcfee id) instead of tallying
        // into an overlapping adspend_<start>_<end> summary that double-counted
        // across every synced date range.
        kind = 'AmazonAdSpend';
        adSpendTotal += Math.abs(feeAmt);
        adSpendCount++;
      }
      upsertBatch.push({
        externalId: `amz_svcfee_${ev.SellerId || ''}_${ev.PostedDate || ''}_${reason}_${i}_${j}`,
        transactionType: kind,
        orderNumber: orderId,
        barcode: ev.ASIN || null,
        productName: reason,
        quantity: 1,
        amount: feeAmt,
        currency: feeCur,
        commission: null,
        shippingAmount: kind === 'FBAFee' ? Math.abs(feeAmt) : null,
        transactionDate: txDate,
        rawData: ev,
      });
    }
  }

  // ---- 2d. Adjustment events → AmazonOther (refund-style)
  for (let i = 0; i < (allEvents.AdjustmentEventList || []).length; i++) {
    const ev = allEvents.AdjustmentEventList[i];
    const txDate = ev.PostedDate ? new Date(ev.PostedDate) : new Date();
    const a = amt(ev.AdjustmentAmount);
    upsertBatch.push({
      externalId: `amz_adj_${ev.PostedDate || ''}_${ev.AdjustmentType || ''}_${i}`,
      transactionType: 'AmazonOther',
      orderNumber: null,
      barcode: null,
      productName: ev.AdjustmentType || 'Adjustment',
      quantity: 1,
      amount: a,
      currency: curr(ev.AdjustmentAmount),
      commission: null,
      shippingAmount: null,
      transactionDate: txDate,
      rawData: ev,
    });
  }

  // ---- 2e. Sponsored Ads payments → per-event AmazonAdSpend rows
  for (let i = 0; i < (allEvents.ProductAdsPaymentEventList || []).length; i++) {
    const ev = allEvents.ProductAdsPaymentEventList[i];
    const a = Math.abs(amt(ev.transactionValue || ev.TransactionValue));
    if (a <= 0) continue;
    adSpendTotal += a;
    adSpendCount++;
    upsertBatch.push({
      externalId: `amz_ads_${ev.postedDate || ev.PostedDate || ''}_${ev.invoiceId || i}`,
      transactionType: 'AmazonAdSpend',
      orderNumber: null,
      barcode: null,
      productName: 'Amazon Sponsored Ads',
      quantity: 1,
      amount: -a,
      currency: curr(ev.transactionValue || ev.TransactionValue),
      commission: null,
      shippingAmount: null,
      transactionDate: (ev.postedDate || ev.PostedDate) ? new Date(ev.postedDate || ev.PostedDate) : new Date(endMs),
      rawData: ev,
    });
  }

  // ---- PHASE 3: Batch upsert to DB ----
  let totalUpserted = 0;
  const UPSERT_BATCH = 20;

  for (let i = 0; i < upsertBatch.length; i += UPSERT_BATCH) {
    const batch = upsertBatch.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(txData =>
      prisma.financialTransaction.upsert({
        where: {
          userId_marketplace_externalId: {
            userId,
            marketplace: 'amazon',
            externalId: txData.externalId,
          },
        },
        update: { ...txData, syncedAt: new Date() },
        create: { userId, marketplace: 'amazon', ...txData },
      })
    ));
    totalUpserted += batch.length;
  }

  // Ad spend is now stored per-event (idempotent). Delete the old overlapping
  // `amz_adspend_<start>_<end>` summary rows, which double-counted across every
  // synced date range (this seller had ~$2.1k of bogus ad spend from them).
  await prisma.financialTransaction.deleteMany({
    where: { userId, marketplace: 'amazon', externalId: { startsWith: 'amz_adspend_' } },
  }).catch(() => undefined);

  // ---- PHASE 4: payouts (settlements) + balance (open settled + deferred) ----
  const { bankedCount, currentBalance, balanceCurrency } = await syncAmazonPayouts(userId, token, region, startMs, endMs, callSpApiWithRetry);
  totalUpserted += bankedCount;

  // Update sync cursor
  await prisma.financialSyncCursor.upsert({
    where: { userId_marketplace: { userId, marketplace: 'amazon' } },
    update: {
      lastSyncedTo: new Date(endMs), totalSynced: { increment: totalUpserted },
      ...(currentBalance != null ? { currentBalance, balanceCurrency: balanceCurrency || 'USD' } : {}),
    },
    create: {
      userId, marketplace: 'amazon', lastSyncedTo: new Date(endMs), totalSynced: totalUpserted,
      ...(currentBalance != null ? { currentBalance, balanceCurrency: balanceCurrency || 'USD' } : {}),
    },
  });

  logger.info('Amazon settlement sync complete', {
    userId,
    totalFetched: allTransactions.eventTotal,
    pages: allTransactions.pages,
    totalUpserted,
    adSpend: Math.round(adSpendTotal * 100) / 100,
    adSpendCount,
  });

  return res.status(200).json({
    success: true,
    totalFetched: allTransactions.eventTotal,
    totalUpserted,
    adSpend: Math.round(adSpendTotal * 100) / 100,
    syncedTo: new Date(endMs).toISOString(),
  });
}

// Debug: inspect real eBay Finances API response
async function handleDebugEbayFinances(userId: string, body: any, res: NextApiResponse) {
  const accessToken = await getEbayAccessToken(userId);

  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - 30 * 86400000).toISOString();
  const filter = `transactionDate:[${startDate}..${endDate}]`;

  // Fetch 5 transactions to inspect structure
  const txData = await callEbayFinancesAPI(
    `/sell/finances/v1/transaction?filter=${encodeURIComponent(filter)}&limit=5`,
    accessToken
  );

  // Also try summary
  let summaryData: any = null;
  try {
    const summaryFilter = `transactionDate:[${startDate}..${endDate}],transactionStatus:{PAYOUT|FUNDS_PROCESSING|FUNDS_AVAILABLE_FOR_PAYOUT}`;
    summaryData = await callEbayFinancesAPI(
      `/sell/finances/v1/transaction_summary?filter=${encodeURIComponent(summaryFilter)}`,
      accessToken
    );
  } catch (err: any) {
    summaryData = { error: err.message };
  }

  return res.status(200).json({
    debug: 'ebay_finances',
    totalTransactions: txData.total,
    transactions: txData.transactions || [],
    summary: summaryData,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Auth: API key or session
    let userId: string;
    const apiKey = req.headers['x-api-key'];
    const envApiKey = process.env.CLAWD_API_KEY;

    if (envApiKey && apiKey === envApiKey) {
      const qUserId = req.query.userId as string;
      if (!qUserId) return res.status(400).json({ error: 'userId required with API key auth' });
      userId = qUserId;
    } else {
      const user = await getAuthUser(req, res);
      if (!user) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
      userId = user.id;
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'sync') {
        const marketplace = req.body.marketplace || 'trendyol';
        if (marketplace === 'etsy') {
          return await handleEtsySync(userId, req.body, res);
        }
        if (marketplace === 'ebay') {
          return await handleEbaySync(userId, req.body, res);
        }
        if (marketplace === 'amazon') {
          return await handleAmazonSync(userId, req.body, res);
        }
        return await handleSync(userId, req.body, res);
      }
      if (action === 'debug_ledger') {
        return await handleDebugLedger(userId, req.body, res);
      }
      if (action === 'debug_ebay_finances') {
        return await handleDebugEbayFinances(userId, req.body, res);
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
