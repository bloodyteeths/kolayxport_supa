// orders §13 G4 — request snapshot tests: each adapter emits the same request (URL, method, body bytes) as the
// legacy code for 3 fixtures per carrier. The `legacy*` builders below are the legacy code paths copied verbatim
// (pages/app/labels.tsx getDefaultValues + handleGenerateLabel; components/UPSLabelDrawer.tsx form prefill +
// handleSubmit; components/MngLabelDrawer.tsx + labels.tsx buildMngOrder), reduced to body construction.
import { describe, expect, it } from 'vitest';
import { buildFedexRequest, parseFedexResult } from '@/lib/shipping/submit/fedex';
import { buildUpsRequest, parseUpsResult } from '@/lib/shipping/submit/ups';
import { buildDhlRequest, parseDhlResult } from '@/lib/shipping/submit/dhl';
import { buildSaveDetailsSteps } from '@/lib/shipping/carriers';
import type { LabelDraft } from '@/lib/shipping/labelDraft';

// ─── shared draft factory ─────────────────────────────────────────────────────────────────────────

function draft(p: Partial<LabelDraft> & Pick<LabelDraft, 'carrier' | 'service'>): LabelDraft {
  return {
    orderId: 'ord_1', orderNumber: '3891', marketplace: 'etsy',
    shipTo: { name: 'Sarah Miller', phone: '+15550134', email: 's@example.com', country: 'US', street1: '12 Oak St', street2: 'Apt 4', city: 'Austin', state: 'TX', postal: '78701', district: '', neighbourhood: '' },
    pkg: { weightKg: 0.8, packaging: 'FEDEX_PAK' },
    customs: { items: [], currency: 'USD', terms: 'DDP', exportReason: 'SALE', ioss: '', vat: '', invoiceNumber: 'INV-3891', sendEtgb: false },
    options: { sendTracking: true, signature: 'NO_SIGNATURE_REQUIRED', labelStock: 'PAPER_LETTER', fedex: { pickupType: 'DROP_BOX', sendCommercialInvoiceViaEtd: true } },
    ...p,
  } as LabelDraft;
}

const bodyOf = (s: { init: { body: string } }) => s.init.body;

// ─── FedEx ─────────────────────────────────────────────────────────────────────────────────────────

interface LegacyRow {
  orderId: string; itemId: string; orderNumber: string; title: string; quantity: number; weight: number;
  hsCode: string; countryOfOrigin: string; sku: string; currency: string; orderTotalPrice: number; customsValue?: number;
  recipientFirstName: string; recipientLastName: string; recipientStreet1: string; recipientStreet2: string;
  recipientCity: string; recipientState: string; recipientPostal: string; recipientCountry: string;
  recipientPhone: string; recipientEmail: string; fedexServiceType?: string; fedexPackagingType?: string;
  originalOrder?: Record<string, any>;
}

