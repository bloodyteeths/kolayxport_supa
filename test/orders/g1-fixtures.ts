/** orders G1 fixtures: one `/api/orders` order per marketplace shape (orders §13 G1 tests). */
import type { ApiOrder } from '@/lib/orders/types';

export const NOW = new Date('2026-10-15T12:00:00Z');
export const YESTERDAY = '2026-10-14T12:00:00.000Z';
export const TOMORROW = '2026-10-16T12:00:00.000Z';

/** Direct Etsy API order: Etsy withholds the buyer address. Marketplace = shop name. */
export const etsyNoAddress: ApiOrder = {
  id: 'o-etsy',
  marketplace: 'BelleCoutureGifts',
  orderNumber: '3891',
  status: 'paid',
  currency: 'USD',
  totalPrice: 169.99,
  orderTotalPrice: 169.99,
  customerName: 'Sarah Miller',
  createdAt: '2026-10-13T21:20:00.000Z',
  marketplaceOrderDate: '2026-10-13T21:12:00.000Z',
  shippingAddress: { name: 'Sarah Miller', street1: '', city: '', postal: '', country: '' },
  rawData: { receipt_id: 3891, transactions: [{ transaction_id: 'tx1', expected_ship_date: 1760529600, personalization: 'LENA' }] },
  shippingUpgrade: 'Express',
  giftMessage: 'Congratulations!',
  customerNote: '',
  labelStatus: null,
  line_items: [
    {
      id: 'i1',
      title: 'Personalized Baby Blanket',
      value: 69.99,
      quantity: 2,
      weight: 0.4,
      sku: 'BB-PINK',
      image: 'https://img/etsy.jpg',
      variantInfo: 'Color: Pink, Personalization: LENA – 03.10.2026',
      shipBy: YESTERDAY,
      remoteLineId: 'tx1',
      labelJobs: [],
    },
  ],
  shipments: [],
  trackingSubmissions: [],
  senkronData: { internalNote: 'Use the pink ribbon', customStatus: null },
};

