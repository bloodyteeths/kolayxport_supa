// lib/mcp/orderData.ts — what the seller's AI sees of one order (SERVER ONLY, pure helpers + one batched lookup).
//
//  - Country: from every place KolayXport keeps it — the structured recipient row (OrderShipping), the stored
//    shipping address, the marketplace payload (Etsy receipt `country_iso`, eBay ship-to, Amazon ship-to) and the
//    Chrome extension's Etsy addresses (EtsyAddress: Etsy's API withholds buyer addresses, the extension scrapes
//    them). Trendyol / Hepsiburada ship inside Turkey.
//  - Buyer name + shipping address: ONLY with the connection's `orders:buyer` scope (the seller ticked it), only for
//    Etsy, eBay, Trendyol, Hepsiburada and Wix orders, never Amazon (Amazon's data rules), and never e-mail or phone.
//    The address is read the same way the orders page reads it (lib/orders/toOrderRows extractShipTo).
//  - Money: the breakdown the marketplace payload (Order.rawData) carries — item subtotal, discounts / coupons,
//    shipping, tax, gift wrap, total; per line the unit price paid. Nothing is invented: a field the payload does not
//    have is null.
import prisma from '@/lib/prisma';
import { extractShipTo, parseJsonObject, resolveCountryCode } from '@/lib/orders/toOrderRows';
import type { ApiOrder, EtsyAddressEnrichment } from '@/lib/orders/types';

type Obj = Record<string, any>;

/** Marketplaces whose buyer name + address may leave with the `orders:buyer` scope. Amazon never. */
export const BUYER_DATA_MARKETPLACES = ['etsy', 'ebay', 'trendyol', 'hepsiburada', 'wix'] as const;

const AMAZON_ORDER_ID = /^\d{3}-\d{7}-\d{7}$/;

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** A money value in any marketplace shape: Etsy {amount, divisor}, eBay {value}, Amazon {Amount}, Wix {amount}
 *  (string), plain numbers / numeric strings. null when absent or not a number. */
export function moneyValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? round2(n) : null;
  }
  if (typeof v === 'object') {
    const o = v as Obj;
    if (typeof o.amount === 'number' && typeof o.divisor === 'number') return round2(o.amount / (o.divisor || 100));
    if (o.value !== undefined) return moneyValue(o.value);
    if (o.Amount !== undefined) return moneyValue(o.Amount);
    if (o.amount !== undefined) return moneyValue(o.amount);
  }
  return null;
}

const sum = (vals: Array<number | null>): number | null => {
  const ok = vals.filter((x): x is number => x !== null);
  return ok.length ? round2(ok.reduce((a, b) => a + b, 0)) : null;
};
const abs = (n: number | null) => (n === null ? null : round2(Math.abs(n)));
const text = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/* ------------------------------------------------------------------ marketplace */

export type OrderFacts = {
  marketplace: string;
  source?: string | null;
  orderNumber?: string | null;
  currency?: string | null;
  totalPrice?: number | null;
  shippingAddress?: unknown;
  rawData?: unknown;
  customerName?: string | null;
  shipping?: { firstName?: string | null; lastName?: string | null; street1?: string | null; street2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; countryCode?: string | null } | null;
};

/** The marketplace a stored order belongs to (`canonical` = the name the tools show: etsy, ebay, amazon …). */
export function isAmazonOrder(o: OrderFacts, canonical: string): boolean {
  if (canonical === 'amazon' || String(o.source || '').toLowerCase() === 'amazon') return true;
  const raw = parseJsonObject(o.rawData);
  return Boolean(raw.AmazonOrderId) || AMAZON_ORDER_ID.test(String(o.orderNumber || ''));
}

/* ------------------------------------------------------------------ country + buyer */

function rawCountry(raw: Obj): string {
  const ebayShipTo = raw.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo?.contactAddress;
  const amazonRow = Array.isArray(raw.rows) ? raw.rows[0] : null;
  const cands = [raw.country_iso, ebayShipTo?.countryCode, raw.ShippingAddress?.CountryCode, amazonRow?.['ship-country'], raw.shipmentAddress?.countryCode];
  for (const c of cands) {
    const r = resolveCountryCode(c);
    if (r) return r;
  }
  return '';
}

