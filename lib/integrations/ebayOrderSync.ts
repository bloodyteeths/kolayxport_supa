import { getUserAccessToken, getApplicationToken } from './ebayClient';
import { callEbayRateLimited } from './ebayRateLimiter';
import { UIOrder } from '../types';
import { logger } from '../logger';

const EBAY_API_BASE = 'https://api.ebay.com';

async function fetchItemImage(legacyItemId: string, token: string): Promise<string> {
  try {
    const url = `${EBAY_API_BASE}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyItemId}`;
    const data = await callEbayRateLimited<any>(url, { token, marketplaceId: 'EBAY_US' });
    return data?.image?.imageUrl || '';
  } catch {
    return '';
  }
}

export async function fetchEbayOrders(
  userId: string,
  options?: { lastSync?: Date }
): Promise<UIOrder[]> {
  let accessToken: string;
  try {
    console.log(`[EbayOrderSync] Getting access token for user ${userId}`);
    accessToken = await getUserAccessToken(userId);
    console.log(`[EbayOrderSync] Got access token (length: ${accessToken?.length})`);
  } catch (err) {
    console.error('[EbayOrderSync] Token fetch failed:', err);
    return [];
  }

  const allOrders: UIOrder[] = [];
  let offset = 0;
  const PAGE_LIMIT = 50;
  let hasMore = true;

  while (hasMore) {
    let url = `${EBAY_API_BASE}/sell/fulfillment/v1/order?limit=${PAGE_LIMIT}&offset=${offset}`;

    // eBay filter format: creationdate:[YYYY-MM-DDTHH:MM:SS.000Z..]
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const filterDate = thirtyDaysAgo.toISOString();
    url += `&filter=creationdate:[${filterDate}..]`;

    console.log(`[EbayOrderSync] Fetching orders: offset=${offset}`);

    try {
      console.log(`[EbayOrderSync] Calling eBay API: ${url.substring(0, 120)}...`);
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      });
      if (!response.ok) {
        const errBody = await response.text();
        console.error(`[EbayOrderSync] API error ${response.status}: ${errBody.substring(0, 300)}`);
        break;
      }
      const data = await response.json();

      console.log(`[EbayOrderSync] API response: total=${data.total}, orders=${(data.orders || []).length}`);
      const orders = data.orders || [];

      // Collect legacyItemIds and fetch images in parallel
      const legacyIds = new Set<string>();
      for (const order of orders) {
        for (const li of order.lineItems || []) {
          if (li.legacyItemId) legacyIds.add(String(li.legacyItemId));
        }
      }

      const imageMap = new Map<string, string>();
      if (legacyIds.size > 0) {
        let appToken: string;
        try { appToken = await getApplicationToken(); } catch { appToken = accessToken; }
        const imagePromises = Array.from(legacyIds).map(async (id) => {
          const img = await fetchItemImage(id, appToken);
          if (img) imageMap.set(id, img);
        });
        await Promise.all(imagePromises);
        console.log(`[EbayOrderSync] Fetched ${imageMap.size}/${legacyIds.size} item images`);
      }

      for (const order of orders) {
        try {
          allOrders.push(mapEbayOrderToUIOrder(order, imageMap));
        } catch (mapErr) {
          logger.warn('[EbayOrderSync] Failed to map order', { orderId: order.orderId, error: String(mapErr) });
        }
      }

      if (orders.length < PAGE_LIMIT || offset + PAGE_LIMIT >= (data.total || 0)) {
        hasMore = false;
      } else {
        offset += PAGE_LIMIT;
      }

      if (allOrders.length > 500) break;
    } catch (err) {
      logger.error('[EbayOrderSync] API call failed', err instanceof Error ? err : new Error(String(err)), { offset });
      break;
    }
  }

  logger.info(`[EbayOrderSync] Fetched ${allOrders.length} orders`);
  return allOrders;
}

function mapEbayOrderToUIOrder(order: any, imageMap?: Map<string, string>): UIOrder {
  const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || {};
  const contactAddr = shipTo.contactAddress || {};
  const fullName = shipTo.fullName || order.buyer?.username || '';
  const nameParts = fullName.trim().split(/\s+/);

  const lineItems = (order.lineItems || []).map((li: any, idx: number) => {
    const variations = (li.variationAspects || [])
      .map((v: any) => `${v.name}: ${v.value}`)
      .join(', ');

    return {
      id: String(li.lineItemId || `${order.orderId}-${idx}`),
      title: li.title || 'Unknown Product',
      value: parseFloat(li.lineItemCost?.value) || 0,
      quantity: li.quantity || 1,
      weight: 0.5,
      sku: li.sku || '',
      image: li.image?.imageUrl || (li.legacyItemId && imageMap?.get(String(li.legacyItemId))) || '',
      variantInfo: variations || '',
    };
  });

  const totalPrice = parseFloat(order.pricingSummary?.total?.value) || 0;
  const currency = order.pricingSummary?.total?.currency || 'USD';

  // Ship-by deadline lives on each line item's lineItemFulfillmentInstructions.shipByDate.
  // The previously-used fulfillmentStartInstructions[0].maxEstimatedDeliveryDate is the
  // latest *delivery* date promised to the buyer — using it as a ship-by tricks sellers
  // into thinking they have several extra days to ship. Take the earliest shipByDate
  // across line items so we surface the tightest deadline.
  const shipByCandidates = (order.lineItems || [])
    .map((li: any) => li?.lineItemFulfillmentInstructions?.shipByDate)
    .filter((d: any): d is string => typeof d === 'string' && d.length > 0);
  const earliestShipByDate = shipByCandidates.length
    ? shipByCandidates.reduce((earliest: string, current: string) =>
        new Date(current).getTime() < new Date(earliest).getTime() ? current : earliest
      )
    : undefined;

  return {
    id: `ebay-${order.orderId}`,
    source: 'ebay-api',
    channel: 'ebay',
    marketplace: 'eBay',
    marketplaceKey: order.orderId,
    orderNumber: order.orderId,
    customerName: fullName,
    status: mapEbayStatus(order.orderFulfillmentStatus),
    externalStatus: order.orderFulfillmentStatus || '',
    currency,
    totalPrice,
    to_address: {
      name: fullName,
      phone: shipTo.primaryPhone?.phoneNumber || '',
      street1: contactAddr.addressLine1 || '',
      street2: contactAddr.addressLine2 || '',
      city: contactAddr.city || '',
      state: contactAddr.stateOrProvince || '',
      postal: contactAddr.postalCode || '',
      country: contactAddr.countryCode || 'US',
      isResidential: true,
      email: shipTo.email || order.buyer?.buyerRegistrationAddress?.email || '',
    },
    line_items: lineItems,
    marketplaceOrderDate: order.creationDate || undefined,
    shipByDate: earliestShipByDate,
    rawData: order,
    commodityDesc: lineItems[0]?.title || '',
  };
}

function mapEbayStatus(status?: string): string {
  if (!status) return 'AWAITING_FULFILLMENT';
  switch (status.toUpperCase()) {
    case 'FULFILLED': return 'SHIPPED';
    case 'IN_PROGRESS': return 'AWAITING_FULFILLMENT';
    case 'NOT_STARTED': return 'PAID';
    default: return status;
  }
}
