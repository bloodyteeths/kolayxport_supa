// lib/mcp/tools.ts — what a seller's own AI (Claude, ChatGPT, Cursor …) can do with their KolayXport shop over MCP.
// SERVER ONLY. Founder 2026-10-17: "users can connect their AI to their shop (must be multitenant safe)".
//
// Rules every tool follows:
//  - Tenant: the userId comes ONLY from the connection (lib/mcp/tokens), never from the arguments; every query filters
//    by it (Etsy listings through the seller's own EtsyShop rows).
//  - Buyer personal data: orders carry the ship-to country only, unless the seller ticked "share buyer names and
//    shipping addresses" for this connection (scope orders:buyer, off by default; founder 2026-10-18). Then name +
//    shipping address go out for Etsy, eBay, Trendyol, Hepsiburada and Wix orders. Amazon orders never (Amazon's data
//    rules), e-mail and phone never (lib/mcp/orderData).
//  - Writes are staged drafts only (scope 'write'): nothing changes on a marketplace until the seller reviews and sends
//    it in KolayXport — the same rule as every editor. Listing tools (audit, SEO, research, staged changes, new
//    listings, photos, AI images): lib/mcp/listingTools.
import prisma from '@/lib/prisma';
import { listListings, type ListingsAdapter } from '@/lib/listings/query';
import { parseListingsQuery, type ListingMarketplace } from '@/lib/listings/types';
import { etsyAdapter } from '@/lib/listings/adapters/etsy';
import { ebayAdapter } from '@/lib/listings/adapters/ebay';
import { trendyolAdapter } from '@/lib/listings/adapters/trendyol';
import { wixAdapter } from '@/lib/listings/adapters/wix';
import { shopifyAdapter } from '@/lib/listings/adapters/shopify';
import { hepsiburadaAdapter } from '@/lib/listings/adapters/hepsiburada';
import { classifyOrderStatus } from '@/lib/orders/orderStatus';
import { resolveCountryCode } from '@/lib/orders/toOrderRows';
import type { EtsyAddressEnrichment } from '@/lib/orders/types';
import { buyerView, compactMoney, etsyAddressesFor, orderMoney, shipToCountry, type LineMoney } from './orderData';
import { mcpBaseUrl, type McpAuth, type McpScope } from './tokens';

const ADAPTERS: Record<ListingMarketplace, ListingsAdapter> = { etsy: etsyAdapter, ebay: ebayAdapter, trendyol: trendyolAdapter, wix: wixAdapter, shopify: shopifyAdapter, hepsiburada: hepsiburadaAdapter };
const MARKETPLACES = Object.keys(ADAPTERS) as ListingMarketplace[];

export { ToolError, type McpTool } from './types';
import { ToolError, type McpTool } from './types';
import { LISTING_TOOLS } from './listingTools';
import { FINANCE_TOOLS } from './financeTools';

const BUYER_NOTE_OFF = 'Buyer name and address are not shared with this connection (country only). The seller can allow them per connection in KolayXport Settings → AI; e-mail and phone are never shared.';
const BUYER_NOTE_ON = 'This connection may see buyer name and shipping address for Etsy, eBay, Trendyol, Hepsiburada and Wix orders (never Amazon). E-mail and phone are never shared.';

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const money = (v: unknown) => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
};

function marketplaceArg(v: unknown, required = false): ListingMarketplace | null {
  const m = str(v, 20).toLowerCase();
  if ((MARKETPLACES as string[]).includes(m)) return m as ListingMarketplace;
  if (required) throw new ToolError(`marketplace must be one of: ${MARKETPLACES.join(', ')}`);
  return null;
}

/** Only the buyer's country leaves (no name, street, city, e-mail or phone) from a stored address. Addresses are
 * stored as JSON or as JSON text; Trendyol / Hepsiburada ship inside Turkey. Pure, exported for tests. The full
 * per-order country (OrderShipping, marketplace payload, the extension's Etsy addresses) is lib/mcp/orderData
 * shipToCountry. */
