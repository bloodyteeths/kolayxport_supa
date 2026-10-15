// lib/shipping/submit/fedex.ts — orders §6.2 FedEx adapter. Three calls, byte-compatible with the legacy
// labels page (`handleGenerateLabel`, pages/app/labels.tsx L2224–2380): POST /api/orders/update →
// PATCH /api/orders/:id/update-options → POST /api/orders/:id/generate-label. Same keys, same order.
// Differences by design (§6.1): every order item becomes a `line_items[]` entry (legacy sent the clicked item
// only), `customsValue` is Σ qty × unit value, and the recipient phone is the order's (legacy left it empty
// whenever the row had none).
// Line weights are whole-line (per-unit item weight × quantity, `lineWeightKg`). `termsOfSale`,
// `fedexDutiesPaymentType`, `signatureType` and `labelStockType` are sent as before but generate-label ignores
// them today (duties = ShipperProfile.dutiesPaymentType, stock hardcoded PAPER_4X6, no signature), so the panel
// shows duties read-only and renders no signature / label-format control.
import {
  JSON_HEADERS, executeSteps, splitName, customsTotal, lineWeightKg,
  type LabelDraft, type LabelStep, type LabelSubmitResult, type SubmitContext,
} from '../labelDraft';
import { toLabelHref } from '../labelLinks';

const DUTIES_PAYER: Record<'DAP' | 'DDP', string> = { DDP: 'SENDER', DAP: 'RECIPIENT' };

export function buildFedexRequest(draft: LabelDraft, ctx: SubmitContext = {}): LabelStep[] {
  const { first, last } = splitName(draft.shipTo.name);
  const s = draft.shipTo;
  const items = draft.customs.items;
  const lead = items[0];
  const orderItemId = lead?.itemId || undefined;
  const commodityDesc = lead?.description || 'Product';
  const fedexOpts = draft.options.fedex ?? { pickupType: 'DROP_BOX', sendCommercialInvoiceViaEtd: true };

  const shippingAddress = {
    firstName: first, lastName: last, street1: s.street1, street2: s.street2, city: s.city, state: s.state,
    postal: s.postal, country: s.country, phone: s.phone, email: s.email,
  };

  // Step 1: /api/orders/update — the legacy body (id, itemId, shippingAddress, weight, hsCode, countryOfOrigin, commodityDesc).
  // `weight` writes the lead OrderItem's weightKg: only the one-line case sends the package weight (as before).
  const update = {
    id: draft.orderId,
    itemId: orderItemId,
    shippingAddress,
    weight: items.length === 1 ? draft.pkg.weightKg : lead?.weightKg,
    hsCode: lead?.hsCode ?? '',
    countryOfOrigin: lead?.origin ?? '',
    commodityDesc,
  };

  const line_items = items.map((it, i) => ({
    id: it.itemId || undefined,
    title: it.description || 'Product',
    quantity: it.quantity > 0 ? it.quantity : 1,
    unitPrice: it.unitValue,
    weight: lineWeightKg(draft, i),
    hs_code: it.hsCode,
    country_of_origin: it.origin,
    sku: it.sku,
  }));

  const options = {
    orderId: draft.orderId,
    shippingAddress,
    line_items,
    weightKg: draft.pkg.weightKg,
    harmonizedCode: lead?.hsCode ?? '',
    countryOfMfg: lead?.origin ?? '',
    commodityDesc,
    termsOfSale: draft.customs.terms,
    sendCommercialInvoiceViaEtd: fedexOpts.sendCommercialInvoiceViaEtd,
    fedexServiceType: draft.service,
    fedexPackagingType: draft.pkg.packaging,
    fedexPickupType: fedexOpts.pickupType,
    fedexDutiesPaymentType: DUTIES_PAYER[draft.customs.terms],
    packageLength: draft.pkg.lengthCm,
    packageWidth: draft.pkg.widthCm,
    packageHeight: draft.pkg.heightCm,
    dimensionUnits: 'CM',
    labelStockType: draft.options.labelStock,
    signatureType: draft.options.signature,
    customsValue: customsTotal(items),
    currency: draft.customs.currency,
  };

  const generate = {
    line_items: options.line_items,
    weightKg: options.weightKg,
    harmonizedCode: options.harmonizedCode,
    countryOfMfg: options.countryOfMfg,
    commodityDesc: options.commodityDesc,
    termsOfSale: options.termsOfSale,
    sendCommercialInvoiceViaEtd: options.sendCommercialInvoiceViaEtd,
    fedexServiceType: options.fedexServiceType,
    fedexPackagingType: options.fedexPackagingType,
    fedexPickupType: options.fedexPickupType,
    fedexDutiesPaymentType: options.fedexDutiesPaymentType,
    packageLength: options.packageLength,
    packageWidth: options.packageWidth,
    packageHeight: options.packageHeight,
    dimensionUnits: options.dimensionUnits,
    labelStockType: options.labelStockType,
    signatureType: options.signatureType,
    customsValue: options.customsValue,
    currency: options.currency,
    recipientFirstName: first,
    recipientLastName: last,
    recipientStreet1: s.street1,
    recipientStreet2: s.street2,
    recipientCity: s.city,
    recipientState: s.state,
    recipientPostal: s.postal,
    recipientCountry: s.country,
    recipientPhone: s.phone,
    recipientEmail: s.email,
    orderId: draft.orderId,
    orderItemId,
    forceCancelled: ctx.forceCancelled || undefined,
  };

  const id = encodeURIComponent(draft.orderId);
  return [
    { kind: 'prepare', url: '/api/orders/update', init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(update) } },
    { kind: 'prepare', url: `/api/orders/${id}/update-options`, init: { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(options) } },
    { kind: 'label', url: `/api/orders/${id}/generate-label`, init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(generate) } },
  ];
}

/** `{ trackingNumber, labelUrl, alerts }` from generate-label. Alerts become text lines (never JSON). */
export function parseFedexResult(body: unknown): LabelSubmitResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const trackingNumber = typeof b.trackingNumber === 'string' ? b.trackingNumber : '';
  if (!trackingNumber) return { ok: false, kind: 'error', message: typeof b.error === 'string' ? b.error.slice(0, 200) : 'FedEx returned no tracking number' };
  const alerts = Array.isArray(b.alerts)
    ? b.alerts.map((a: unknown) => (typeof a === 'string' ? a : a && typeof a === 'object' && typeof (a as any).message === 'string' ? (a as any).message : null))
      .filter((m: string | null): m is string => !!m).map((m: string) => m.slice(0, 200))
    : [];
  return { ok: true, carrier: 'fedex', trackingNumber, labelHref: toLabelHref(b.labelUrl, b.labelBase64), alerts };
}

export function submitFedex(draft: LabelDraft, ctx: SubmitContext = {}, fetchImpl?: typeof fetch): Promise<LabelSubmitResult> {
  return executeSteps(buildFedexRequest(draft, ctx), parseFedexResult, fetchImpl);
}
