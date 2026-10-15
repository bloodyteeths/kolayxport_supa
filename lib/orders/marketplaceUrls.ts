/**
 * Marketplace deep links for orders and order items ("Open on {marketplace} ↗", item title links).
 * Moved verbatim from `pages/app/labels.tsx` (`getMarketplaceOrderUrl`, the listing-URL blocks of
 * `toLabelRows`). Pure.
 */
import { buildTrendyolProductUrl } from '@/lib/utils/trendyolUrl';
import type { ListingUrlLookup } from './types';

/** Seller-side order page, or null (manual orders, Wix, Shopify, unknown). Same rules as the legacy page. */
export function marketplaceOrderUrl(
  marketplace: string | null | undefined,
  orderNumber: string | null | undefined,
  channel?: string | null,
  opts: { isEtsyStore?: boolean } = {},
): string | null {
  if (!orderNumber || orderNumber === '—') return null;
  const mp = String(marketplace ?? '').toLowerCase();
  const ch = String(channel ?? '').toLowerCase();

  // Etsy: direct marketplace match, a known Etsy shop name, or orders routed through Veeqo/Shippo with channel=etsy.
  if (mp.includes('etsy') || ch.includes('etsy') || opts.isEtsyStore) {
    return `https://www.etsy.com/your/orders/sold/completed?order_id=${orderNumber}`;
  }
  if (mp.includes('trendyol')) return `https://partner.trendyol.com/orders/detail/${orderNumber}`;
  if (mp.includes('ebay')) return `https://www.ebay.com/sh/ord/details?orderid=${encodeURIComponent(orderNumber)}`;
  if (mp.includes('amazon')) return `https://sellercentral.amazon.com/orders-v3/order/${orderNumber}`;
  if (mp.includes('hepsiburada')) return `https://merchant.hepsiburada.com/siparis/detay/${orderNumber}`;
  return null;
}

export interface ItemUrlInput {
  /** Index of the item in the order's line items. */
  index: number;
  title: string;
  /** Server-resolved active Etsy listing URL or Wix product page (`line_items[].etsyListingUrl`). */
  serverUrl?: string | null;
  /** Trendyol line id (`remoteLineId` / item id). */
  lineId?: string | null;
  /** Veeqo `sellable.product.id` of a rawData item. */
  veeqoProductId?: number | null;
}

export interface OrderUrlContext {
  isTrendyol: boolean;
  /** Parsed `rawData` (Trendyol `lines[]`). */
  rawData: Record<string, any> | null;
  /** Veeqo product ids from `rawData.line_items`, index-aligned with the items. */
  veeqoProductIds: number[];
  listingUrls?: ListingUrlLookup;
}

/** Product page of one order item (legacy `toLabelRows` item `listingUrl`), or null. */
export function itemListingUrl(item: ItemUrlInput, ctx: OrderUrlContext): string | null {
  const lookup = ctx.listingUrls ?? {};
  if (ctx.isTrendyol) {
    const lines: any[] = Array.isArray(ctx.rawData?.lines) ? ctx.rawData!.lines : [];
    const lineId = item.lineId ?? null;
    const matched =
      (lineId != null ? lines.find((l) => String(l?.lineId) === String(lineId) || String(l?.id) === String(lineId)) : undefined) ??
      lines[0];
    const contentId = matched?.contentId;
    const barcode = matched?.barcode || matched?.sku || matched?.merchantSku;
    if (contentId || barcode) {
      return buildTrendyolProductUrl({ contentId, productName: matched?.productName, merchantId: matched?.merchantId, barcode });
    }
  }
  if (item.serverUrl) return item.serverUrl;
  const pids = ctx.veeqoProductIds;
  if (pids.length > 0) {
    const pid = pids[item.index] || pids[0];
    const resolved = lookup.byProductId?.[String(pid)];
    if (resolved) return resolved;
  }
  if (item.veeqoProductId) {
    const resolved = lookup.byProductId?.[String(item.veeqoProductId)];
    if (resolved) return resolved;
  }
  return (item.title && lookup.byTitle?.[item.title]) || null;
}