export function countryOf(addr: unknown, marketplace?: string | null): string | null {
  const mp = String(marketplace || '').toLowerCase();
  if (mp === 'trendyol' || mp === 'hepsiburada') return 'TR';
  let a: unknown = addr;
  if (typeof a === 'string' && a.trim().startsWith('{')) {
    try { a = JSON.parse(a); } catch { return null; }
  }
  if (!a || typeof a !== 'object') return null; // free-text addresses: never parsed (they are personal data)
  const o = a as Record<string, unknown>;
  const c = resolveCountryCode(o.countryCode ?? o.country_code ?? o.country_iso ?? o.country ?? o.countryName ?? '');
  return c ? c.slice(0, 40) : null;
}

/** Orders keep the marketplace as synced (an Etsy order may carry the shop name): one name per marketplace. */
async function marketplaceNamer(userId: string): Promise<(raw: string) => { marketplace: string; store?: string }> {
  const shops = await prisma.etsyShop.findMany({ where: { userId }, select: { shopName: true } });
  const etsy = new Set(shops.map((x) => (x.shopName || '').toLowerCase()).filter(Boolean));
  const known = new Set(['etsy', 'ebay', 'amazon', 'trendyol', 'shopify', 'wix', 'hepsiburada']);
  return (raw) => {
    const low = String(raw || '').toLowerCase();
    if (known.has(low)) return { marketplace: low };
    if (etsy.has(low)) return { marketplace: 'etsy', store: raw };
    return { marketplace: low || 'other', ...(raw ? { store: raw } : {}) };
  };
}

/** `marketplace` filter for orders, matching Etsy orders filed under the shop name too. */
async function orderMarketplaceWhere(userId: string, mp: string): Promise<Record<string, unknown>> {
  if (mp.toLowerCase() !== 'etsy') return { marketplace: { equals: mp, mode: 'insensitive' } };
  const shops = (await prisma.etsyShop.findMany({ where: { userId }, select: { shopName: true } })).map((x) => x.shopName).filter((x): x is string => Boolean(x));
  return { OR: [{ marketplace: { equals: 'etsy', mode: 'insensitive' } }, ...shops.map((n) => ({ marketplace: { equals: n, mode: 'insensitive' } }))] };
}

// rawData / shippingAddress / the recipient row are read server-side for the country, the money breakdown and (only
// with the orders:buyer scope) the buyer's name + address; e-mail and phone are never selected or returned.
const ORDER_SELECT = {
  id: true, orderNumber: true, marketplace: true, source: true, status: true, externalStatus: true, totalPrice: true, currency: true,
  createdAt: true, uiOrderDate: true, shipByAt: true, shippedAt: true, deliveredAt: true, cancelledAt: true, trackingNumber: true,
  shippingAddress: true, rawData: true, customerName: true,
  shipping: { select: { firstName: true, lastName: true, street1: true, street2: true, city: true, state: true, postalCode: true, countryCode: true } },
  items: { select: { productName: true, sku: true, variantInfo: true, quantity: true, unitPrice: true, listingRef: true } },
} as const;

type Namer = (raw: string) => { marketplace: string; store?: string };
type ViewCtx = { name: Namer; etsy: Map<string, EtsyAddressEnrichment>; buyer: boolean; detail: boolean; prices?: Map<string, { amount: number | null; currency: string | null }> };

/** Whether this connection may receive buyer names + addresses (the seller ticked it for this connection). */
export const canSeeBuyer = (auth: McpAuth) => auth.scopes.includes('orders:buyer');

/** EtsyAddress rows for the Etsy orders among `rows` (the extension's scraped addresses). */
async function etsyContext(userId: string, rows: Array<{ marketplace: string; orderNumber: string }>, name: Namer) {
  return etsyAddressesFor(userId, rows.filter((o) => name(o.marketplace).marketplace === 'etsy').map((o) => o.orderNumber));
}