/** labels.tsx L1240–1288 `getDefaultValues` (verbatim). */
function getDefaultValues(row: LegacyRow, defaultCountryOfOrigin = 'TR') {
  const effectiveCustomsValue = row.customsValue ?? row.orderTotalPrice ?? 0;
  const effectiveQuantity = (row.quantity && row.quantity > 0) ? row.quantity : 1;
  const calculatedUnitPrice = effectiveQuantity > 0 ? effectiveCustomsValue / effectiveQuantity : 0;
  return {
    weightKg: row.weight || row.originalOrder?.weightKg || 0.5,
    hsCode: row.hsCode === '—' ? (row.originalOrder?.harmonizedCode || '') : row.hsCode,
    countryOfOrigin: row.countryOfOrigin || row.originalOrder?.countryOfMfg || defaultCountryOfOrigin,
    serviceType: row.fedexServiceType || row.originalOrder?.fedexServiceType || 'FEDEX_INTERNATIONAL_PRIORITY',
    packagingType: row.fedexPackagingType || row.originalOrder?.fedexPackagingType || 'FEDEX_PAK',
    recipientFirstName: row.recipientFirstName === '—' ? '' : row.recipientFirstName,
    recipientLastName: row.recipientLastName === '—' ? '' : row.recipientLastName,
    recipientStreet1: row.recipientStreet1 === '—' ? '' : row.recipientStreet1,
    recipientStreet2: row.recipientStreet2,
    recipientCity: row.recipientCity === '—' ? '' : row.recipientCity,
    recipientState: row.recipientState,
    recipientPostal: row.recipientPostal === '—' ? '' : row.recipientPostal,
    recipientCountry: row.recipientCountry === '—' ? '' : row.recipientCountry,
    recipientPhone: row.recipientPhone,
    recipientEmail: row.recipientEmail === '—' ? '' : row.recipientEmail,
    commodityDesc: row.title || 'Product',
    termsOfSale: row.originalOrder?.termsOfSale || 'DDP',
    sendCommercialInvoiceViaEtd: row.originalOrder?.sendCommercialInvoiceViaEtd ?? true,
    fedexPickupType: row.originalOrder?.fedexPickupType || 'DROP_BOX',
    fedexDutiesPaymentType: row.originalOrder?.fedexDutiesPaymentType || 'SENDER',
    packageLength: row.originalOrder?.packageLength,
    packageWidth: row.originalOrder?.packageWidth,
    packageHeight: row.originalOrder?.packageHeight,
    dimensionUnits: row.originalOrder?.dimensionUnits || 'CM',
    labelStockType: row.originalOrder?.labelStockType || 'PAPER_LETTER',
    signatureType: row.originalOrder?.signatureType || 'NO_SIGNATURE_REQUIRED',
    currency: row.currency || row.originalOrder?.currency || 'USD',
    customsValue: effectiveCustomsValue,
    line_items: [{
      id: row.itemId,
      title: row.originalOrder?.commodityDesc || row.title || 'Product',
      quantity: effectiveQuantity,
      unitPrice: calculatedUnitPrice,
      weight: row.weight,
      hs_code: row.hsCode === '—' ? (row.originalOrder?.harmonizedCode || '') : row.hsCode,
      country_of_origin: row.countryOfOrigin || row.originalOrder?.countryOfMfg || '',
      sku: row.sku,
    }],
  };
}

