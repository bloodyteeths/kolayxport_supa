// MCP orders + finance (fix/mcp-orders-finance): ship-to country from the extension's Etsy addresses, the order money
// breakdown, finance_summary, the opt-in orders:buyer scope, tenant scoping and the tools/list annotations.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  orders: [] as Row[],
  etsyAddresses: [] as Row[],
  etsyShops: [] as Row[],
  etsyListings: [] as Row[],
  ebayListings: [] as Row[],
  trendyolProducts: [] as Row[],
  tx: [] as Row[],
  cursors: [] as Row[],
  calls: [] as Array<{ model: string; where: any }>,
  financials: true,
}));

/** Rows owned by the user the `where` names (the fake refuses a query without a user filter). */
function owned(model: string, rows: Row[], where: any = {}): Row[] {
  h.calls.push({ model, where });
  const userId = where.userId ?? where.etsyShop?.userId;
  if (!userId) throw new Error(`${model}: query without a user filter`);
  return rows.filter((r) => r.userId === userId);
}
const inList = (v: any, cond: any) => (cond?.in ? cond.in.map(String).includes(String(v)) : true);

vi.mock('@/lib/prisma', () => ({
  default: {
    order: {
      findMany: async ({ where, take }: any) => owned('order', h.orders, where)
        .filter((o) => !where.OR || where.OR.some((c: any) => c.marketplace && String(o.marketplace).toLowerCase() === String(c.marketplace.equals).toLowerCase()))
        .slice(0, take ?? 1000),
      findFirst: async ({ where }: any) => owned('order', h.orders, where).find((o) => (where.id ? o.id === where.id : o.orderNumber === where.orderNumber)) ?? null,
      count: async ({ where }: any) => owned('order', h.orders, where).length,
    },
    etsyAddress: { findMany: async ({ where }: any) => owned('etsyAddress', h.etsyAddresses, where).filter((r) => inList(r.orderNumber, where.orderNumber)) },
    etsyShop: { findMany: async ({ where }: any) => owned('etsyShop', h.etsyShops, where) },
    etsyListing: {
      findMany: async ({ where }: any) => {
        const shops = owned('etsyListing', h.etsyShops, where).map((s) => s.shopId);
        return h.etsyListings.filter((l) => shops.includes(l.etsyShopId) && inList(l.etsyListingId, where.etsyListingId));
      },
      count: async () => 0,
    },
    ebayListing: { findMany: async ({ where }: any) => owned('ebayListing', h.ebayListings, where).filter((l) => inList(l.sku, where.sku)), count: async () => 0 },
    trendyolProduct: { findMany: async ({ where }: any) => owned('trendyolProduct', h.trendyolProducts, where).filter((l) => inList(l.barcode, where.barcode)), count: async () => 0 },
    wixProduct: { count: async () => 0 },
    shopifyProduct: { count: async () => 0 },
    financialSyncCursor: {
      findMany: async ({ where }: any) => owned('financialSyncCursor', h.cursors, where),
      findUnique: async ({ where }: any) => {
        const k = where.userId_marketplace;
        h.calls.push({ model: 'financialSyncCursor', where: k });
        return h.cursors.find((c) => c.userId === k.userId && c.marketplace === k.marketplace) ?? null;
      },
    },
    financialTransaction: {
      findMany: async ({ where, distinct }: any) => {
        let rows = owned('financialTransaction', h.tx, where);
        if (where.marketplace) rows = rows.filter((r) => r.marketplace === where.marketplace);
        if (where.transactionType) rows = rows.filter((r) => r.transactionType === where.transactionType);
        if (where.transactionDate) rows = rows.filter((r) => r.transactionDate >= where.transactionDate.gte && r.transactionDate <= where.transactionDate.lte);
        if (distinct) return Array.from(new Set(rows.map((r) => r.marketplace))).map((marketplace) => ({ marketplace }));
        return rows;
      },
    },
    productCost: { findMany: async ({ where }: any) => owned('productCost', [], where) },
  },
}));
vi.mock('@/lib/billing/requireFeature', () => ({ hasFeature: async () => ({ allowed: h.financials, neutral: false }) }));
vi.mock('@/lib/finance/financialAutoSync', () => ({ refreshFinancialsIfStale: async () => undefined }));