/** Pairs each stored line item with the payload's line (same listing / SKU / barcode, else the same position). */
function matchLines(items: any[], lines: LineMoney[]): Array<LineMoney | null> {
  const used = new Set<number>();
  return items.map((i, idx) => {
    const keys = [i.listingRef, i.sku].filter(Boolean).map(String);
    let k = lines.findIndex((l, j) => !used.has(j) && l.key !== null && keys.includes(l.key));
    if (k < 0 && lines.length === items.length && !used.has(idx)) k = idx;
    if (k < 0) return null;
    used.add(k);
    return lines[k];
  });
}

function viewOrder(o: any, ctx: ViewCtx) {
  const state = classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt);
  const named = ctx.name(o.marketplace);
  const canonical = named.marketplace;
  const etsy = canonical === 'etsy' ? ctx.etsy.get(String(o.orderNumber)) ?? null : null;
  const total = money(o.totalPrice);
  const m = orderMoney(canonical, o.rawData, o.currency ?? null, total);
  const paired = matchLines(o.items ?? [], m.lines);
  const items = (o.items ?? []).map((i: any, idx: number) => {
    const line = paired[idx];
    const listingId = canonical === 'etsy' ? (i.listingRef ?? line?.key ?? null) : null;
    const priceKey = canonical === 'etsy' ? listingId : (canonical === 'trendyol' ? (line?.key ?? i.sku) : i.sku);
    const base = {
      title: i.productName ?? null, sku: i.sku ?? null, variant: i.variantInfo ?? null, quantity: i.quantity,
      unitPricePaid: line?.unitPricePaid ?? money(i.unitPrice),
    };
    if (!ctx.detail) return base;
    return {
      ...base,
      ...(line?.unitPriceBeforeDiscount != null ? { unitPriceBeforeDiscount: line.unitPriceBeforeDiscount } : {}),
      ...(line?.lineDiscount ? { lineDiscount: line.lineDiscount } : {}),
      ...(line?.couponOnLine ? { couponOnLine: line.couponOnLine } : {}),
      ...(line?.promotions?.length ? { promotions: line.promotions } : {}),
      ...(line?.vatRatePercent != null ? { vatRatePercent: line.vatRatePercent } : {}),
      ...(listingId ? { listingId: String(listingId) } : {}),
      listingPriceNow: (priceKey && ctx.prices?.get(`${canonical}:${priceKey}`)) || null,
    };
  });
  const view: Record<string, unknown> = {
    id: o.id, orderNumber: o.orderNumber, ...named, state, marketplaceStatus: o.status ?? null,
    orderedAt: (o.uiOrderDate ?? o.createdAt)?.toISOString?.() ?? null, shipBy: o.shipByAt?.toISOString?.() ?? null,
    shippedAt: o.shippedAt?.toISOString?.() ?? null, trackingNumber: o.trackingNumber ?? null,
    total, currency: o.currency ?? null, shipToCountry: shipToCountry(o, canonical, etsy),
    money: ctx.detail ? m.breakdown : compactMoney(m.breakdown),
    items,
  };
  if (ctx.buyer) {
    const b = buyerView(o, canonical, etsy);
    if (b) view.buyer = b;
  }
  return view;
}

