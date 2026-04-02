import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { EtsyClient } from '../../../lib/integrations/etsyClient';
import type { EtsyCredentials } from '../../../lib/integrations/etsyClient';

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
): Promise<{ orderShippingMap: Map<string, number>; totalCargoItems: number }> {
  const orderShippingMap = new Map<string, number>();
  let totalCargoItems = 0;

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

  return { orderShippingMap, totalCargoItems };
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

  // ---- PHASE 1: Fetch all data in parallel ----
  // Build all settlement fetch promises across ALL windows × ALL types at once
  const allTypes = [...SETTLEMENT_TYPES_PRIMARY, ...SETTLEMENT_TYPES_SECONDARY];
  const settlementPromises = windows.flatMap(window =>
    allTypes.map(txType =>
      callTrendyolSettlements(credentials, {
        startDate: window.startDate,
        endDate: window.endDate,
        transactionType: txType,
        page: 0,
        size: 500,
      }).catch(() => ({ content: [], totalPages: 0, totalElements: 0 }))
    )
  );

  // Fetch settlements + cargo invoices in parallel
  const [settlementResults, cargoResult] = await Promise.all([
    Promise.all(settlementPromises),
    syncCargoInvoices(credentials, windows),
  ]);

  // Collect all settlement items
  const allSettlementItems: any[] = [];
  for (const data of settlementResults) {
    const items = Array.isArray(data.content) ? data.content : [];
    allSettlementItems.push(...items);
  }
  const totalFetched = allSettlementItems.length;
  const { orderShippingMap, totalCargoItems } = cargoResult;

  // ---- PHASE 2: Resolve product names (parallel with bigger batches) ----
  const uniqueBarcodes = [...new Set(
    allSettlementItems
      .map((item: any) => item.barcode)
      .filter((b: any): b is string => !!b)
  )];

  const productNameMap = await fetchProductNamesByBarcodes(credentials, uniqueBarcodes);

  // ---- PHASE 3: Bulk upsert (batched for speed) ----
  const UPSERT_BATCH = 20;
  for (let i = 0; i < allSettlementItems.length; i += UPSERT_BATCH) {
    const batch = allSettlementItems.slice(i, i + UPSERT_BATCH);
    await Promise.all(batch.map(item => {
      const externalId = item.id ? String(item.id) : `${item.transactionType}_${item.orderNumber || ''}_${item.transactionDate || Date.now()}`;
      const credit = Number(item.credit || 0);
      const debt = Number(item.debt || 0);
      const amount = credit - debt;
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

  return {
    accessToken: resolved.accessToken,
    refreshToken: resolved.refreshToken,
    shopId: resolved.shopId,
    tokenExpiresAt: resolved.tokenExpiresAt,
    dbId: resolved.id,
  };
}

async function handleEtsySync(userId: string, body: any, res: NextApiResponse) {
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

  // Token refresh callback — persists new tokens to DB
  const onTokenRefresh = async (newCreds: EtsyCredentials) => {
    await prisma.etsyShop.update({
      where: { id: etsyCreds.dbId },
      data: {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken || undefined,
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

  // ---- PHASE 2: Fetch payments in parallel for fee data ----
  const paymentMap = new Map<string, { amount_gross: number; amount_fees: number; amount_net: number }>();

  try {
    let paymentOffset = 0;
    let paymentHasMore = true;
    const allPayments: any[] = [];

    while (paymentHasMore) {
      const paymentData = await client.getShopPayments({
        min_created: minCreated,
        max_created: maxCreated,
        limit: PAGE_LIMIT,
        offset: paymentOffset,
      });

      const paymentResults = Array.isArray(paymentData.results) ? paymentData.results : [];
      allPayments.push(...paymentResults);

      if (paymentResults.length < PAGE_LIMIT) {
        paymentHasMore = false;
      } else {
        paymentOffset += PAGE_LIMIT;
      }
    }

    for (const payment of allPayments) {
      const receiptId = String(payment.receipt_id);
      const existing = paymentMap.get(receiptId);
      const gross = EtsyClient.etsyMoney(payment.amount_gross || { amount: 0, divisor: 100 });
      const fees = EtsyClient.etsyMoney(payment.amount_fees || { amount: 0, divisor: 100 });
      const net = EtsyClient.etsyMoney(payment.amount_net || { amount: 0, divisor: 100 });

      if (existing) {
        existing.amount_gross += gross;
        existing.amount_fees += fees;
        existing.amount_net += net;
      } else {
        paymentMap.set(receiptId, { amount_gross: gross, amount_fees: fees, amount_net: net });
      }
    }
  } catch (err) {
    // Payment data is supplementary — log and continue
    logger.warn('Failed to fetch Etsy payments (continuing without fee data)', {
      error: err instanceof Error ? err.message : String(err),
      shopId: etsyCreds.shopId,
    });
  }

  logger.info('Etsy sync phase 2 complete', {
    receipts: allReceipts.length,
    paymentsWithFees: paymentMap.size,
    sampleFee: paymentMap.size > 0 ? Array.from(paymentMap.values())[0] : null,
  });

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

      // Amount from grandtotal (includes buyer-paid shipping)
      let amount = EtsyClient.etsyMoney(receipt.grandtotal || { amount: 0, divisor: 100 });
      if (isRefund) amount = -Math.abs(amount);

      // Etsy shipping is buyer-paid — NOT a seller expense. Don't store as shippingAmount.
      // shippingAmount is for seller-paid shipping costs (deductions). Etsy doesn't charge shipping to sellers.

      // Fees from payment map
      const paymentInfo = paymentMap.get(receiptId);
      // Etsy fees = listing fee + transaction fee (6.5%) + payment processing (3%+$0.25) + offsite ads (if applicable)
      let commission: number | null = null;
      if (paymentInfo && paymentInfo.amount_fees !== 0) {
        commission = Math.abs(paymentInfo.amount_fees);
      } else if (!isRefund && amount > 0) {
        // Fallback: estimate Etsy fees (~13% total: 6.5% transaction + 3%+$0.25 processing + ~1.5% regulatory + listing)
        commission = Math.round((amount * 0.13 + 0.20) * 100) / 100;
      }

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
  let adSpendTotal = 0;
  let adSpendEntries = 0;
  try {
    let ledgerOffset = 0;
    let ledgerHasMore = true;

    while (ledgerHasMore) {
      const ledgerData = await client.getLedgerEntries({
        min_created: minCreated,
        max_created: maxCreated,
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
        // Match: prolist (Etsy Ads), offsite_ads_fee, or description-based matching
        const isAdSpend = ledgerType === 'prolist'
          || ledgerType === 'offsite_ads_fee'
          || ledgerType.includes('ad')
          || description.includes('offsite ads')
          || description.includes('etsy ads')
          || description.includes('promoted listing')
          || description.includes('advertising');

        if (isAdSpend) {
          // Ledger amounts are plain integers in cents, not Money objects
          const rawAmount = typeof entry.amount === 'object'
            ? EtsyClient.etsyMoney(entry.amount)
            : (Number(entry.amount) || 0) / 100;
          adSpendTotal += Math.abs(rawAmount);
          adSpendEntries++;
        }
      }

      if (entries.length < PAGE_LIMIT) {
        ledgerHasMore = false;
      } else {
        ledgerOffset += PAGE_LIMIT;
      }
    }

    // Upsert a single AdSpend summary transaction for the period
    if (adSpendTotal > 0) {
      const adSpendId = `adspend_${minCreated}_${maxCreated}`;
      await prisma.financialTransaction.upsert({
        where: {
          userId_marketplace_externalId: {
            userId,
            marketplace: 'etsy',
            externalId: adSpendId,
          },
        },
        update: {
          amount: -adSpendTotal,
          quantity: adSpendEntries,
          syncedAt: new Date(),
        },
        create: {
          userId,
          marketplace: 'etsy',
          externalId: adSpendId,
          transactionType: 'AdSpend',
          orderNumber: null,
          barcode: null,
          productName: 'Etsy Ads + Offsite Ads',
          quantity: adSpendEntries,
          amount: -adSpendTotal,
          currency: 'USD',
          commission: null,
          shippingAmount: null,
          transactionDate: new Date(endMs),
        },
      });
      totalUpserted++;
    }
  } catch (err) {
    logger.warn('Failed to fetch Etsy ledger entries for ad spend', {
      error: err instanceof Error ? err.message : String(err),
      shopId: etsyCreds.shopId,
    });
  }

  // Update sync cursor
  await prisma.financialSyncCursor.upsert({
    where: {
      userId_marketplace: { userId, marketplace: 'etsy' },
    },
    update: {
      lastSyncedTo: new Date(endMs),
      totalSynced: { increment: totalUpserted },
    },
    create: {
      userId,
      marketplace: 'etsy',
      lastSyncedTo: new Date(endMs),
      totalSynced: totalUpserted,
    },
  });

  logger.info('Etsy settlement sync complete', {
    userId,
    totalFetched,
    totalUpserted,
    paymentsWithFees: paymentMap.size,
    adSpendTotal: Math.round(adSpendTotal * 100) / 100,
    adSpendEntries,
    shopId: etsyCreds.shopId,
  });

  return res.status(200).json({
    success: true,
    totalFetched,
    totalUpserted,
    paymentsWithFees: paymentMap.size,
    adSpend: Math.round(adSpendTotal * 100) / 100,
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
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken || undefined,
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
        const marketplace = req.body.marketplace || 'trendyol';
        if (marketplace === 'etsy') {
          return await handleEtsySync(userId, req.body, res);
        }
        return await handleSync(userId, req.body, res);
      }
      if (action === 'debug_ledger') {
        return await handleDebugLedger(userId, req.body, res);
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
