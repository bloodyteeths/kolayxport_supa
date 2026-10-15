// lib/shipping/submit/dhl.ts — orders §6.2 DHL eCommerce (MNG API) adapter: POST /api/labels/mng with the
// legacy `MngLabelDrawer.handleSubmit` body (same keys, same order). `recipient.address` = street1 + street2
// (legacy `buildMngOrder`), `recipient.street` stays '' as before. Difference by design (§6.1): the recipient
// phone is the order's, never the seller's (legacy fell back to `shipperPhoneNumber`).
import {
  JSON_HEADERS, executeSteps,
  type LabelDraft, type LabelStep, type LabelSubmitResult, type SubmitContext,
} from '../labelDraft';
import { toLabelHref } from '../labelLinks';

const DHL_DEFAULTS = { paymentType: 1, deliveryType: 1, packagingType: 1, cod: false, codAmount: 0, smsShipped: true, smsDelivered: true, content: '' };

export function buildDhlRequest(draft: LabelDraft, ctx: SubmitContext = {}): LabelStep[] {
  const s = draft.shipTo;
  const o = { ...DHL_DEFAULTS, ...(draft.options.dhl || {}) };
  const packagingType = Number(draft.pkg.packaging) || o.packagingType || 1;
  const body = {
    orderId: draft.orderId,
    forceCancelled: ctx.forceCancelled || undefined,
    recipient: {
      name: s.name,
      phone: s.phone,
      email: s.email,
      city: s.city,
      district: s.district,
      neighbourhood: s.neighbourhood,
      street: '',
      address: `${s.street1} ${s.street2}`.trim(),
      postalCode: s.postal,
    },
    packageInfo: {
      weight: Number(draft.pkg.weightKg) || 0.5,
      width: draft.pkg.widthCm ? Number(draft.pkg.widthCm) : undefined,
      height: draft.pkg.heightCm ? Number(draft.pkg.heightCm) : undefined,
      length: draft.pkg.lengthCm ? Number(draft.pkg.lengthCm) : undefined,
    },
    serviceType: Number(draft.service) || 1,
    paymentType: o.paymentType,
    deliveryType: o.deliveryType,
    packagingType,
    isCOD: o.cod,
    codAmount: o.cod ? Number(o.codAmount) || 0 : 0,
    content: o.content,
    smsPreference1: false,
    smsPreference2: o.smsShipped,
    smsPreference3: o.smsDelivered,
    description: '',
  };
  return [{ kind: 'label', url: '/api/labels/mng', init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) } }];
}

/** `{ success, trackingNumber, barcode, labelUrl, labelBase64 }` (PDF). */
export function parseDhlResult(body: unknown): LabelSubmitResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  if (!b.success) {
    const msg = [b.error, b.message].find((m) => typeof m === 'string' && m.trim()) as string | undefined;
    return { ok: false, kind: 'error', message: (msg || 'DHL eCommerce label creation failed').slice(0, 200) };
  }
  const tracking = [b.trackingNumber, b.barcode].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  return {
    ok: true, carrier: 'dhl',
    trackingNumber: tracking ?? '',
    labelHref: toLabelHref(b.labelUrl, b.labelBase64),
    barcode: typeof b.barcode === 'string' ? b.barcode : null,
  };
}

export function submitDhl(draft: LabelDraft, ctx: SubmitContext = {}, fetchImpl?: typeof fetch): Promise<LabelSubmitResult> {
  return executeSteps(buildDhlRequest(draft, ctx), parseDhlResult, fetchImpl);
}