/** labels.tsx L2224–2380 `handleGenerateLabel` bodies (verbatim key order). */
function legacyFedex(cur: LegacyRow, force = false) {
  const { orderId, recipientFirstName, recipientLastName, recipientStreet1, recipientStreet2, recipientCity, recipientState,
    recipientPostal, recipientCountry, recipientPhone, recipientEmail, weight, hsCode, countryOfOrigin, itemId } = cur;
  const dbUpdatePayload = {
    id: orderId, itemId,
    shippingAddress: { firstName: recipientFirstName, lastName: recipientLastName, street1: recipientStreet1, street2: recipientStreet2, city: recipientCity, state: recipientState, postal: recipientPostal, country: recipientCountry, phone: recipientPhone, email: recipientEmail },
    weight, hsCode, countryOfOrigin, commodityDesc: cur.title || 'Product',
  };
  const d = getDefaultValues(cur, 'TR');
  const fedexOptionsPayload = {
    orderId: cur.orderId,
    shippingAddress: { firstName: cur.recipientFirstName, lastName: cur.recipientLastName, street1: cur.recipientStreet1, street2: cur.recipientStreet2, city: cur.recipientCity, state: cur.recipientState, postal: cur.recipientPostal, country: cur.recipientCountry, phone: cur.recipientPhone, email: cur.recipientEmail },
    line_items: d.line_items, weightKg: d.weightKg, harmonizedCode: d.hsCode, countryOfMfg: d.countryOfOrigin, commodityDesc: d.commodityDesc,
    termsOfSale: d.termsOfSale, sendCommercialInvoiceViaEtd: d.sendCommercialInvoiceViaEtd, fedexServiceType: d.serviceType,
    fedexPackagingType: d.packagingType, fedexPickupType: d.fedexPickupType, fedexDutiesPaymentType: d.fedexDutiesPaymentType,
    packageLength: d.packageLength, packageWidth: d.packageWidth, packageHeight: d.packageHeight, dimensionUnits: d.dimensionUnits,
    labelStockType: d.labelStockType, signatureType: d.signatureType, customsValue: d.customsValue, currency: d.currency,
  };
  const p = fedexOptionsPayload;
  const bodyForGenerateLabel = {
    line_items: p.line_items, weightKg: p.weightKg, harmonizedCode: p.harmonizedCode, countryOfMfg: p.countryOfMfg, commodityDesc: p.commodityDesc,
    termsOfSale: p.termsOfSale, sendCommercialInvoiceViaEtd: p.sendCommercialInvoiceViaEtd, fedexServiceType: d.serviceType,
    fedexPackagingType: d.packagingType, fedexPickupType: p.fedexPickupType, fedexDutiesPaymentType: p.fedexDutiesPaymentType,
    packageLength: p.packageLength, packageWidth: p.packageWidth, packageHeight: p.packageHeight, dimensionUnits: p.dimensionUnits,
    labelStockType: p.labelStockType, signatureType: p.signatureType, customsValue: p.customsValue, currency: p.currency,
    recipientFirstName: d.recipientFirstName, recipientLastName: d.recipientLastName, recipientStreet1: d.recipientStreet1,
    recipientStreet2: d.recipientStreet2, recipientCity: d.recipientCity, recipientState: d.recipientState, recipientPostal: d.recipientPostal,
    recipientCountry: d.recipientCountry, recipientPhone: d.recipientPhone, recipientEmail: d.recipientEmail,
    orderId: cur.orderId, orderItemId: cur.itemId, forceCancelled: force || undefined,
  };
  return [
    { url: '/api/orders/update', method: 'POST', body: JSON.stringify(dbUpdatePayload) },
    { url: `/api/orders/${cur.orderId}/update-options`, method: 'PATCH', body: JSON.stringify(fedexOptionsPayload) },
    { url: `/api/orders/${cur.orderId}/generate-label`, method: 'POST', body: JSON.stringify(bodyForGenerateLabel) },
  ];
}

const fedexRows: LegacyRow[] = [
  {
    orderId: 'ord_1', itemId: 'it_1', orderNumber: '3891', title: 'Personalized Baby Blanket', quantity: 2, weight: 0.8,
    hsCode: '630210', countryOfOrigin: 'TR', sku: 'BB-01', currency: 'USD', orderTotalPrice: 50,
    recipientFirstName: 'Sarah', recipientLastName: 'Miller', recipientStreet1: '12 Oak St', recipientStreet2: 'Apt 4',
    recipientCity: 'Austin', recipientState: 'TX', recipientPostal: '78701', recipientCountry: 'US',
    recipientPhone: '+15550134', recipientEmail: 'sarah@example.com', fedexServiceType: 'INTERNATIONAL_PRIORITY',
  },
  {
    orderId: 'ord_2', itemId: 'it_9', orderNumber: '12-11834', title: 'Wooden Keepsake Box', quantity: 1, weight: 1.25,
    hsCode: '442090', countryOfOrigin: 'TR', sku: '', currency: 'EUR', orderTotalPrice: 89.9,
    recipientFirstName: 'Jonas', recipientLastName: 'Weber', recipientStreet1: 'Hauptstr. 5', recipientStreet2: '',
    recipientCity: 'Berlin', recipientState: '', recipientPostal: '10115', recipientCountry: 'DE',
    recipientPhone: '', recipientEmail: '', fedexServiceType: 'FEDEX_INTERNATIONAL_ECONOMY', fedexPackagingType: 'FEDEX_BOX',
    originalOrder: { packageLength: 30, packageWidth: 20, packageHeight: 10, labelStockType: 'PAPER_4X6' },
  },
  {
    orderId: 'ord_3', itemId: 'it_3', orderNumber: 'W-1001', title: 'Gift wrap', quantity: 4, weight: 0.4,
    hsCode: '', countryOfOrigin: 'TR', sku: 'GW', currency: 'GBP', orderTotalPrice: 20,
    recipientFirstName: 'Mary Ann', recipientLastName: 'Smith', recipientStreet1: '1 King Rd', recipientStreet2: '',
    recipientCity: 'London', recipientState: '', recipientPostal: 'SW1A 1AA', recipientCountry: 'GB',
    recipientPhone: '+447700900123', recipientEmail: 'ma@example.co.uk', fedexServiceType: 'INTERNATIONAL_PRIORITY',
    originalOrder: { signatureType: 'DIRECT' },
  },
];