/** Current listing prices for the order lines (seller's own listings only), keyed `marketplace:key`. */
async function currentPrices(userId: string, orders: any[], name: Namer) {
  const out = new Map<string, { amount: number | null; currency: string | null }>();
  const etsyIds = new Set<string>();
  const ebaySkus = new Set<string>();
  const tyKeys = new Set<string>();
  for (const o of orders) {
    const mp = name(o.marketplace).marketplace;
    const m = orderMoney(mp, o.rawData, o.currency ?? null, null);
    for (const [idx, i] of (o.items ?? []).entries()) {
      const line = matchLines(o.items, m.lines)[idx];
      if (mp === 'etsy') { const id = i.listingRef ?? line?.key; if (id && /^\d{1,20}$/.test(String(id))) etsyIds.add(String(id)); }
      if (mp === 'ebay' && i.sku) ebaySkus.add(String(i.sku));
      if (mp === 'trendyol') { const k = line?.key ?? i.sku; if (k) tyKeys.add(String(k)); }
    }
  }
  const [etsy, ebay, ty] = await Promise.all([
    etsyIds.size ? prisma.etsyListing.findMany({ where: { etsyListingId: { in: Array.from(etsyIds).map((x) => BigInt(x)) }, etsyShop: { userId } }, select: { etsyListingId: true, priceAmount: true, priceDivisor: true, priceCurrencyCode: true } }) : [],
    ebaySkus.size ? prisma.ebayListing.findMany({ where: { userId, sku: { in: Array.from(ebaySkus) } }, select: { sku: true, priceValue: true, priceCurrency: true } }) : [],
    tyKeys.size ? prisma.trendyolProduct.findMany({ where: { userId, barcode: { in: Array.from(tyKeys) } }, select: { barcode: true, salePrice: true, currencyType: true } }) : [],
  ]);
  for (const l of etsy) out.set(`etsy:${l.etsyListingId}`, { amount: money(l.priceDivisor ? l.priceAmount / l.priceDivisor : l.priceAmount), currency: l.priceCurrencyCode });
  for (const l of ebay) out.set(`ebay:${l.sku}`, { amount: money(l.priceValue), currency: l.priceCurrency });
  for (const l of ty) out.set(`trendyol:${l.barcode}`, { amount: money(l.salePrice), currency: l.currencyType });
  return out;
}

function sinceDays(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

async function etsyShopIds(userId: string): Promise<string[]> {
  return (await prisma.etsyShop.findMany({ where: { userId, isActive: true }, select: { shopId: true } })).map((s) => s.shopId);
}

// ── Tools ──────────────────────────────────────────────────────────────────────────────────────

const getStoreOverview: McpTool = {
  name: 'get_store_overview',
  title: 'Store overview',
  description: 'Snapshot of the seller\'s KolayXport account: listing counts per marketplace; orders in the last 7 and 30 days (per marketplace and per ship-to country), how many wait to ship and how many are late; the 5 newest orders; when each marketplace\'s financial records were last synced. Money totals: sales_summary (order value) and finance_summary (fees, profit, payouts, balance).',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(auth) {
    const userId = auth.userId;
    const shops = await etsyShopIds(userId);
    const [etsy, ebay, trendyol, wix, shopify, orders30, open, cursors] = await Promise.all([
      shops.length ? prisma.etsyListing.count({ where: { etsyShopId: { in: shops } } }) : 0,
      prisma.ebayListing.count({ where: { userId } }),
      prisma.trendyolProduct.count({ where: { userId } }),
      prisma.wixProduct.count({ where: { userId } }),
      prisma.shopifyProduct.count({ where: { userId } }),
      prisma.order.findMany({ where: { userId, createdAt: { gte: sinceDays(30) } }, select: { orderNumber: true, createdAt: true, uiOrderDate: true, marketplace: true, status: true, externalStatus: true, deliveredAt: true, shippingAddress: true, shipping: { select: { countryCode: true } } } }),
      prisma.order.findMany({ where: { userId, shippedAt: null, cancelledAt: null, createdAt: { gte: sinceDays(60) } }, select: { status: true, externalStatus: true, deliveredAt: true, shipByAt: true } }),
      prisma.financialSyncCursor.findMany({ where: { userId }, select: { marketplace: true, updatedAt: true } }),
    ]);
    const week = sinceDays(7).getTime();
    const waiting = open.filter((o) => classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt) === 'open');
    const name = await marketplaceNamer(userId);
    const byMarketplace: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    const etsyAddr = await etsyContext(userId, orders30, name);
    for (const o of orders30) {
      const m = name(o.marketplace).marketplace;
      byMarketplace[m] = (byMarketplace[m] ?? 0) + 1;
      const c = shipToCountry(o, m, m === 'etsy' ? etsyAddr.get(o.orderNumber) : null) ?? 'unknown';
      byCountry[c] = (byCountry[c] ?? 0) + 1;
    }
    const recent = await prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, select: ORDER_SELECT });
    const recentCtx: ViewCtx = { name, etsy: await etsyContext(userId, recent, name), buyer: canSeeBuyer(auth), detail: false };
    return {
      listings: { etsy, ebay, trendyol, wix, shopify },
      orders: {
        last7Days: orders30.filter((o) => (o.uiOrderDate ?? o.createdAt).getTime() >= week).length,
        last30Days: orders30.length,
        last30DaysByMarketplace: byMarketplace,
        waitingToShip: waiting.length,
        late: waiting.filter((o) => o.shipByAt && o.shipByAt.getTime() < Date.now()).length,
        last30DaysByShipToCountry: byCountry,
      },
      recentOrders: recent.map((o) => viewOrder(o, recentCtx)),
      finance: { lastSyncedAt: Object.fromEntries(cursors.map((c) => [c.marketplace, c.updatedAt.toISOString()])), tool: 'finance_summary' },
      appUrl: mcpBaseUrl(),
    };
  },
};

