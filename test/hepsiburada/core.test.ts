import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolve: vi.fn(), resolveNotification: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishLive: vi.fn() }));

import { hbDate, parseHbTimestamp } from '@/lib/hepsiburada/date';
import { HepsiburadaClient, hbErrorMessage, hbHost } from '@/lib/hepsiburada/client';
import { HbOrderBook, hbLineState, orderState, toUIOrder } from '@/lib/hepsiburada/orderMapper';
import { interpretUpload } from '@/lib/hepsiburada/uploads';
import { isAuthFailure } from '@/lib/integrations/authFailures';
import { resolveOrderChannel } from '@/lib/stock/orderKey';

const MID = '069f1e61-8b6f-40c5-952c-f19d84872c36';

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { status: 200, body: {} };
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('hbDate / parseHbTimestamp', () => {
  it('formats in Turkey local time without seconds or zone', () => {
    expect(hbDate(new Date('2026-08-25T09:00:00Z'))).toBe('2026-08-25 12:00');
    expect(hbDate(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01 01:30');
  });
  it('reads zone-less timestamps as Turkey time and trims .NET fractions', () => {
    expect(parseHbTimestamp('2018-12-21T09:34:47')?.toISOString()).toBe('2018-12-21T06:34:47.000Z');
    expect(parseHbTimestamp('2018-12-23T13:28:27.4518986')?.toISOString()).toBe('2018-12-23T10:28:27.451Z');
    expect(parseHbTimestamp('2020-09-15T16:06:51Z')?.toISOString()).toBe('2020-09-15T16:06:51.000Z');
    expect(parseHbTimestamp('garbage')).toBeUndefined();
    expect(parseHbTimestamp(null)).toBeUndefined();
  });
});

describe('HepsiburadaClient', () => {
  beforeEach(() => { delete process.env.HEPSIBURADA_ENV; });

  it('sends Basic merchantId:serviceKey and the exact integrator name as User-Agent', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { listings: [], totalCount: 0 } }]);
    const c = new HepsiburadaClient({ merchantId: MID, serviceKey: 'secret', integratorName: 'kolayxport_dev' }, fn);
    await c.listListings({ offset: 0, limit: 1 });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Basic ' + Buffer.from(`${MID}:secret`).toString('base64'));
    expect(h['User-Agent']).toBe('kolayxport_dev');
    expect(calls[0].url).toBe(`https://listing-external.hepsiburada.com/listings/merchantid/${MID}?offset=0&limit=1`);
  });

  it('formats OMS date filters, caps limit at 100 and uses SIT hosts when asked', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { items: [] } }]);
    const c = new HepsiburadaClient({ merchantId: MID, serviceKey: 'k', integratorName: 'x', env: 'sit' }, fn);
    await c.listOrders({ begin: new Date('2026-08-25T09:00:00Z'), limit: 500 });
    expect(calls[0].url).toBe(`https://oms-external-sit.hepsiburada.com/orders/merchantid/${MID}?begindate=2026-08-25%2012%3A00&offset=0&limit=100`);
  });

  it('packages use capital Offset and limit ≤ 10', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: [] }]);
    const c = new HepsiburadaClient({ merchantId: MID, serviceKey: 'k', integratorName: 'x' }, fn);
    await c.listPackages({ offset: 20, limit: 50 });
    expect(calls[0].url).toContain('?Offset=20&limit=10');
  });

  it('adds the merchantId header for the Q&A service only', () => {
    const c = new HepsiburadaClient({ merchantId: MID, serviceKey: 'k', integratorName: 'x' }, vi.fn() as any);
    expect(c.headersFor({ service: 'question' }).merchantId).toBe(MID);
    expect(c.headersFor({ service: 'order' }).merchantId).toBeUndefined();
  });

  it('retries 429 then succeeds', async () => {
    const { fn, calls } = fakeFetch([{ status: 429, headers: { 'retry-after': '0' } }, { status: 200, body: { ok: 1 } }]);
    const c = new HepsiburadaClient({ merchantId: MID, serviceKey: 'k', integratorName: 'x' }, fn);
    await expect(c.questionCounts()).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('throws {status, body, endpoint} that isAuthFailure recognises on 401', async () => {
    const { fn } = fakeFetch([{ status: 401, body: { message: 'Unauthorized' } }]);
    const c = new HepsiburadaClient({ merchantId: MID, serviceKey: 'k', integratorName: 'x' }, fn);
    const err = await c.listListings().catch((e) => e);
    expect(err.status).toBe(401);
    expect(isAuthFailure(err)).toBe(true);
    expect(hbErrorMessage(err)).toBe('Hepsiburada API 401: Unauthorized');
  });

  it('refuses without an integrator name and has no prod host for SIT stubs', () => {
    delete process.env.HEPSIBURADA_INTEGRATOR_NAME;
    expect(() => new HepsiburadaClient({ merchantId: MID, serviceKey: 'k' })).toThrow(/INTEGRATOR_NAME/);
    expect(() => hbHost('testOrder', 'prod')).toThrow(/SIT/);
  });
});