function fedexDraftFor(r: LegacyRow): LabelDraft {
  const oo = r.originalOrder || {};
  return draft({
    orderId: r.orderId, orderNumber: r.orderNumber, carrier: 'fedex',
    service: r.fedexServiceType || 'FEDEX_INTERNATIONAL_PRIORITY',
    shipTo: { name: `${r.recipientFirstName} ${r.recipientLastName}`, phone: r.recipientPhone, email: r.recipientEmail, country: r.recipientCountry, street1: r.recipientStreet1, street2: r.recipientStreet2, city: r.recipientCity, state: r.recipientState, postal: r.recipientPostal, district: '', neighbourhood: '' },
    pkg: { weightKg: r.weight, lengthCm: oo.packageLength, widthCm: oo.packageWidth, heightCm: oo.packageHeight, packaging: r.fedexPackagingType || 'FEDEX_PAK' },
    customs: { items: [{ itemId: r.itemId, description: r.title, hsCode: r.hsCode, quantity: r.quantity, unitValue: r.orderTotalPrice / r.quantity, origin: r.countryOfOrigin, sku: r.sku }], currency: r.currency, terms: 'DDP', exportReason: 'SALE', ioss: '', vat: '', invoiceNumber: `INV-${r.orderNumber}`, sendEtgb: false },
    options: { sendTracking: true, signature: oo.signatureType || 'NO_SIGNATURE_REQUIRED', labelStock: oo.labelStockType || 'PAPER_LETTER', fedex: { pickupType: 'DROP_BOX', sendCommercialInvoiceViaEtd: true } },
  });
}

describe('FedEx adapter = legacy labels page (3 fixtures)', () => {
  for (const row of fedexRows) {
    it(`order ${row.orderNumber}`, () => {
      const legacy = legacyFedex(row);
      const steps = buildFedexRequest(fedexDraftFor(row));
      expect(steps.map((s) => ({ url: s.url, method: s.init.method, body: bodyOf(s) }))).toEqual(legacy);
      expect(steps.map((s) => s.kind)).toEqual(['prepare', 'prepare', 'label']);
    });
  }
  it('retry after the cancelled-order dialog adds forceCancelled', () => {
    const legacy = legacyFedex(fedexRows[0], true);
    const steps = buildFedexRequest(fedexDraftFor(fedexRows[0]), { forceCancelled: true });
    expect(bodyOf(steps[2])).toBe(legacy[2].body);
    expect(JSON.parse(bodyOf(steps[2])).forceCancelled).toBe(true);
  });
  it('multi-item orders send every item (by design, §6.1) and Σ customs value', () => {
    const d = fedexDraftFor(fedexRows[0]);
    d.customs.items.push({ itemId: 'it_2', description: 'Gift wrap', hsCode: '482390', quantity: 1, unitValue: 5, origin: 'TR' });
    const opts = JSON.parse(bodyOf(buildFedexRequest(d)[1]));
    expect(opts.line_items).toHaveLength(2);
    expect(opts.customsValue).toBe(55);
    expect(JSON.parse(bodyOf(buildFedexRequest(d)[0])).weight).toBeUndefined();
  });
  it('parses tracking, label URL and alerts as text', () => {
    expect(parseFedexResult({ trackingNumber: '794612900012', labelUrl: 'https://x/l.pdf', alerts: [{ message: 'Postal code adjusted' }, 'Other'] }))
      .toEqual({ ok: true, carrier: 'fedex', trackingNumber: '794612900012', labelHref: 'https://x/l.pdf', alerts: ['Postal code adjusted', 'Other'] });
    expect(parseFedexResult({}).ok).toBe(false);
  });
});