const listOrders: McpTool = {
  name: 'list_orders',
  title: 'List orders',
  description: 'The seller\'s orders, newest first (up to 100), filtered by state (open = waiting to ship, shipped, delivered, cancelled), marketplace and age. Each order: number, marketplace and shop, state, dates, tracking, ship-to country, a money summary (items subtotal, discount, shipping, tax, total, currency) and items with the unit price paid. Buyer name and shipping address only if the seller allowed them for this connection (never Amazon); e-mail and phone are never included. Full breakdown of one order: get_order.',
  scope: 'read', readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['open', 'shipped', 'delivered', 'cancelled', 'all'], description: 'Default: all' },
      marketplace: { type: 'string', description: 'e.g. etsy, ebay, amazon, trendyol, shopify, wix' },
      days: { type: 'integer', minimum: 1, maximum: 365, description: 'Orders from the last N days (default 30)' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25' },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const state = ['open', 'shipped', 'delivered', 'cancelled'].includes(a.state) ? a.state : 'all';
    const limit = int(a.limit, 25, 1, 100);
    const where: Record<string, unknown> = { userId: auth.userId, createdAt: { gte: sinceDays(int(a.days, 30, 1, 365)) } };
    const mp = str(a.marketplace, 40);
    if (mp) Object.assign(where, await orderMarketplaceWhere(auth.userId, mp));
    if (state === 'open') Object.assign(where, { shippedAt: null, cancelledAt: null });
    const rows = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: state === 'all' ? limit : Math.min(400, limit * 4), select: ORDER_SELECT });
    const name = await marketplaceNamer(auth.userId);
    const live = rows.filter((o) => state === 'all' || classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt) === state).slice(0, limit);
    const ctx: ViewCtx = { name, etsy: await etsyContext(auth.userId, live, name), buyer: canSeeBuyer(auth), detail: false };
    const orders = live.map((o) => viewOrder(o, ctx));
    return { count: orders.length, buyerDetails: ctx.buyer ? BUYER_NOTE_ON : BUYER_NOTE_OFF, orders };
  },
};

