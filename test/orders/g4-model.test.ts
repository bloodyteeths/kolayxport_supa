// orders §13 G4 — LabelDraft prefill (§6.1), eligibility matrix (§6.3), validation, bulk runner, tracking push
// parsing and package-preset read-merge-write.
import { describe, expect, it, vi } from 'vitest';
import {
  draftFromOrder, executeSteps, splitName, toIso2, withCarrier, applyPreset, carrierMessage,
  type LabelDraft, type LabelOrderInput, type LabelSubmitResult,
} from '@/lib/shipping/labelDraft';
import {
  carrierEligibility, eligibilityAll, noCarrierConnected, pickDefaultCarrier, rateRows, runLabelQueue, serviceCodes, packagingCodes,
  servicesFor, SERVICES, type ConnectionSnapshot,
} from '@/lib/shipping/carriers';
import { validateDraft, senderMissing, missingShipTo, requiredShipTo } from '@/lib/shipping/validate';
import { parseTrackingResult, buildTrackingRequest, pushTracking } from '@/lib/shipping/submit/tracking';
import { mergePreset, presetsPatchBody, sanitizePresets } from '@/lib/shipping/usePackagePresets';
import { baseCurrencyOf, senderSummary } from '@/lib/shipping/useSenderProfile';

const sender = {
  shipperName: 'Belle Couture Gifts', shipperPersonName: 'Tamer S.', shipperPhoneNumber: '+905321112233', shipperStreet1: 'Atatürk Cad. 12',
  shipperCity: 'Bursa', shipperPostalCode: '16110', shipperCountryCode: 'TR', defaultCurrencyCode: 'USD', dutiesPaymentType: 'SENDER',
  shipperStateCode: 'Nilüfer',
};

const etsyOrder: LabelOrderInput = {
  id: 'o1', orderNumber: '3891', marketplace: 'BelleCoutureGifts', store: { marketplace: 'etsy' }, currency: 'USD', total: 144.98,
  shipTo: { name: 'Sarah Miller', phone: '+1 555 0134', email: 'sarah@example.com', country: 'US', street1: '12 Oak St', street2: 'Apt 4', city: 'Austin', state: 'TX', postal: '78701', district: '', neighbourhood: '' },
  items: [
    { id: 'i1', title: 'Personalized Baby Blanket', quantity: 2, unitPrice: 69.99, weightKg: 0.3, hsCode: '630210', originCountry: 'TR', sku: 'BB' },
    { id: 'i2', title: 'Gift wrap', quantity: 1, unitPrice: 5, weightKg: 0.2, hsCode: null, originCountry: null },
  ],
  raw: { id: 'o1', recipientPhone: '', line_items: [] },
};

const ctx = { sender, presets: [], baseCurrency: 'USD' };