const openLine = (over: Record<string, any> = {}) => ({
  id: 'L1', orderNumber: '4000001', orderId: 'O1', orderDate: '2026-10-17T10:00:00', status: 'Open',
  sku: 'HBV00001', merchantSKU: 'BOX-01', name: 'Ahşap Kutu', quantity: 2,
  unitPrice: { amount: 150, currency: 'TRY' }, totalPrice: { amount: 300, currency: 'TRY' },
  dueDate: '2026-10-19T18:00:00', customerName: 'Ayşe Yılmaz',
  productImageUrlFormat: 'https://productimages.hepsiburada.net/s/1/{size}/x.jpg',
  shippingAddress: { name: 'Ayşe Yılmaz', address: 'Atatürk Cad. 5', district: 'Moda', town: 'Kadıköy', city: 'İstanbul', countryCode: 'TR', phoneNumber: '5550000000', email: 'a@x.com' },
  ...over,
});

describe('order mapping', () => {
  it('normalises HB status strings', () => {
    expect(hbLineState('Open')).toBe('open');
    expect(hbLineState('Unpacked')).toBe('open');
    expect(hbLineState('Packaged')).toBe('packed');
    expect(hbLineState('InTransit')).toBe('shipped');
    expect(hbLineState('Shipped')).toBe('shipped');
    expect(hbLineState('Delivered')).toBe('delivered');
    expect(hbLineState('Undelivered')).toBe('undelivered');
    expect(hbLineState('CancelledByMerchant')).toBe('cancelled');
    expect(hbLineState(undefined)).toBe('open');
  });

  it('maps an open line into one order keyed by orderNumber', () => {
    const book = new HbOrderBook();
    book.addLine(openLine() as any);
    const ui = toUIOrder(book.orders.get('4000001')!);
    expect(ui.marketplace).toBe('Hepsiburada');
    expect(ui.marketplaceKey).toBe('4000001');
    expect(ui.status).toBe('AWAITING_FULFILLMENT');
    expect(ui.externalStatus).toBe('Open');
    expect(ui.totalPrice).toBe(300);
    expect(ui.uiOrderDate).toBe('2026-10-17T07:00:00.000Z');
    expect(ui.shipByDate).toBe('2026-10-19T15:00:00.000Z');
    expect(ui.line_items[0]).toMatchObject({ id: 'L1', sku: 'BOX-01', quantity: 2, value: 150, image: 'https://productimages.hepsiburada.net/s/1/500/x.jpg' });
    expect(ui.to_address).toMatchObject({ city: 'İstanbul', state: 'Kadıköy', street1: 'Atatürk Cad. 5, Moda' });
    expect(ui.rawData.hbLines[0]).toMatchObject({ id: 'L1', state: 'open', packageNumber: null });
    expect(ui.rawData.lines).toBeUndefined();
  });

  it('a package adds barcode/cargo and moves the order to Packaged; shipped list moves it to SHIPPED', () => {
    const book = new HbOrderBook();
    book.addLine(openLine() as any);
    book.addPackage({
      packageNumber: 'P9', barcode: 'HJ123', cargoCompany: 'HepsiJet', status: 'Packaged', orderDate: '2026-10-17T10:00:00',
      items: [{ lineItemId: 'L1', orderNumber: '4000001', hbSku: 'HBV00001', merchantSku: 'BOX-01', productName: 'Ahşap Kutu', quantity: 2, merchantUnitPrice: { amount: 150, currency: 'TRY' }, merchantTotalPrice: { amount: 300, currency: 'TRY' } }],
    } as any);
    let ui = toUIOrder(book.orders.get('4000001')!);
    expect(ui.externalStatus).toBe('Packaged');
    expect(ui.status).toBe('AWAITING_FULFILLMENT');
    expect(ui.rawData).toMatchObject({ packageNumber: 'P9', cargoTrackingNumber: 'HJ123', cargoProviderName: 'HepsiJet' });

    book.addPackageStatus({ PackageNumber: 'P9', OrderNumber: '4000001', ShippedDate: '2026-10-18T09:00:00' }, 'shipped');
    ui = toUIOrder(book.orders.get('4000001')!);
    expect(ui.status).toBe('SHIPPED');
  });

  it('status before detail still applies once the line arrives (package state wins)', () => {
    const book = new HbOrderBook();
    book.addPackageStatus({ PackageNumber: 'P1', OrderNumber: '5', DeliveredDate: '2026-10-18T09:00:00' }, 'delivered');
    expect(book.ordersMissingDetail()).toEqual(['5']);
    book.addLine(openLine({ id: 'A', orderNumber: '5', packageNumber: 'P1', status: 'Shipped' }) as any);
    expect(book.ordersMissingDetail()).toEqual([]);
    expect(orderState(book.orders.get('5')!)).toBe('delivered');
  });

  it('cancelled lines: partial keeps the order open, all cancelled → CANCELLED', () => {
    const book = new HbOrderBook();
    book.addLine(openLine({ id: 'A' }) as any);
    book.addLine(openLine({ id: 'B' }) as any);
    book.addCancelled({ orderNumber: '4000001', lineItemId: 'A' });
    let ui = toUIOrder(book.orders.get('4000001')!);
    expect(ui.status).toBe('AWAITING_FULFILLMENT');
    expect(ui.totalPrice).toBe(300);
    book.addCancelled({ orderNumber: '4000001', lineItemId: 'B' });
    ui = toUIOrder(book.orders.get('4000001')!);
    expect(ui.status).toBe('CANCELLED');
  });

  it('stock order-key detection sees HB orders as hepsiburada, not trendyol', () => {
    const book = new HbOrderBook();
    book.addLine(openLine() as any);
    const ui = toUIOrder(book.orders.get('4000001')!);
    const det = resolveOrderChannel({ marketplace: 'Hepsiburada', source: 'hepsiburada', marketplaceKey: '4000001', rawData: ui.rawData } as any);
    expect(det.channel).toBe('hepsiburada');
  });
});

