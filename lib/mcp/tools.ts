// lib/mcp/tools.ts — what a seller's own AI (Claude, ChatGPT, Cursor …) can do with their KolayXport shop over MCP.
// SERVER ONLY. Founder 2026-10-17: "users can connect their AI to their shop (must be multitenant safe)".
//
// Rules every tool follows:
//  - Tenant: the userId comes ONLY from the connection (lib/mcp/tokens), never from the arguments; every query filters
//    by it (Etsy listings through the seller's own EtsyShop rows).
//  - No buyer personal data leaves to the AI provider: no names, addresses, e-mails or phones (Amazon's data rules
//    forbid it, and the seller's buyers never agreed to it). Orders carry country only.
//  - Writes are staged drafts only (scope 'write'): nothing changes on a marketplace until the seller reviews and sends
//    it in KolayXport — the same rule as every editor.
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
import { sanitizeEtsyBatchFields } from '@/lib/bulk/batchStage';
import { assertShopOwnership, getEtsyAccessToken, upsertDraftPatch as stageEtsy } from '@/lib/etsy/draftService';
import { upsertDraftPatch as stageEbay } from '@/lib/ebay/draftService';
import { mcpBaseUrl, type McpAuth, type McpScope } from './tokens';

const ADAPTERS: Record<ListingMarketplace, ListingsAdapter> = { etsy: etsyAdapter, ebay: ebayAdapter, trendyol: trendyolAdapter, wix: wixAdapter, shopify: shopifyAdapter, hepsiburada: hepsiburadaAdapter };
const MARKETPLACES = Object.keys(ADAPTERS) as ListingMarketplace[];

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

type JsonSchema = Record<string, unknown>;
export type McpTool = {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  readOnly: boolean;
  inputSchema: JsonSchema;
  run: (auth: McpAuth, args: Record<string, any>) => Promise<unknown>;
};

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

/** Only the buyer's country leaves (no name, street, city, e-mail or phone). */
function countryOf(addr: unknown): string | null {
  const a = (addr && typeof addr === 'object' ? addr : {}) as Record<string, unknown>;
  const c = a.countryCode ?? a.country_code ?? a.country ?? a.countryName;
  return typeof c === 'string' && c.trim() ? c.trim().slice(0, 40) : null;
}

const ORDER_SELECT = {
  id: true, orderNumber: true, marketplace: true, status: true, externalStatus: true, totalPrice: true, currency: true,
  createdAt: true, uiOrderDate: true, shipByAt: true, shippedAt: true, deliveredAt: true, cancelledAt: true, trackingNumber: true,
  shippingAddress: true,
  items: { select: { productName: true, sku: true, variantInfo: true, quantity: true, unitPrice: true } },
} as const;

function viewOrder(o: any) {
  const state = classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt);
  return {
    id: o.id, orderNumber: o.orderNumber, marketplace: o.marketplace, state, marketplaceStatus: o.status ?? null,
    orderedAt: (o.uiOrderDate ?? o.createdAt)?.toISOString?.() ?? null, shipBy: o.shipByAt?.toISOString?.() ?? null,
    shippedAt: o.shippedAt?.toISOString?.() ?? null, trackingNumber: o.trackingNumber ?? null,
    total: money(o.totalPrice), currency: o.currency ?? null, shipToCountry: countryOf(o.shippingAddress),
    items: (o.items ?? []).map((i: any) => ({ name: i.productName ?? null, sku: i.sku ?? null, variant: i.variantInfo ?? null, quantity: i.quantity, unitPrice: money(i.unitPrice) })),
  };
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
  description: 'The seller\'s connected marketplaces, listing counts per marketplace, and orders in the last 7 and 30 days, including how many are waiting to ship and how many are late. Start here.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(auth) {
    const userId = auth.userId;
    const shops = await etsyShopIds(userId);
    const [etsy, ebay, trendyol, wix, shopify, orders30, open] = await Promise.all([
      shops.length ? prisma.etsyListing.count({ where: { etsyShopId: { in: shops } } }) : 0,
      prisma.ebayListing.count({ where: { userId } }),
      prisma.trendyolProduct.count({ where: { userId } }),
      prisma.wixProduct.count({ where: { userId } }),
      prisma.shopifyProduct.count({ where: { userId } }),
      prisma.order.findMany({ where: { userId, createdAt: { gte: sinceDays(30) } }, select: { createdAt: true, uiOrderDate: true, marketplace: true, status: true, externalStatus: true, deliveredAt: true } }),
      prisma.order.findMany({ where: { userId, shippedAt: null, cancelledAt: null, createdAt: { gte: sinceDays(60) } }, select: { status: true, externalStatus: true, deliveredAt: true, shipByAt: true } }),
    ]);
    const week = sinceDays(7).getTime();
    const waiting = open.filter((o) => classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt) === 'open');
    const byMarketplace: Record<string, number> = {};
    for (const o of orders30) byMarketplace[o.marketplace] = (byMarketplace[o.marketplace] ?? 0) + 1;
    return {
      listings: { etsy, ebay, trendyol, wix, shopify },
      orders: {
        last7Days: orders30.filter((o) => (o.uiOrderDate ?? o.createdAt).getTime() >= week).length,
        last30Days: orders30.length,
        last30DaysByMarketplace: byMarketplace,
        waitingToShip: waiting.length,
        late: waiting.filter((o) => o.shipByAt && o.shipByAt.getTime() < Date.now()).length,
      },
      appUrl: mcpBaseUrl(),
    };
  },
};