import { MCP_TOOLS, buyerRecordCount, listedTools } from '@/lib/mcp/tools';
import { orderMoney } from '@/lib/mcp/orderData';
import { grantScopes, redirectUriRegistered } from '@/lib/mcp/tokens';

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const auth = (userId = 'u1', scopes: any[] = ['read']) => ({ userId, connectionId: 'c', scopes, name: 't' });
const call = (name: string, args: Record<string, unknown> = {}, a = auth()) => MCP_TOOLS.find((t) => t.name === name)!.run(a, args) as Promise<any>;
const cents = (n: number) => ({ amount: n, divisor: 100, currency_code: 'USD' });

const base = (o: Row): Row => ({
  status: 'paid', externalStatus: 'paid', createdAt: daysAgo(1), uiOrderDate: daysAgo(1), shipByAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null,
  trackingNumber: null, customerName: null, shipping: null, source: null, ...o,
});

function seed() {
  h.calls = [];
  h.financials = true;
  h.etsyShops = [{ userId: 'u1', shopId: '900', shopName: 'BelleCoutureGifts', isActive: true }, { userId: 'u2', shopId: '901', shopName: 'OtherShop', isActive: true }];
  h.etsyListings = [{ etsyShopId: '900', etsyListingId: 111n, priceAmount: 32900, priceDivisor: 100, priceCurrencyCode: 'USD' }, { etsyShopId: '901', etsyListingId: 222n, priceAmount: 100, priceDivisor: 100, priceCurrencyCode: 'USD' }];
  h.ebayListings = [{ userId: 'u1', sku: 'EB-1', priceValue: '60.00', priceCurrency: 'USD' }];
  h.trendyolProducts = [{ userId: 'u1', barcode: 'TY-BC', salePrice: 120, currencyType: 'TRY' }];
  h.orders = [
    base({
      id: 'o-etsy', userId: 'u1', marketplace: 'BelleCoutureGifts', orderNumber: '4206064918', source: 'etsy-api', currency: 'USD', totalPrice: 211.22,
      // Etsy withheld the address: the mapped to_address is empty, the receipt has no country_iso.
      shippingAddress: JSON.stringify({ name: '', street1: '', city: '', postal: '', country: '' }),
      rawData: {
        receipt_id: 4206064918, country_iso: null, total_price: cents(32900), subtotal: cents(19740), discount_amt: cents(13160),
        total_shipping_cost: cents(0), total_tax_cost: cents(1382), total_vat_cost: cents(0), gift_wrap_price: cents(0), grandtotal: cents(21122),
        transactions: [{ listing_id: 111, title: 'Keepsake Box', quantity: 1, price: cents(32900), shop_coupon: 0, buyer_coupon: 0 }],
      },
      items: [{ productName: 'Keepsake Box', sku: 'KB-1', variantInfo: null, quantity: 1, unitPrice: 329, listingRef: '111' }],
    }),
    base({
      id: 'o-ebay', userId: 'u1', marketplace: 'eBay', orderNumber: '13-1111-2222', source: 'ebay-api', currency: 'USD', totalPrice: 55,
      shippingAddress: { name: 'Bob Buyer', street1: '9 Elm St', city: 'Leeds', postal: 'LS1 1AA', country: 'GB', email: 'bob@example.com', phone: '+44 7000 000000' },
      rawData: {
        orderId: '13-1111-2222', totalMarketplaceFee: { value: '7.10', currency: 'USD' },
        pricingSummary: { priceSubtotal: { value: '60.00', currency: 'USD' }, priceDiscount: { value: '-10.00', currency: 'USD' }, deliveryCost: { value: '5.00', currency: 'USD' }, total: { value: '55.00', currency: 'USD' } },
        lineItems: [{ sku: 'EB-1', title: 'Mug', quantity: 2, lineItemCost: { value: '60.00' }, discountedLineItemCost: { value: '50.00' }, appliedPromotions: [{ description: '10 off', discountAmount: { value: '10.00' } }] }],
      },
      items: [{ productName: 'Mug', sku: 'EB-1', variantInfo: null, quantity: 2, unitPrice: 30, listingRef: null }],
    }),
    base({
      id: 'o-ty', userId: 'u1', marketplace: 'Trendyol', orderNumber: '10349724', source: 'trendyol', currency: 'TRY', totalPrice: 99,
      shippingAddress: 'Ayşe Yılmaz, Bağdat Cd. 5, İstanbul, TR',
      rawData: {
        grossAmount: 129, totalDiscount: 30, totalTyDiscount: 0, totalPrice: 99, currencyCode: 'TRY',
        shipmentAddress: { fullName: 'Ayşe Yılmaz', address1: 'Bağdat Cd. 5', city: 'İstanbul', postalCode: '34710', countryCode: 'TR', phone: '05320000000' },
        customerEmail: 'ayse@example.com',
        lines: [{ barcode: 'TY-BC', productName: 'Cezve', quantity: 1, amount: 129, price: 99, discount: 30, tyDiscount: 0, vatBaseAmount: 20 }],
      },
      items: [{ productName: 'Cezve', sku: 'TY-SKU', variantInfo: null, quantity: 1, unitPrice: 99, listingRef: null }],
    }),
    base({
      id: 'o-amz', userId: 'u1', marketplace: 'amazon', orderNumber: '111-1234567-1234567', source: 'amazon', currency: 'USD', totalPrice: 40,
      shippingAddress: { name: 'Amy Amazon', street1: '1 Prime Way', city: 'Seattle', postal: '98101', country: 'US', phone: '555' },
      rawData: { AmazonOrderId: '111-1234567-1234567', OrderTotal: { Amount: '40.00', CurrencyCode: 'USD' }, ShippingAddress: { Name: 'Amy Amazon', CountryCode: 'US' }, BuyerInfo: { BuyerEmail: 'amy@example.com' } },
      items: [{ productName: 'Lamp', sku: 'LMP', variantInfo: null, quantity: 1, unitPrice: 40, listingRef: null }],
    }),
    // Another seller, same Etsy order number: must never leak into u1's answers.
    base({
      id: 'o-other', userId: 'u2', marketplace: 'OtherShop', orderNumber: '4206064918', source: 'etsy-api', currency: 'USD', totalPrice: 999,
      shippingAddress: { name: 'Zed Other', street1: 'Rue 1', city: 'Paris', postal: '75001', country: 'FR' }, rawData: {}, items: [],
    }),
  ];
  h.etsyAddresses = [
    { userId: 'u1', orderNumber: '4206064918', etsyStoreName: 'BelleCoutureGifts', updatedAt: daysAgo(0),
      shippingAddress: { name: 'Jane Doe', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '73301', country: 'United States', email: 'jane@example.com', phone: '+1 512 000 0000' } },
    { userId: 'u2', orderNumber: '4206064918', etsyStoreName: 'OtherShop', updatedAt: daysAgo(0),
      shippingAddress: { name: 'Zed Other', line1: 'Rue 1', city: 'Paris', postalCode: '75001', country: 'France' } },
  ];
  h.cursors = [];
  h.tx = [];
}