function etsyAddressCountry(e: EtsyAddressEnrichment | null | undefined): string {
  const a = e?.shippingAddress && typeof e.shippingAddress === 'object' ? (e.shippingAddress as Obj) : null;
  return a ? resolveCountryCode(a.country_iso ?? a.countryCode ?? a.country_code ?? a.country ?? '') : '';
}

function apiOrderOf(o: OrderFacts): ApiOrder {
  const s = o.shipping ?? null;
  return {
    id: '', marketplace: o.marketplace, orderNumber: String(o.orderNumber || ''),
    shippingAddress: o.shippingAddress, rawData: o.rawData, customerName: o.customerName ?? null,
    ...(s ? {
      recipientFirstName: s.firstName || undefined, recipientLastName: s.lastName || undefined, recipientStreet1: s.street1 || undefined,
      recipientStreet2: s.street2 || undefined, recipientCity: s.city || undefined, recipientState: s.state || undefined,
      recipientPostal: s.postalCode || undefined, recipientCountry: s.countryCode || undefined,
    } : {}),
  } as ApiOrder;
}

/** ISO-2 ship-to country (or the stored name when it is not a known one); null when KolayXport does not have it. */
export function shipToCountry(o: OrderFacts, canonical: string, etsy?: EtsyAddressEnrichment | null): string | null {
  if (canonical === 'trendyol' || canonical === 'hepsiburada') return 'TR';
  const fromRow = resolveCountryCode(o.shipping?.countryCode ?? '');
  if (fromRow) return fromRow;
  const shipTo = extractShipTo(apiOrderOf(o), etsy ?? null, canonical === 'etsy');
  const c = shipTo.country || rawCountry(parseJsonObject(o.rawData)) || etsyAddressCountry(etsy);
  return c ? c.slice(0, 40) : null;
}

export type BuyerView = {
  name: string | null;
  shippingAddress: { street1: string | null; street2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null };
};

/** Buyer name + shipping address for the `orders:buyer` scope. null for Amazon and every marketplace outside
 *  BUYER_DATA_MARKETPLACES. E-mail and phone are never part of it. */
export function buyerView(o: OrderFacts, canonical: string, etsy?: EtsyAddressEnrichment | null): BuyerView | null {
  if (!(BUYER_DATA_MARKETPLACES as readonly string[]).includes(canonical) || isAmazonOrder(o, canonical)) return null;
  const s = extractShipTo(apiOrderOf(o), etsy ?? null, canonical === 'etsy');
  const customer = text(o.customerName, 120);
  const name = text(s.name, 120) || (customer && !/anonymi[sz]ed|^amazon customer$/i.test(customer) ? customer : null);
  const country = shipToCountry(o, canonical, etsy);
  return {
    name,
    shippingAddress: { street1: text(s.street1, 200), street2: text(s.street2, 200), city: text(s.city), state: text(s.state), postalCode: text(s.postal, 20), country },
  };
}

/** EtsyAddress rows (Chrome extension) for these Etsy orders, newest first; never another seller's. */
export async function etsyAddressesFor(userId: string, orderNumbers: string[]): Promise<Map<string, EtsyAddressEnrichment>> {
  const out = new Map<string, EtsyAddressEnrichment>();
  const nums = Array.from(new Set(orderNumbers.filter(Boolean))).slice(0, 500);
  if (!nums.length) return out;
  const rows = await prisma.etsyAddress.findMany({
    where: { userId, orderNumber: { in: nums } },
    select: { orderNumber: true, etsyStoreName: true, shippingAddress: true },
    orderBy: { updatedAt: 'desc' },
  });
  for (const r of rows) {
    if (out.has(r.orderNumber)) continue;
    let addr: unknown = r.shippingAddress;
    if (typeof addr === 'string') addr = parseJsonObject(addr);
    out.set(r.orderNumber, { orderNumber: r.orderNumber, etsyStoreName: r.etsyStoreName, shippingAddress: addr as EtsyAddressEnrichment['shippingAddress'] });
  }
  return out;
}

/* ------------------------------------------------------------------ money */

