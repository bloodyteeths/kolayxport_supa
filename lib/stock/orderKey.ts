/**
 * Order identity for stock sales (W2, T3). Pure — unit tested on fixtures
 * shaped after real production rows (read-only check 2026-10-15).
 *
 * deriveOrderKey(order) -> '<channel>:<nativeOrderId>' so the same sale seen
 * via webhook, poll, scan or an aggregator copy (Veeqo / Shippo) maps to ONE
 * ledger sale per (orderKey, stockItem).
 *
 * Shapes observed in production:
 *  - Etsy direct (etsy-api):    rawData.receipt_id
 *  - Veeqo copy:                rawData.channel.type_code in etsy|amazon|amazon_fba|ebay|shopify;
 *                               rawData.number = native order id (Etsy receipt id / Amazon id /
 *                               eBay order id); Shopify copies carry '#2615-A' (NOT native).
 *                               Some rows store rawData as a JSON string.
 *  - Shippo copy:               rawData.object_id + shop_app ('Etsy') + order_number (= receipt id)
 *  - eBay direct:               rawData.orderId
 *  - Trendyol:                  rawData.id = shipment package id (one orderNumber can be split
 *                               into several packages = several Order rows, so the package id is
 *                               the identity, not orderNumber)
 *  - Shopify direct:            rawData.id (numeric)
 *  - Wix:                       rawData.id (uuid)
 *  - Amazon direct:             rawData.orderId (AmazonOrderId)
 *  - Manual:                    rawData.manualOrder / marketplace 'Manual'
 */
import type { StockChannel } from './types';

export type OrderLike = {
  id: string;
  marketplace?: string | null;
  marketplaceKey?: string | null;
  orderNumber?: string | null;
  source?: string | null;
  status?: string | null;
  rawData?: unknown;
};

export type OrderChannelInfo = {
  /** Sales channel the order belongs to (null = manual / unknown). */
  channel: StockChannel | null;
  /** 'direct' integration, or the aggregator the row came through. */
  via: 'direct' | 'veeqo' | 'shippo' | 'manual' | 'unknown';
  /** Native order id on the channel, when resolvable. */
  nativeId: string | null;
};

export function parseRaw(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null;
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
}

const DIGITS = /^\d{6,}$/;
const AMAZON_ID = /^\d{3}-\d{7}-\d{7}$/;
const EBAY_ID = /^\d{2}-\d{5}-\d{5}$/;

function channelFromAggregatorCode(code: string | null): StockChannel | null {
  const c = (code || '').toLowerCase();
  if (c === 'etsy') return 'etsy';
  if (c === 'amazon' || c === 'amazon_fba') return 'amazon';
  if (c === 'ebay') return 'ebay';
  if (c === 'shopify') return 'shopify';
  if (c === 'wix') return 'wix';
  if (c === 'trendyol') return 'trendyol';
  return null;
}

