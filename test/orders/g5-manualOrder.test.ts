import { describe, expect, it } from 'vitest';
import {
  buildManualOrderPayload, classifyManualResponse, emptyManualOrder, formSnapshot, isOrdersKey, manualOrderTotal,
  resolveBaseCurrency, resolveManualDefaults, stateAfterCountryChange, validateManualOrder, type ManualOrderForm,
} from '@/lib/orders/manualOrder';

/** Keys of the legacy `ManualOrderData` (components/ManualOrderForm.tsx, pages/api/orders/manual.ts). */
const LEGACY_KEYS = ['customerName', 'customerEmail', 'customerPhone', 'orderNumber', 'currency', 'street1', 'street2', 'city', 'state', 'postal', 'country', 'items'];
const LEGACY_ITEM_KEYS = ['productName', 'quantity', 'unitPrice', 'weight', 'sku', 'hsCode', 'countryOfOrigin'];

function filled(): ManualOrderForm {
  const f = emptyManualOrder({ country: 'TR', countryOfOrigin: 'TR' }, 'k1');
  return {
    ...f,
    customerName: '  Ayşe Yılmaz ',
    customerEmail: 'ayse@example.com',
    customerPhone: '+905320000000',
    orderNumber: ' IG-2026-031 ',
    street1: 'Bağdat Cd. 12',
    city: 'İstanbul',
    postal: '34710',
    items: [{ ...f.items[0], productName: 'Baby blanket', unitPrice: 625, quantity: 2, sku: ' BB-1 ' }],
  };
}

describe('buildManualOrderPayload', () => {
  it('emits exactly the legacy ManualOrderData shape with trimmed values', () => {
    const p = buildManualOrderPayload(filled(), 'TRY');
    expect(Object.keys(p)).toEqual(LEGACY_KEYS);
    expect(Object.keys(p.items[0])).toEqual(LEGACY_ITEM_KEYS);
    expect(p).toEqual({
      customerName: 'Ayşe Yılmaz',
      customerEmail: 'ayse@example.com',
      customerPhone: '+905320000000',
      orderNumber: 'IG-2026-031',
      currency: 'TRY',
      street1: 'Bağdat Cd. 12',
      street2: '',
      city: 'İstanbul',
      state: '',
      postal: '34710',
      country: 'TR',
      items: [{ productName: 'Baby blanket', quantity: 2, unitPrice: 625, weight: 0.5, sku: 'BB-1', hsCode: '', countryOfOrigin: 'TR' }],
    });
  });

  it('an explicit currency choice wins over the base currency', () => {
    expect(buildManualOrderPayload({ ...filled(), currency: 'EUR' }, 'TRY').currency).toBe('EUR');
  });
});

describe('resolveBaseCurrency (never a hard USD)', () => {
  it('TR sender with the schema-default USD → TRY', () => {
    expect(resolveBaseCurrency({ shipperProfile: { shipperCountryCode: 'TR', defaultCurrencyCode: 'USD' }, localeCurrency: 'USD' })).toBe('TRY');
  });
  it('an explicit non-USD default is kept', () => {
    expect(resolveBaseCurrency({ shipperProfile: { shipperCountryCode: 'TR', defaultCurrencyCode: 'EUR' }, localeCurrency: 'TRY' })).toBe('EUR');
  });
  it('no sender profile → locale currency (TRY in the TR UI)', () => {
    expect(resolveBaseCurrency({ shipperProfile: null, localeCurrency: 'TRY' })).toBe('TRY');
    expect(resolveBaseCurrency({ shipperProfile: { defaultCurrencyCode: 'USD' }, localeCurrency: 'TRY' })).toBe('TRY');
  });
  it('US / eurozone senders', () => {
    expect(resolveBaseCurrency({ shipperProfile: { shipperCountryCode: 'US', defaultCurrencyCode: 'USD' }, localeCurrency: 'TRY' })).toBe('USD');
    expect(resolveBaseCurrency({ shipperProfile: { shipperCountryCode: 'de' }, localeCurrency: 'TRY' })).toBe('EUR');
  });
  it('defaults follow the sender country, else the locale', () => {
    expect(resolveManualDefaults({ shipperCountryCode: 'tr' }, '')).toEqual({ country: 'TR', countryOfOrigin: 'TR' });
    expect(resolveManualDefaults(null, 'TR')).toEqual({ country: 'TR', countryOfOrigin: 'TR' });
  });
});

