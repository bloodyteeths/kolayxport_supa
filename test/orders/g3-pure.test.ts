// M3 orders-G3: pure helpers (tracking carriers, request builders, ship-to mapping, message body, totals).
import { describe, expect, it } from 'vitest';
import {
  TRACKING_CARRIERS, carrierToTrackingId, isValidTrackingNumber, normalizeTrackingNumber, marketplaceSelectKey, trackingPushOutcome,
} from '@/lib/shipping/trackingCarriers';
import { carrierToVeeqoId } from '@/lib/shipping/labelLinks';
import { buildShipToUpdateBody, buildTrackingBody, splitRecipientName } from '@/components/domain/orders/panel/useOrderActions';
import { shipToFromRow, phoneToE164, stateCode, sameShipTo, EMPTY_SHIP_TO } from '@/components/domain/orders/panel/ShipToForm';
import { buildMessageBody, isAllowedKind, amazonMarketplaceId } from '@/components/domain/orders/panel/MessageBuyerModal';
import { itemsSubtotal } from '@/components/domain/orders/panel/ItemsSection';
import { trackingPrefill } from '@/components/domain/orders/panel/AddTrackingModal';
import { costCurrency } from '@/components/domain/orders/panel/CostsSection';
import { makeRow, labeledRow, SHIP_TO_US } from './g3-fixtures';

describe('trackingCarriers', () => {
  it('keeps the legacy Veeqo ids and order', () => {
    expect(TRACKING_CARRIERS.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 7, 9, 10, 12, 13, 14, 15]);
  });
  it('maps carrier names exactly like the legacy carrierToVeeqoId', () => {
    for (const c of ['FedEx', 'UPS', 'MNG', 'DHL eCommerce', 'DHL', 'USPS', 'DPD', 'Royal Mail', 'Yurtiçi', 'Aras', 'Sürat', 'Trendyol Express', '', null, 'Acme']) {
      expect(carrierToTrackingId(c)).toBe(carrierToVeeqoId(c));
    }
  });
  it('validates and normalizes tracking numbers as the API does', () => {
    expect(normalizeTrackingNumber(' 794 6129 0012 ')).toBe('79461290012');
    expect(isValidTrackingNumber('1Z999AA10123456784')).toBe(true);
    expect(isValidTrackingNumber('abc')).toBe(false);
    expect(isValidTrackingNumber('ab-12345678')).toBe(false);
  });
  it('marketplace select keys', () => {
    expect(marketplaceSelectKey('etsy')).toBe('etsy');
    expect(marketplaceSelectKey('Amazon Channel')).toBe('amazon');
    expect(marketplaceSelectKey('manual')).toBe('other');
  });
  it('reads the honest push outcome from a 200 body', () => {
    expect(trackingPushOutcome({ success: true, etsyPending: true })).toBe('queued');
    expect(trackingPushOutcome({ success: true, message: 'Tracking saved locally. eBay push failed: 500' })).toBe('saved_not_sent');
    expect(trackingPushOutcome({ success: true, message: 'Tracking saved locally (no Veeqo API key configured — nothing pushed to a marketplace).' })).toBe('saved_not_sent');
    expect(trackingPushOutcome({ success: true, message: 'Tracking submitted to Amazon.' })).toBe('sent');
  });
});

