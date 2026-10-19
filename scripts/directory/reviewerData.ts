/**
 * Demo data for the directory reviewer account (scripts/directory/seed-reviewer-account.ts). PURE: builds plain
 * objects only (deterministic for a given `now`), no database access.
 *
 * Every marketplace id is in a reserved range or carries the KXREVIEW prefix, so it can never be a real one:
 *   Etsy shop id            9990000000001                    (real Etsy shop ids are 8 digits)
 *   Etsy listing ids        9990000001000 – 9990000001099    (real: ~10 digits)
 *   Etsy receipt ids        9990000100001 – …                (real: ~10 digits)
 *   Etsy transaction ids    9990000200001 – …
 *   Etsy ledger entries     etsy_ledger_9990000300001 – …
 *   eBay SKUs               KXREVIEW-…   (eBay order ids KXREVIEW-EB-…, transaction ids KXREVIEW-EBTX-…)
 *   Trendyol supplier       KXREVIEW     (barcodes KXREVIEW-TY-…, order numbers KXREVIEW-TY-…)
 * Buyers are obviously fictional ("… Example" / "… Sample" names, "Example Street" addresses, @example.com
 * e-mails, 555-01xx phone numbers).
 */
import { PRODUCTS, TAGS, MATERIALS, TAXONOMY, type Product } from '../demo/demoCatalog';

export const REVIEWER_NAME = 'KolayXport Review';
export const REVIEW_PREFIX = 'KXREVIEW';
export const ETSY_SHOP_ID = '9990000000001';
export const ETSY_SHOP_NAME = 'KXReviewDemoShop';
export const TRENDYOL_SUPPLIER_ID = 'KXREVIEW';
export const ETSY_LISTING_BASE = 9_990_000_001_000;
export const ETSY_RECEIPT_BASE = 9_990_000_100_000;
export const ETSY_TRANSACTION_BASE = 9_990_000_200_000;
export const ETSY_LEDGER_BASE = 9_990_000_300_000;

const DAY = 86_400_000;
const FAR_FUTURE = new Date(Date.UTC(2099, 0, 1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);
const etsyMoney = (n: number, currency = 'USD') => ({ amount: cents(n), divisor: 100, currency_code: currency });
const ebayMoney = (n: number, currency = 'USD') => ({ value: n.toFixed(2), currency });

/** Deterministic PRNG (same data on every run for the same seed). */
function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return {
    next,
    between: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
  };
}

interface Buyer { name: string; street1: string; city: string; state: string; postal: string; country: string; countryName: string }

/** Obviously fictional buyers. Countries are real (the tools report ship-to country); everything else is not. */
export const BUYERS: readonly Buyer[] = [
  { name: 'Alex Example', street1: '100 Example Street', city: 'Sampleton', state: 'OR', postal: '97000', country: 'US', countryName: 'United States' },
  { name: 'Jamie Sample', street1: '200 Example Avenue', city: 'Testville', state: 'TX', postal: '78000', country: 'US', countryName: 'United States' },
  { name: 'Robin Placeholder', street1: '300 Demo Road', city: 'Mockford', state: 'CA', postal: '92000', country: 'US', countryName: 'United States' },
  { name: 'Casey Example', street1: '400 Example Lane', city: 'Sampleton', state: 'NY', postal: '11000', country: 'US', countryName: 'United States' },
  { name: 'Morgan Sample', street1: '1 Example Gardens', city: 'Testbury', state: '', postal: 'EX1 1AA', country: 'GB', countryName: 'United Kingdom' },
  { name: 'Taylor Example', street1: 'Beispielstraße 1', city: 'Musterstadt', state: '', postal: '10000', country: 'DE', countryName: 'Germany' },
  { name: 'Charlie Sample', street1: "1 Rue de l'Exemple", city: 'Exempleville', state: '', postal: '75000', country: 'FR', countryName: 'France' },
  { name: 'Sam Voorbeeld', street1: 'Voorbeeldstraat 1', city: 'Teststad', state: '', postal: '1000 AA', country: 'NL', countryName: 'Netherlands' },
  { name: 'Jordan Example', street1: '500 Sample Crescent', city: 'Testington', state: 'ON', postal: 'A1A 1A1', country: 'CA', countryName: 'Canada' },
  { name: 'Riley Sample', street1: '6 Example Street', city: 'Demoburn', state: 'VIC', postal: '3000', country: 'AU', countryName: 'Australia' },
];
export const TR_BUYERS: readonly Buyer[] = [
  { name: 'Örnek Alıcı', street1: 'Örnek Mah. Deneme Sok. No:1', city: 'İstanbul', state: 'Örnekköy', postal: '34000', country: 'TR', countryName: 'Türkiye' },
  { name: 'Deneme Müşteri', street1: 'Test Cad. No:2', city: 'Ankara', state: 'Denemeköy', postal: '06000', country: 'TR', countryName: 'Türkiye' },
  { name: 'Test Kullanıcı', street1: 'Örnek Bulvarı No:3', city: 'İzmir', state: 'Testköy', postal: '35000', country: 'TR', countryName: 'Türkiye' },
];

export interface ReviewerDataInput { userId: string; now: number; imageBase: string }

type Row = Record<string, any>;

export interface OrderSeed { order: Row; items: Row[] }

export interface ReviewerDataset {
  shipperProfile: Row;
  credential: Row;
  etsyShop: Row;
  etsyListings: Row[];
  etsyListingOfferings: Row[];
  ebayListings: Row[];
  trendyolProducts: Row[];
  orders: OrderSeed[];
  etsyAddresses: Row[];
  financialTransactions: Row[];
  financialSyncCursors: Row[];
  productCosts: Row[];
  etsyListingDrafts: Row[];
  ebayListingDrafts: Row[];
  catalogDrafts: Row[];
}