describe('validateManualOrder', () => {
  it('flags required and non-positive fields; US needs a state', () => {
    const base = emptyManualOrder({ country: 'US', countryOfOrigin: '' }, 'k');
    const e = validateManualOrder({ ...base, items: [{ ...base.items[0], quantity: 0 }] });
    expect(e).toMatchObject({
      customerName: 'required', orderNumber: 'required', street1: 'required', city: 'required', postal: 'required', state: 'required',
      'items.0.productName': 'required', 'items.0.unitPrice': 'required', 'items.0.quantity': 'positive',
    });
    expect(e['items.0.weight']).toBeUndefined();
    expect(validateManualOrder(filled())).toEqual({});
  });
  it('clears a state code that belonged to the old country', () => {
    expect(stateAfterCountryChange('US', 'TR', 'NY')).toBe('');
    expect(stateAfterCountryChange('TR', 'CA', 'Kadıköy')).toBe('');
    expect(stateAfterCountryChange('TR', 'DE', 'Bayern')).toBe('Bayern');
  });
});

describe('response + helpers', () => {
  it('duplicate via A8 code or the pre-A8 Turkish text', () => {
    expect(classifyManualResponse(400, { error: 'x', code: 'DUPLICATE_ORDER_NUMBER' })).toEqual({ kind: 'duplicate' });
    expect(classifyManualResponse(400, { error: 'Bu sipariş numarası zaten mevcut' })).toEqual({ kind: 'duplicate' });
  });
  it('created / auth / failed', () => {
    expect(classifyManualResponse(201, { success: true, order: { id: 'o1', orderNumber: 'IG-1' } })).toEqual({ kind: 'created', orderId: 'o1', orderNumber: 'IG-1' });
    expect(classifyManualResponse(401, { error: 'Not authenticated' })).toEqual({ kind: 'auth' });
    expect(classifyManualResponse(500, { error: 'boom', details: 'stack' })).toEqual({ kind: 'failed', status: 500 });
    expect(classifyManualResponse(0, null)).toEqual({ kind: 'failed', status: 0 });
    // Server validation copy is Turkish-only: never passed through to the UI.
    expect(classifyManualResponse(400, { error: 'Müşteri adı gerekli' })).toEqual({ kind: 'failed', status: 400 });
  });
  it('total in cents, snapshot ignores item keys, orders SWR keys', () => {
    expect(manualOrderTotal([{ unitPrice: 0.1, quantity: 3 }, { unitPrice: 0.2, quantity: 1 }, { unitPrice: null, quantity: 1 }])).toBe(0.5);
    const a = emptyManualOrder({ country: 'TR', countryOfOrigin: 'TR' }, 'a');
    const b = emptyManualOrder({ country: 'TR', countryOfOrigin: 'TR' }, 'b');
    expect(formSnapshot(a)).toBe(formSnapshot(b));
    expect(isOrdersKey('/api/orders?page=1')).toBe(true);
    expect(isOrdersKey(['/api/orders', { view: 'to_ship' }])).toBe(true);
    expect(isOrdersKey('/api/orders')).toBe(true);
    expect(isOrdersKey('/api/orders/o1')).toBe(true);
    expect(isOrdersKey('/api/orders#enrichment?ids=a,b')).toBe(true);
    expect(isOrdersKey('/api/ordersx')).toBe(false);
    expect(isOrdersKey('/api/nav/counts')).toBe(false);
    expect(isOrdersKey('/api/user/settings')).toBe(false);
  });
});
