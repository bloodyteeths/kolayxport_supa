import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {
  csvField,
  neutralizeFormula,
  toCsv,
  UTF8_BOM,
  mapOrderToExportRow,
  summarizeItems,
  labelStateOf,
  dedupeOrders,
  getExportLabels,
  ordersTable,
  itemsTable,
  toXlsx,
  toPdf,
  toWinAnsi,
  localIsoDay,
  safeTimeZone,
  ORDER_COLUMNS,
  type ExportSourceOrder,
} from '@/lib/export/orders';

const baseOrder = (over: Partial<ExportSourceOrder> = {}): ExportSourceOrder => ({
  id: 'ord_1',
  orderNumber: '3456789012',
  marketplace: 'BelleCoutureGifts',
  status: 'paid',
  labelStatus: null,
  trackingNumber: null,
  shippingLabelUrl: null,
  currency: 'USD',
  totalPrice: 59.9,
  manualShippingCost: '12.50',
  manualShippingCostCurrency: 'USD',
  customerName: 'Jane Doe',
  createdAt: new Date('2026-10-01T09:00:00Z'),
  uiOrderDate: new Date('2026-10-02T21:30:00Z'),
  shippingAddress: {
    name: 'Jane Doe', street1: '1 Main St', street2: 'Apt 4', city: 'Austin', state: 'TX',
    postal: '73301', country: 'US', phone: '+1 555 0100', email: 'jane@example.com',
  },
  rawData: null,
  items: [
    { sku: 'BOX-1', productName: 'Wooden Box', variantInfo: 'Walnut', quantity: 2, unitPrice: '19.95', totalPrice: null, notes: '' },
    { sku: '', productName: 'Gift Card', variantInfo: '', quantity: 1, unitPrice: null, totalPrice: null, notes: 'Happy b-day' },
  ],
  shipping: null,
  shipments: [],
  trackingSubmissions: [],
  senkronData: { internalNote: 'Paint name gold' },
  ...over,
});