// ─── UPS ───────────────────────────────────────────────────────────────────────────────────────────

interface UpsOrder {
  orderId: string; orderNumber: string; recipientFirstName: string; recipientLastName: string; recipientStreet1: string;
  recipientStreet2: string; recipientCity: string; recipientState: string; recipientPostal: string; recipientCountry: string;
  recipientPhone: string; recipientEmail: string; orderTotalPrice: number; currency: string; title: string; weight: number;
  hsCode: string; countryOfOrigin: string;
}

const normalizeDecimal = (value: number | string): number => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
};
// eslint-disable-next-line no-restricted-syntax
const formatDecimal = (value: number | string): string => normalizeDecimal(value).toFixed(2);

/** UPSLabelDrawer.tsx prefill (L571–614) + handleSubmit body (L683–741), verbatim; user id passed in. */
function legacyUps(order: UpsOrder, userId: string, force = false) {
  const orderValue = order.orderTotalPrice || 0;
  const form = {
    recipientFirstName: order.recipientFirstName || '', recipientLastName: order.recipientLastName || '',
    recipientStreet1: order.recipientStreet1 || '', recipientStreet2: order.recipientStreet2 || '', recipientCity: order.recipientCity || '',
    recipientState: order.recipientState || '', recipientPostal: order.recipientPostal || '', recipientCountry: order.recipientCountry,
    recipientPhone: order.recipientPhone || '', weight: normalizeDecimal(order.weight || 0.5), serviceType: '65', dutyPaymentType: 'RECEIVER',
    packageLength: '', packageWidth: '', packageHeight: '', invoiceNumber: `INV-${order.orderNumber || Date.now()}`, exportReason: 'SALE',
    currencyCode: 'USD', iossNumber: '', vatNumber: '',
    products: [{ description: (order.title || 'Global Cargo Shipment').substring(0, 35), quantity: 1, value: normalizeDecimal(orderValue), commodityCode: order.hsCode || '', unitOfMeasurement: 'PCS', weight: formatDecimal(order.weight || 0.5), originCountry: order.countryOfOrigin || 'TR' }],
    soldToName: `${order.recipientFirstName || ''} ${order.recipientLastName || ''}`.trim(),
    soldToAttention: `${order.recipientFirstName || ''} ${order.recipientLastName || ''}`.trim(),
    soldToStreet1: order.recipientStreet1 || '', soldToStreet2: order.recipientStreet2 || '', soldToCity: order.recipientCity || '',
    soldToPostal: order.recipientPostal || '', soldToCountry: order.recipientCountry, soldToPhone: order.recipientPhone || '',
    soldToState: order.recipientState || '', soldToEmail: order.recipientEmail || '', termsOfShipment: 'DAP',
  };
  return JSON.stringify({
    userId, orderId: order.orderId, forceCancelled: force || undefined,
    recipient: { name: `${form.recipientFirstName} ${form.recipientLastName}`.trim(), phone: form.recipientPhone, street1: form.recipientStreet1, street2: form.recipientStreet2, city: form.recipientCity, stateCode: form.recipientState, postalCode: form.recipientPostal, countryCode: form.recipientCountry },
    package: { weightKg: form.weight, lengthCm: form.packageLength ? Number(form.packageLength) : undefined, widthCm: form.packageWidth ? Number(form.packageWidth) : undefined, heightCm: form.packageHeight ? Number(form.packageHeight) : undefined, dimensionUnits: 'CM' },
    serviceType: form.serviceType, isEdi: true, description: form.products[0].description, dutyPaymentType: form.dutyPaymentType,
    internationalForms: {
      invoiceNumber: form.invoiceNumber,
      invoiceLineTotal: { currencyCode: form.currencyCode, monetaryValue: formatDecimal(form.products[0].quantity * form.products[0].value) },
      exportReason: form.exportReason, currencyCode: form.currencyCode, iossNumber: form.iossNumber, vatNumber: form.vatNumber,
      products: form.products.map((product) => ({ ...product, commodityCode: product.commodityCode || '000000' })),
      soldTo: { name: form.soldToName, attention: form.soldToAttention, street1: form.soldToStreet1, street2: form.soldToStreet2, city: form.soldToCity, postalCode: form.soldToPostal, countryCode: form.soldToCountry, phone: form.soldToPhone, state: form.soldToState, email: form.soldToEmail },
      soldToState: form.soldToState, soldToEmail: form.soldToEmail, termsOfShipment: form.termsOfShipment,
    },
  });
}