const getOrder: McpTool = {
  name: 'get_order',
  title: 'Get one order',
  description: 'One order by its KolayXport id or marketplace order number: state, dates, tracking, ship-to country, and the money breakdown the marketplace reported (items subtotal, discount / coupon / promotions, shipping, tax or VAT, gift wrap, total, eBay fees) with, per item, the unit price paid, any line discount and the listing\'s current price. Fields the marketplace did not report are null. Buyer name and shipping address only if the seller allowed them for this connection (never Amazon); e-mail and phone are never included.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, orderNumber: { type: 'string' } }, additionalProperties: false },
  async run(auth, a) {
    const id = str(a.id, 60);
    const orderNumber = str(a.orderNumber, 80).replace(/^#/, '');
    if (!id && !orderNumber) throw new ToolError('Give id or orderNumber');
    const o = await prisma.order.findFirst({ where: { userId: auth.userId, ...(id ? { id } : { orderNumber }) }, select: ORDER_SELECT });
    if (!o) throw new ToolError('Order not found');
    const name = await marketplaceNamer(auth.userId);
    const [etsy, prices] = await Promise.all([etsyContext(auth.userId, [o], name), currentPrices(auth.userId, [o], name)]);
    const ctx: ViewCtx = { name, etsy, buyer: canSeeBuyer(auth), detail: true, prices };
    return { ...viewOrder(o, ctx), buyerDetails: ctx.buyer ? BUYER_NOTE_ON : BUYER_NOTE_OFF };
  },
};

const listListingsTool: McpTool = {
  name: 'list_listings',
  title: 'List listings',
  description: 'The seller\'s listings on one marketplace (etsy, ebay, trendyol, wix, shopify, hepsiburada) from KolayXport\'s synced copy, 50 per page: id, title, price, stock, status, link, health. Optional title search. Sales per item: sales_summary.',
  scope: 'read', readOnly: true,
  inputSchema: {
    type: 'object',
    required: ['marketplace'],
    properties: {
      marketplace: { type: 'string', enum: MARKETPLACES },
      search: { type: 'string', description: 'Words in the title' },
      page: { type: 'integer', minimum: 1, description: 'Pages of 50' },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const marketplace = marketplaceArg(a.marketplace, true) as ListingMarketplace;
    const parsed = parseListingsQuery({ marketplace, page: String(int(a.page, 1, 1, 1000)), size: '50', ...(str(a.search) ? { q: str(a.search) } : {}) });
    if (!parsed.ok) throw new ToolError(parsed.message ?? 'Bad query');
    const body = await listListings(prisma, ADAPTERS[marketplace], auth.userId, parsed.query);
    return {
      marketplace, total: body.total, page: parsed.query.page,
      listings: body.rows.map((r) => ({ id: r.id, title: r.title, price: r.price, quantity: r.qty, status: r.status, url: r.externalUrl, health: r.health ?? null })),
    };
  },
};

async function listingDetail(userId: string, marketplace: ListingMarketplace, id: string) {
  if (marketplace === 'etsy') {
    if (!/^\d{1,20}$/.test(id)) throw new ToolError('Etsy listing id must be a number');
    const l = await prisma.etsyListing.findFirst({ where: { etsyListingId: BigInt(id), etsyShop: { userId } } });
    if (!l) return null;
    return {
      id, title: l.title, description: l.description, tags: l.tags, materials: l.materials, quantity: l.quantity, state: l.state, url: l.url,
      price: { amount: l.priceDivisor ? l.priceAmount / l.priceDivisor : l.priceAmount, currency: l.priceCurrencyCode },
      views: l.views, favorites: l.numFavorers, shopId: l.etsyShopId, photoCount: l.imageCount, hasVideo: l.hasVideo,
    };
  }
  if (marketplace === 'ebay') {
    const l = await prisma.ebayListing.findFirst({ where: { userId, sku: id } });
    if (!l) return null;
    return { id, title: l.title, description: l.description, price: { amount: money(l.priceValue), currency: l.priceCurrency }, quantity: l.quantity, status: l.status, condition: l.condition, category: l.categoryName, photos: l.imageUrls, marketplaceId: l.marketplaceId };
  }
  if (marketplace === 'trendyol') {
    const l = await prisma.trendyolProduct.findFirst({ where: { userId, barcode: id } });
    if (!l) return null;
    return { id, title: l.title, description: l.description, brand: l.brandName, category: l.categoryName, price: { sale: money(l.salePrice), list: money(l.listPrice), currency: l.currencyType }, quantity: l.quantity, onSale: l.onSale, approved: l.approved };
  }
  if (marketplace === 'wix') {
    const l = await prisma.wixProduct.findFirst({ where: { userId, wixProductId: id } });
    if (!l) return null;
    return { id, title: l.title, description: l.description, price: { amount: money(l.price), discounted: money(l.discountPrice), currency: l.currency }, quantity: l.quantity, inStock: l.inStock, visible: l.visible, sku: l.sku };
  }
  if (marketplace === 'hepsiburada') {
    // Title, description and images belong to Hepsiburada's catalog (read-only here).
    const l = await prisma.hepsiburadaListing.findFirst({ where: { userId, OR: [{ hbSku: id }, { merchantSku: id }] } });
    if (!l) return null;
    return {
      id: l.hbSku, merchantSku: l.merchantSku, title: l.title, brand: l.brand, barcode: l.barcode, category: l.categoryName,
      price: { amount: money(l.price), currency: 'TRY' }, quantity: l.availableStock, dispatchTimeDays: l.dispatchTime,
      salable: l.isSalable, suspended: l.isSuspended, locked: l.isLocked, fulfilledByHepsiburada: l.isFulfilledByHB,
    };
  }
  const l = await prisma.shopifyProduct.findFirst({ where: { userId, shopifyProductId: id } });
  if (!l) return null;
  return { id, title: l.title, description: l.description, vendor: l.vendor, productType: l.productType, status: l.status, tags: l.tags, price: { amount: money(l.price), compareAt: money(l.compareAtPrice), currency: l.currency }, inventory: l.totalInventory, seoTitle: l.seoTitle, seoDescription: l.seoDescription };
}

const getListing: McpTool = {
  name: 'get_listing',
  title: 'Get one listing',
  description: 'Full details of one listing (title, description, tags, price, stock, status). id = Etsy listing id, eBay SKU, Trendyol barcode, Hepsiburada SKU, Wix or Shopify product id (as list_listings returns it). From KolayXport\'s synced copy.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', required: ['marketplace', 'id'], properties: { marketplace: { type: 'string', enum: MARKETPLACES }, id: { type: 'string' } }, additionalProperties: false },
  async run(auth, a) {
    const marketplace = marketplaceArg(a.marketplace, true) as ListingMarketplace;
    const d = await listingDetail(auth.userId, marketplace, str(a.id, 120));
    if (!d) throw new ToolError('Listing not found');
    return { marketplace, ...d };
  },
};

const lowStock: McpTool = {
  name: 'low_stock',
  title: 'Low stock',
  description: 'Listings at or below a stock level (default 2) across Etsy (active listings), eBay, Trendyol, Wix and Shopify, lowest first, from KolayXport\'s synced copy.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: { atMost: { type: 'integer', minimum: 0, maximum: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
  async run(auth, a) {
    const atMost = int(a.atMost, 2, 0, 1000);
    const take = int(a.limit, 50, 1, 200);
    const userId = auth.userId;
    const shops = await etsyShopIds(userId);
    const [etsy, ebay, trendyol, wix, shopify] = await Promise.all([
      shops.length ? prisma.etsyListing.findMany({ where: { etsyShopId: { in: shops }, state: 'active', quantity: { lte: atMost } }, select: { etsyListingId: true, title: true, quantity: true }, take }) : [],
      prisma.ebayListing.findMany({ where: { userId, quantity: { lte: atMost } }, select: { sku: true, title: true, quantity: true }, take }),
      prisma.trendyolProduct.findMany({ where: { userId, archived: false, quantity: { lte: atMost } }, select: { barcode: true, title: true, quantity: true }, take }),
      prisma.wixProduct.findMany({ where: { userId, trackInventory: true, quantity: { lte: atMost } }, select: { wixProductId: true, title: true, quantity: true }, take }),
      prisma.shopifyProduct.findMany({ where: { userId, trackInventory: true, totalInventory: { lte: atMost } }, select: { shopifyProductId: true, title: true, totalInventory: true }, take }),
    ]);
    const rows = [
      ...etsy.map((l) => ({ marketplace: 'etsy', id: String(l.etsyListingId), title: l.title, quantity: l.quantity })),
      ...ebay.map((l) => ({ marketplace: 'ebay', id: l.sku, title: l.title, quantity: l.quantity })),
      ...trendyol.map((l) => ({ marketplace: 'trendyol', id: l.barcode, title: l.title, quantity: l.quantity })),
      ...wix.map((l) => ({ marketplace: 'wix', id: l.wixProductId, title: l.title, quantity: l.quantity })),
      ...shopify.map((l) => ({ marketplace: 'shopify', id: l.shopifyProductId, title: l.title, quantity: l.totalInventory })),
    ].sort((x, y) => x.quantity - y.quantity).slice(0, take);
    return { atMost, count: rows.length, listings: rows };
  },
};

const salesSummary: McpTool = {
  name: 'sales_summary',
  title: 'Sales summary',
  description: 'Order count and gross order value (what buyers paid, incl. shipping and tax) per marketplace and currency for the last N days (default 30, max 365), cancelled orders excluded, plus the 10 best-selling items by quantity. Not net of fees or refunds: fees, payouts, balance and profit are in finance_summary.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
  async run(auth, a) {
    const days = int(a.days, 30, 1, 365);
    const rows = await prisma.order.findMany({
      where: { userId: auth.userId, createdAt: { gte: sinceDays(days) }, cancelledAt: null },
      select: { marketplace: true, currency: true, totalPrice: true, status: true, externalStatus: true, deliveredAt: true, items: { select: { productName: true, sku: true, quantity: true } } },
    });
    const name = await marketplaceNamer(auth.userId);
    const live = rows.filter((o) => classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt) !== 'cancelled');
    const totals: Record<string, { orders: number; value: Record<string, number> }> = {};
    const items = new Map<string, { name: string; sku: string | null; quantity: number }>();
    for (const o of live) {
      const t = (totals[name(o.marketplace).marketplace] ??= { orders: 0, value: {} });
      t.orders += 1;
      const cur = o.currency || '?';
      t.value[cur] = Math.round(((t.value[cur] ?? 0) + (Number(o.totalPrice) || 0)) * 100) / 100;
      for (const i of o.items) {
        const key = i.sku || i.productName || '?';
        const it = items.get(key) ?? { name: i.productName ?? key, sku: i.sku ?? null, quantity: 0 };
        it.quantity += i.quantity || 0;
        items.set(key, it);
      }
    }
    return {
      days,
      basis: 'Gross order value as the buyer paid it (order totals incl. shipping and tax as the marketplace reports them), by order date, per marketplace and currency (currencies are never added together). Cancelled orders excluded. Not net of fees or refunds: use finance_summary for fees, payouts, balance and profit.',
      orders: live.length, byMarketplace: totals, topItems: Array.from(items.values()).sort((x, y) => y.quantity - x.quantity).slice(0, 10),
    };
  },
};

