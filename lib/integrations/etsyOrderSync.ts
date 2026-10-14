/**
 * Etsy receipts -> UIOrder mapping and raw receipt fetches (W4 T5).
 *
 * Writers: this module never writes orders. lib/orders/etsyLifecycle.ts
 * (upsertEtsyReceipt) is the only Etsy order writer; the orderSync batch
 * writer rejects source 'etsy-api'.
 *
 * HTTP goes through lib/etsy/http.ts (callEtsyAPI) with the shared lease-based
 * token helper, so every call is visible to the W1 rate budget. Errors
 * propagate (no silent []), there is no 500-receipt cap, and listing images
 * come from the EtsyListing cache only — missing listing ids are returned so
 * the caller can hand them to ensureListingsCached (W3) instead of spending
 * one live Etsy call per listing on every run.
 */
import { UIOrder } from '../types';
import { logger } from '../logger';
import prisma from '../prisma';
import { etsyVariantKeys, type EtsyVariantPair } from '@/lib/etsy/variantKey';
import { EtsyPriority, withEtsyBudget } from '@/lib/etsy/rateBudget';
import { mapEtsyReceiptStatus } from '@/lib/orders/orderStatus';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function etsyGet(userId: string, shopId: string, endpoint: string, priority: EtsyPriority): Promise<any> {
  return withEtsyBudget({ shopId, userId, priority }, async () => {
    const { getEtsyAccessToken } = await import('@/lib/etsy/etsyToken');
    const { callEtsyAPI } = await import('@/lib/etsy/http');
    const accessToken = await getEtsyAccessToken(shopId, userId);
    return callEtsyAPI(endpoint, accessToken);
  });
}

function isNotFound(err: unknown): boolean {
  return /Etsy API error: 404/.test(String((err as any)?.message || ''));
}

/**
 * GET /shops/{shopId}/receipts/{receiptId}. Returns null on 404 or when the
 * shop is not connected for this user.
 */