const upsOrders: UpsOrder[] = [
  { orderId: 'u1', orderNumber: '3891', recipientFirstName: 'Sarah', recipientLastName: 'Miller', recipientStreet1: '12 Oak St', recipientStreet2: 'Apt 4', recipientCity: 'Austin', recipientState: 'TX', recipientPostal: '78701', recipientCountry: 'US', recipientPhone: '+15550134', recipientEmail: 'sarah@example.com', orderTotalPrice: 139.98, currency: 'USD', title: 'Personalized Baby Blanket With Name Embroidery', weight: 0.8, hsCode: '630210', countryOfOrigin: 'TR' },
  { orderId: 'u2', orderNumber: '12-11834', recipientFirstName: 'Jonas', recipientLastName: 'Weber', recipientStreet1: 'Hauptstr. 5', recipientStreet2: '', recipientCity: 'Berlin', recipientState: '', recipientPostal: '10115', recipientCountry: 'DE', recipientPhone: '', recipientEmail: '', orderTotalPrice: 89.9, currency: 'USD', title: 'Wooden Keepsake Box', weight: 1.25, hsCode: '', countryOfOrigin: 'TR' },
  { orderId: 'u3', orderNumber: 'A-77', recipientFirstName: 'Li', recipientLastName: '', recipientStreet1: '9 Queen St', recipientStreet2: 'Unit 2', recipientCity: 'Toronto', recipientState: 'ON', recipientPostal: 'M5H 2N2', recipientCountry: 'CA', recipientPhone: '+14165550100', recipientEmail: 'li@example.ca', orderTotalPrice: 42, currency: 'USD', title: 'Keychain', weight: 0.2, hsCode: '731819', countryOfOrigin: 'TR' },
];

function upsDraftFor(o: UpsOrder): LabelDraft {
  return draft({
    orderId: o.orderId, orderNumber: o.orderNumber, carrier: 'ups', service: '65',
    shipTo: { name: `${o.recipientFirstName} ${o.recipientLastName}`, phone: o.recipientPhone, email: o.recipientEmail, country: o.recipientCountry, street1: o.recipientStreet1, street2: o.recipientStreet2, city: o.recipientCity, state: o.recipientState, postal: o.recipientPostal, district: '', neighbourhood: '' },
    pkg: { weightKg: o.weight, packaging: 'UPS_PAK' },
    customs: { items: [{ itemId: 'x', description: o.title, hsCode: o.hsCode, quantity: 1, unitValue: o.orderTotalPrice, origin: o.countryOfOrigin }], currency: o.currency, terms: 'DAP', exportReason: 'SALE', ioss: '', vat: '', invoiceNumber: `INV-${o.orderNumber}`, sendEtgb: false },
    options: { sendTracking: true, signature: 'NO_SIGNATURE', labelStock: 'PAPER_LETTER' },
  });
}