const listOrders: McpTool = {
  name: 'list_orders',
  title: 'List orders',
  description: 'The seller\'s orders, newest first. Filter by state (open = waiting to ship, shipped, delivered, cancelled), marketplace and age. Buyer names and addresses are never included (country only).',
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
    if (mp) where.marketplace = { equals: mp, mode: 'insensitive' };
    if (state === 'open') Object.assign(where, { shippedAt: null, cancelledAt: null });
    const rows = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: state === 'all' ? limit : Math.min(400, limit * 4), select: ORDER_SELECT });
    const orders = rows.map(viewOrder).filter((o) => state === 'all' || o.state === state).slice(0, limit);
    return { count: orders.length, orders };
  },
};

const getOrder: McpTool = {
  name: 'get_order',
  title: 'Get one order',
  description: 'One order by its KolayXport id or its marketplace order number: items, totals, state, ship-by date and tracking. No buyer personal data.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, orderNumber: { type: 'string' } }, additionalProperties: false },
  async run(auth, a) {
    const id = str(a.id, 60);
    const orderNumber = str(a.orderNumber, 80).replace(/^#/, '');
    if (!id && !orderNumber) throw new ToolError('Give id or orderNumber');
    const o = await prisma.order.findFirst({ where: { userId: auth.userId, ...(id ? { id } : { orderNumber }) }, select: ORDER_SELECT });
    if (!o) throw new ToolError('Order not found');
    return viewOrder(o);
  },
};

const listListingsTool: McpTool = {
  name: 'list_listings',
  title: 'List listings',
  description: 'The seller\'s listings on one marketplace (etsy, ebay, trendyol, wix, shopify) from KolayXport\'s synced copy: id, title, price, stock, status, link. Optional text search.',
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
  const l = await prisma.shopifyProduct.findFirst({ where: { userId, shopifyProductId: id } });
  if (!l) return null;
  return { id, title: l.title, description: l.description, vendor: l.vendor, productType: l.productType, status: l.status, tags: l.tags, price: { amount: money(l.price), compareAt: money(l.compareAtPrice), currency: l.currency }, inventory: l.totalInventory, seoTitle: l.seoTitle, seoDescription: l.seoDescription };
}

const getListing: McpTool = {
  name: 'get_listing',
  title: 'Get one listing',
  description: 'Full details of one listing (title, description, tags, price, stock, status). id = Etsy listing id, eBay SKU, Trendyol barcode, Wix or Shopify product id (as list_listings returns it).',
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
  description: 'Listings at or below a stock level across all marketplaces (default 2), lowest first.',
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
  description: 'Orders and order value per marketplace and currency for the last N days (cancelled orders excluded), plus the top-selling items by quantity.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
  async run(auth, a) {
    const days = int(a.days, 30, 1, 365);
    const rows = await prisma.order.findMany({
      where: { userId: auth.userId, createdAt: { gte: sinceDays(days) }, cancelledAt: null },
      select: { marketplace: true, currency: true, totalPrice: true, status: true, externalStatus: true, deliveredAt: true, items: { select: { productName: true, sku: true, quantity: true } } },
    });
    const live = rows.filter((o) => classifyOrderStatus(o.status, o.externalStatus, o.deliveredAt) !== 'cancelled');
    const totals: Record<string, { orders: number; value: Record<string, number> }> = {};
    const items = new Map<string, { name: string; sku: string | null; quantity: number }>();
    for (const o of live) {
      const t = (totals[o.marketplace] ??= { orders: 0, value: {} });
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
    return { days, orders: live.length, byMarketplace: totals, topItems: Array.from(items.values()).sort((x, y) => y.quantity - x.quantity).slice(0, 10) };
  },
};

const stageListingChanges: McpTool = {
  name: 'stage_listing_changes',
  title: 'Stage listing changes',
  description: 'Prepares changes to an Etsy or eBay listing as a KolayXport draft — title, description, tags (Etsy, up to 13, 20 characters each), price (Etsy). NOTHING changes on the marketplace: the seller reviews the draft and sends it from KolayXport. Returns the link to review it.',
  scope: 'write', readOnly: false,
  inputSchema: {
    type: 'object',
    required: ['marketplace', 'id'],
    properties: {
      marketplace: { type: 'string', enum: ['etsy', 'ebay'] },
      id: { type: 'string', description: 'Etsy listing id or eBay SKU' },
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Etsy only' },
      price: { type: 'number', description: 'Etsy only, in the listing currency' },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const marketplace = str(a.marketplace, 10);
    const id = str(a.id, 120);
    const title = typeof a.title === 'string' ? a.title.trim().slice(0, 140) : undefined;
    const description = typeof a.description === 'string' ? a.description.slice(0, 50_000) : undefined;
    if (marketplace === 'etsy') {
      if (!/^\d{1,20}$/.test(id)) throw new ToolError('Etsy listing id must be a number');
      const listing = await prisma.etsyListing.findFirst({ where: { etsyListingId: BigInt(id), etsyShop: { userId: auth.userId } }, select: { etsyShopId: true } });
      if (!listing) throw new ToolError('Listing not found');
      await assertShopOwnership(auth.userId, listing.etsyShopId);
      const raw: Record<string, unknown> = {};
      if (title !== undefined) raw.title = title;
      if (description !== undefined) raw.description = description;
      if (Array.isArray(a.tags)) raw.tags = a.tags.map((x: unknown) => String(x));
      if (a.price !== undefined) raw.price = a.price;
      const { fields, rejected } = sanitizeEtsyBatchFields(raw);
      if (!Object.keys(fields).length) throw new ToolError(rejected.length ? `Nothing valid to stage: ${rejected.map((r) => r.field ?? r.key).join(', ')}` : 'Give at least one of title, description, tags, price');
      const token = await getEtsyAccessToken(listing.etsyShopId, auth.userId).catch(() => undefined);
      await stageEtsy({ userId: auth.userId, shopId: listing.etsyShopId, listingId: id, fields, ...(token ? { accessToken: token } : {}) });
      return { staged: true, marketplace, id, fields: Object.keys(fields), skipped: rejected.map((r) => r.field ?? r.key), reviewUrl: `${mcpBaseUrl()}/app/etsy-listings/${id}?shop=${encodeURIComponent(listing.etsyShopId)}`, note: 'Nothing changed on Etsy yet: the seller reviews and sends the draft in KolayXport.' };
    }
    if (marketplace === 'ebay') {
      const listing = await prisma.ebayListing.findFirst({ where: { userId: auth.userId, sku: id }, select: { sku: true, marketplaceId: true, offerId: true } });
      if (!listing) throw new ToolError('Listing not found');
      const product: Record<string, unknown> = {};
      if (title !== undefined) product.title = title.slice(0, 80);
      if (description !== undefined) product.description = description;
      if (!Object.keys(product).length) throw new ToolError('For eBay give title and/or description');
      await stageEbay({ userId: auth.userId, sku: listing.sku, marketplaceId: listing.marketplaceId, ...(listing.offerId ? { offerId: listing.offerId } : {}), inventoryFields: { product } });
      return { staged: true, marketplace, id, fields: Object.keys(product), reviewUrl: `${mcpBaseUrl()}/app/ebay-listings/${encodeURIComponent(id)}`, note: 'Nothing changed on eBay yet: the seller reviews and sends the draft in KolayXport.' };
    }
    throw new ToolError('Staging is available for etsy and ebay');
  },
};

export const MCP_TOOLS: McpTool[] = [getStoreOverview, listOrders, getOrder, listListingsTool, getListing, lowStock, salesSummary, stageListingChanges];

export function toolsFor(scopes: McpScope[]): McpTool[] {
  return MCP_TOOLS.filter((t) => scopes.includes(t.scope));
}