/** Every fake marketplace id the dataset uses, for the cross-user collision check. */
export interface ReservedIds {
  etsyShopIds: string[];
  etsyListingIds: bigint[];
  etsyOrderNumbers: string[];
  ebaySkus: string[];
  ebayOrderNumbers: string[];
  trendyolBarcodes: string[];
  trendyolSupplierIds: string[];
  trendyolOrderNumbers: string[];
  financeExternalIds: string[];
  productCostBarcodes: string[];
}

const ebaySku = (p: Product) => p.sku.replace(/^KX-/, `${REVIEW_PREFIX}-`);
const etsyListingId = (i: number) => BigInt(ETSY_LISTING_BASE + i);
const tyBarcode = (n: number) => `${REVIEW_PREFIX}-TY-${String(n + 1).padStart(4, '0')}`;

/** Etsy items (all 25), eBay (12) and Trendyol (13) subsets of the catalogue, by catalogue index. */
export const EBAY_IDX = [0, 4, 6, 7, 8, 11, 12, 15, 16, 19, 20, 17] as const;
export const TRENDYOL_IDX = [0, 1, 2, 3, 4, 6, 8, 11, 12, 13, 15, 18, 19] as const;

export function buildReviewerDataset({ userId, now, imageBase }: ReviewerDataInput): ReviewerDataset {
  const r = prng(20261018);
  const nowSec = Math.floor(now / 1000);
  const at = (daysAgo: number, hour = 12) => new Date(now - daysAgo * DAY - ((hour % 24) - 12) * 3_600_000);
  const img = (key: string) => `${imageBase.replace(/\/+$/, '')}/demo/${key}.jpg`;

  // ── Profile (sender address is fictional too) ─────────────────────────────────────────────────
  const shipperProfile = {
    userId,
    shipperName: 'KolayXport Review Workshop',
    shipperPersonName: REVIEWER_NAME,
    shipperPhoneNumber: '+905550000000',
    shipperStreet1: 'Örnek Mah. Deneme Sok. No:1',
    shipperCity: 'İstanbul',
    shipperStateCode: 'Örnekköy',
    shipperPostalCode: '34000',
    shipperCountryCode: 'TR',
    shipperTinNumber: '0000000000',
    shipperTinType: 'BUSINESS_NATIONAL',
    defaultCurrencyCode: 'USD',
    defaultCountryOfMfg: 'TR',
    defaultHarmonizedCode: '691200',
    defaultPackagingType: 'YOUR_PACKAGING',
    defaultServiceType: 'INTERNATIONAL_ECONOMY',
    defaultWeightKg: 0.5,
  };

  // Only the Trendyol supplier id: the store id Trendyol catalog drafts are filed under. No API key / secret / token
  // of any marketplace or carrier, so nothing here can authenticate and no sync treats it as connected.
  const credential = { userId, trendyolSupplierId: TRENDYOL_SUPPLIER_ID };

  // Etsy shop row: the MCP tools read Etsy listings through the seller's ACTIVE EtsyShop rows. The access token is
  // an empty string (it can never be sent to Etsy: the token helper refuses an empty token before any request),
  // there is no refresh token, and the expiry is far away so no refresh is ever attempted.
  const etsyShop = {
    userId,
    shopId: ETSY_SHOP_ID,
    shopName: ETSY_SHOP_NAME,
    accessToken: '',
    refreshToken: null,
    tokenExpiresAt: FAR_FUTURE,
    isDefault: true,
    isActive: true,
    needsReauth: false,
    // Far future on purpose: etsy-orders-incremental skips a shop whose last poll AND last webhook are fresh, and the
    // listings page auto-pulls only when lastListingSyncAt is older than 12 h. Neither may ever try this shop.
    lastListingSyncAt: FAR_FUTURE,
    lastWebhookAt: FAR_FUTURE,
    lastOrderPollAt: FAR_FUTURE,
    lastListingReconcileAt: new Date(now),
    lastOrderReconcileAt: new Date(now),
  };

  // ── Etsy listings ─────────────────────────────────────────────────────────────────────────────
  const etsyHealth = [96, 92, 88, 85, 94, 79, 91, 87, 83, 76, 68, 98, 93, 81, 89, 90, 72, 64, 58, 86, 84, 95, 77, 88, 47];
  const lowStock: Record<number, number> = { 3: 1, 9: 2, 13: 0, 16: 1, 21: 2 };
  const etsyListings: Row[] = [];
  const etsyListingOfferings: Row[] = [];
  PRODUCTS.forEach((p, i) => {
    const score = etsyHealth[i];
    const id = etsyListingId(i);
    const state = i === 24 ? 'inactive' : i === 13 ? 'sold_out' : 'active';
    const quantity = lowStock[i] ?? r.between(6, 40);
    etsyListings.push({
      etsyShopId: ETSY_SHOP_ID,
      etsyListingId: id,
      title: score < 50 ? p.title.split(',')[0] : p.title,
      description: `${p.title}.\n\nHandmade in our small workshop and shipped worldwide with tracking. Every piece is made to order, so small variations make each one unique.\n\nDetails\n- Materials: ${MATERIALS[p.cat].join(', ')}\n- Ships in 1-3 business days\n- Gift wrapping available\n\n(Demo listing for the KolayXport review account: not a real product.)`,
      tags: TAGS[p.cat].slice(0, score < 60 ? 8 : 13),
      materials: MATERIALS[p.cat],
      priceAmount: cents(p.price), priceDivisor: 100, priceCurrencyCode: 'USD',
      views: r.between(180, 4200), numFavorers: r.between(12, 640),
      quantity: state === 'sold_out' ? 0 : quantity,
      state,
      url: null,
      taxonomyId: TAXONOMY[p.cat], whoMade: 'i_did', whenMade: 'made_to_order', isSupply: false,
      processingMin: 1, processingMax: 3,
      isPersonalizable: !!p.personalizable,
      personalizationInstructions: p.personalizable ? 'Enter up to 3 initials' : null,
      personalizationCharCountMax: p.personalizable ? 3 : null,
      thumbnailUrl75x75: img(p.image), thumbnailUrl170x135: img(p.image), thumbnailUrl570xN: img(p.image),
      imageCount: score < 50 ? 3 : r.between(6, 10), hasVideo: score >= 80,
      etsyCreatedTimestamp: nowSec - r.between(30, 400) * 86400, etsyUpdatedTimestamp: nowSec - r.between(1, 20) * 86400,
      syncedAt: new Date(now),
      healthScore: score, healthChecksUsed: 12, healthChecksTotal: 12,
      healthFails: score >= 90 ? [] : score >= 80 ? ['photos_alt'] : score >= 70 ? ['photos_alt', 'video'] : ['tags_count', 'video', 'photos_alt'],
    });
    etsyListingOfferings.push({
      etsyShopId: ETSY_SHOP_ID, etsyListingId: id, variantKey: '', variantValueKey: '', sku: p.sku, skuNormalized: p.sku.toLowerCase(),
      quantity: state === 'sold_out' ? 0 : quantity, priceAmount: cents(p.price), priceDivisor: 100,
    });
  });

  // ── eBay listings ─────────────────────────────────────────────────────────────────────────────
  const ebayScores = [91, 84, 95, 88, 73, 90, 86, 69, 82, 93, 78, 61];
  const ebayQty = [14, 2, 9, 1, 22, 6, 0, 11, 3, 17, 8, 5];
  const ebayListings: Row[] = EBAY_IDX.map((i, n) => {
    const p = PRODUCTS[i];
    const score = ebayScores[n];
    return {
      userId, sku: ebaySku(p), offerId: null, listingId: null, listingUrl: null,
      title: p.title.slice(0, 80),
      description: `<p>${p.title}</p><p>Handmade, ships worldwide with tracking.</p><p>(Demo listing for the KolayXport review account.)</p>`,
      priceValue: round2(p.price * 1.08).toFixed(2), priceCurrency: 'USD', quantity: ebayQty[n], condition: 'NEW',
      categoryName: { ceramics: 'Pottery & Glass', silver: 'Fine Necklaces & Pendants', towel: 'Beach Towels', leather: "Men's Wallets", decor: 'Home Décor' }[p.cat],
      categoryId: null, status: 'PUBLISHED', marketplaceId: 'EBAY_US',
      imageUrl: img(p.image), imageUrls: [img(p.image)], imageCount: 1,
      aspects: { Brand: ['Unbranded'], 'Country/Region of Manufacture': ['Turkey'], Material: [MATERIALS[p.cat][0]] },
      ebayCreatedAt: at(r.between(40, 300)).toISOString(), ebayUpdatedAt: at(r.between(1, 15)).toISOString(), syncedAt: new Date(now),
      healthScore: score, healthChecksUsed: 10, healthChecksTotal: 10, healthFails: score >= 85 ? [] : ['item_specifics'],
    };
  });

  // ── Trendyol products ─────────────────────────────────────────────────────────────────────────
  const tyQty = [12, 30, 2, 18, 7, 0, 25, 40, 1, 9, 15, 6, 21];
  const trendyolProducts: Row[] = TRENDYOL_IDX.map((i, n) => {
    const p = PRODUCTS[i];
    const tryPrice = Math.round(p.price * 40) - 0.1;
    return {
      userId, supplierId: TRENDYOL_SUPPLIER_ID, barcode: tyBarcode(n), stockCode: p.sku, productMainId: `${p.sku}-TY`, trendyolId: null,
      title: p.trTitle, description: `${p.trTitle}. Atölyede el yapımı. (KolayXport inceleme hesabı için örnek ürün.)`, brandName: 'Demo Atölye',
      categoryName: { ceramics: 'Kase & Tabak', silver: 'Gümüş Takı', towel: 'Havlu', leather: 'Cüzdan', decor: 'Dekoratif Obje' }[p.cat],
      categoryId: { ceramics: 1203, silver: 1247, towel: 839, leather: 1108, decor: 1877 }[p.cat],
      listPrice: round2(Math.round(tryPrice * 1.25)), salePrice: round2(tryPrice), currencyType: 'TRY', quantity: tyQty[n], vatRate: 10,
      images: [{ url: img(p.image) }], thumbnailUrl: img(p.image), imageCount: 1,
      approved: true, onSale: true, trendyolCreatedDate: at(r.between(30, 300)), trendyolLastUpdate: at(r.between(1, 10)), syncedAt: new Date(now),
      healthScore: [88, 92, 79, 84, 90, 95, 73, 86, 91, 67, 82, 94, 77][n], healthChecksUsed: 9, healthChecksTotal: 9,
    };
  });

  // ── Orders (60 days: Etsy 22, eBay 14, Trendyol 14) ──────────────────────────────────────────
  type Mp = 'etsy' | 'ebay' | 'trendyol';
  const plan: Mp[] = [];
  for (let k = 0; k < 50; k++) plan.push(k % 25 < 11 ? 'etsy' : k % 25 < 18 ? 'ebay' : 'trendyol');
  // Interleave deterministically so the newest orders mix marketplaces.
  for (let k = plan.length - 1; k > 0; k--) {
    const j = Math.floor(r.next() * (k + 1));
    [plan[k], plan[j]] = [plan[j], plan[k]];
  }

  const orders: OrderSeed[] = [];
  const etsyAddresses: Row[] = [];
  const financialTransactions: Row[] = [];
  let etsyN = 0, ebayN = 0, tyN = 0, etsyTxn = 0;

  plan.forEach((mp, k) => {
    const ageDays = Math.min(59, Math.floor(k * 1.2));
    const created = at(ageDays, r.between(8, 21));
    const isOpen = ageDays <= 3;
    const isCancelled = k === 17 || k === 38;
    const isDelivered = !isOpen && !isCancelled && ageDays > 9;
    const late = isOpen && ageDays >= 3;
    const buyer = mp === 'trendyol' ? TR_BUYERS[k % TR_BUYERS.length] : BUYERS[(k * 7) % BUYERS.length];
    const pool: readonly number[] = mp === 'trendyol' ? TRENDYOL_IDX : mp === 'ebay' ? EBAY_IDX : PRODUCTS.map((_, i) => i).filter((i) => i !== 24);
    const nItems = r.next() < 0.25 ? 2 : 1;
    const picks = Array.from({ length: nItems }, (_, j) => (j === 0 ? pool[(k * 5 + 3) % pool.length] : r.pick(pool)));
    const qtys = picks.map(() => (r.next() < 0.15 ? 2 : 1));
    const shipBy = new Date(created.getTime() + (late ? 2 : 3) * DAY);
    const shippedAt = isOpen || isCancelled ? null : new Date(created.getTime() + r.between(1, 2) * DAY);
    const deliveredAt = isDelivered && shippedAt ? new Date(shippedAt.getTime() + 5 * DAY) : null;
    const tracking = shippedAt ? `KXREVIEWTRK${String(k + 1).padStart(6, '0')}` : null;
    const firstName = buyer.name.split(' ')[0];
    const email = `${firstName.toLowerCase().replace(/[^a-z]/g, '') || 'buyer'}.${k + 1}@example.com`;
    const shippingAddress = {
      name: buyer.name, phone: buyer.country === 'TR' ? '+905550000000' : '+15555550100', street1: buyer.street1, street2: '',
      city: buyer.city, state: buyer.state, postal: buyer.postal, country: buyer.country, isResidential: true, email,
    };

    if (mp === 'etsy') {
      etsyN++;
      const receiptId = ETSY_RECEIPT_BASE + etsyN;
      const number = String(receiptId);
      const lines = picks.map((i, j) => ({ p: PRODUCTS[i], i, qty: qtys[j] }));
      const itemsTotal = round2(lines.reduce((s, l) => s + l.p.price * l.qty, 0));
      const discount = k % 4 === 1 ? round2(itemsTotal * 0.15) : 0; // a 15 % shop coupon on every 4th order
      const shippingCost = buyer.country === 'US' ? 0 : 12;
      const tax = buyer.country === 'US' ? round2((itemsTotal - discount + shippingCost) * 0.0725) : 0; // marketplace-facilitator sales tax
      const vat = ['GB', 'DE', 'FR', 'NL'].includes(buyer.country) ? round2((itemsTotal - discount + shippingCost) * 0.2) : 0;
      const giftWrap = k % 9 === 2 ? 5 : 0;
      const subtotal = round2(itemsTotal - discount);
      const grand = round2(subtotal + shippingCost + tax + vat + giftWrap);
      const status = isCancelled ? 'Canceled' : isOpen ? 'Paid' : isDelivered ? 'Completed' : 'Completed';
      const transactions = lines.map((l, j) => ({
        transaction_id: ETSY_TRANSACTION_BASE + ++etsyTxn,
        title: l.p.title,
        listing_id: Number(etsyListingId(l.i)),
        sku: l.p.sku,
        product_data: { sku: l.p.sku },
        quantity: l.qty,
        price: etsyMoney(l.p.price),
        shipping_cost: etsyMoney(j === 0 ? shippingCost : 0),
        is_digital: false,
        personalization: l.p.personalizable ? 'Initials: A.E.' : '',
        variations: l.p.personalizable ? [{ property_id: 54, value_id: null, formatted_name: 'Personalization', formatted_value: 'A.E.' }] : [],
        expected_ship_date: Math.floor(shipBy.getTime() / 1000),
        create_timestamp: Math.floor(created.getTime() / 1000),
        created_timestamp: Math.floor(created.getTime() / 1000),
      }));
      // Etsy's API withholds buyer name / address / e-mail from third-party apps: the receipt carries the country
      // only, and the address comes from the browser extension (EtsyAddress), exactly as in production.
      const receipt = {
        receipt_id: receiptId,
        receipt_type: 0,
        seller_user_id: null,
        seller_email: null,
        buyer_user_id: null,
        buyer_email: '',
        name: '',
        first_line: '', second_line: '', city: '', state: '', zip: '', formatted_address: '',
        country_iso: buyer.country,
        status,
        payment_method: 'cc',
        message_from_seller: null,
        message_from_buyer: k % 6 === 0 ? 'Could you add a small gift note? Thank you! (demo message)' : '',
        is_shipped: Boolean(shippedAt),
        is_paid: true,
        is_gift: giftWrap > 0,
        gift_message: giftWrap > 0 ? 'Happy birthday! (demo gift note)' : '',
        gift_wrap_price: etsyMoney(giftWrap),
        create_timestamp: Math.floor(created.getTime() / 1000),
        created_timestamp: Math.floor(created.getTime() / 1000),
        update_timestamp: Math.floor((shippedAt ?? created).getTime() / 1000),
        updated_timestamp: Math.floor((shippedAt ?? created).getTime() / 1000),
        currency_code: 'USD',
        grandtotal: etsyMoney(grand),
        subtotal: etsyMoney(subtotal),
        total_price: etsyMoney(itemsTotal),
        total_shipping_cost: etsyMoney(shippingCost),
        total_tax_cost: etsyMoney(tax),
        total_vat_cost: etsyMoney(vat),
        discount_amt: etsyMoney(discount),
        shipments: tracking ? [{ receipt_shipping_id: null, shipment_notification_timestamp: Math.floor((shippedAt as Date).getTime() / 1000), carrier_name: 'fedex', tracking_code: tracking }] : [],
        transactions,
        refunds: isCancelled ? [{ amount: etsyMoney(grand), created_timestamp: Math.floor(created.getTime() / 1000) + 3600, reason: 'Order canceled (demo)', note_from_issuer: '', status: 'SUCCESS' }] : [],
      };
      orders.push({
        order: {
          userId, marketplace: ETSY_SHOP_NAME, marketplaceKey: number, orderNumber: number, source: 'etsy-api',
          customerName: buyer.name, status: isCancelled ? 'cancelled' : isOpen ? 'paid' : isDelivered ? 'delivered' : 'shipped', externalStatus: status,
          currency: 'USD', totalPrice: grand, createdAt: created, uiOrderDate: created, shipByAt: shipBy, lastEventAt: shippedAt ?? created,
          shippedAt, deliveredAt, cancelledAt: isCancelled ? new Date(created.getTime() + 3_600_000) : null, trackingNumber: tracking,
          shippingAddress, rawData: receipt, giftMessage: receipt.gift_message || null, customerNote: receipt.message_from_buyer || null,
          labelStatus: shippedAt ? 'created' : null, weightKg: 0.5, countryOfMfg: 'TR',
        },
        items: lines.map((l, j) => ({
          sku: l.p.sku, productName: l.p.title, quantity: l.qty, unitPrice: l.p.price, totalPrice: round2(l.p.price * l.qty),
          image: img(l.p.image), marketplaceKey: number, orderNumber: number, shipBy, uniqueLineKey: `${number}-${j}`,
          remoteLineId: String(transactions[j].transaction_id), listingRef: String(etsyListingId(l.i)), variantRef: '', variantValueKey: '',
          variantInfo: l.p.personalizable ? 'Personalization: A.E.' : null, countryOfMfg: 'TR', weightKg: 0.5,
        })),
      });
      etsyAddresses.push({
        userId, orderNumber: number, etsyStoreId: ETSY_SHOP_ID, etsyStoreName: ETSY_SHOP_NAME,
        shippingAddress: { name: buyer.name, line1: buyer.street1, line2: '', city: buyer.city, state: buyer.state, postalCode: buyer.postal, country: buyer.countryName, email },
        notes: null, orderDate: created.toISOString().slice(0, 10), shipByDate: shipBy.toISOString().slice(0, 10),
      });
      // Finance: the receipt row as the Etsy finance sync writes it (amount = grandtotal − sales tax, rawData = receipt).
      financialTransactions.push({
        userId, marketplace: 'etsy', externalId: number, transactionType: 'Sale', orderNumber: number,
        barcode: String(etsyListingId(lines[0].i)), productName: lines.map((l) => l.p.title).join(', '),
        quantity: lines.reduce((s, l) => s + l.qty, 0), amount: round2(grand - tax), currency: 'USD', commission: null, shippingAmount: null,
        transactionDate: created, rawData: receipt,
      });
      return;
    }

    if (mp === 'ebay') {
      ebayN++;
      const number = `${REVIEW_PREFIX}-EB-${String(ebayN).padStart(4, '0')}`;
      const lines = picks.map((i, j) => ({ p: PRODUCTS[i], qty: qtys[j], price: round2(PRODUCTS[i].price * 1.08) }));
      const itemsTotal = round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
      const discount = k % 5 === 2 ? round2(itemsTotal * 0.1) : 0;
      const delivery = buyer.country === 'US' ? 6.5 : 14;
      const tax = buyer.country === 'US' ? round2((itemsTotal - discount + delivery) * 0.08) : 0;
      const total = round2(itemsTotal - discount + delivery + tax);
      const fulfillment = isCancelled ? 'NOT_STARTED' : isOpen ? 'NOT_STARTED' : 'FULFILLED';
      const raw = {
        orderId: number, legacyOrderId: number,
        creationDate: created.toISOString(), lastModifiedDate: (shippedAt ?? created).toISOString(),
        orderFulfillmentStatus: fulfillment, orderPaymentStatus: isCancelled ? 'FULLY_REFUNDED' : 'PAID',
        cancelStatus: { cancelState: isCancelled ? 'CANCELED' : 'NONE_REQUESTED', cancelRequests: [] },
        sellerId: 'kxreview_demo_seller',
        buyer: { username: `demo_buyer_${String(k + 1).padStart(2, '0')}`, taxAddress: { countryCode: buyer.country } },
        pricingSummary: {
          priceSubtotal: ebayMoney(itemsTotal),
          ...(discount ? { priceDiscount: ebayMoney(-discount) } : {}),
          deliveryCost: ebayMoney(delivery),
          ...(tax ? { tax: ebayMoney(tax) } : {}),
          total: ebayMoney(total),
        },
        totalFeeBasisAmount: ebayMoney(total),
        totalMarketplaceFee: ebayMoney(round2(total * 0.1325 + 0.3)),
        fulfillmentStartInstructions: [{
          fulfillmentInstructionsType: 'SHIP_TO',
          shippingStep: { shipTo: { fullName: buyer.name, contactAddress: { addressLine1: buyer.street1, city: buyer.city, stateOrProvince: buyer.state, postalCode: buyer.postal, countryCode: buyer.country }, primaryPhone: { phoneNumber: '5555550100' }, email } },
        }],
        lineItems: lines.map((l, j) => ({
          lineItemId: `${number}-L${j + 1}`, legacyItemId: null, sku: ebaySku(l.p), title: l.p.title.slice(0, 80), quantity: l.qty,
          lineItemCost: ebayMoney(round2(l.price * l.qty)), total: ebayMoney(round2(l.price * l.qty)),
          ...(j === 0 && discount ? { appliedPromotions: [{ description: '10% off (demo promotion)', discountAmount: ebayMoney(discount) }] } : {}),
          ...(tax ? { ebayCollectAndRemitTaxes: [{ taxType: 'STATE_SALES_TAX', amount: ebayMoney(round2(tax / lines.length)), collectionMethod: 'NET' }] } : {}),
          lineItemFulfillmentStatus: fulfillment,
          lineItemFulfillmentInstructions: { shipByDate: shipBy.toISOString(), guaranteedDelivery: false },
        })),
      };
      orders.push({
        order: {
          userId, marketplace: 'eBay', marketplaceKey: number, orderNumber: number, source: 'ebay-api',
          customerName: buyer.name, status: isCancelled ? 'cancelled' : isOpen ? 'AWAITING_FULFILLMENT' : isDelivered ? 'delivered' : 'shipped', externalStatus: fulfillment,
          currency: 'USD', totalPrice: total, createdAt: created, uiOrderDate: created, shipByAt: shipBy, lastEventAt: shippedAt ?? created,
          shippedAt, deliveredAt, cancelledAt: isCancelled ? new Date(created.getTime() + 3_600_000) : null, trackingNumber: tracking,
          shippingAddress, rawData: raw, labelStatus: shippedAt ? 'created' : null, weightKg: 0.5, countryOfMfg: 'TR',
        },
        items: lines.map((l, j) => ({
          sku: ebaySku(l.p), productName: l.p.title.slice(0, 80), quantity: l.qty, unitPrice: l.price, totalPrice: round2(l.price * l.qty),
          image: img(l.p.image), marketplaceKey: number, orderNumber: number, shipBy, uniqueLineKey: `${number}-${j}`, remoteLineId: `${number}-L${j + 1}`,
          countryOfMfg: 'TR', weightKg: 0.5,
        })),
      });
      if (!isCancelled) {
        financialTransactions.push({
          userId, marketplace: 'ebay', externalId: `${REVIEW_PREFIX}-EBTX-${String(ebayN).padStart(4, '0')}`, transactionType: 'Sale', orderNumber: number,
          barcode: `${number}-L1`, productName: lines[0].p.title.slice(0, 80), quantity: lines.length, amount: round2(total - tax), currency: 'USD',
          commission: round2(total * 0.1325 + 0.3), shippingAmount: null, transactionDate: created,
          rawData: { transactionId: `${REVIEW_PREFIX}-EBTX-${String(ebayN).padStart(4, '0')}`, transactionType: 'SALE', orderId: number, amount: ebayMoney(round2(total - total * 0.1325 - 0.3)), totalFeeBasisAmount: ebayMoney(total), totalFeeAmount: ebayMoney(round2(total * 0.1325 + 0.3)), salesTax: ebayMoney(tax), transactionDate: created.toISOString() },
        });
      }
      return;
    }

    tyN++;
    const id = `${REVIEW_PREFIX}-TY-${String(tyN).padStart(5, '0')}`;
    const lines = picks.map((i, j) => {
      const n = TRENDYOL_IDX.indexOf(i as (typeof TRENDYOL_IDX)[number]);
      return { p: PRODUCTS[i], n, qty: qtys[j], price: round2(Math.round(PRODUCTS[i].price * 40) - 0.1) };
    });
    const gross = round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
    const sellerDiscount = k % 3 === 0 ? round2(gross * 0.1) : 0;
    const tyDiscount = k % 4 === 1 ? 50 : 0;
    const total = round2(gross - sellerDiscount - tyDiscount);
    const status = isCancelled ? 'Cancelled' : isOpen ? 'Created' : isDelivered ? 'Delivered' : 'Shipped';
    const raw = {
      id, orderNumber: id, orderDate: created.getTime(), status, shipmentPackageStatus: status, currencyCode: 'TRY',
      grossAmount: gross, totalDiscount: round2(sellerDiscount + tyDiscount), totalTyDiscount: tyDiscount, totalPrice: total,
      customerFirstName: buyer.name.split(' ')[0], customerLastName: buyer.name.split(' ').slice(1).join(' '), customerEmail: email,
      cargoProviderName: 'Demo Kargo', cargoTrackingNumber: tracking,
      shipmentAddress: { fullName: buyer.name, address1: buyer.street1, address2: '', city: buyer.city, district: buyer.state, postalCode: buyer.postal, countryCode: 'TR', phone: null },
      lines: lines.map((l, j) => ({
        id: `${id}-L${j + 1}`, productName: l.p.trTitle, barcode: tyBarcode(l.n), merchantSku: l.p.sku, sku: l.p.sku, quantity: l.qty,
        price: l.price, amount: round2(l.price * l.qty), discount: j === 0 ? sellerDiscount : 0, tyDiscount: j === 0 ? tyDiscount : 0,
        vatBaseAmount: 10, currencyCode: 'TRY', orderLineItemStatusName: status,
      })),
    };
    orders.push({
      order: {
        userId, marketplace: 'Trendyol', marketplaceKey: id, orderNumber: id, source: 'trendyol',
        customerName: buyer.name, status: isCancelled ? 'cancelled' : isOpen ? 'Created' : isDelivered ? 'delivered' : 'shipped', externalStatus: status,
        currency: 'TRY', totalPrice: total, createdAt: created, uiOrderDate: created, shipByAt: shipBy, lastEventAt: shippedAt ?? created,
        shippedAt, deliveredAt, cancelledAt: isCancelled ? new Date(created.getTime() + 3_600_000) : null, trackingNumber: tracking,
        shippingAddress, rawData: raw, labelStatus: shippedAt ? 'created' : null, weightKg: 0.5, countryOfMfg: 'TR',
      },
      items: lines.map((l, j) => ({
        sku: l.p.sku, productName: l.p.trTitle, quantity: l.qty, unitPrice: l.price, totalPrice: round2(l.price * l.qty),
        image: img(l.p.image), marketplaceKey: id, orderNumber: id, shipBy, uniqueLineKey: `${id}-${j}`, remoteLineId: `${id}-L${j + 1}`,
        countryOfMfg: 'TR', weightKg: 0.5,
      })),
    });
    if (!isCancelled) {
      financialTransactions.push({
        userId, marketplace: 'trendyol', externalId: `${id}-SATIS`, transactionType: 'Satış', orderNumber: id, barcode: tyBarcode(lines[0].n),
        productName: lines[0].p.trTitle, quantity: lines.reduce((s, l) => s + l.qty, 0), amount: total, currency: 'TRY',
        commission: round2(total * 0.17), shippingAmount: 54.9, transactionDate: created,
      });
    }
  });

  // ── Etsy ledger rows (fees, ads, refunds, sales tax, disbursements) as the Etsy finance sync stores them ───────
  let ledger = 0;
  const ledgerRow = (type: string, amount: number, date: Date, productName: string) => ({
    userId, marketplace: 'etsy', externalId: `etsy_ledger_${ETSY_LEDGER_BASE + ++ledger}`, transactionType: type, orderNumber: null, barcode: null,
    productName, quantity: 1, amount: round2(amount), currency: 'USD', commission: null, shippingAmount: null, transactionDate: date,
  });
  for (const o of orders.filter((x) => x.order.source === 'etsy-api')) {
    const rc = o.order.rawData;
    const grand = rc.grandtotal.amount / 100;
    const date = o.order.createdAt as Date;
    financialTransactions.push(ledgerRow('EtsyFee', -round2(grand * 0.065), date, 'Transaction fee'));
    financialTransactions.push(ledgerRow('EtsyFee', -round2(grand * 0.03 + 0.25), date, 'Processing fee'));
    if (rc.total_tax_cost.amount > 0) financialTransactions.push(ledgerRow('SalesTax', -(rc.total_tax_cost.amount / 100), date, 'Sales tax paid by buyer'));
    if (o.order.cancelledAt) financialTransactions.push(ledgerRow('Refund', -grand, o.order.cancelledAt as Date, 'Refund to buyer'));
  }
  for (let d = 0; d < 60; d++) {
    financialTransactions.push(ledgerRow('AdSpend', -round2(3 + r.next() * 3), at(d, 6), 'Etsy Ads'));
    if (d % 14 === 3) financialTransactions.push(ledgerRow('AdSpend', -round2(6 + r.next() * 6), at(d, 7), 'Offsite Ads fee'));
    if (d % 30 === 5) financialTransactions.push(ledgerRow('EtsyFee', -8.4, at(d, 8), 'Listing fees (renewals)'));
    if (d % 7 === 1) financialTransactions.push(ledgerRow('Disbursement', -round2(180 + r.next() * 120), at(d, 9), 'Deposit to bank'));
  }
  for (let w = 0; w < 8; w++) {
    financialTransactions.push({
      userId, marketplace: 'ebay', externalId: `payout_${REVIEW_PREFIX}-${String(w + 1).padStart(3, '0')}`, transactionType: 'Disbursement',
      orderNumber: null, barcode: null, productName: 'Payout to bank', quantity: 1, amount: -round2(90 + r.next() * 60), currency: 'USD',
      commission: null, shippingAmount: null, transactionDate: at(w * 7 + 2, 9),
    });
  }

  const financialSyncCursors = [
    { userId, marketplace: 'etsy', lastSyncedTo: new Date(now), totalSynced: financialTransactions.filter((t) => t.marketplace === 'etsy').length, currentBalance: 1284.6, balanceCurrency: 'USD' },
    { userId, marketplace: 'ebay', lastSyncedTo: new Date(now), totalSynced: financialTransactions.filter((t) => t.marketplace === 'ebay').length, currentBalance: 412.2, balanceCurrency: 'USD', heldFunds: 96.4 },
    { userId, marketplace: 'trendyol', lastSyncedTo: new Date(now), totalSynced: financialTransactions.filter((t) => t.marketplace === 'trendyol').length, currentBalance: 18640.5, balanceCurrency: 'TRY' },
  ];

  const productCosts: Row[] = [];
  for (const p of PRODUCTS) {
    productCosts.push({ userId, marketplace: 'etsy', sku: p.sku, barcode: p.sku, productName: p.title, costAmount: p.cost, costCurrency: 'USD', shippingCost: p.cat === 'silver' ? 1.2 : 2.5 });
  }
  EBAY_IDX.forEach((i) => {
    const p = PRODUCTS[i];
    productCosts.push({ userId, marketplace: 'ebay', sku: ebaySku(p), barcode: ebaySku(p), productName: p.title.slice(0, 80), costAmount: p.cost, costCurrency: 'USD', shippingCost: 2.5 });
  });
  TRENDYOL_IDX.forEach((i, n) => {
    const p = PRODUCTS[i];
    productCosts.push({ userId, marketplace: 'trendyol', sku: p.sku, barcode: tyBarcode(n), productName: p.trTitle, costAmount: p.cost * 40, costCurrency: 'TRY', shippingCost: 45 });
  });

  // ── Staged drafts (nothing is ever sent: there are no marketplace credentials) ─────────────────
  const l0 = etsyListings[0];
  const etsyListingDrafts = [{
    userId, etsyShopId: ETSY_SHOP_ID, etsyListingId: l0.etsyListingId, status: 'draft',
    baseEtsyUpdatedTimestamp: l0.etsyUpdatedTimestamp, baseSnapshot: { localDraft: false, source: 'kxreview-seed', title: l0.title, tags: l0.tags },
    fieldPatch: { title: 'Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Bowl, Turkish Pottery Serving Bowl, Housewarming Gift', tags: [...l0.tags.slice(0, 12), 'tulip bowl'] },
    queuedActions: [],
  }];
  // eBay: staging a change on an existing listing needs either an eBay token (to read the base from eBay) or an
  // open draft. There is no token, so every eBay listing gets an open draft whose base is the cached listing;
  // only the second one carries a demo change (price + stock). Drafts without scheduledSendAt are never sent.
  const ebayListingDrafts = ebayListings.map((e, n) => ({
    userId, sku: e.sku, offerId: null, listingId: null, status: 'draft',
    baseSnapshotInventory: { sku: e.sku, condition: e.condition, product: { title: e.title, description: e.description, imageUrls: e.imageUrls, aspects: e.aspects }, availability: { shipToLocationAvailability: { quantity: e.quantity } } },
    baseSnapshotOffer: { sku: e.sku, marketplaceId: 'EBAY_US', format: 'FIXED_PRICE', listingDescription: e.description, pricingSummary: { price: { value: e.priceValue, currency: 'USD' } } },
    baseUpdatedAt: new Date(now),
    inventoryPatch: n === 1 ? { availability: { shipToLocationAvailability: { quantity: 10 } } } : {},
    offerPatch: n === 1 ? { pricingSummary: { price: { value: '54.00', currency: 'USD' } } } : {},
    queuedActions: [],
  }));
  const t0 = trendyolProducts[2];
  const catalogDrafts = [{
    userId, marketplace: 'trendyol', storeId: TRENDYOL_SUPPLIER_ID, externalId: t0.barcode, status: 'draft', baseUpdatedAt: t0.trendyolLastUpdate,
    baseSnapshot: { title: t0.title, price: t0.salePrice, listPrice: t0.listPrice, quantity: t0.quantity },
    fieldPatch: { price: round2(Number(t0.salePrice) * 0.95), quantity: 20 }, queuedActions: [],
  }];

  return {
    shipperProfile, credential, etsyShop, etsyListings, etsyListingOfferings, ebayListings, trendyolProducts, orders, etsyAddresses,
    financialTransactions, financialSyncCursors, productCosts, etsyListingDrafts, ebayListingDrafts, catalogDrafts,
  };
}