describe('interpretUpload', () => {
  it('pending, done with per-row failures, failed', () => {
    expect(interpretUpload({ status: 'Ready' }).state).toBe('pending');
    const done = interpretUpload({ status: 'Done', errors: [{ hepsiburadaSku: 'HB1', errorMessage: 'stok negatif' }], priceValidations: [{ merchantSku: 'M2', minPrice: 10, maxPrice: 20 }] });
    expect(done).toEqual({ state: 'done', failedSkus: { HB1: 'stok negatif', M2: 'price outside allowed range 10–20' } });
    expect(interpretUpload({ status: 'Failed', errors: [{ message: 'bad' }] })).toEqual({ state: 'failed', error: 'bad' });
  });
});

describe('upload limits', () => {
  it('maps HB limit errors to retryable 429 HbUploadLimitError', async () => {
    const { asUploadLimitError, HbUploadLimitError } = await import('@/lib/hepsiburada/uploads');
    const { isRetryableHttp } = await import('@/lib/stock/adapters/types');
    const busy = asUploadLimitError({ status: 400, body: { message: 'There are too many ongoing/waiting inventory uploads at the moment. Please try again later' }, endpoint: 'x' });
    expect(busy).toBeInstanceOf(HbUploadLimitError);
    expect((busy as any).code).toBe('hb_uploads_in_flight');
    expect(isRetryableHttp(busy)).toBe(true);
    const daily = asUploadLimitError({ status: 400, body: { errors: ['Merchant exceeds his inventory upload limit'] }, endpoint: 'x' });
    expect((daily as any).code).toBe('hb_daily_upload_limit');
    const other = { status: 400, body: { message: 'bad sku' }, endpoint: 'x' };
    expect(asUploadLimitError(other)).toBe(other);
  });
});