/** Etsy order the Chrome extension enriched (EtsyAddress lookup). */
export const etsyEnrichment = {
  orderNumber: '3891',
  etsyStoreName: 'BelleCoutureGifts',
  shippingAddress: { name: 'Sarah Miller', line1: '12 Oak St', line2: 'Apt 4', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' },
  notes: 'xx PersonalizationLENA | Track package',
  shipByDate: 'Ship by tomorrow',
};

/** Amazon direct-sync FBA order with an anonymized buyer. */
export const amazonFba: ApiOrder = {
  id: 'o-amz',
  marketplace: 'Amazon',
  orderNumber: '114-0000000-0098',
  status: 'Shipped',
  currency: 'USD',
  totalPrice: 42,
  customerName: 'Anonymized by Amazon',
  createdAt: '2026-10-12T10:00:00.000Z',
  shippingAddress: { name: 'Anonymized by Amazon', street1: 'Anonymized by Amazon', city: 'SEATTLE', postal: '98101', country: 'US' },
  rawData: { rows: [{ 'fulfillment-channel': 'AFN', 'sales-channel': 'Amazon.com' }] },
  isFBA: true,
  isMCF: false,
  line_items: [{ id: 'i2', title: 'Name Necklace', value: 14, quantity: 3, labelJobs: [] }],
  shipments: [],
  trackingSubmissions: [],
};

/** Amazon merchant-fulfilled (open) order, anonymized name, full address. */
export const amazonOpen: ApiOrder = {
  ...amazonFba,
  id: 'o-amz-open',
  orderNumber: '114-0000000-0099',
  status: 'Unshipped',
  isFBA: false,
  rawData: { rows: [{ 'fulfillment-channel': 'MFN' }] },
  shippingAddress: { name: 'Anonymized by Amazon', street1: '1 Main St', city: 'SEATTLE', postal: '98101', country: 'US' },
  line_items: [{ id: 'i3', title: 'Name Necklace', value: 14, quantity: 1, shipBy: TOMORROW, labelJobs: [] }],
};

/** Trendyol order with a pre-assigned cargo number (not a label) and Turkish address parts. */
export const trendyolCargo: ApiOrder = {
  id: 'o-ty',
  marketplace: 'Trendyol',
  orderNumber: 'TY-88213',
  status: 'Created',
  currency: 'TRY',
  totalPrice: 1109.3,
  customerName: 'Ayşe Kaya',
  createdAt: '2026-10-14T08:00:00.000Z',
  shippingAddress: null,
  rawData: {
    cargoTrackingNumber: 7330012345,
    shipmentAddress: { fullName: 'Ayşe Kaya', address1: 'Ertuğrul Mah. 5', city: 'Bursa', district: 'Nilüfer', neighborhood: 'Ertuğrul', postalCode: '16110', countryCode: 'TR', phone: '+905320000000' },
    lines: [{ id: 501, contentId: 999, productName: 'Wooden Keepsake Box', barcode: '8690000000001' }],
  },
  line_items: [{ id: 'i4', title: 'Wooden Keepsake Box', value: 1109.3, quantity: 1, remoteLineId: '501', shipBy: TOMORROW, labelJobs: [] }],
  shipments: [],
  trackingSubmissions: [],
};

/** Wix order: address only in the nested shippingDestination. */
export const wixNested: ApiOrder = {
  id: 'o-wix',
  marketplace: 'Wix',
  orderNumber: '10021',
  status: 'PAID',
  currency: 'EUR',
  totalPrice: '58.00',
  createdAt: '2026-10-14T09:00:00.000Z',
  shippingAddress: null,
  rawData: {
    shippingInfo: {
      logistics: {
        shippingDestination: {
          address: { addressLine: 'Hauptstr. 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
          contactDetails: { firstName: 'Jonas', lastName: 'Weber', phone: '+49301234' },
        },
      },
    },
    buyerInfo: { email: 'j@example.com' },
  },
  line_items: [{ id: 'i5', title: 'Baby Name Sign', value: 58, quantity: 1, etsyListingUrl: 'https://shop.example/product-page/sign', labelJobs: [] }],
  shipments: [],
  trackingSubmissions: [],
};

/** Legacy Veeqo order: product data on rawData sellables, failed FedEx LabelJob. */
export const veeqoSellable: ApiOrder = {
  id: 'o-veeqo',
  marketplace: 'Veeqo',
  orderNumber: 'V-77',
  status: 'awaiting_fulfillment',
  currency: 'GBP',
  totalPrice: 20,
  createdAt: '2026-10-10T09:00:00.000Z',
  shippingAddress: { first_name: 'Tom', last_name: 'Hill', address1: '5 King Rd', city: 'Leeds', zip: 'LS1 1AA', country: 'GB' },
  rawData: { line_items: [{ sellable: { product: { id: 4242 } } }] },
  line_items: [
    {
      id: 'i6',
      title: 'Mug',
      value: 10,
      quantity: 2,
      labelJobs: [{ status: 'failed', carrier: 'FEDEX', errorMessage: 'Postal code is invalid for GB', createdAt: '2026-10-11T09:00:00.000Z' }],
    },
  ],
  shipments: [],
  trackingSubmissions: [],
};

/** Manual order with a UPS shipment label and a failed tracking push. */
export const manualLabeled: ApiOrder = {
  id: 'o-manual',
  marketplace: 'Manual',
  orderNumber: 'IG-2026-031',
  status: 'Created',
  currency: 'TRY',
  totalPrice: 1250,
  customerName: 'Mehmet Yılmaz',
  createdAt: '2026-10-14T07:00:00.000Z',
  shippingAddress: { name: 'Mehmet Yılmaz', street1: 'Atatürk Cad. 12', city: 'Bursa', postal: '16110', country: 'TR', phone: '+905321112233' },
  rawData: { source: 'manual', manualOrder: true },
  manualShippingCost: '412.50',
  manualShippingCostCurrency: 'TRY',
  line_items: [{ id: 'i7', title: 'Jewelry Box', value: 1250, quantity: 1, labelJobs: [] }],
  shipments: [
    { id: 's1', status: 'created', carrier: 'UPS', trackingNumber: '1Z999AA10123456784', pdfUrl: 'data:image/gif;base64,AAA', createdAt: '2026-10-14T10:00:00.000Z' },
    { id: 's0', status: 'voided', carrier: 'UPS', trackingNumber: '1ZOLD', pdfUrl: 'https://old', createdAt: '2026-10-14T09:00:00.000Z' },
  ],
  trackingSubmissions: [{ trackingNumber: '1Z999AA10123456784', carrierName: 'UPS', status: 'failed', errorMessage: 'eBay API 500', submittedAt: '2026-10-14T10:05:00.000Z' }],
};

/** Order whose label was voided (labelStatus voided, tracking fields left behind). */
export const voidedLabel: ApiOrder = {
  id: 'o-void',
  marketplace: 'eBay',
  orderNumber: '12-11834',
  status: 'PAID',
  currency: 'EUR',
  totalPrice: 58,
  createdAt: '2026-10-14T07:00:00.000Z',
  labelStatus: 'voided',
  trackingNumber: '794612900012',
  shippingLabelUrl: 'https://label.pdf',
  shippingAddress: { name: 'J. Weber', street1: 'Hauptstr. 1', city: 'Berlin', postal: '', country: 'DE' },
  rawData: {},
  line_items: [{ id: 'i8', title: 'Baby Name Sign', value: 58, quantity: 1, shipBy: TOMORROW, labelJobs: [] }],
  shipments: [],
  trackingSubmissions: [],
};

export const ALL_FIXTURES: ApiOrder[] = [etsyNoAddress, amazonFba, amazonOpen, trendyolCargo, wixNested, veeqoSellable, manualLabeled, voidedLabel];

/* Review fixtures (address twin): not in ALL_FIXTURES, so the view membership tests above are unchanged. */

/** Address merged on re-sync / filled by the extension: stored as JSON.stringify(...) → a jsonb string. */
export const stringifiedAddress: ApiOrder = {
  ...etsyNoAddress,
  id: 'o-etsy-str',
  orderNumber: '3892',
  shippingAddress: JSON.stringify({ name: 'Sarah Miller', street1: '12 Oak St', city: 'Austin', postal: '78701', country: 'US', note: 'say "hi"' }),
  rawData: { receipt_id: 3892 },
  line_items: [{ id: 'i9', title: 'Blanket', value: 10, quantity: 1, shipBy: TOMORROW, labelJobs: [] }],
};

/** Postal-free country sent by name, no postal code. */
export const ghanaByName: ApiOrder = {
  ...voidedLabel,
  id: 'o-gh',
  orderNumber: 'GH-1',
  labelStatus: null,
  trackingNumber: null,
  shippingLabelUrl: null,
  shippingAddress: { name: 'Kofi A.', street1: '3 Ring Rd', city: 'Accra', postal: '', country: 'Ghana' },
};

/** Primary address lacks only the postal code; rawData.to_address has it. */
export const postalInFallback: ApiOrder = {
  ...ghanaByName,
  id: 'o-fallback',
  orderNumber: 'FB-1',
  shippingAddress: { name: 'J. Weber', street1: 'Hauptstr. 1', city: 'Berlin', postal: '', country: 'DE' },
  rawData: { to_address: { street1: 'Hauptstr. 1', city: 'Berlin', zip: '10115', country: 'DE' } },
};

export const REVIEW_FIXTURES: ApiOrder[] = [stringifiedAddress, ghanaByName, postalInFallback];
