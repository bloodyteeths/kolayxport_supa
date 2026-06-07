import { EtsyClient, EtsyCredentials } from './etsyClient';
import { UIOrder } from '../types';
import { logger } from '../logger';
import prisma from '../prisma';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';

export async function fetchEtsyOrders(
  userId: string,
  options?: { lastSync?: Date }
): Promise<UIOrder[]> {
  const shops = await prisma.etsyShop.findMany({
    where: { userId, isActive: true },
  });

  if (shops.length === 0) return [];

  const allOrders: UIOrder[] = [];

  console.log(`[EtsyOrderSync] Found ${shops.length} active Etsy shops for user ${userId}`);

  for (const shop of shops) {
    if (!shop.accessToken || !shop.shopId) continue;
    console.log(`[EtsyOrderSync] Processing shop ${shop.shopName || shop.shopId}`);

    const onTokenRefresh = async (newCreds: EtsyCredentials) => {
      await prisma.etsyShop.update({
        where: { id: shop.id },
        data: {
          accessToken: encryptIfNeeded(newCreds.accessToken) as string,
          refreshToken: encryptIfNeeded(newCreds.refreshToken) as string | undefined,
          tokenExpiresAt: newCreds.tokenExpiresAt || undefined,
        },
      });
    };

    // Decrypt once before handing off to the client; the client treats them as plain bytes.
    const client = new EtsyClient(
      {
        accessToken: decryptIfNeeded(shop.accessToken) as string,
        refreshToken: (decryptIfNeeded(shop.refreshToken) as string | null) || undefined,
        shopId: shop.shopId,
        tokenExpiresAt: shop.tokenExpiresAt || undefined,
      },
      onTokenRefresh
    );

    try {
      const orders = await fetchReceiptsForShop(client, shop.shopId, shop.shopName || 'Etsy', options);
      allOrders.push(...orders);
      logger.info(`[EtsyOrderSync] Fetched ${orders.length} orders from shop ${shop.shopName || shop.shopId}`);
    } catch (err) {
      logger.error(`[EtsyOrderSync] Failed to fetch orders from shop ${shop.shopId}`, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return allOrders;
}

async function fetchReceiptsForShop(
  client: EtsyClient,
  shopId: string,
  shopName: string,
  options?: { lastSync?: Date }
): Promise<UIOrder[]> {
  const PAGE_LIMIT = 100;
  let offset = 0;
  const allReceipts: any[] = [];

  const params: Record<string, any> = {
    limit: PAGE_LIMIT,
    offset: 0,
    includes: ['Transactions'],
  };

  // Always use 30-day window — Etsy receipts are cheap to fetch and we need full coverage
  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  params.min_created = thirtyDaysAgo;

  let hasMore = true;
  while (hasMore) {
    params.offset = offset;
    console.log(`[EtsyOrderSync] Fetching receipts with params:`, JSON.stringify(params));
    const result = await client.getReceipts(params);
    console.log(`[EtsyOrderSync] Got ${result.count || 0} total, ${(result.results || []).length} in this page`);
    const receipts = result.results || [];
    allReceipts.push(...receipts);

    if (receipts.length < PAGE_LIMIT) {
      hasMore = false;
    } else {
      offset += PAGE_LIMIT;
    }

    if (allReceipts.length > 500) break;
  }

  // Resolve listing images from EtsyListing cache using listing_id from transactions
  const listingIds = new Set<bigint>();
  for (const receipt of allReceipts) {
    for (const tx of (receipt.transactions || [])) {
      if (tx.listing_id) listingIds.add(BigInt(tx.listing_id));
    }
  }

  const imageMap = new Map<string, string>();
  if (listingIds.size > 0) {
    try {
      const cached = await prisma.etsyListing.findMany({
        where: { etsyListingId: { in: [...listingIds] } },
        select: { etsyListingId: true, thumbnailUrl570xN: true, thumbnailUrl170x135: true },
      });
      for (const l of cached) {
        const url = l.thumbnailUrl570xN || l.thumbnailUrl170x135 || '';
        if (url) imageMap.set(String(l.etsyListingId), url);
      }
    } catch (err) {
      logger.warn('[EtsyOrderSync] Failed to batch-fetch listing images from cache', { error: (err as Error).message });
    }
  }

  // Fallback: fetch images from Etsy API for listings not in cache
  const missingIds = [...listingIds].filter(id => !imageMap.has(String(id)));
  if (missingIds.length > 0) {
    logger.info(`[EtsyOrderSync] Fetching ${missingIds.length} listing images from Etsy API (not in cache)`);
    // Batch in groups of 10 to avoid hammering the API
    for (let i = 0; i < missingIds.length; i += 10) {
      const batch = missingIds.slice(i, i + 10);
      await Promise.allSettled(batch.map(async (id) => {
        const url = await client.getListingFirstImage(String(id));
        if (url) imageMap.set(String(id), url);
      }));
    }
  }

  return allReceipts.map((receipt) => mapReceiptToUIOrder(receipt, shopId, shopName, imageMap));
}

function parseEtsyPrice(price: any): number {
  if (!price) return 0;
  if (typeof price === 'number') return price;
  if (price.amount != null && price.divisor != null) {
    return price.amount / price.divisor;
  }
  if (price.amount != null) return price.amount / 100;
  return 0;
}

function mapReceiptToUIOrder(receipt: any, shopId: string, shopName: string, imageMap: Map<string, string>): UIOrder {
  const transactions = receipt.transactions || [];

  const lineItems = transactions.map((tx: any, idx: number) => {
    const variations = (tx.variations || [])
      .map((v: any) => `${v.formatted_name}: ${v.formatted_value}`)
      .join(', ');

    const listingImage = tx.listing_id ? (imageMap.get(String(tx.listing_id)) || '') : '';

    return {
      id: String(tx.transaction_id || `${receipt.receipt_id}-${idx}`),
      title: tx.title || 'Unknown Product',
      value: parseEtsyPrice(tx.price),
      quantity: tx.quantity || 1,
      weight: 0.5,
      sku: tx.product_data?.sku || tx.sku || '',
      image: listingImage,
      variantInfo: variations || '',
    };
  });

  const customerName = receipt.name || '';
  const nameParts = customerName.trim().split(/\s+/);

  // Etsy receipts surface two free-text fields the seller must see during
  // fulfillment: gift_message (added by the buyer when checking out as a gift)
  // and message_from_buyer (the "note to seller" / personalization request).
  // Sellers doing custom orders rely on these — drop them and we silently lose
  // customer requests.
  const rawGiftMessage =
    typeof receipt.gift_message === 'string' ? receipt.gift_message.trim() : '';
  const rawBuyerMessage =
    typeof receipt.message_from_buyer === 'string'
      ? receipt.message_from_buyer.trim()
      : '';

  // Transactions can also carry per-line personalization in
  // `personalization` / `buyer_request`. Pull them as a fallback so custom-order
  // shops still get the buyer's instructions if Etsy puts them at the
  // transaction level instead of the receipt level.
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
      country: receipt.country_iso || 'US',
      isResidential: true,
      email: receipt.buyer_email || '',
    },
    line_items: lineItems,
    marketplaceOrderDate: receipt.created_timestamp
      ? new Date(receipt.created_timestamp * 1000).toISOString()
      : undefined,
    shipByDate: receipt.expected_ship_date
      ? new Date(receipt.expected_ship_date * 1000).toISOString()
      : undefined,
    giftMessage: rawGiftMessage || undefined,
    customerNote: customerNote || undefined,
    rawData: receipt,
    commodityDesc: lineItems[0]?.title || '',
  };
}

function mapEtsyStatus(receipt: any): string {
  // Order matters: a canceled order can still have was_paid/was_shipped=true
  // (they were paid+shipped before the cancel), so the cancel check has to
  // win over both — otherwise refunded orders look perfectly healthy in our
  // UI and the user can't tell what's been refunded.
  const externalStatus = typeof receipt.status === 'string' ? receipt.status : '';
  if (
    receipt.is_dead ||
    receipt.is_refunded ||
    externalStatus === 'Canceled' ||
    externalStatus === 'Cancelled' ||
    externalStatus === 'Fully Refunded'
  ) {
    return 'CANCELLED';
  }
  if (receipt.is_shipped || receipt.was_shipped) return 'SHIPPED';
  if (receipt.is_paid || receipt.was_paid) return 'PAID';
  if (externalStatus === 'Completed') return 'SHIPPED';
  if (externalStatus === 'Paid') return 'PAID';
  return 'AWAITING_FULFILLMENT';
}