/** Every key anywhere in a JSON value. */
function keys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
  return out;
}
const PII_KEYS = ['buyer', 'name', 'firstName', 'lastName', 'customerName', 'street1', 'street2', 'address', 'shippingAddress', 'city', 'postal', 'postalCode', 'zip', 'email', 'phone'];
const PII_VALUES = ['Jane Doe', '1 Main St', 'Austin', 'jane@', 'Bob Buyer', '9 Elm St', 'bob@', '+44', 'Ayşe', 'Bağdat', '0532', 'ayse@', 'Amy Amazon', 'Prime Way', 'amy@', 'Zed Other', 'Paris'];

beforeEach(seed);

describe('ship-to country', () => {
  it('Etsy: from the extension\'s address when Etsy withheld it (name → ISO), never another seller\'s', async () => {
    const o = await call('get_order', { orderNumber: '#4206064918' });
    expect(o.id).toBe('o-etsy');
    expect(o.shipToCountry).toBe('US');
    const list = await call('list_orders', { marketplace: 'etsy' });
    expect(list.orders.map((x: any) => x.id)).toEqual(['o-etsy']);
    expect(list.orders[0].shipToCountry).toBe('US');
    expect(h.calls.filter((c) => c.model === 'etsyAddress').every((c) => c.where.userId === 'u1')).toBe(true);
  });
  it('the receipt\'s own country_iso is used when Etsy sends it', async () => {
    h.etsyAddresses = [];
    h.orders[0].rawData.country_iso = 'CA';
    expect((await call('get_order', { id: 'o-etsy' })).shipToCountry).toBe('CA');
  });
  it('eBay / Amazon from the stored address, Trendyol is TR', async () => {
    const list = await call('list_orders', {});
    const by = Object.fromEntries(list.orders.map((x: any) => [x.id, x.shipToCountry]));
    expect(by).toMatchObject({ 'o-ebay': 'GB', 'o-amz': 'US', 'o-ty': 'TR' });
  });
  it('overview counts orders per ship-to country', async () => {
    const ov = await call('get_store_overview');
    expect(ov.orders.last30DaysByShipToCountry).toEqual({ US: 2, GB: 1, TR: 1 });
    expect(ov.recentOrders).toHaveLength(4);
  });
});