describe('draftFromOrder (§6.1 prefill rules)', () => {
  it('takes the recipient phone from the order, never the sender phone', () => {
    const d = draftFromOrder(etsyOrder, ctx);
    expect(d.shipTo.phone).toBe('+1 555 0134');
    const noPhone = draftFromOrder({ ...etsyOrder, shipTo: { ...etsyOrder.shipTo, phone: '' } }, ctx);
    expect(noPhone.shipTo.phone).toBe('');
  });
  it('falls back to the raw API order (recipient*, Trendyol shipmentAddress) field by field', () => {
    const d = draftFromOrder({
      id: 'o2', orderNumber: 'TY-1', marketplace: 'Trendyol',
      raw: { recipientFirstName: 'Ayşe', recipientLastName: 'Kaya', recipientCity: 'Bursa', recipientCountry: 'Türkiye',
        rawData: { shipmentAddress: { district: 'Nilüfer', neighborhood: 'Ertuğrul', phone: '05321234567', address1: 'Atatürk Cad. 12' } } },
    }, ctx);
    expect(d.shipTo).toMatchObject({ name: 'Ayşe Kaya', city: 'Bursa', country: 'TR', district: 'Nilüfer', neighbourhood: 'Ertuğrul', phone: '05321234567', street1: 'Atatürk Cad. 12' });
  });
  it('one customs line per item, order currency, DDP from dutiesPaymentType SENDER, invoice INV-{number}', () => {
    const d = draftFromOrder(etsyOrder, ctx);
    expect(d.customs.items).toHaveLength(2);
    expect(d.customs.items[1]).toMatchObject({ description: 'Gift wrap', quantity: 1, unitValue: 5, origin: 'TR' });
    expect(d.customs.currency).toBe('USD');
    expect(d.customs.terms).toBe('DDP');
    expect(d.customs.invoiceNumber).toBe('INV-3891');
    expect(draftFromOrder(etsyOrder, { ...ctx, sender: { ...sender, dutiesPaymentType: 'RECIPIENT' } }).customs.terms).toBe('DAP');
  });
  it('weight = Σ item weight × qty, else profile default, else 0.5; a default preset wins', () => {
    expect(draftFromOrder(etsyOrder, ctx).pkg.weightKg).toBe(0.8);
    const noWeights = { ...etsyOrder, items: [{ id: 'i1', title: 'X', quantity: 1, unitPrice: 1, weightKg: 0.01 }] };
    expect(draftFromOrder(noWeights, ctx).pkg.weightKg).toBe(0.5);
    expect(draftFromOrder(noWeights, { ...ctx, sender: { ...sender, defaultWeightKg: '1.2' } }).pkg.weightKg).toBe(1.2);
    const preset = { id: 'p', name: 'Small pak', weightKg: 0.4, packaging: { fedex: 'FEDEX_ENVELOPE' }, isDefault: true };
    const d = draftFromOrder(etsyOrder, { ...ctx, presets: [preset], carrier: 'fedex' }, { validPackaging: packagingCodes });
    expect(d.pkg).toMatchObject({ weightKg: 0.4, packaging: 'FEDEX_ENVELOPE' });
  });
  it('service: the profile default when it belongs to the carrier, else the carrier default', () => {
    expect(draftFromOrder(etsyOrder, { ...ctx, carrier: 'ups', sender: { ...sender, defaultServiceType: 'INTERNATIONAL_PRIORITY' } }, { validServices: serviceCodes }).service).toBe('65');
    expect(draftFromOrder(etsyOrder, { ...ctx, carrier: 'fedex', sender: { ...sender, defaultServiceType: 'FEDEX_INTERNATIONAL_ECONOMY' } }, { validServices: serviceCodes }).service).toBe('FEDEX_INTERNATIONAL_ECONOMY');
    expect(draftFromOrder(etsyOrder, { ...ctx, carrier: 'dhl' }, { validServices: serviceCodes }).service).toBe('1');
  });
  it('canonical marketplace drives tracking; manual orders never push tracking', () => {
    expect(draftFromOrder(etsyOrder, ctx).marketplace).toBe('etsy');
    expect(draftFromOrder({ ...etsyOrder, store: { marketplace: 'manual' } }, ctx).options.sendTracking).toBe(false);
    expect(draftFromOrder(etsyOrder, { ...ctx, sendTracking: false }).options.sendTracking).toBe(false);
  });
  it('withCarrier / applyPreset move packaging and signature to the new carrier', () => {
    const d = draftFromOrder(etsyOrder, { ...ctx, carrier: 'fedex' });
    const u = withCarrier(d, 'ups', '08', { validPackaging: packagingCodes('ups') });
    expect(u).toMatchObject({ carrier: 'ups', service: '08', pkg: { packaging: 'UPS_PAK' }, options: { signature: 'NO_SIGNATURE' } });
    const p = applyPreset(u, { id: 'x', name: 'Box', weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 });
    expect(p.pkg).toMatchObject({ weightKg: 2, lengthCm: 30, packaging: 'UPS_PAK' });
  });
  it('helpers: splitName at the last space, toIso2 for names in EN/TR', () => {
    expect(splitName('Mary Ann Smith')).toEqual({ first: 'Mary Ann', last: 'Smith' });
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(toIso2('United States')).toBe('US');
    expect(toIso2('Almanya')).toBe('DE');
    expect(toIso2('türkiye')).toBe('TR');
    expect(toIso2('Atlantis')).toBe('');
  });
});

describe('carrier catalog', () => {
  it('UPS services are deduped by code; FedEx offers only the services the route accepts', () => {
    const ups = servicesFor('ups').map((s) => s.code);
    expect(new Set(ups).size).toBe(ups.length);
    expect(ups).toEqual(['65', '07', '54', '08', '11']);
    expect(serviceCodes('fedex')).toEqual(['INTERNATIONAL_PRIORITY', 'FEDEX_INTERNATIONAL_ECONOMY']);
    expect(SERVICES.every((s) => !/MNG/i.test(s.name))).toBe(true);
  });
});