export type MoneyBreakdown = {
  currency: string | null;
  /** Items at the price charged, before order-level discounts. */
  itemsSubtotal: number | null;
  discount: { amount: number | null; sellerFunded?: number | null; marketplaceFunded?: number | null; couponCode?: string | null; promotions?: Array<{ description: string | null; amount: number | null }> } | null;
  shipping: number | null;
  shippingDiscount?: number | null;
  /** Sales tax / VAT the buyer paid (marketplace-collected taxes are passed through, not the seller's money). */
  tax: number | null;
  giftWrap: number | null;
  total: number | null;
  /** eBay: the fees eBay charged the seller on this order. */
  marketplaceFee?: number | null;
  notes: string[];
  source: string;
};

export type LineMoney = {
  key: string | null;
  title: string | null;
  quantity: number | null;
  /** Price per unit the buyer paid after line discounts (null when the payload does not say). */
  unitPricePaid: number | null;
  /** Price per unit before line discounts, when the payload has both. */
  unitPriceBeforeDiscount?: number | null;
  lineDiscount?: number | null;
  couponOnLine?: number | null;
  promotions?: Array<{ description: string | null; amount: number | null }>;
  vatRatePercent?: number | null;
};

export type OrderMoney = { breakdown: MoneyBreakdown | null; lines: LineMoney[] };

function etsyMoney(raw: Obj, currency: string | null): OrderMoney {
  const txs: Obj[] = Array.isArray(raw.transactions) ? raw.transactions : [];
  const discount = moneyValue(raw.discount_amt);
  const lines: LineMoney[] = txs.map((tx) => {
    const shop = moneyValue(tx.shop_coupon);
    const buyer = moneyValue(tx.buyer_coupon);
    return {
      key: tx.listing_id != null ? String(tx.listing_id) : null,
      title: text(tx.title, 200),
      quantity: Number(tx.quantity) || null,
      unitPricePaid: moneyValue(tx.price),
      couponOnLine: shop || buyer ? round2((shop ?? 0) + (buyer ?? 0)) : null,
    };
  });
  const notes: string[] = [];
  if (discount) notes.push('Etsy reports the discount for the whole order (discount_amt): coupon or sale promotion; Etsy\'s API does not name the coupon code.');
  notes.push('Unit prices are what Etsy charged per item at checkout; a lower price than the listing\'s current price usually means the listing price changed or a sale was running.');
  return {
    breakdown: {
      currency: raw.grandtotal?.currency_code ?? currency,
      itemsSubtotal: moneyValue(raw.total_price),
      discount: discount ? { amount: abs(discount), couponCode: null } : null,
      shipping: moneyValue(raw.total_shipping_cost),
      tax: sum([moneyValue(raw.total_tax_cost), moneyValue(raw.total_vat_cost)]),
      giftWrap: moneyValue(raw.gift_wrap_price),
      total: moneyValue(raw.grandtotal),
      notes,
      source: 'Etsy receipt (as synced)',
    },
    lines,
  };
}

function ebayMoney(raw: Obj, currency: string | null): OrderMoney {
  const p: Obj = raw.pricingSummary || {};
  const lis: Obj[] = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  const promoOf = (li: Obj) => (Array.isArray(li.appliedPromotions) ? li.appliedPromotions : []).map((x: Obj) => ({ description: text(x.description, 120), amount: abs(moneyValue(x.discountAmount)) }));
  const lines: LineMoney[] = lis.map((li) => {
    const qty = Number(li.quantity) || 1;
    const before = moneyValue(li.lineItemCost);
    const after = moneyValue(li.discountedLineItemCost);
    return {
      key: text(li.sku, 80) ?? (li.legacyItemId != null ? String(li.legacyItemId) : null),
      title: text(li.title, 200),
      quantity: qty,
      unitPricePaid: after !== null ? round2(after / qty) : before !== null ? round2(before / qty) : null,
      unitPriceBeforeDiscount: before !== null ? round2(before / qty) : null,
      lineDiscount: before !== null && after !== null ? round2(before - after) : null,
      promotions: promoOf(li),
    };
  });
  const promotions = lis.flatMap(promoOf);
  const discount = abs(moneyValue(p.priceDiscount));
  const ebayTax = sum(lis.flatMap((li) => (Array.isArray(li.ebayCollectAndRemitTaxes) ? li.ebayCollectAndRemitTaxes : []).map((t: Obj) => moneyValue(t.amount))));
  const notes: string[] = [];
  if (ebayTax) notes.push('tax includes sales tax / VAT eBay collected and remits itself (not the seller\'s money).');
  return {
    breakdown: {
      currency: p.total?.currency ?? currency,
      itemsSubtotal: moneyValue(p.priceSubtotal),
      discount: discount || promotions.length ? { amount: discount, promotions } : null,
      shipping: moneyValue(p.deliveryCost),
      shippingDiscount: abs(moneyValue(p.deliveryDiscount)),
      tax: sum([moneyValue(p.tax), ebayTax]),
      giftWrap: null,
      total: moneyValue(p.total),
      marketplaceFee: moneyValue(raw.totalMarketplaceFee),
      notes,
      source: 'eBay order (as synced)',
    },
    lines,
  };
}