describe('money breakdown', () => {
  it('Etsy: $329 listed → $211.22 paid is explained by the receipt (discount + tax)', async () => {
    const o = await call('get_order', { id: 'o-etsy' });
    expect(o.money).toMatchObject({ currency: 'USD', itemsSubtotal: 329, discount: { amount: 131.6 }, shipping: 0, tax: 13.82, giftWrap: 0, total: 211.22 });
    expect(o.items[0]).toMatchObject({ unitPricePaid: 329, listingId: '111', listingPriceNow: { amount: 329, currency: 'USD' } });
    const list = await call('list_orders', { marketplace: 'etsy' });
    expect(list.orders[0].money).toEqual({ currency: 'USD', itemsSubtotal: 329, discount: 131.6, shipping: 0, tax: 13.82, total: 211.22 });
  });
  it('eBay: subtotal, promotion, shipping, total, eBay fee; per line price before / after discount', async () => {
    const o = await call('get_order', { id: 'o-ebay' });
    expect(o.money).toMatchObject({ itemsSubtotal: 60, discount: { amount: 10, promotions: [{ description: '10 off', amount: 10 }] }, shipping: 5, total: 55, marketplaceFee: 7.1 });
    expect(o.items[0]).toMatchObject({ unitPricePaid: 25, unitPriceBeforeDiscount: 30, lineDiscount: 10, listingPriceNow: { amount: 60, currency: 'USD' } });
  });
  it('Trendyol: seller vs Trendyol-funded discount, VAT rate per line', async () => {
    const o = await call('get_order', { id: 'o-ty' });
    expect(o.money).toMatchObject({ currency: 'TRY', itemsSubtotal: 129, discount: { amount: 30, sellerFunded: 30, marketplaceFunded: 0 }, total: 99 });
    expect(o.items[0]).toMatchObject({ unitPricePaid: 99, unitPriceBeforeDiscount: 129, lineDiscount: 30, vatRatePercent: 20, listingPriceNow: { amount: 120, currency: 'TRY' } });
  });
  it('no payload breakdown → only the total, said plainly', () => {
    const m = orderMoney('shopify', {}, 'USD', 12.5);
    expect(m.breakdown).toMatchObject({ total: 12.5, itemsSubtotal: null, discount: null, source: 'order total only' });
  });
});