export function reservedIdsOf(d: ReviewerDataset): ReservedIds {
  const byMp = (src: string) => d.orders.filter((o) => o.order.source === src).map((o) => String(o.order.orderNumber));
  return {
    etsyShopIds: [d.etsyShop.shopId],
    etsyListingIds: d.etsyListings.map((l) => BigInt(l.etsyListingId)),
    etsyOrderNumbers: byMp('etsy-api'),
    ebaySkus: d.ebayListings.map((l) => l.sku),
    ebayOrderNumbers: byMp('ebay-api'),
    trendyolBarcodes: d.trendyolProducts.map((p) => p.barcode),
    trendyolSupplierIds: [TRENDYOL_SUPPLIER_ID],
    trendyolOrderNumbers: byMp('trendyol'),
    financeExternalIds: d.financialTransactions.map((t) => t.externalId),
    productCostBarcodes: d.productCosts.map((c) => c.barcode),
  };
}

/** Every reserved id must match its reserved pattern (unit-tested; a typo here would weaken the safety model). */
export function reservedIdProblems(ids: ReservedIds): string[] {
  const bad: string[] = [];
  const reservedNumeric = (s: string) => /^999000\d{7}$/.test(s);
  const prefixed = (s: string) => s.startsWith(`${REVIEW_PREFIX}`) || s.startsWith(`payout_${REVIEW_PREFIX}`) || s.startsWith('etsy_ledger_999000');
  ids.etsyShopIds.forEach((x) => reservedNumeric(x) || bad.push(`etsy shop ${x}`));
  ids.etsyListingIds.forEach((x) => reservedNumeric(String(x)) || bad.push(`etsy listing ${x}`));
  ids.etsyOrderNumbers.forEach((x) => reservedNumeric(x) || bad.push(`etsy order ${x}`));
  [...ids.ebaySkus, ...ids.ebayOrderNumbers, ...ids.trendyolBarcodes, ...ids.trendyolSupplierIds, ...ids.trendyolOrderNumbers].forEach((x) => prefixed(x) || bad.push(`id ${x}`));
  ids.financeExternalIds.forEach((x) => reservedNumeric(x) || prefixed(x) || bad.push(`finance ${x}`));
  return bad;
}
