// orders §13 G4 review fixes: tracking-push eligibility, FedEx label stock / duties, per-line weights,
// bulk print batching, stored push state of an existing label, local-format TR phone through the panel path.
import { describe, expect, it } from 'vitest';
import {
  canPushTracking, draftFromOrder, lineWeightKg, profileTerms, withCarrier,
  type LabelOrderInput,
} from '@/lib/shipping/labelDraft';
import { buildFedexRequest } from '@/lib/shipping/submit/fedex';
import { buildUpsRequest } from '@/lib/shipping/submit/ups';
import { buildDhlRequest } from '@/lib/shipping/submit/dhl';
import { nextPrintBatch, PRINT_BATCH } from '@/components/domain/shipping/BulkCreateLabelsPanel';
import { pushStateFromSubmission } from '@/components/domain/shipping/CreateLabelPanel';

const sender = {
  shipperName: 'Belle Couture Gifts', shipperPhoneNumber: '+905321112233', shipperStreet1: 'Atatürk Cad. 12',
  shipperCity: 'Bursa', shipperPostalCode: '16110', shipperCountryCode: 'TR', defaultCurrencyCode: 'USD', dutiesPaymentType: 'SENDER',
};
const ctx = { sender, presets: [], baseCurrency: 'USD' };

const order = (p: Partial<LabelOrderInput>): LabelOrderInput => ({
  id: 'o1', orderNumber: '3891', marketplace: 'etsy', currency: 'USD', total: 100,
  shipTo: { name: 'Sarah Miller', phone: '+15550134', email: '', country: 'US', street1: '12 Oak St', street2: '', city: 'Austin', state: 'TX', postal: '78701', district: '', neighbourhood: '' },
  items: [
    { id: 'i1', title: 'Blanket', quantity: 2, unitPrice: 50, weightKg: 0.3, hsCode: '630210', originCountry: 'TR' },
    { id: 'i2', title: 'Gift wrap', quantity: 3, unitPrice: 5, weightKg: null, hsCode: null, originCountry: null },
  ],
  raw: {},
  ...p,
});

describe('tracking push only where submit-tracking has a branch', () => {
  it('etsy / ebay / amazon / wix / veeqo / Etsy shop names push; trendyol / shopify / hepsiburada / manual do not', () => {
    for (const m of ['etsy', 'eBay', 'Amazon US', 'wix', 'veeqo', 'BelleCoutureGifts']) expect(canPushTracking(m), m).toBe(true);
    for (const m of ['Trendyol', 'shopify', 'Hepsiburada', 'manual', '']) expect(canPushTracking(m), m).toBe(m === '');
  });
  it('a Trendyol draft starts with sendTracking off even when the viewer remembered it on', () => {
    expect(draftFromOrder(order({ marketplace: 'Trendyol' }), { ...ctx, sendTracking: true }).options.sendTracking).toBe(false);
    expect(draftFromOrder(order({ marketplace: 'etsy' }), { ...ctx, sendTracking: true }).options.sendTracking).toBe(true);
  });
});

describe('FedEx label stock and duties', () => {
  it('a stored stock update-options would refuse falls back to PAPER_LETTER; accepted ones are kept', () => {
    expect(draftFromOrder(order({ raw: { labelStockType: 'PAPER_4X8' } }), ctx).options.labelStock).toBe('PAPER_LETTER');
    expect(draftFromOrder(order({ raw: { labelStockType: 'STOCK_4X6' } }), ctx).options.labelStock).toBe('STOCK_4X6');
  });
  it('switching to FedEx resets the terms to the sender profile (generate-label reads nothing else)', () => {
    const ups = withCarrier(draftFromOrder(order({}), ctx), 'ups', '65', { sender });
    const dap = { ...ups, customs: { ...ups.customs, terms: 'DAP' as const } };
    expect(withCarrier(dap, 'fedex', 'INTERNATIONAL_PRIORITY', { sender }).customs.terms).toBe(profileTerms(sender));
    expect(profileTerms(sender)).toBe('DDP');
  });
});

describe('per-line weights (whole line, all units)', () => {
  const d = draftFromOrder(order({}), ctx);
  it('own per-unit weight × quantity; fallback share by quantity', () => {
    expect(lineWeightKg(d, 0)).toBe(0.6);
    expect(lineWeightKg(d, 1)).toBe(Math.round(((d.pkg.weightKg * 3) / 5) * 100) / 100);
  });
  it('FedEx line_items and UPS products carry the line weight', () => {
    const fx = JSON.parse(buildFedexRequest(d)[2].init.body);
    expect(fx.line_items[0].weight).toBe(0.6);
    const ups = JSON.parse(buildUpsRequest({ ...d, carrier: 'ups', service: '65' })[0].init.body);
    expect(ups.internationalForms.products[0].weight).toBe('0.60');
  });
});

describe('bulk print batches', () => {
  it('25 labels: first 20, then the next 5, then from the start again', () => {
    expect(PRINT_BATCH).toBe(20);
    expect(nextPrintBatch(25, 0)).toEqual({ from: 0, to: 20 });
    expect(nextPrintBatch(25, 20)).toEqual({ from: 20, to: 25 });
    expect(nextPrintBatch(25, 25)).toEqual({ from: 0, to: 20 });
    expect(nextPrintBatch(7, 0)).toEqual({ from: 0, to: 7 });
  });
});

describe('existing label push state', () => {
  const s = (state: 'sent' | 'queued' | 'pending' | 'failed', trackingNumber = '1Z999AA10123456784') => ({
    state, trackingNumber, carrierName: 'UPS', submittedAt: null, deliveredAt: null, error: null,
  });
  it('maps the stored submission; pending, none or another tracking number show no line', () => {
    expect(pushStateFromSubmission(s('failed'), '1Z999AA10123456784')).toBe('failed');
    expect(pushStateFromSubmission(s('queued'), '1Z999AA10123456784')).toBe('queued');
    expect(pushStateFromSubmission(s('sent'), null)).toBe('sent');
    expect(pushStateFromSubmission(s('pending'), '1Z999AA10123456784')).toBe('idle');
    expect(pushStateFromSubmission(s('sent', 'OTHER12345'), '1Z999AA10123456784')).toBe('idle');
    expect(pushStateFromSubmission(null, '1Z999AA10123456784')).toBe('idle');
  });
});

describe('local-format TR phone through the panel path', () => {
  it('draftFromOrder keeps "05321234567" and the DHL eCommerce body sends it unchanged', () => {
    const d = draftFromOrder(order({
      id: 'm1', marketplace: 'Trendyol', currency: 'TRY',
      shipTo: { name: 'Ayşe Kaya', phone: '05321234567', email: '', country: 'TR', street1: 'Atatürk Cad. 12', street2: '', city: 'Bursa', state: '', postal: '16110', district: 'Nilüfer', neighbourhood: 'Ertuğrul' },
    }), { ...ctx, carrier: 'dhl' });
    expect(d.shipTo.phone).toBe('05321234567');
    expect(JSON.parse(buildDhlRequest(d)[0].init.body).recipient.phone).toBe('05321234567');
  });
});