describe('buyer data (orders:buyer scope)', () => {
  it('scope off: no name / address keys or values anywhere', async () => {
    for (const r of [await call('list_orders', {}), await call('get_order', { id: 'o-etsy' }), await call('get_order', { id: 'o-ebay' }), await call('get_store_overview')]) {
      const k = keys(r);
      for (const p of PII_KEYS) expect(k.has(p), p).toBe(false);
      const json = JSON.stringify(r);
      for (const v of PII_VALUES) expect(json.includes(v), v).toBe(false);
      expect(buyerRecordCount(r)).toBe(0);
    }
  });
  it('scope on: name + address for Etsy (extension), eBay, Trendyol; never Amazon; never e-mail or phone', async () => {
    const a = auth('u1', ['read', 'orders:buyer']);
    const list = await call('list_orders', {}, a);
    const by = Object.fromEntries(list.orders.map((x: any) => [x.id, x]));
    expect(by['o-etsy'].buyer).toEqual({ name: 'Jane Doe', shippingAddress: { street1: '1 Main St', street2: null, city: 'Austin', state: 'TX', postalCode: '73301', country: 'US' } });
    expect(by['o-ebay'].buyer).toMatchObject({ name: 'Bob Buyer', shippingAddress: { street1: '9 Elm St', city: 'Leeds', postalCode: 'LS1 1AA', country: 'GB' } });
    expect(by['o-ty'].buyer).toMatchObject({ name: 'Ayşe Yılmaz', shippingAddress: { street1: 'Bağdat Cd. 5', city: 'İstanbul', country: 'TR' } });
    expect(by['o-amz'].buyer).toBeUndefined();
    expect(buyerRecordCount(list)).toBe(3);
    const single = await call('get_order', { id: 'o-amz' }, a);
    expect(single.buyer).toBeUndefined();
    for (const r of [list, single, await call('get_order', { id: 'o-etsy' }, a)]) {
      const k = keys(r);
      expect(k.has('email')).toBe(false);
      expect(k.has('phone')).toBe(false);
      const json = JSON.stringify(r);
      for (const v of ['@example.com', '+1 512', '+44', '0532', 'Amy Amazon', 'Prime Way', 'Zed Other', 'Paris']) expect(json.includes(v), v).toBe(false);
    }
  });
  it('scope is granted only by the seller\'s tick, never by the requested scope', () => {
    expect(grantScopes('read write orders:buyer', undefined)).toEqual(['read', 'write']);
    expect(grantScopes(['read', 'orders:buyer'], 'true')).toEqual(['read']);
    expect(grantScopes('read', true)).toEqual(['read', 'orders:buyer']);
  });
});

describe('tenant scoping', () => {
  it('another seller\'s order is never found or listed', async () => {
    await expect(call('get_order', { id: 'o-other' })).rejects.toThrow(/not found/i);
    const list = await call('list_orders', {}, auth('u1', ['read', 'orders:buyer']));
    expect(list.orders.some((x: any) => x.id === 'o-other')).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/Zed Other|Paris|999/);
    const other = await call('get_order', { orderNumber: '4206064918' }, auth('u2', ['read', 'orders:buyer']));
    expect(other.id).toBe('o-other');
    expect(other.shipToCountry).toBe('FR');
    expect(other.items).toEqual([]);
    for (const c of h.calls) {
      const uid = c.where?.userId ?? c.where?.etsyShop?.userId;
      expect(uid, c.model).toBeTruthy();
    }
  });
});