function trendyolMoney(raw: Obj, currency: string | null): OrderMoney {
  const ls: Obj[] = Array.isArray(raw.lines) ? raw.lines : Array.isArray(raw.lineItems) ? raw.lineItems : [];
  const lines: LineMoney[] = ls.map((l) => ({
    key: text(l.barcode, 80) ?? text(l.merchantSku, 80),
    title: text(l.productName, 200),
    quantity: Number(l.quantity) || null,
    unitPricePaid: moneyValue(l.price),
    unitPriceBeforeDiscount: moneyValue(l.amount),
    lineDiscount: sum([moneyValue(l.discount), moneyValue(l.tyDiscount)]),
    vatRatePercent: moneyValue(l.vatBaseAmount),
  }));
  const seller = moneyValue(raw.totalDiscount);
  const ty = moneyValue(raw.totalTyDiscount);
  return {
    breakdown: {
      currency: raw.currencyCode ?? currency,
      itemsSubtotal: moneyValue(raw.grossAmount),
      discount: seller || ty ? { amount: sum([seller, ty]), sellerFunded: seller, marketplaceFunded: ty } : null,
      shipping: null,
      tax: null,
      giftWrap: null,
      total: moneyValue(raw.totalPrice),
      notes: ['Trendyol prices include VAT (KDV); vatRatePercent is per line.'],
      source: 'Trendyol order (as synced)',
    },
    lines,
  };
}

function amazonMoney(raw: Obj, currency: string | null): OrderMoney {
  const notes: string[] = [];
  if (Array.isArray(raw.OrderItems)) {
    const its: Obj[] = raw.OrderItems;
    const lines: LineMoney[] = its.map((i) => {
      const qty = Number(i.QuantityOrdered) || 1;
      const lineTotal = moneyValue(i.ItemPrice);
      return { key: text(i.SellerSKU, 80) ?? text(i.ASIN, 20), title: text(i.Title, 200), quantity: qty, unitPricePaid: lineTotal !== null ? round2(lineTotal / qty) : null, lineDiscount: abs(moneyValue(i.PromotionDiscount)) };
    });
    const promo = sum(its.map((i) => abs(moneyValue(i.PromotionDiscount))));
    return {
      breakdown: {
        currency: raw.OrderTotal?.CurrencyCode ?? currency,
        itemsSubtotal: sum(its.map((i) => moneyValue(i.ItemPrice))),
        discount: promo ? { amount: promo } : null,
        shipping: sum(its.map((i) => moneyValue(i.ShippingPrice))),
        shippingDiscount: sum(its.map((i) => abs(moneyValue(i.ShippingDiscount)))),
        tax: sum(its.flatMap((i) => [moneyValue(i.ItemTax), moneyValue(i.ShippingTax), moneyValue(i.GiftWrapTax)])),
        giftWrap: sum(its.map((i) => moneyValue(i.GiftWrapPrice))),
        total: moneyValue(raw.OrderTotal),
        notes,
        source: 'Amazon order (as synced)',
      },
      lines,
    };
  }
  const rows: Obj[] = Array.isArray(raw.rows) ? raw.rows : raw['item-price'] !== undefined ? [raw] : [];
  if (!rows.length) return { breakdown: null, lines: [] };
  const lines: LineMoney[] = rows.map((r) => {
    const qty = Number(r['quantity-purchased']) || 1;
    const price = moneyValue(r['item-price']);
    return { key: text(r.sku, 80), title: text(r['product-name'], 200), quantity: qty, unitPricePaid: price !== null ? round2(price / qty) : null, lineDiscount: abs(moneyValue(r['item-promotion-discount'])) };
  });
  const promo = sum(rows.map((r) => abs(moneyValue(r['item-promotion-discount']))));
  const shipPromo = sum(rows.map((r) => abs(moneyValue(r['ship-promotion-discount']))));
  const subtotal = sum(rows.map((r) => moneyValue(r['item-price'])));
  const shipping = sum(rows.map((r) => moneyValue(r['shipping-price'])));
  const giftWrap = sum(rows.map((r) => moneyValue(r['gift-wrap-price'])));
  const tax = sum(rows.flatMap((r) => [moneyValue(r['item-tax']), moneyValue(r['shipping-tax']), moneyValue(r['gift-wrap-tax'])]));
  return {
    breakdown: {
      currency: text(rows[0].currency, 5) ?? currency,
      itemsSubtotal: subtotal,
      discount: promo ? { amount: promo } : null,
      shipping,
      shippingDiscount: shipPromo,
      tax,
      giftWrap,
      total: round2((subtotal ?? 0) + (shipping ?? 0) + (giftWrap ?? 0) - (promo ?? 0) - (shipPromo ?? 0)),
      notes: ['Amazon order report: total = items + shipping + gift wrap − promotions (tax shown separately).'],
      source: 'Amazon order report (as synced)',
    },
    lines,
  };
}