export const MCP_TOOLS: McpTool[] = [getStoreOverview, listOrders, getOrder, listListingsTool, getListing, lowStock, salesSummary, ...FINANCE_TOOLS, ...LISTING_TOOLS];

/** How many orders in a tool result carry buyer details (for the call log: a count, never the data). */
export function buyerRecordCount(result: unknown): number {
  let n = 0;
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    if (o.buyer && typeof o.buyer === 'object') n += 1;
    for (const [k, x] of Object.entries(o)) if (k !== 'buyer') walk(x, depth + 1);
  };
  walk(result, 0);
  return n;
}

/** AI image generation can be switched off server-wide (MCP_DISABLE_IMAGE_TOOL=1): Claude's Connectors Directory does
 * not accept connectors that generate images through AI models. */
export function activeTools(): McpTool[] {
  const off = /^(1|true|yes)$/i.test(process.env.MCP_DISABLE_IMAGE_TOOL || '');
  return off ? MCP_TOOLS.filter((t) => t.name !== 'generate_product_image') : MCP_TOOLS;
}

export function toolsFor(scopes: McpScope[]): McpTool[] {
  return activeTools().filter((t) => scopes.includes(t.scope));
}

/** tools/list entries: name, title, description, inputSchema and the MCP annotations (title, readOnlyHint,
 * destructiveHint, idempotentHint, openWorldHint) the Connectors Directory requires on every tool. */
export function listedTools(scopes: McpScope[]) {
  return toolsFor(scopes).map((t) => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.idempotent ?? t.readOnly, openWorldHint: t.openWorld ?? false },
    // OpenAI Apps SDK: per-tool auth declaration (every tool needs the seller's OAuth connection).
    securitySchemes: [{ type: 'oauth2', scopes: [t.scope] }],
  }));
}
