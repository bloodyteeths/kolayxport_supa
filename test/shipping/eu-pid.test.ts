// EU customs reform (1 Nov 2026; FedEx enforces 26 Oct): product identifiers per item to EU destinations, plus
// IOSS autofill. lib/shipping/euPid.ts rules, the label draft prefill, validation and the FedEx request body.
import { describe, expect, it } from 'vitest';
import {
  ETSY_IOSS, defaultProductIds, fedexRegulatoryDetail, isEuCountry, normalizeGtin, productIdProblems, suggestIoss,
} from '@/lib/shipping/euPid';
import { draftFromOrder, type LabelOrderInput } from '@/lib/shipping/labelDraft';
import { validateDraft } from '@/lib/shipping/validate';
import { buildFedexRequest } from '@/lib/shipping/submit/fedex';

describe('EU countries', () => {
  it('has the 27 members only', () => {
    for (const c of ['DE', 'FR', 'gr', 'EL', 'IE', 'NL']) expect(isEuCountry(c)).toBe(true);
    for (const c of ['GB', 'NO', 'CH', 'TR', 'US', 'XI', '']) expect(isEuCountry(c)).toBe(false);
  });
});

describe('GTIN', () => {
  it('accepts valid EAN-13 / UPC-A / GTIN-8 / GTIN-14 by check digit, rejects the rest', () => {
    expect(normalizeGtin('4006381333931')).toBe('4006381333931'); // EAN-13
    expect(normalizeGtin('036000291452')).toBe('036000291452'); // UPC-A
    expect(normalizeGtin('96385074')).toBe('96385074'); // GTIN-8
    expect(normalizeGtin('10012345678902')).toBe('10012345678902'); // GTIN-14
    expect(normalizeGtin('4006381333932')).toBe(''); // wrong check digit
    expect(normalizeGtin('0000000000000')).toBe('');
    expect(normalizeGtin('Does not apply')).toBe('');
    expect(normalizeGtin('')).toBe('');
  });
  it('turns an ISBN-10 into its EAN-13', () => {
    expect(normalizeGtin('0-306-40615-2')).toBe('9780306406157');
  });
});

describe('default product IDs', () => {
  it('merchant = SKU, else listing id, else item id; manufacturer = MPN or the same code; GTIN only when valid', () => {
    expect(defaultProductIds({ sku: 'ORG-BRD-6', listingRef: '1234', itemId: 'x' })).toEqual({ merchant: 'ORG-BRD-6', manufacturer: 'ORG-BRD-6', gtin: '' });
    expect(defaultProductIds({ sku: '', listingRef: '4455667788', itemId: 'x' })).toEqual({ merchant: '4455667788', manufacturer: '4455667788', gtin: '' });
    expect(defaultProductIds({ itemId: 'it_1' }).merchant).toBe('it_1');
    expect(defaultProductIds({ sku: 'A1', mpn: 'Does not apply', gtin: '4006381333931' })).toEqual({ merchant: 'A1', manufacturer: 'A1', gtin: '4006381333931' });
    expect(defaultProductIds({ sku: 'A1', mpn: 'SH123456-L' }).manufacturer).toBe('SH123456-L');
  });

  it('problems: both codes required; a typed barcode must be real; empty or NA is fine', () => {
    expect(productIdProblems({ merchant: 'A', manufacturer: 'A', gtin: '' })).toEqual([]);
    expect(productIdProblems({ merchant: 'A', manufacturer: 'A', gtin: 'NA' })).toEqual([]);
    expect(productIdProblems({ merchant: '', manufacturer: ' ', gtin: '123' })).toEqual(['merchantMissing', 'manufacturerMissing', 'gtinInvalid']);
  });
});

describe('FedEx regulatoryDetails', () => {
  it('EU_DE_MINIMIS with SKU as productId; no barcode → NA', () => {
    expect(fedexRegulatoryDetail({ merchant: 'ORG-BRD-6', manufacturer: 'ORG-BRD-6', gtin: '' })).toEqual({
      regulationCode: 'EU_DE_MINIMIS',
      productId: 'ORG-BRD-6',
      productIdType: 'SKU',
      details: { merchantProductId: 'ORG-BRD-6', nonStandardManufacturerProductId: 'ORG-BRD-6', standardManufacturerProductId: 'NA' },
    });
    expect(fedexRegulatoryDetail({ merchant: 'A1', manufacturer: 'M1', gtin: '4006381333931' })?.details.standardManufacturerProductId).toBe('4006381333931');
    expect(fedexRegulatoryDetail({ merchant: '', manufacturer: 'M1', gtin: '' })).toBeNull();
  });
});