export async function fetchEtsyReceiptRawFromApi(
  userId: string,
  shopId: string,
  receiptId: string,
  priority: EtsyPriority = EtsyPriority.Webhook,
): Promise<any | null> {
  if (!/^\d+$/.test(String(receiptId))) throw new Error(`Invalid Etsy receipt id: ${receiptId}`);
  const shop = await prisma.etsyShop.findFirst({ where: { userId, shopId, isActive: true }, select: { shopId: true } });
  if (!shop) return null;
  try {
    const receipt = await etsyGet(userId, shopId, `/shops/${shopId}/receipts/${receiptId}`, priority);
    return receipt && receipt.receipt_id ? receipt : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export type ReceiptsPageParams = {
  minLastModified?: number;
  minCreated?: number;
  sortOn?: 'created' | 'updated' | 'receipt_id';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  /** Only used inside a one-second tie of updated_timestamp (keyset paging). */
  offset?: number;
};

/** One page of GET /shops/{shopId}/receipts (keyset-friendly). */
export async function fetchReceiptsPage(
  userId: string,
  shopId: string,
  p: ReceiptsPageParams,
  priority: EtsyPriority = EtsyPriority.Reconcile,
): Promise<{ results: any[]; count: number }> {
  const q = new URLSearchParams();
  q.set('limit', String(Math.min(Math.max(p.limit ?? 100, 1), 100)));
  if (p.offset) q.set('offset', String(p.offset));
  if (p.minLastModified != null) q.set('min_last_modified', String(Math.floor(p.minLastModified)));
  if (p.minCreated != null) q.set('min_created', String(Math.floor(p.minCreated)));
  if (p.sortOn) q.set('sort_on', p.sortOn);
  if (p.sortOrder) q.set('sort_order', p.sortOrder);
  q.set('includes', 'Transactions');
  const data = await etsyGet(userId, shopId, `/shops/${shopId}/receipts?${q.toString()}`, priority);
  return { results: Array.isArray(data?.results) ? data.results : [], count: Number(data?.count) || 0 };
}

// ---------------------------------------------------------------------------
// Listing images (cache only)
// ---------------------------------------------------------------------------

export function listingIdsOfReceipts(receipts: any[]): bigint[] {
  const ids = new Set<string>();
  for (const r of receipts || []) {
    for (const tx of r?.transactions || []) {
      if (tx?.listing_id && /^\d+$/.test(String(tx.listing_id))) ids.add(String(tx.listing_id));
    }
  }
  return [...ids].map((s) => BigInt(s));
}

/** Thumbnail map from the EtsyListing cache; `missing` = listing ids not cached (for ensureListingsCached). */
export async function listingImagesFromCache(shopId: string, listingIds: bigint[]): Promise<{ imageMap: Map<string, string>; missing: bigint[] }> {
  const imageMap = new Map<string, string>();
  if (listingIds.length === 0) return { imageMap, missing: [] };
  try {
    const cached = await prisma.etsyListing.findMany({
      where: { etsyListingId: { in: listingIds } },
      select: { etsyListingId: true, thumbnailUrl570xN: true, thumbnailUrl170x135: true },
    });
    for (const l of cached) {
      const url = l.thumbnailUrl570xN || l.thumbnailUrl170x135 || '';
      if (url) imageMap.set(String(l.etsyListingId), url);
    }
  } catch (err) {
    logger.warn('[EtsyOrderSync] Listing image cache lookup failed', { shopId, error: (err as Error).message });
  }
  const missing = listingIds.filter((id) => !imageMap.has(String(id)));
  return { imageMap, missing };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function parseEtsyPrice(price: any): number {
  if (!price) return 0;
  if (typeof price === 'number') return price;
  if (price.amount != null && price.divisor != null) {
    return price.amount / price.divisor;
  }
  if (price.amount != null) return price.amount / 100;
  return 0;
}

/**
 * Variation pairs of a transaction for variantKey matching. Entries without
 * a value_id (buyer personalization text) are not part of the offering identity.
 */
export function variantPairsOfTransaction(tx: any): EtsyVariantPair[] {
  const vars = Array.isArray(tx?.variations) ? tx.variations : [];
  return vars
    .filter((v: any) => Number.isFinite(Number(v?.property_id)) && v?.value_id !== null && v?.value_id !== undefined && v?.value_id !== '')
    .map((v: any) => ({ propertyId: Number(v.property_id), valueId: Number(v.value_id), value: v.formatted_value ?? null }));
}

export function mapReceiptToUIOrder(receipt: any, shopId: string, shopName: string, imageMap: Map<string, string>): UIOrder {
  const transactions = receipt.transactions || [];

  const lineItems = transactions.map((tx: any, idx: number) => {
    const variations = (tx.variations || [])
      .map((v: any) => `${v.formatted_name}: ${v.formatted_value}`)
      .join(', ');

    const listingImage = tx.listing_id ? (imageMap.get(String(tx.listing_id)) || '') : '';
    const pairs = variantPairsOfTransaction(tx);
    const keys = pairs.length > 0 ? etsyVariantKeys(pairs) : { variantKey: '', variantValueKey: '' };

    return {
      id: String(tx.transaction_id || `${receipt.receipt_id}-${idx}`),
      title: tx.title || 'Unknown Product',
      value: parseEtsyPrice(tx.price),
      quantity: tx.quantity || 1,
      weight: 0.5,
      sku: tx.product_data?.sku || tx.sku || '',
      image: listingImage,
      variantInfo: variations || '',
      listingRef: tx.listing_id ? String(tx.listing_id) : null,
      variantRef: keys.variantKey,
      variantValueKey: keys.variantValueKey,
      shipBy: Number(tx.expected_ship_date) > 0 ? new Date(Number(tx.expected_ship_date) * 1000).toISOString() : undefined,
    };
  });

  const customerName = receipt.name || '';

  // Etsy receipts surface two free-text fields the seller must see during
  // fulfillment: gift_message and message_from_buyer.
  const rawGiftMessage =
    typeof receipt.gift_message === 'string' ? receipt.gift_message.trim() : '';
  const rawBuyerMessage =
    typeof receipt.message_from_buyer === 'string'
      ? receipt.message_from_buyer.trim()
      : '';

  // Per-line personalization fallback.
  const transactionPersonalizations = transactions
    .map((tx: any) => {
      const personalization =
        typeof tx.personalization === 'string' ? tx.personalization.trim() : '';
      const buyerRequest =
        typeof tx.buyer_request === 'string' ? tx.buyer_request.trim() : '';
      return [personalization, buyerRequest].filter(Boolean).join(' | ');
    })
    .filter(Boolean)
    .join('\n');

  const customerNote =
    rawBuyerMessage || transactionPersonalizations || '';

  // Only fall back to 'US' when Etsy delivered at least one other address
  // field (a fully redacted address must not be tagged as US).
  const hasAnyAddress = Boolean(receipt.first_line || receipt.city || receipt.zip || receipt.state);
  const rawCountry = typeof receipt.country_iso === 'string' ? receipt.country_iso.trim().toUpperCase() : '';
  const resolvedCountry = rawCountry || (hasAnyAddress ? 'US' : '');
  if (!rawCountry && hasAnyAddress) {
    logger.warn('Etsy receipt missing country_iso — defaulting to US', { receiptId: receipt.receipt_id });
  }

  return {
    id: `etsy-${receipt.receipt_id}`,
    source: 'etsy-api',
    channel: 'etsy',
    marketplace: shopName || 'Etsy',
    marketplaceKey: String(receipt.receipt_id),
    orderNumber: String(receipt.receipt_id),
    customerName,
    status: mapEtsyStatus(receipt),
    externalStatus: receipt.status || '',
    currency: receipt.currency_code || 'USD',
    totalPrice: parseEtsyPrice(receipt.grandtotal),
    to_address: {
      name: customerName,
      phone: '',
      street1: receipt.first_line || '',
      street2: receipt.second_line || '',
      city: receipt.city || '',
      state: receipt.state || '',
      postal: receipt.zip || '',
      country: resolvedCountry,
      isResidential: true,
      email: receipt.buyer_email || '',
    },
    line_items: lineItems,
    marketplaceOrderDate: receipt.created_timestamp
      ? new Date(receipt.created_timestamp * 1000).toISOString()
      : undefined,
    // Earliest expected_ship_date across the receipt's transactions.
    shipByDate: etsyShipByDate(receipt)?.toISOString(),
    giftMessage: rawGiftMessage || undefined,
    customerNote: customerNote || undefined,
    // Latest shipment tracking (pushed by the extension or any 3rd-party app).
    trackingNumber: etsyLatestTrackingCode(receipt) || undefined,
    rawData: receipt,
    commodityDesc: lineItems[0]?.title || '',
  } as UIOrder;
}

export function etsyShipByDate(receipt: any): Date | null {
  const txs = Array.isArray(receipt?.transactions) ? receipt.transactions : [];
  const stamps = txs
    .map((tx: any) => Number(tx?.expected_ship_date))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  if (stamps.length === 0) return null;
  return new Date(Math.min(...stamps) * 1000);
}

export function etsyTrackingCodes(receipt: any): string[] {
  const ships = Array.isArray(receipt?.shipments) ? receipt.shipments : [];
  return ships.map((s: any) => (s?.tracking_code ? String(s.tracking_code).trim() : '')).filter(Boolean);
}

export function etsyLatestTrackingCode(receipt: any): string | null {
  const codes = etsyTrackingCodes(receipt);
  return codes.length ? codes[codes.length - 1] : null;
}

/** Earliest shipment notification time on the receipt (when Etsy marked it shipped). */
export function etsyShippedAt(receipt: any): Date | null {
  const ships = Array.isArray(receipt?.shipments) ? receipt.shipments : [];
  const stamps = ships
    .map((s: any) => Number(s?.shipment_notification_timestamp))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  if (stamps.length > 0) return new Date(Math.min(...stamps) * 1000);
  return null;
}

export function mapEtsyStatus(receipt: any): string {
  return mapEtsyReceiptStatus(receipt);
}

/**
 * Fetch ONE Etsy receipt and map it (legacy helper kept for callers that only
 * need the mapped shape). Returns null when Etsy reports the receipt doesn't
 * exist (404) or the shop is not connected.
 */
export async function fetchSingleEtsyReceipt(
  userId: string,
  shopId: string,
  receiptId: string,
): Promise<UIOrder | null> {
  const receipt = await fetchEtsyReceiptRawFromApi(userId, shopId, receiptId, EtsyPriority.Webhook);
  if (!receipt) return null;
  const shop = await prisma.etsyShop.findFirst({ where: { userId, shopId }, select: { shopName: true } });
  const { imageMap } = await listingImagesFromCache(shopId, listingIdsOfReceipts([receipt]));
  return mapReceiptToUIOrder(receipt, shopId, shop?.shopName || 'Etsy', imageMap);
}