describe('eligibility matrix (§6.3)', () => {
  const ready = (connected: boolean, reason?: string): ConnectionSnapshot => ({ state: 'ready', connected, reason });
  const intl = { senderCountry: 'TR', recipientCountry: 'US' };
  const dom = { senderCountry: 'TR', recipientCountry: 'TR' };
  it.each([
    ['fedex', ready(false), intl, { available: false, reason: 'notConnected' }],
    ['ups', ready(false, 'incomplete_credentials'), intl, { available: false, reason: 'incomplete' }],
    ['dhl', ready(true), intl, { available: false, reason: 'domesticOnly' }],
    ['dhl', ready(true), { senderCountry: 'US', recipientCountry: 'TR' }, { available: false, reason: 'domesticOnly' }],
    ['dhl', ready(true), dom, { available: true }],
    ['fedex', ready(true), dom, { available: true }],
    ['ups', { state: 'error' } as ConnectionSnapshot, intl, { available: true, checkFailed: true }],
    ['fedex', ready(true), intl, { available: true }],
  ] as const)('%s %j %j', (carrier, conn, route, expected) => {
    expect(carrierEligibility(carrier, conn, route)).toMatchObject(expected);
  });
  it('TR → TR sorts DHL first, FedEx/UPS after it', () => {
    const all = eligibilityAll({ fedex: ready(true), ups: ready(true), dhl: ready(true) }, dom).map((e) => e.carrier);
    expect(all).toEqual(['dhl', 'fedex', 'ups']);
    expect(eligibilityAll({ fedex: ready(true), ups: ready(true), dhl: ready(true) }, intl).map((e) => e.carrier)).toEqual(['fedex', 'ups', 'dhl']);
  });
  it('default carrier: DHL for domestic when connected, else last used, else first of FedEx → UPS', () => {
    const elig = eligibilityAll({ fedex: ready(true), ups: ready(true), dhl: ready(true) }, dom);
    expect(pickDefaultCarrier(elig, { domestic: true, lastCarrier: 'ups' })).toBe('dhl');
    const intlElig = eligibilityAll({ fedex: ready(false), ups: ready(true), dhl: ready(true) }, intl);
    expect(pickDefaultCarrier(intlElig, { domestic: false, lastCarrier: 'fedex' })).toBe('ups');
    expect(pickDefaultCarrier(eligibilityAll({ fedex: ready(true), ups: ready(true), dhl: ready(false) }, intl), { domestic: false, lastCarrier: 'ups' })).toBe('ups');
    expect(pickDefaultCarrier(intlElig, { domestic: false, preferred: 'ups' })).toBe('ups');
  });
  it('rate rows keep unavailable carriers listed (one DHL row when unavailable)', () => {
    const rows = rateRows(eligibilityAll({ fedex: ready(true), ups: ready(false), dhl: ready(true) }, intl));
    expect(rows.filter((r) => r.carrier === 'dhl')).toHaveLength(1);
    expect(rows.filter((r) => r.carrier === 'ups').every((r) => r.eligibility.reason === 'notConnected')).toBe(true);
  });
  it('noCarrierConnected only when every carrier is known and not connected', () => {
    expect(noCarrierConnected({ fedex: ready(false), ups: ready(false), dhl: ready(false) })).toBe(true);
    expect(noCarrierConnected({ fedex: ready(false), ups: { state: 'error' }, dhl: ready(false) })).toBe(false);
    expect(noCarrierConnected({ fedex: ready(false), ups: ready(false, 'incomplete_credentials'), dhl: ready(false) })).toBe(false);
  });
});

describe('validation (§6.2 / §6.3)', () => {
  const base = (): LabelDraft => draftFromOrder(etsyOrder, { ...ctx, carrier: 'fedex' });
  it('a complete international draft is valid', () => {
    expect(validateDraft(base(), { international: true })).toEqual({});
  });
  it('US/CA need a state; postal, city, street, country, name are required for FedEx/UPS', () => {
    const d = base();
    d.shipTo = { ...d.shipTo, state: '', postal: '', name: '' };
    const e = validateDraft(d, { international: true });
    expect(e['shipTo.state']).toEqual({ code: 'stateRequired', params: { country: 'US' } });
    expect(e['shipTo.postal']?.code).toBe('required');
    expect(Object.keys(e)[0]).toBe('shipTo.name');
  });
  it('DHL needs phone and district; postal is optional', () => {
    const d = { ...base(), carrier: 'dhl' as const, shipTo: { ...base().shipTo, country: 'TR', phone: '', district: '', postal: '' } };
    const e = validateDraft(d, { international: false });
    expect(e['shipTo.phone']?.code).toBe('phoneDhl');
    expect(e['shipTo.district']?.code).toBe('districtDhl');
    expect(e['shipTo.postal']).toBeUndefined();
    expect(requiredShipTo('dhl', 'TR')).toContain('district');
  });
  it('weight > 0, UPS description ≤ 35, HS code 6–10 digits', () => {
    const d = { ...base(), carrier: 'ups' as const };
    d.pkg = { ...d.pkg, weightKg: 0 };
    d.customs = { ...d.customs, items: [{ ...d.customs.items[0], description: 'x'.repeat(36), hsCode: '12' }] };
    const e = validateDraft(d, { international: true });
    expect(e['pkg.weightKg']?.code).toBe('weight');
    expect(e['customs.items.0.description']).toEqual({ code: 'maxChars', params: { max: 35 } });
    expect(e['customs.items.0.hsCode']?.code).toBe('hsFormat');
    expect(validateDraft(d, { international: false })['customs.items.0.hsCode']).toBeUndefined();
  });
  it('sender profile completeness and missing ship-to for bulk rows', () => {
    expect(senderMissing(sender)).toEqual([]);
    expect(senderMissing({ ...sender, shipperPhoneNumber: '' })).toEqual(['shipperPhoneNumber']);
    expect(senderMissing(null)).toHaveLength(6);
    const d = base();
    d.shipTo.postal = '';
    expect(missingShipTo(d)).toEqual(['postal']);
  });
});