describe('request builders', () => {
  it('splits the recipient name at the last space', () => {
    expect(splitRecipientName('Sarah Ann  Miller')).toEqual({ first: 'Sarah Ann', last: 'Miller' });
    expect(splitRecipientName('Cher')).toEqual({ first: 'Cher', last: '' });
  });
  it('ship-to update body carries the top-level recipient* fields and the email', () => {
    const body = buildShipToUpdateBody('o1', { ...shipToFromRow(SHIP_TO_US), country: 'us' });
    expect(body).toMatchObject({ id: 'o1', recipientFirstName: 'Sarah', recipientLastName: 'Miller', recipientCountry: 'US', recipientPostal: '78701' });
    expect(body.shippingAddress.email).toBe('sarah@example.com');
  });
  it('tracking body is the legacy one', () => {
    expect(buildTrackingBody({ trackingNumber: ' 1Z 999 ', carrierId: 5, notifyCustomer: false })).toEqual({
      trackingNumber: '1Z999', carrierId: 5, notifyCustomer: false, updateRemoteOrder: true,
    });
  });
  it('tracking prefill comes from one source (label first, then submission)', () => {
    expect(trackingPrefill(labeledRow())).toEqual({ trackingNumber: '1Z999AA10123456784', carrierId: 5 });
    expect(trackingPrefill(makeRow({ trackingSubmission: { state: 'failed', trackingNumber: '794612900012', carrierName: 'FedEx', submittedAt: null, deliveredAt: null, error: 'x' } })))
      .toEqual({ trackingNumber: '794612900012', carrierId: 2 });
    expect(trackingPrefill(makeRow())).toEqual({ trackingNumber: '', carrierId: 3 });
  });
});

describe('ShipToForm helpers', () => {
  it('maps OrderRow.shipTo; hidden Amazon names start empty; phones become E.164', () => {
    expect(shipToFromRow({ ...SHIP_TO_US, nameHidden: true, name: 'Amazon Customer' }).name).toBe('');
    expect(phoneToE164('0532 123 45 67', 'TR')).toBe('+905321234567');
    expect(phoneToE164('+1 (555) 013-4', 'US')).toBe('+15550134');
    expect(phoneToE164('', 'US')).toBe('');
  });
  it('resolves state names to codes for US/CA', () => {
    expect(stateCode('US', 'Texas')).toBe('TX');
    expect(stateCode('US', 'tx')).toBe('TX');
    expect(stateCode('CA', 'Ontario')).toBe('ON');
    expect(stateCode('US', 'Nowhere')).toBe('');
    expect(stateCode('DE', 'Bayern')).toBe('Bayern');
  });
  it('sameShipTo ignores surrounding whitespace', () => {
    expect(sameShipTo({ ...EMPTY_SHIP_TO, city: 'Austin ' }, { ...EMPTY_SHIP_TO, city: 'Austin' })).toBe(true);
  });
});

describe('MessageBuyerModal helpers', () => {
  const amazon = makeRow({ orderNumber: '113-1', raw: { id: 'o1', marketplace: 'Amazon', orderNumber: '113-1', rawData: { salesChannel: 'Amazon.com' } } });
  it('sends the Amazon order number and the legacy marketplace id', () => {
    expect(amazonMarketplaceId(amazon)).toBe('Amazon.com');
    expect(buildMessageBody(amazon, 'confirmOrderDetails', '  hi  ')).toEqual({ orderId: '113-1', marketplaceId: 'Amazon.com', messageType: 'confirmOrderDetails', text: 'hi' });
    expect(buildMessageBody(amazon, 'reviewRequest', '')).toEqual({ orderId: '113-1', marketplaceId: 'Amazon.com', action: 'productReviewAndSellerFeedback' });
  });
  it('templates are allowed unless Amazon listed others; review requests always are', () => {
    expect(isAllowedKind('confirmOrderDetails', null)).toBe(true);
    expect(isAllowedKind('confirmOrderDetails', ['unexpectedProblem'])).toBe(false);
    expect(isAllowedKind('reviewRequest', ['unexpectedProblem'])).toBe(true);
  });
});

describe('totals and currency', () => {
  it('items subtotal is null when any unit price is unknown', () => {
    expect(itemsSubtotal(makeRow().items)).toBe(144.98);
    expect(itemsSubtotal([{ ...makeRow().items[0], unitPrice: null }])).toBeNull();
  });
  it('carrier cost currency: stored when the API accepts it, else the base currency', () => {
    expect(costCurrency({ amount: 1, currency: 'eur' }, 'TRY')).toBe('EUR');
    expect(costCurrency({ amount: 1, currency: 'AUD' }, 'TRY')).toBe('TRY');
    expect(costCurrency(null, 'USD')).toBe('USD');
  });
});