describe('finance_summary', () => {
  const tx = (o: Row): Row => ({ userId: 'u1', marketplace: 'etsy', quantity: 1, commission: null, shippingAmount: null, barcode: null, orderNumber: null, productName: null, currency: 'USD', transactionDate: daysAgo(2), ...o });
  beforeEach(() => {
    h.tx = [
      tx({ transactionType: 'Sale', amount: 200, orderNumber: '1' }),
      tx({ transactionType: 'EtsyFee', amount: -13, productName: 'transaction fee: Keepsake Box' }),
      tx({ transactionType: 'EtsyFee', amount: -6.2, productName: 'processing fee' }),
      tx({ transactionType: 'AdSpend', amount: -10 }),
      tx({ transactionType: 'Refund', amount: -20 }),
      tx({ transactionType: 'Disbursement', amount: -150 }),
      tx({ userId: 'u2', transactionType: 'Sale', amount: 5000 }),
      tx({ marketplace: 'ebay', transactionType: 'SALE', amount: 80 }),
    ];
    h.cursors = [
      { userId: 'u1', marketplace: 'etsy', updatedAt: daysAgo(0), currentBalance: 412.5, balanceCurrency: 'USD', heldFunds: null },
      { userId: 'u1', marketplace: 'ebay', updatedAt: daysAgo(0), currentBalance: 300, balanceCurrency: 'USD', heldFunds: 96.4 },
      { userId: 'u2', marketplace: 'trendyol', updatedAt: daysAgo(0), currentBalance: 1, balanceCurrency: 'TRY', heldFunds: null },
    ];
  });
  it('fees by type, net, payouts, balance with as-of time; Etsy holds = not available; eBay holds reported', async () => {
    const r = await call('finance_summary', { period: '30d' });
    expect(r.marketplaces.map((m: any) => m.marketplace)).toEqual(['etsy', 'ebay']);
    const etsy = r.marketplaces[0];
    expect(etsy.sales.grossSales).toBe(200);
    expect(etsy.costs).toMatchObject({ marketplaceFees: 19.2, adSpend: 10, refunds: 20 });
    expect(etsy.net.netProfit).toBe(150.8);
    expect(etsy.payouts).toMatchObject({ paidToBank: 150, count: 1 });
    expect(etsy.balance).toMatchObject({ current: 412.5, currency: 'USD', heldFunds: null });
    expect(etsy.balance.asOf).toEqual(expect.any(String));
    expect(etsy.balance.heldFundsMeaning).toMatch(/^Not available: Etsy/);
    expect(etsy.feesByType.map((f: any) => f.type)).toEqual(expect.arrayContaining(['EtsyFee', 'AdSpend', 'Refund']));
    expect(etsy.etsyFeeDetails).toEqual([{ description: 'transaction fee', count: 1, total: -13 }, { description: 'processing fee', count: 1, total: -6.2 }]);
    const ebay = r.marketplaces[1];
    expect(ebay.balance).toMatchObject({ current: 300, heldFunds: 96.4 });
    expect(JSON.stringify(r)).not.toMatch(/5000|trendyol/);
    for (const c of h.calls) expect(c.where?.userId ?? c.where?.etsyShop?.userId).toBe('u1');
  });
  it('no data: says so plainly, per account and per marketplace', async () => {
    h.tx = []; h.cursors = [];
    const r = await call('finance_summary', {});
    expect(r.marketplaces).toEqual([]);
    expect(r.note).toMatch(/No financial data/);
    const one = await call('finance_summary', { marketplace: 'amazon' });
    expect(one.marketplaces[0]).toMatchObject({ marketplace: 'amazon', available: false });
  });
  it('Financials not in the plan → a clear refusal; bad dates refused', async () => {
    h.financials = false;
    await expect(call('finance_summary', {})).rejects.toThrow(/not included/);
    h.financials = true;
    await expect(call('finance_summary', { from: '2026-10-10', to: '2026-10-01' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('tools/list for the Claude and ChatGPT directories', () => {
  const all = listedTools(['read', 'write', 'orders:buyer']);
  it('every tool: title, annotations with explicit booleans, name ≤ 64', () => {
    expect(all.length).toBe(MCP_TOOLS.length);
    for (const t of all) {
      expect(t.name.length).toBeLessThanOrEqual(64);
      expect(t.title).toBeTruthy();
      expect(t.annotations.title).toBe(t.title);
      for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) expect(typeof t.annotations[k], `${t.name}.${k}`).toBe('boolean');
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
  it('write tools are not read-only and say they only stage drafts; reads are read-only', () => {
    for (const t of all) {
      const tool = MCP_TOOLS.find((x) => x.name === t.name)!;
      expect(t.annotations.readOnlyHint).toBe(tool.scope === 'read');
      expect(t.annotations.destructiveHint).toBe(false);
    }
    for (const n of ['stage_listing_changes', 'create_listing_draft', 'add_listing_photos']) expect(all.find((t) => t.name === n)!.description).toMatch(/draft/i);
    expect(all.find((t) => t.name === 'generate_product_image')!.description).toMatch(/\d+ of the seller's KolayXport AI credits per image/);
    expect(listedTools(['read']).every((t) => t.annotations.readOnlyHint)).toBe(true);
  });
  it('the image tool can be switched off for the directory', () => {
    process.env.MCP_DISABLE_IMAGE_TOOL = '1';
    try {
      expect(listedTools(['read', 'write']).map((t) => t.name)).not.toContain('generate_product_image');
    } finally {
      delete process.env.MCP_DISABLE_IMAGE_TOOL;
    }
  });
  it('loopback redirect URIs match on any port; others exactly', () => {
    expect(redirectUriRegistered(['http://localhost/callback'], 'http://localhost:3118/callback')).toBe(true);
    expect(redirectUriRegistered(['http://127.0.0.1:1/callback'], 'http://127.0.0.1:5555/callback')).toBe(true);
    expect(redirectUriRegistered(['http://localhost/callback'], 'http://localhost:3118/other')).toBe(false);
    expect(redirectUriRegistered(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriRegistered(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai:444/api/mcp/auth_callback')).toBe(false);
  });
});