describe('executeSteps', () => {
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const steps = [
    { kind: 'prepare' as const, url: '/a', init: { method: 'POST' as const, headers: {}, body: '{}' } },
    { kind: 'label' as const, url: '/b', init: { method: 'POST' as const, headers: {}, body: '{}' } },
  ];
  const parse = (b: unknown): LabelSubmitResult => ({ ok: true, carrier: 'fedex', trackingNumber: String((b as { t: string }).t), labelHref: null });
  it('maps 409 guard, 402 limit, prepare failure and success', async () => {
    expect(await executeSteps(steps, parse, vi.fn().mockResolvedValueOnce(res(200, {})).mockResolvedValueOnce(res(409, { code: 'ORDER_CANCELLED' })) as never))
      .toEqual({ ok: false, kind: 'guard', code: 'ORDER_CANCELLED' });
    expect(await executeSteps(steps, parse, vi.fn().mockResolvedValueOnce(res(200, {})).mockResolvedValueOnce(res(402, {})) as never)).toEqual({ ok: false, kind: 'limit' });
    expect(await executeSteps(steps, parse, vi.fn().mockResolvedValueOnce(res(400, { error: 'Invalid FedEx Service Type: X' })) as never))
      .toMatchObject({ ok: false, kind: 'error', message: 'Invalid FedEx Service Type: X' });
    expect(await executeSteps(steps, parse, vi.fn().mockResolvedValueOnce(res(200, {})).mockResolvedValueOnce(res(200, { t: '794' })) as never))
      .toMatchObject({ ok: true, trackingNumber: '794' });
  });
  it('carrier messages are text only, ≤ 200 chars, never JSON', () => {
    expect(carrierMessage({ error: '{"a":1}' }, 'fallback')).toBe('fallback');
    expect(carrierMessage({ errors: [{ message: 'Postal code is invalid for US' }] }, 'f')).toBe('Postal code is invalid for US');
    expect(carrierMessage({ error: 'x'.repeat(300) }, 'f')).toHaveLength(200);
  });
});