/** Which channel / native id an Order row represents. */
export function resolveOrderChannel(order: OrderLike): OrderChannelInfo {
  const raw = parseRaw(order.rawData) || {};
  const source = (order.source || '').toLowerCase();
  const marketplace = (order.marketplace || '').toLowerCase();

  if (marketplace === 'manual' || raw.manualOrder) {
    return { channel: null, via: 'manual', nativeId: s(order.id) };
  }

  // Direct integrations first (source is set by W4 for new rows; shape fallback for old rows).
  if (source === 'etsy-api' || raw.receipt_id !== undefined) {
    return { channel: 'etsy', via: 'direct', nativeId: s(raw.receipt_id) ?? s(order.marketplaceKey) };
  }

  // Veeqo copy: { channel: { type_code }, number, line_items, ... }
  if (source === 'veeqo' || (raw.channel && typeof raw.channel === 'object' && raw.line_items && raw.number !== undefined && !raw.object_id)) {
    const ch = channelFromAggregatorCode(s(raw.channel?.type_code));
    const num = s(raw.number);
    let nativeId: string | null = null;
    if (ch === 'etsy' && num && DIGITS.test(num)) nativeId = num;
    else if (ch === 'amazon' && num && AMAZON_ID.test(num)) nativeId = num;
    else if (ch === 'ebay' && num && EBAY_ID.test(num)) nativeId = num;
    // Shopify via Veeqo: '#2615-A' is Veeqo's own number, not Shopify's id.
    return { channel: ch, via: 'veeqo', nativeId };
  }

  // Shippo copy: { object_id, shop_app, order_number, ... }
  if (source === 'shippo' || raw.object_id !== undefined) {
    const ch = channelFromAggregatorCode(s(raw.shop_app)) ?? channelFromAggregatorCode(s(raw.channel?.type_code));
    // Some rows merge Veeqo + Shippo fields; prefer Shippo's order_number, else Veeqo's number.
    const on = s(raw.order_number);
    const num = on && (DIGITS.test(on) || AMAZON_ID.test(on) || EBAY_ID.test(on)) ? on : s(raw.number);
    let nativeId: string | null = null;
    if (ch === 'etsy' && num && DIGITS.test(num)) nativeId = num;
    else if (ch === 'amazon' && num && AMAZON_ID.test(num)) nativeId = num;
    else if (ch === 'ebay' && num && EBAY_ID.test(num)) nativeId = num;
    return { channel: ch, via: 'shippo', nativeId };
  }

  if (source === 'ebay-api' || (raw.orderId !== undefined && raw.lineItems !== undefined && raw.orderFulfillmentStatus !== undefined)) {
    return { channel: 'ebay', via: 'direct', nativeId: s(raw.orderId) ?? s(order.marketplaceKey) };
  }
  if (source === 'trendyol' || marketplace === 'trendyol' || (raw.shipmentPackageStatus !== undefined || (raw.orderNumber !== undefined && raw.lines !== undefined))) {
    return { channel: 'trendyol', via: 'direct', nativeId: s(raw.id) ?? s(order.marketplaceKey) };
  }
  if (source === 'shopify' || marketplace === 'shopify' || (raw.admin_graphql_api_id !== undefined && raw.line_items !== undefined)) {
    return { channel: 'shopify', via: 'direct', nativeId: s(raw.id) ?? s(order.marketplaceKey) };
  }
  if (source === 'wix' || marketplace === 'wix' || (raw.buyerInfo !== undefined && raw.lineItems !== undefined)) {
    return { channel: 'wix', via: 'direct', nativeId: s(raw.id) ?? s(order.marketplaceKey) };
  }
  if (source === 'amazon' || marketplace === 'amazon' || (raw.orderId !== undefined && raw.salesChannel !== undefined)) {
    return { channel: 'amazon', via: 'direct', nativeId: s(raw.orderId) ?? s(order.marketplaceKey) };
  }
  if (source === 'hepsiburada' || marketplace === 'hepsiburada') {
    return { channel: 'hepsiburada', via: 'direct', nativeId: s(order.marketplaceKey) };
  }
  return { channel: null, via: 'unknown', nativeId: null };
}

/**
 * '<channel>:<nativeOrderId>'.
 *
 * Aggregator copies whose native id cannot be resolved:
 *  - return null when a direct integration for that channel is connected
 *    (`directChannels`) — the direct row will carry the sale; the caller skips
 *    with 'aggregator_unresolved' and counts an unmatched sale;
 *  - otherwise the aggregator copy is the only source of that sale, so it is
 *    keyed by the aggregator's own id: '<channel>:<via>:<marketplaceKey>'.
 */
export function deriveOrderKey(order: OrderLike, opts: { directChannels?: ReadonlySet<string> } = {}): string | null {
  const info = resolveOrderChannel(order);
  if (info.via === 'manual') return `manual:${order.id}`;
  if (!info.channel) {
    const mk = s(order.marketplaceKey);
    return mk ? `unknown:${(order.marketplace || 'x').toLowerCase()}:${mk}` : null;
  }
  if (info.nativeId) return `${info.channel}:${info.nativeId}`;
  if (info.via === 'veeqo' || info.via === 'shippo') {
    if (opts.directChannels?.has(info.channel)) return null;
    const mk = s(order.marketplaceKey);
    return mk ? `${info.channel}:${info.via}:${mk}` : null;
  }
  const mk = s(order.marketplaceKey);
  return mk ? `${info.channel}:${mk}` : null;
}

/**
 * Should a cancelled order be restocked? Cancellations and refunds-before-ship
 * restock; returns (goods may be damaged, handled manually) do not.
 */
export function orderStatusClass(order: OrderLike): 'open' | 'cancelled' | 'returned' {
  const st = String(order.status || '').toUpperCase();
  const raw = parseRaw(order.rawData) || {};
  const rawStatus = String(raw.status ?? raw.shipmentPackageStatus ?? '').toLowerCase();
  if (rawStatus === 'returned' || rawStatus === 'undelivered') {
    return st === 'CANCELLED' || st === 'CANCELED' ? 'returned' : 'open';
  }
  if (st === 'CANCELLED' || st === 'CANCELED' || st === 'REFUNDED' || rawStatus === 'unpacked') return 'cancelled';
  return 'open';
}
