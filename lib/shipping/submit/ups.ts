// lib/shipping/submit/ups.ts — orders §6.2 UPS adapter: POST /api/labels/ups with the legacy
// `UPSLabelDrawer.handleSubmit` body (same keys, same order, same number formatting).
// Differences by design (§6.1): one `internationalForms.products[]` line per order item (legacy: one line),
// `invoiceLineTotal` = Σ lines, `dutyPaymentType`/`termsOfShipment` follow the DAP/DDP choice.
// The route reads no package type or signature option, so none are sent (the legacy body sent none either).
import {
  JSON_HEADERS, executeSteps, lineWeightKg, round2,
  type LabelDraft, type LabelStep, type LabelSubmitResult, type SubmitContext,
} from '../labelDraft';
import { toLabelHref } from '../labelLinks';

/** UPS description limit (§6.1 "UPS description max 35 characters"). */
export const UPS_DESCRIPTION_MAX = 35;
// Wire format of the legacy body ("12.00" strings), not display text.
// eslint-disable-next-line no-restricted-syntax
const fmt2 = (n: number) => round2(n).toFixed(2);

export function buildUpsRequest(draft: LabelDraft, ctx: SubmitContext = {}): LabelStep[] {
  const s = draft.shipTo;
  const c = draft.customs;
  const items = c.items.length ? c.items : [{ itemId: '', description: 'Global Cargo Shipment', hsCode: '', quantity: 1, unitValue: 0.01, origin: 'TR' }];
  const products = items.map((it, i) => ({
    description: (it.description || 'Global Cargo Shipment').substring(0, UPS_DESCRIPTION_MAX),
    quantity: it.quantity > 0 ? it.quantity : 1,
    value: round2(it.unitValue),
    commodityCode: it.hsCode || '000000',
    unitOfMeasurement: 'PCS',
    weight: fmt2(lineWeightKg(draft, i)),
    originCountry: it.origin,
    // EU product identifiers; createUpsShipment sends them only to EU recipients.
    ...('pid' in it && it.pid ? { pid: it.pid } : {}),
  }));
  const lineTotal = products.reduce((sum, p) => sum + p.quantity * p.value, 0);

  const body = {
    userId: ctx.userId,
    orderId: draft.orderId,
    forceCancelled: ctx.forceCancelled || undefined,
    recipient: {
      name: s.name.trim(),
      phone: s.phone,
      street1: s.street1,
      street2: s.street2,
      city: s.city,
      stateCode: s.state,
      postalCode: s.postal,
      countryCode: s.country,
    },
    package: {
      weightKg: draft.pkg.weightKg,
      lengthCm: draft.pkg.lengthCm ? Number(draft.pkg.lengthCm) : undefined,
      widthCm: draft.pkg.widthCm ? Number(draft.pkg.widthCm) : undefined,
      heightCm: draft.pkg.heightCm ? Number(draft.pkg.heightCm) : undefined,
      dimensionUnits: 'CM',
    },
    serviceType: draft.service,
    isEdi: true,
    description: products[0].description,
    dutyPaymentType: c.terms === 'DDP' ? 'SHIPPER' : 'RECEIVER',
    internationalForms: {
      invoiceNumber: c.invoiceNumber,
      invoiceLineTotal: { currencyCode: c.currency, monetaryValue: fmt2(lineTotal) },
      exportReason: c.exportReason,
      currencyCode: c.currency,
      iossNumber: c.ioss,
      vatNumber: c.vat,
      products,
      soldTo: {
        name: s.name.trim(),
        attention: s.name.trim(),
        street1: s.street1,
        street2: s.street2,
        city: s.city,
        postalCode: s.postal,
        countryCode: s.country,
        phone: s.phone,
        state: s.state,
        email: s.email,
      },
      soldToState: s.state,
      soldToEmail: s.email,
      termsOfShipment: c.terms,
    },
  };
  return [{ kind: 'label', url: '/api/labels/ups', init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) } }];
}

/** `{ success, trackingNumber, labelUrl }`; `success: false` (HTTP 200) is a failure, as in the legacy drawer. */
export function parseUpsResult(body: unknown): LabelSubmitResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  if (!b.success) {
    const msg = [b.error, b.message].find((m) => typeof m === 'string' && m.trim()) as string | undefined;
    return { ok: false, kind: 'error', message: (msg || 'UPS label creation failed').slice(0, 200) };
  }
  return {
    ok: true, carrier: 'ups',
    trackingNumber: typeof b.trackingNumber === 'string' ? b.trackingNumber : '',
    labelHref: toLabelHref(b.labelUrl, b.labelBase64, 'image/gif'),
  };
}

export function submitUps(draft: LabelDraft, ctx: SubmitContext = {}, fetchImpl?: typeof fetch): Promise<LabelSubmitResult> {
  return executeSteps(buildUpsRequest(draft, ctx), parseUpsResult, fetchImpl);
}