describe('UPS adapter = legacy UPSLabelDrawer (3 fixtures)', () => {
  for (const o of upsOrders) {
    it(`order ${o.orderNumber}`, () => {
      const steps = buildUpsRequest(upsDraftFor(o), { userId: 'user_1' });
      expect(steps).toHaveLength(1);
      expect(steps[0].url).toBe('/api/labels/ups');
      expect(steps[0].init.method).toBe('POST');
      expect(bodyOf(steps[0])).toBe(legacyUps(o, 'user_1'));
    });
  }
  it('forceCancelled retry', () => {
    expect(bodyOf(buildUpsRequest(upsDraftFor(upsOrders[0]), { userId: 'user_1', forceCancelled: true })[0])).toBe(legacyUps(upsOrders[0], 'user_1', true));
  });
  it('DDP maps to SHIPPER and one product line per item', () => {
    const d = upsDraftFor(upsOrders[0]);
    d.customs.terms = 'DDP';
    d.customs.items = [
      { itemId: 'a', description: 'Blanket', hsCode: '630210', quantity: 2, unitValue: 60, origin: 'TR' },
      { itemId: 'b', description: 'Gift wrap', hsCode: '', quantity: 1, unitValue: 5, origin: 'TR' },
    ];
    const b = JSON.parse(bodyOf(buildUpsRequest(d)[0]));
    expect(b.dutyPaymentType).toBe('SHIPPER');
    expect(b.internationalForms.termsOfShipment).toBe('DDP');
    expect(b.internationalForms.products).toHaveLength(2);
    expect(b.internationalForms.products[1].commodityCode).toBe('000000');
    expect(b.internationalForms.invoiceLineTotal.monetaryValue).toBe('125.00');
  });
  it('success:false on HTTP 200 is a failure', () => {
    expect(parseUpsResult({ success: false, message: 'UPS shipment creation failed.' })).toEqual({ ok: false, kind: 'error', message: 'UPS shipment creation failed.' });
    expect(parseUpsResult({ success: true, trackingNumber: '1Z999', labelUrl: 'data:image/gif;base64,R0lG' }).ok).toBe(true);
  });
});

// ─── DHL eCommerce ─────────────────────────────────────────────────────────────────────────────────

interface MngOrder {
  orderId: string; orderNumber: string; recipientName: string; recipientPhone: string; recipientEmail: string; recipientCity: string;
  recipientDistrict: string; recipientNeighbourhood: string; recipientAddress: string; recipientPostalCode: string; weight?: number; title?: string;
}

/** MngLabelDrawer.tsx prefill (L79–96) + handleSubmit body (L121–152), verbatim (defaults untouched). */
function legacyMng(order: MngOrder, force = false) {
  const weight = String(order.weight || 0.5);
  return JSON.stringify({
    orderId: order.orderId, forceCancelled: force || undefined,
    recipient: { name: order.recipientName || '', phone: order.recipientPhone || '', email: order.recipientEmail || '', city: order.recipientCity || '', district: order.recipientDistrict || '', neighbourhood: order.recipientNeighbourhood || '', street: '', address: order.recipientAddress || '', postalCode: order.recipientPostalCode || '' },
    packageInfo: { weight: parseFloat(weight) || 0.5, width: undefined, height: undefined, length: undefined },
    serviceType: 1, paymentType: 1, deliveryType: 1, packagingType: 1, isCOD: false, codAmount: 0,
    content: order.title || order.orderNumber || '', smsPreference1: false, smsPreference2: true, smsPreference3: true, description: '',
  });
}

