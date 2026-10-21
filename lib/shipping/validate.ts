// lib/shipping/validate.ts — orders §6.2 field matrix + §6.3 validation. Pure. Errors are codes + params; the
// panel turns them into `createLabel.validation.*` strings. Runs on blur (one field) and on submit (all).
import {
  EU_COUNTRIES, STATE_REQUIRED_COUNTRIES, clean,
  type CarrierKey, type LabelDraft, type SenderProfile, type ShipToField,
} from './labelDraft';
import { UPS_DESCRIPTION_MAX } from './submit/ups';
import { productIdProblems } from './euPid';

export type ValidationCode = 'required' | 'weight' | 'phoneDhl' | 'districtDhl' | 'stateRequired' | 'maxChars' | 'hsFormat' | 'pidRequired' | 'gtinInvalid';
export interface FieldError { code: ValidationCode; params?: Record<string, string | number> }

/**
 * Field paths, in display order (the first error gets focus): `shipTo.<field>`, `pkg.weightKg`,
 * `customs.items.<i>.description|hsCode`.
 */
export type FieldPath = `shipTo.${ShipToField}` | 'pkg.weightKg' | `customs.items.${number}.${'description' | 'hsCode' | 'pid'}`;
export type DraftErrors = Partial<Record<FieldPath, FieldError>>;

export interface ValidateContext {
  /** International (customs section shown). */
  international: boolean;
}

const SHIP_TO_ORDER: ShipToField[] = ['name', 'phone', 'email', 'country', 'street1', 'street2', 'city', 'postal', 'state', 'district', 'neighbourhood'];

/** Which ship-to fields a carrier renders (fields a carrier does not use are not rendered, §2.5). */
export function shipToFieldsFor(carrier: CarrierKey, country: string): ShipToField[] {
  if (carrier === 'dhl') return ['name', 'phone', 'email', 'country', 'street1', 'street2', 'city', 'postal', 'district', 'neighbourhood'];
  const base: ShipToField[] = ['name', 'phone', 'email', 'country', 'street1', 'street2', 'city', 'postal', 'state'];
  return country === 'TR' ? [...base, 'district', 'neighbourhood'] : base;
}

/** Required ship-to fields per carrier (§6.2). */
export function requiredShipTo(carrier: CarrierKey, country: string): ShipToField[] {
  if (carrier === 'dhl') return ['name', 'phone', 'street1', 'city', 'district'];
  const req: ShipToField[] = ['name', 'country', 'street1', 'city', 'postal'];
  if (STATE_REQUIRED_COUNTRIES.has(country)) req.push('state');
  return req;
}

export const showsIoss = (country: string) => EU_COUNTRIES.has(country);

const HS_RE = /^\d{6,10}$/;

export function validateDraft(draft: LabelDraft, ctx: ValidateContext): DraftErrors {
  const errors: DraftErrors = {};
  const s = draft.shipTo;
  const required = new Set(requiredShipTo(draft.carrier, s.country));
  for (const f of SHIP_TO_ORDER) {
    if (!required.has(f) || clean(s[f])) continue;
    if (draft.carrier === 'dhl' && f === 'phone') errors['shipTo.phone'] = { code: 'phoneDhl' };
    else if (draft.carrier === 'dhl' && f === 'district') errors['shipTo.district'] = { code: 'districtDhl' };
    else if (f === 'state') errors['shipTo.state'] = { code: 'stateRequired', params: { country: s.country } };
    else errors[`shipTo.${f}`] = { code: 'required' };
  }
  if (!(Number(draft.pkg.weightKg) > 0)) errors['pkg.weightKg'] = { code: 'weight' };
  if (ctx.international && draft.carrier !== 'dhl') {
    draft.customs.items.forEach((it, i) => {
      const desc = clean(it.description);
      if (!desc) errors[`customs.items.${i}.description`] = { code: 'required' };
      else if (draft.carrier === 'ups' && desc.length > UPS_DESCRIPTION_MAX) {
        errors[`customs.items.${i}.description`] = { code: 'maxChars', params: { max: UPS_DESCRIPTION_MAX } };
      }
      const hs = clean(it.hsCode).replace(/[.\s]/g, '');
      if (hs && !HS_RE.test(hs)) errors[`customs.items.${i}.hsCode`] = { code: 'hsFormat' };
      // EU customs reform: merchant + manufacturer IDs are mandatory, a barcode only when it is a real one.
      if (showsIoss(s.country)) {
        const problems = productIdProblems(it.pid);
        if (problems.includes('merchantMissing') || problems.includes('manufacturerMissing')) errors[`customs.items.${i}.pid`] = { code: 'pidRequired' };
        else if (problems.includes('gtinInvalid')) errors[`customs.items.${i}.pid`] = { code: 'gtinInvalid' };
      }
    });
  }
  return errors;
}

/** One field (blur). */
export function validateField(draft: LabelDraft, path: FieldPath, ctx: ValidateContext): FieldError | undefined {
  return validateDraft(draft, ctx)[path];
}

export const errorCount = (e: DraftErrors) => Object.keys(e).length;
export const firstErrorPath = (e: DraftErrors): FieldPath | undefined => Object.keys(e)[0] as FieldPath | undefined;

/** §6.3: the sender profile is incomplete when any of these is missing. */
export const SENDER_REQUIRED = ['shipperName', 'shipperPhoneNumber', 'shipperStreet1', 'shipperCity', 'shipperPostalCode', 'shipperCountryCode'] as const;
export function senderMissing(sender: SenderProfile | null | undefined): string[] {
  if (!sender) return [...SENDER_REQUIRED];
  return SENDER_REQUIRED.filter((k) => !clean(sender[k]));
}

/** Ship-to fields still missing for a carrier (bulk "Problem" rows, Fix address focus). */
export function missingShipTo(draft: LabelDraft): ShipToField[] {
  const required = requiredShipTo(draft.carrier, draft.shipTo.country);
  return required.filter((f) => !clean(draft.shipTo[f]));
}