describe('IOSS autofill', () => {
  it('eBay: the IOSS eBay put on the order (ebayReference)', () => {
    const rawData = { lineItems: [{ ebayCollectAndRemitTaxes: [{ taxType: 'VAT', ebayReference: { name: 'IOSS', value: 'IM2760000742' } }] }] };
    expect(suggestIoss({ country: 'DE', marketplace: 'ebay', rawData })).toEqual({ ioss: 'IM2760000742', source: 'marketplace' });
  });
  it("Etsy: Etsy's IOSS only when the receipt shows VAT collected", () => {
    expect(suggestIoss({ country: 'FR', marketplace: 'etsy', rawData: { total_vat_cost: { amount: 1240, divisor: 100 } } })).toEqual({ ioss: ETSY_IOSS, source: 'etsy' });
    expect(suggestIoss({ country: 'FR', marketplace: 'etsy', rawData: { total_vat_cost: { amount: 0, divisor: 100 } } }).ioss).toBe('');
  });
  it('never outside the EU; seller IOSS as the last fallback', () => {
    expect(suggestIoss({ country: 'GB', marketplace: 'etsy', rawData: { total_vat_cost: { amount: 900 } } }).ioss).toBe('');
    expect(suggestIoss({ country: 'IT', marketplace: 'wix', rawData: {}, sellerIoss: 'im1234567890' })).toEqual({ ioss: 'IM1234567890', source: 'seller' });
  });
});

const ORDER: LabelOrderInput = {
  id: 'ord_1',
  orderNumber: '3951',
  marketplace: 'BelleCoutureGifts',
  store: { marketplace: 'etsy' },
  currency: 'USD',
  shipTo: { name: 'Anna Schmidt', country: 'DE', street1: 'Hauptstr 1', city: 'Berlin', postal: '10115' },
  items: [
    { id: 'it_1', title: 'Organza party dress', sku: 'ORG-BRD-6', quantity: 1, unitPrice: 59, hsCode: '620442', originCountry: 'TR' },
    { id: 'it_2', title: 'Hair bow', sku: '', quantity: 2, unitPrice: 9 },
  ],
  raw: { line_items: [{ id: 'it_1', listingRef: '1500123' }, { id: 'it_2', listingRef: '1500456' }], rawData: { total_vat_cost: { amount: 1300, divisor: 100 } } },
};

describe('label draft + validation + FedEx body', () => {
  const draft = draftFromOrder(ORDER, { sender: { shipperCountryCode: 'TR' }, presets: [], baseCurrency: 'USD', carrier: 'fedex' });

  it("prefills IDs per line and Etsy's IOSS for a German Etsy order with VAT collected", () => {
    expect(draft.customs.items.map((i) => i.pid)).toEqual([
      { merchant: 'ORG-BRD-6', manufacturer: 'ORG-BRD-6', gtin: '' },
      { merchant: '1500456', manufacturer: '1500456', gtin: '' },
    ]);
    expect(draft.customs.ioss).toBe(ETSY_IOSS);
  });

  it('validation: cleared IDs or a bad barcode block an EU label; non-EU is untouched', () => {
    expect(Object.keys(validateDraft(draft, { international: true })).filter((k) => k.includes('pid'))).toEqual([]);
    const bad = structuredClone(draft);
    bad.customs.items[0].pid = { merchant: '', manufacturer: 'X', gtin: '' };
    bad.customs.items[1].pid = { merchant: 'A', manufacturer: 'A', gtin: '1234567' };
    const e = validateDraft(bad, { international: true });
    expect(e['customs.items.0.pid']).toEqual({ code: 'pidRequired' });
    expect(e['customs.items.1.pid']).toEqual({ code: 'gtinInvalid' });
    bad.shipTo.country = 'GB';
    expect(Object.keys(validateDraft(bad, { international: true })).some((k) => k.includes('pid'))).toBe(false);
  });

  it('FedEx generate-label body carries pid + listing ref on every line', () => {
    const steps = buildFedexRequest(draft);
    const body = JSON.parse(String(steps[2].init.body));
    expect(body.line_items.map((l: any) => [l.sku, l.listing_ref, l.pid])).toEqual([
      ['ORG-BRD-6', '1500123', { merchant: 'ORG-BRD-6', manufacturer: 'ORG-BRD-6', gtin: '' }],
      [undefined, '1500456', { merchant: '1500456', manufacturer: '1500456', gtin: '' }],
    ]);
  });
});