function wixMoney(raw: Obj, currency: string | null): OrderMoney {
  const ps: Obj | null = raw.priceSummary && typeof raw.priceSummary === 'object' ? raw.priceSummary : null;
  if (!ps) return { breakdown: null, lines: [] };
  const coupons = (Array.isArray(raw.appliedDiscounts) ? raw.appliedDiscounts : []).map((d: Obj) => d.coupon).filter(Boolean);
  const discount = abs(moneyValue(ps.discount));
  const lis: Obj[] = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  return {
    breakdown: {
      currency: text(raw.currency, 5) ?? currency,
      itemsSubtotal: moneyValue(ps.subtotal),
      discount: discount || coupons.length ? { amount: discount, couponCode: text(coupons[0]?.code, 60) } : null,
      shipping: moneyValue(ps.shipping),
      tax: moneyValue(ps.tax),
      giftWrap: null,
      total: moneyValue(ps.total),
      notes: [],
      source: 'Wix order (as synced)',
    },
    lines: lis.map((li) => ({ key: text(li.physicalProperties?.sku, 80) ?? text(li.catalogReference?.catalogItemId, 80), title: text(li.productName?.original ?? li.productName, 200), quantity: Number(li.quantity) || null, unitPricePaid: moneyValue(li.price) })),
  };
}

/** The money breakdown the stored marketplace payload carries. Pure. */
export function orderMoney(canonical: string, rawData: unknown, currency: string | null, totalPrice: number | null): OrderMoney {
  const raw = parseJsonObject(rawData);
  let m: OrderMoney = { breakdown: null, lines: [] };
  if (canonical === 'etsy' && (raw.grandtotal || raw.transactions)) m = etsyMoney(raw, currency);
  else if (canonical === 'ebay' && (raw.pricingSummary || raw.lineItems)) m = ebayMoney(raw, currency);
  else if (canonical === 'trendyol' && (raw.grossAmount !== undefined || raw.lines)) m = trendyolMoney(raw, currency);
  else if (canonical === 'amazon') m = amazonMoney(raw, currency);
  else if (canonical === 'wix') m = wixMoney(raw, currency);
  if (!m.breakdown) {
    return {
      breakdown: {
        currency, itemsSubtotal: null, discount: null, shipping: null, tax: null, giftWrap: null, total: totalPrice === null ? null : round2(totalPrice),
        notes: ['Only the order total is stored for this order; no item/discount/shipping/tax breakdown is available.'], source: 'order total only',
      },
      lines: m.lines,
    };
  }
  if (m.breakdown.total === null && totalPrice !== null) m.breakdown.total = round2(totalPrice);
  return m;
}

/** list_orders' one-line money view. */
export function compactMoney(b: MoneyBreakdown | null) {
  if (!b) return null;
  return { currency: b.currency, itemsSubtotal: b.itemsSubtotal, discount: b.discount?.amount ?? null, shipping: b.shipping, tax: b.tax, total: b.total };
}