describe('bulk runner (sequential, stop, retry)', () => {
  const d = (id: string) => ({ id, draft: { orderId: id } as LabelDraft });
  it('runs one at a time in order', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const submit = vi.fn(async (dr: LabelDraft) => {
      active += 1; maxActive = Math.max(maxActive, active); order.push(dr.orderId);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return { ok: true, carrier: 'fedex', trackingNumber: `T${dr.orderId}`, labelHref: null } as LabelSubmitResult;
    });
    const updates: string[] = [];
    const s = await runLabelQueue([d('a'), d('b'), d('c')], { submit, onUpdate: (id, o) => updates.push(`${id}:${o.ok ? 'ok' : o.kind}`) });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(updates).toEqual(['a:running', 'a:ok', 'b:running', 'b:ok', 'c:running', 'c:ok']);
    expect(s).toMatchObject({ created: ['a', 'b', 'c'], failed: [], notStarted: [] });
  });
  it('"Stop after current" finishes the running job and leaves the rest not started', async () => {
    let stop = false;
    const submit = vi.fn(async () => { stop = true; return { ok: true, carrier: 'ups', trackingNumber: '1Z', labelHref: null } as LabelSubmitResult; });
    const s = await runLabelQueue([d('a'), d('b'), d('c')], { submit, onUpdate: () => undefined, shouldStop: () => stop });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ created: ['a'], notStarted: ['b', 'c'], stopped: true });
  });
  it('a 402 stops the queue; failures continue; forced ids get forceCancelled', async () => {
    const results: Record<string, LabelSubmitResult> = {
      a: { ok: false, kind: 'error', message: 'Postal code invalid' },
      b: { ok: true, carrier: 'fedex', trackingNumber: 'T', labelHref: null },
      c: { ok: false, kind: 'limit' },
    };
    const seen: Array<{ id: string; force?: boolean }> = [];
    const submit = vi.fn(async (dr: LabelDraft, c: { forceCancelled?: boolean }) => { seen.push({ id: dr.orderId, force: c.forceCancelled }); return results[dr.orderId]; });
    const s = await runLabelQueue([d('a'), d('b'), d('c'), d('e')], { submit, onUpdate: () => undefined, forceIds: new Set(['b']) });
    expect(s).toMatchObject({ created: ['b'], failed: ['a', 'c'], notStarted: ['e'], limitReached: true, stopped: false });
    expect(seen).toEqual([{ id: 'a', force: undefined }, { id: 'b', force: true }, { id: 'c', force: undefined }]);
  });
  it('retrying only the failed ids re-sends just those', async () => {
    const submit = vi.fn(async () => ({ ok: true, carrier: 'fedex', trackingNumber: 'T', labelHref: null } as LabelSubmitResult));
    await runLabelQueue([d('a')], { submit, onUpdate: () => undefined });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('tracking push (honest result)', () => {
  it('reads etsyPending as queued and "push failed" 200s as failures', () => {
    expect(parseTrackingResult(200, { success: true, etsyPending: true })).toEqual({ status: 'queued' });
    expect(parseTrackingResult(200, { success: true, message: 'Tracking saved locally. eBay push failed: 400' }).status).toBe('failed');
    expect(parseTrackingResult(200, { success: true, message: 'Tracking saved locally (no Veeqo API key configured — nothing pushed to a marketplace).' }).status).toBe('failed');
    expect(parseTrackingResult(200, { success: true, message: 'Tracking submitted to Amazon. Processing may take a few minutes.' })).toEqual({ status: 'sent' });
    expect(parseTrackingResult(500, { error: 'Failed to submit tracking number' }).status).toBe('failed');
  });
  it('sends the legacy dialog body with the Veeqo carrier id', async () => {
    const { url, init } = buildTrackingRequest('o 1', ' 794612900012 ', 'FedEx');
    expect(url).toBe('/api/orders/o%201/submit-tracking');
    expect(JSON.parse(init.body)).toEqual({ trackingNumber: '794612900012', carrierId: 2, notifyCustomer: true, updateRemoteOrder: true });
    const f = vi.fn();
    expect(await pushTracking('o1', 'short', 'UPS', f as never)).toMatchObject({ status: 'failed' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('package presets (A5 read-merge-write)', () => {
  it('replaces by id, keeps one default, caps at 20', () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, weightKg: 1, isDefault: i === 3 }));
    const next = mergePreset(list, { id: 'new', name: 'New', weightKg: 0.5, isDefault: true });
    expect(next).toHaveLength(20);
    expect(next.filter((p) => p.isDefault).map((p) => p.id)).toEqual(['new']);
    expect(next[0].id).toBe('p1');
    expect(mergePreset(list, { id: 'p2', name: 'Renamed', weightKg: 2 }).find((p) => p.id === 'p2')?.name).toBe('Renamed');
  });
  it('keeps every other shippingSettings key (PATCH replaces the whole object)', () => {
    const body = presetsPatchBody({ etgbEnabled: true, etgbRecipientEmail: 'gumruk@x.com' }, [{ id: 'a', name: 'A', weightKg: 1 }]);
    expect(body).toEqual({ shippingSettings: { etgbEnabled: true, etgbRecipientEmail: 'gumruk@x.com', packagePresets: [{ id: 'a', name: 'A', weightKg: 1 }] } });
    expect(sanitizePresets([{ name: 'ok', weightKg: '0.5' }, null, { weightKg: 1 }])).toEqual([{ name: 'ok', weightKg: 0.5 }]);
  });
});

describe('sender profile helpers', () => {
  it('base currency: profile currency, else TRY for TR, else USD; one-line summary', () => {
    expect(baseCurrencyOf({ defaultCurrencyCode: 'eur' })).toBe('EUR');
    expect(baseCurrencyOf({ shipperCountryCode: 'TR' })).toBe('TRY');
    expect(baseCurrencyOf(null)).toBe('USD');
    expect(senderSummary(sender)).toBe('Belle Couture Gifts · Tamer S. · Atatürk Cad. 12, Bursa Nilüfer 16110, TR · +905321112233');
  });
});