describe('neutralizeFormula / csvField', () => {
  it.each(['=SUM(A1)', '+90 555', '-2+3', '@cmd', '\tx', '\rx'])('prefixes %j with a quote', v => {
    expect(neutralizeFormula(v)).toBe(`'${v}`);
  });

  it('leaves normal text and empty strings alone', () => {
    expect(neutralizeFormula('Hello = world')).toBe('Hello = world');
    expect(neutralizeFormula('')).toBe('');
  });

  it('does not neutralize typed numbers (negative numbers stay numeric)', () => {
    expect(csvField(-5)).toBe('-5');
    expect(csvField(12.5)).toBe('12.5');
    expect(csvField(Number.NaN)).toBe('');
  });

  it('quotes per RFC 4180 and doubles quotes', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('plain')).toBe('plain');
    expect(csvField(null)).toBe('');
  });

  it('neutralizes before quoting', () => {
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 BOM, uses CRLF and keeps Turkish characters', () => {
    const csv = toCsv({ headers: ['Ad', 'Şehir'], rows: [['Gülşen Çığ', 'İstanbul'], ['=1+1', 3]] });
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toBe(`${UTF8_BOM}Ad,Şehir\r\nGülşen Çığ,İstanbul\r\n'=1+1,3\r\n`);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe('toCsv (Turkish dialect)', () => {
  it("uses ';' separators and ',' decimals for locale tr, quoting cells with either separator", () => {
    const csv = toCsv({ headers: ['Ad', 'Tutar'], rows: [['Ayşe; Fatma', 12.5], ['a,b', -3], ['=cmd', 1000]] }, { locale: 'tr' });
    expect(csv).toBe(`${UTF8_BOM}Ad;Tutar\r\n"Ayşe; Fatma";12,5\r\n"a,b";-3\r\n'=cmd;1000\r\n`);
    expect(csv).not.toMatch(/^\uFEFF?sep=/);
  });

  it('keeps the comma dialect for en and quotes semicolons there too', () => {
    expect(toCsv({ headers: ['x'], rows: [['a;b'], [1.5]] }, { locale: 'en' })).toBe(`${UTF8_BOM}x\r\n"a;b"\r\n1.5\r\n`);
    expect(csvField(12.5, { locale: 'tr' })).toBe('12,5');
  });
});

describe('mapOrderToExportRow', () => {
  it('maps the core fields', () => {
    const row = mapOrderToExportRow(baseOrder(), { locale: 'en', timeZone: 'UTC' });
    expect(row).toMatchObject({
      orderNumber: '3456789012',
      store: 'BelleCoutureGifts',
      orderDateIso: '2026-10-02T21:30:00.000Z',
      status: 'paid',
      labelStatus: 'not_created',
      buyerName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      address1: '1 Main St',
      address2: 'Apt 4',
      city: 'Austin',
      state: 'TX',
      postalCode: '73301',
      country: 'US',
      itemCount: 3,
      total: 59.9,
      currency: 'USD',
      shippingCost: 12.5,
      privateNote: 'Paint name gold',
    });
    expect(row.orderDate).toContain('2026');
    expect(row.itemsSummary).toBe('2× BOX-1 — Wooden Box (Walnut); 1× Gift Card');
    expect(row.items[0]).toMatchObject({ unitPrice: 19.95, lineTotal: 39.9 });
  });

  it('formats the readable date in the requested time zone', () => {
    const row = mapOrderToExportRow(baseOrder(), { locale: 'tr', timeZone: 'Europe/Istanbul' });
    expect(row.orderDate).toBe('03.10.2026 00:30');
  });

  it('uses the Trendyol shipmentAddress with district', () => {
    const row = mapOrderToExportRow(baseOrder({
      marketplace: 'Trendyol',
      shippingAddress: null,
      rawData: {
        shipmentAddress: { fullName: 'Ayşe Yılmaz', address1: 'Moda Cad. No:5', district: 'Kadıköy', city: 'İstanbul', postalCode: '34710', countryCode: 'TR' },
        cargoTrackingNumber: '7330000123',
        cargoProviderName: 'Trendyol Express',
      },
    }), { locale: 'tr', timeZone: 'UTC' });
    expect(row).toMatchObject({
      buyerName: 'Ayşe Yılmaz', address1: 'Moda Cad. No:5', district: 'Kadıköy', city: 'İstanbul',
      postalCode: '34710', country: 'TR', trackingNumber: '7330000123', carrier: 'Trendyol Express',
      email: '',
    });
  });

  it('falls back to rawData.line_items when there are no OrderItem rows', () => {
    const row = mapOrderToExportRow(baseOrder({
      items: [],
      rawData: { line_items: [{ sku: 'RAW-1', title: 'Raw Item', quantity: '3', variant_title: 'Red' }] },
    }));
    expect(row.itemCount).toBe(3);
    expect(row.itemsSummary).toBe('3× RAW-1 — Raw Item (Red)');
  });

  it('takes tracking + carrier from a created shipment', () => {
    const row = mapOrderToExportRow(baseOrder({
      shipments: [{ carrier: 'UPS', status: 'created', trackingNumber: '1Z999', pdfUrl: null }],
    }));
    expect(row.trackingNumber).toBe('1Z999');
    expect(row.carrier).toBe('UPS');
    expect(row.labelStatus).toBe('created');
  });

  it('handles missing optional data without throwing', () => {
    const row = mapOrderToExportRow({ id: 'x', orderNumber: '', marketplace: 'Wix', createdAt: 'not-a-date' });
    expect(row.orderNumber).toBe('x');
    expect(row.orderDateIso).toBe('');
    expect(row.total).toBeNull();
    expect(row.itemsSummary).toBe('');
  });
});

describe('labelStateOf / summarizeItems / dedupeOrders', () => {
  it('detects label states', () => {
    expect(labelStateOf(baseOrder({ trackingNumber: 'T1' }))).toBe('created');
    expect(labelStateOf(baseOrder({ labelStatus: 'failed' }))).toBe('failed');
    expect(labelStateOf(baseOrder({ trackingNumber: '  ' }))).toBe('not_created');
  });

  it('summarizes items with no sku/title', () => {
    expect(summarizeItems([{ sku: '', title: '', variation: '', quantity: 1, unitPrice: null, lineTotal: null, note: '' }])).toBe('1× ?');
  });

  it('dedupes by marketplace + order number, preferring priced items', () => {
    const a = baseOrder({ id: 'a', items: [{ quantity: 1, unitPrice: null }] });
    const b = baseOrder({ id: 'b' });
    const c = baseOrder({ id: 'c', orderNumber: 'other' });
    expect(dedupeOrders([a, b, c]).map(o => o.id)).toEqual(['b', 'c']);
  });
});

describe('tables + files', () => {
  const rows = [mapOrderToExportRow(baseOrder(), { locale: 'en', timeZone: 'UTC' })];
  const labels = getExportLabels('en');

  it('orders table has one header per column and localized label state', () => {
    const tbl = ordersTable(rows, labels);
    expect(tbl.headers).toHaveLength(ORDER_COLUMNS.length);
    expect(tbl.rows[0][ORDER_COLUMNS.indexOf('labelStatus')]).toBe(labels.labelState('not_created'));
    expect(typeof tbl.rows[0][ORDER_COLUMNS.indexOf('total')]).toBe('number');
  });

  it('items table has one row per line item', () => {
    expect(itemsTable(rows, labels).rows).toHaveLength(2);
  });

  it('writes an xlsx with Orders + Items sheets, numeric cells and an autofilter', () => {
    const buf = toXlsx(rows, labels);
    // Reading back our own generated file is fine; never parse user uploads with xlsx 0.18.5.
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Orders', 'Items']);
    const ws = wb.Sheets.Orders;
    const totalCol = XLSX.utils.encode_col(ORDER_COLUMNS.indexOf('total'));
    expect(ws[`${totalCol}2`].t).toBe('n');
    expect(ws[`${totalCol}2`].v).toBe(59.9);
    expect(ws['!autofilter']?.ref).toBeTruthy();
  });

  it('writes a PDF', async () => {
    const many = Array.from({ length: 60 }, () => rows[0]);
    const { buffer } = await toPdf(many, labels, { locale: 'en', timeZone: 'UTC', now: new Date('2026-10-14T10:00:00Z') });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('falls back to standard fonts when no Unicode TTF exists', async () => {
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      const turkish = [{ ...rows[0], buyerName: 'Ayşe Yılmaz', city: 'İstanbul' }];
      const { buffer, unicodeFont } = await toPdf(turkish, getExportLabels('tr'), { locale: 'tr', timeZone: 'Europe/Istanbul' });
      expect(unicodeFont).toBe(false);
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('helpers', () => {
  it('transliterates Turkish letters missing from WinAnsi and keeps ç ö ü', () => {
    expect(toWinAnsi('Ağaç şişe ılık İzmir Çöü')).toBe('Agaç sise ilik Izmir Çöü');
    expect(toWinAnsi('Łódź 日本')).toBe('?ódz ??');
  });

  it('local ISO day respects the time zone', () => {
    expect(localIsoDay(new Date('2026-10-13T22:30:00Z'), 'Europe/Istanbul')).toBe('2026-10-14');
    expect(safeTimeZone('Not/AZone')).toBe('Europe/Istanbul');
    expect(safeTimeZone('UTC')).toBe('UTC');
  });
});