const mngOrders: Array<MngOrder & { street1: string; street2: string }> = [
  { orderId: 'm1', orderNumber: 'TY-88213', recipientName: 'Ayşe Kaya', recipientPhone: '+905321234567', recipientEmail: '', recipientCity: 'Bursa', recipientDistrict: 'Nilüfer', recipientNeighbourhood: 'Ertuğrul', street1: 'Atatürk Cad. 12', street2: 'D:4', recipientAddress: 'Atatürk Cad. 12 D:4', recipientPostalCode: '16110', weight: 0.5, title: 'Bebek battaniyesi' },
  { orderId: 'm2', orderNumber: 'TY-90001', recipientName: 'Mehmet Demir', recipientPhone: '+905551112233', recipientEmail: 'm@example.com', recipientCity: 'İstanbul', recipientDistrict: 'Kadıköy', recipientNeighbourhood: '', street1: 'Bağdat Cad. 100', street2: '', recipientAddress: 'Bağdat Cad. 100', recipientPostalCode: '', weight: 1.2, title: 'Ahşap kutu' },
  { orderId: 'm3', orderNumber: 'HB-5', recipientName: 'Zeynep Ak', recipientPhone: '+905009998877', recipientEmail: '', recipientCity: 'Ankara', recipientDistrict: 'Çankaya', recipientNeighbourhood: 'Kızılay', street1: 'Atatürk Blv. 1', street2: '', recipientAddress: 'Atatürk Blv. 1', recipientPostalCode: '06420', weight: 2, title: '' },
];

function dhlDraftFor(o: (typeof mngOrders)[number]): LabelDraft {
  return draft({
    orderId: o.orderId, orderNumber: o.orderNumber, marketplace: 'trendyol', carrier: 'dhl', service: '1',
    shipTo: { name: o.recipientName, phone: o.recipientPhone, email: o.recipientEmail, country: 'TR', street1: o.street1, street2: o.street2, city: o.recipientCity, state: '', postal: o.recipientPostalCode, district: o.recipientDistrict, neighbourhood: o.recipientNeighbourhood },
    pkg: { weightKg: o.weight ?? 0.5, packaging: '1' },
    options: { sendTracking: true, signature: '', labelStock: 'PAPER_LETTER', dhl: { paymentType: 1, deliveryType: 1, packagingType: 1, cod: false, codAmount: 0, smsShipped: true, smsDelivered: true, content: o.title || o.orderNumber } },
  });
}

describe('DHL eCommerce adapter = legacy MngLabelDrawer (3 fixtures)', () => {
  for (const o of mngOrders) {
    it(`order ${o.orderNumber}`, () => {
      const steps = buildDhlRequest(dhlDraftFor(o));
      expect(steps[0].url).toBe('/api/labels/mng');
      expect(bodyOf(steps[0])).toBe(legacyMng(o));
    });
  }
  it('forceCancelled retry', () => {
    expect(bodyOf(buildDhlRequest(dhlDraftFor(mngOrders[0]), { forceCancelled: true })[0])).toBe(legacyMng(mngOrders[0], true));
  });
  it('cash on delivery sends the amount; parse takes the barcode when no tracking number', () => {
    const d = dhlDraftFor(mngOrders[0]);
    d.options.dhl = { ...d.options.dhl!, cod: true, codAmount: 250 };
    const b = JSON.parse(bodyOf(buildDhlRequest(d)[0]));
    expect(b.isCOD).toBe(true);
    expect(b.codAmount).toBe(250);
    const r = parseDhlResult({ success: true, barcode: 'MNG123456789', labelBase64: 'JVBERi0x' });
    expect(r).toMatchObject({ ok: true, trackingNumber: 'MNG123456789', labelHref: 'data:application/pdf;base64,JVBERi0x' });
  });
});

describe('Save details without creating', () => {
  it('FedEx runs the two legacy prepare calls; UPS/DHL send address + package only', () => {
    const f = buildSaveDetailsSteps(fedexDraftFor(fedexRows[0]));
    expect(f.map((s) => s.url)).toEqual(['/api/orders/update', '/api/orders/ord_1/update-options']);
    const u = buildSaveDetailsSteps(upsDraftFor(upsOrders[0]));
    expect(u).toHaveLength(1);
    const body = JSON.parse(bodyOf(u[0]));
    expect(body.fedexServiceType).toBeUndefined();
    expect(body.shippingAddress).toMatchObject({ firstName: 'Sarah', lastName: 'Miller', postal: '78701', country: 'US' });
  });
});
