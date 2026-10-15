import { describe, it, expect, vi } from 'vitest';
import {
  toOrderRow,
  toOrderRows,
  mergeLineItems,
  splitVariant,
  shipToMissing,
  resolveCountryCode,
  getLatestLabel,
  fetchOrderEnrichment,
  ordersNeedingEtsyAddress,
  listingUrlRequest,
} from '@/lib/orders/toOrderRows';
import {
  NOW,
  YESTERDAY,
  TOMORROW,
  etsyNoAddress,
  etsyEnrichment,
  amazonFba,
  amazonOpen,
  trendyolCargo,
  wixNested,
  veeqoSellable,
  manualLabeled,
  voidedLabel,
  ALL_FIXTURES,
} from './g1-fixtures';

const ctx = { now: NOW, etsyShopNames: ['BelleCoutureGifts'] };

describe('toOrderRows — per marketplace', () => {
  it('Etsy without address: problem (address unavailable), not labelable, Etsy store via shop name', () => {
    const r = toOrderRow(etsyNoAddress, ctx);
    expect(r.store).toEqual({ key: 'etsy:bellecouturegifts', marketplace: 'etsy', shopName: 'BelleCoutureGifts' });
    expect(r.storeName).toBe('BelleCoutureGifts');
    expect(r.shipTo.unavailable).toBe(true);
    expect(r.shipTo.missing).toEqual(['street1', 'city', 'postal', 'country']);
    expect(r.status).toMatchObject({ domain: 'order', key: 'problem', reason: 'address_unavailable', raw: 'paid' });
    expect(r.canLabel).toBe(false);
    expect(r.shipBy).toBe(YESTERDAY);
    expect(r.shippingUpgrade).toBe('Express');
    expect(r.note).toBe('Use the pink ribbon');
    expect(r.giftMessage).toBe('Congratulations!');
    expect(r.marketplaceUrl).toBe('https://www.etsy.com/your/orders/sold/completed?order_id=3891');
    expect(r.items[0]).toMatchObject({ title: 'Personalized Baby Blanket', variant: 'Color: Pink', personalization: 'LENA – 03.10.2026', sku: 'BB-PINK', quantity: 2, unitPrice: 69.99 });
    expect(r.currency).toBe('USD');
    expect(r.total).toBe(169.99);
  });

  it('Etsy with the extension address: complete, overdue, labelable, buyer note from the notes', () => {
    const r = toOrderRow(etsyNoAddress, { ...ctx, enrichment: { etsyAddresses: { '3891': etsyEnrichment } } });
    expect(r.shipTo).toMatchObject({ street1: '12 Oak St', street2: 'Apt 4', city: 'Austin', state: 'TX', postal: '78701', country: 'US', enrichedFromEtsy: true, unavailable: false });
    expect(r.shipTo.missing).toEqual([]);
    expect(r.status.key).toBe('overdue');
    expect(r.canLabel).toBe(true);
    expect(r.buyerNote).toBe('LENA');
    // The extension's relative "Ship by tomorrow" text is never used as a date.
    expect(r.shipBy).toBe(YESTERDAY);
  });

  it('an Etsy shop name without the EtsyShop list is "other", labeled with its name', () => {
    const r = toOrderRow(etsyNoAddress, { now: NOW });
    expect(r.store).toEqual({ key: 'other:bellecouturegifts', marketplace: 'other', shopName: 'BelleCoutureGifts' });
    expect(r.shipTo.unavailable).toBe(false);
    expect(r.status).toMatchObject({ key: 'problem', reason: 'address_incomplete' });
  });

  it('Amazon FBA + anonymized: shipped with fba reason, never labelable, name hidden', () => {
    const r = toOrderRow(amazonFba, ctx);
    expect(r.status).toMatchObject({ key: 'shipped', reason: 'fba' });
    expect(r.isFBA).toBe(true);
    expect(r.canLabel).toBe(false);
    expect(r.shipTo.nameHidden).toBe(true);
    expect(r.buyerName).toBe('');
    expect(r.shipTo.street1).toBe('');
  });

  it('Amazon merchant-fulfilled with anonymized name: to ship and labelable (name is not required)', () => {
    const r = toOrderRow(amazonOpen, ctx);
    expect(r.status.key).toBe('to_ship');
    expect(r.shipTo.nameHidden).toBe(true);
    expect(r.shipTo.missing).toEqual([]);
    expect(r.canLabel).toBe(true);
    expect(r.shipBy).toBe(TOMORROW);
    expect(r.marketplaceUrl).toBe('https://sellercentral.amazon.com/orders-v3/order/114-0000000-0099');
  });

  it('Trendyol pre-assigned cargo number is not a label; district, neighbourhood and phone come from shipmentAddress', () => {
    const r = toOrderRow(trendyolCargo, ctx);
    expect(r.label).toBeNull();
    expect(r.marketplaceCargoNumber).toBe('7330012345');
    expect(r.status.key).toBe('to_ship');
    expect(r.shipTo).toMatchObject({ name: 'Ayşe Kaya', street1: 'Ertuğrul Mah. 5', city: 'Bursa', district: 'Nilüfer', neighbourhood: 'Ertuğrul', phone: '+905320000000', country: 'TR' });
    expect(r.items[0].listingUrl).toMatch(/^\/api\/trendyol\/url\?barcode=8690000000001/);
    expect(r.currency).toBe('TRY');
  });

  it('Wix nested address, string total, server listing URL', () => {
    const r = toOrderRow(wixNested, ctx);
    expect(r.shipTo).toMatchObject({ name: 'Jonas Weber', street1: 'Hauptstr. 1', city: 'Berlin', postal: '10115', country: 'DE', phone: '+49301234', email: 'j@example.com' });
    expect(r.total).toBe(58);
    expect(r.items[0].listingUrl).toBe('https://shop.example/product-page/sign');
    expect(r.store.marketplace).toBe('wix');
    expect(r.marketplaceUrl).toBeNull();
  });

  it('Veeqo order with a failed LabelJob: label_failed with the carrier message, retry is labelable', () => {
    const r = toOrderRow(veeqoSellable, ctx);
    expect(r.status).toMatchObject({ domain: 'label', key: 'label_failed', detail: 'Postal code is invalid for GB' });
    expect(r.labelFailure).toEqual({ carrier: 'FEDEX', errorMessage: 'Postal code is invalid for GB', at: '2026-10-11T09:00:00.000Z' });
    expect(r.canLabel).toBe(true);
    expect(r.shipTo).toMatchObject({ name: 'Tom Hill', postal: 'LS1 1AA', country: 'GB' });
    expect(r.history.map((h) => h.kind)).toEqual(['ordered', 'imported', 'label_failed']);
    expect(r.store).toEqual({ key: 'other:veeqo', marketplace: 'other', shopName: 'Veeqo' });
  });

  it('manual order: no marketplace link, newest non-voided Shipment label, failed push, carrier cost', () => {
    const r = toOrderRow(manualLabeled, ctx);
    expect(r.isManual).toBe(true);
    expect(r.store.marketplace).toBe('manual');
    expect(r.marketplaceUrl).toBeNull();
    expect(r.status.key).toBe('label_created');
    expect(r.label).toEqual({ source: 'shipment', shipmentId: 's1', carrier: 'UPS', trackingNumber: '1Z999AA10123456784', labelHref: 'data:image/gif;base64,AAA', createdAt: '2026-10-14T10:00:00.000Z' });
    expect(r.trackingSubmission).toMatchObject({ state: 'failed', error: 'eBay API 500', carrierName: 'UPS' });
    expect(r.carrierCost).toEqual({ amount: 412.5, currency: 'TRY' });
    expect(r.canLabel).toBe(false);
  });

  it('voided label = no label; DE without postal code is a problem', () => {
    const r = toOrderRow(voidedLabel, ctx);
    expect(r.label).toBeNull();
    expect(getLatestLabel(voidedLabel)).toBeNull();
    expect(r.status).toMatchObject({ key: 'problem', reason: 'address_incomplete', detail: 'postal' });
    expect(r.canLabel).toBe(false);
  });

  it('unknown currency stays null (no USD default) and no placeholder image', () => {
    const r = toOrderRow({ ...wixNested, id: 'x', currency: null, line_items: [{ id: 'z', title: 'T', image: '/placeholder.png', labelJobs: [] }] }, ctx);
    expect(r.currency).toBeNull();
    expect(r.items[0].image).toBeNull();
  });

  it('one row per order id; every fixture maps without throwing', () => {
    const rows = toOrderRows([...ALL_FIXTURES, etsyNoAddress], ctx);
    expect(rows.map((r) => r.id)).toEqual(ALL_FIXTURES.map((o) => o.id));
    for (const r of rows) {
      expect(r.raw).toBeDefined();
      expect(Array.isArray(r.history)).toBe(true);
    }
  });
});

describe('toOrderRows helpers', () => {
  it('merges the API one-row-per-LabelJob items', () => {
    const merged = mergeLineItems([
      { id: 'a', title: 'A', labelJobs: [{ status: 'failed' }] },
      { id: 'a', title: 'A', labelJobs: [{ status: 'created', trackingNumber: 'T' }] },
      { id: 'b', title: 'B', labelJobs: [] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].labelJobs).toHaveLength(2);
  });

  it('a failure followed by a created LabelJob is a label, not a failure', () => {
    const r = toOrderRow(
      {
        ...veeqoSellable,
        line_items: [
          { id: 'i6', title: 'Mug', labelJobs: [{ status: 'failed', createdAt: '2026-10-11T09:00:00Z' }] },
          { id: 'i6', title: 'Mug', labelJobs: [{ status: 'created', trackingNumber: '7946', pdfUrl: 'https://l', carrier: 'FEDEX', createdAt: '2026-10-11T10:00:00Z' }] },
        ],
      },
      ctx,
    );
    expect(r.status.key).toBe('label_created');
    expect(r.label?.source).toBe('labelJob');
    expect(r.labelFailure).toBeNull();
  });

  it('splitVariant pulls personalization out of Etsy variations', () => {
    expect(splitVariant('Color: Pink, Personalization: LENA')).toEqual({ variant: 'Color: Pink', personalization: 'LENA' });
    expect(splitVariant('Personalization: Not requested on this item.')).toEqual({ variant: null, personalization: null });
    expect(splitVariant('—')).toEqual({ variant: null, personalization: null });
    expect(splitVariant('M, Red')).toEqual({ variant: 'M, Red', personalization: null });
  });

  it('shipToMissing: postal not required where countries have none', () => {
    expect(shipToMissing({ street1: 'a', city: 'b', postal: '', country: 'HK' })).toEqual([]);
    expect(shipToMissing({ street1: 'a', city: 'b', postal: '', country: 'DE' })).toEqual(['postal']);
    expect(shipToMissing({ street1: '', city: '', postal: '', country: '' })).toEqual(['street1', 'city', 'postal', 'country']);
  });

  it('resolveCountryCode', () => {
    expect(resolveCountryCode('United States')).toBe('US');
    expect(resolveCountryCode('Türkiye')).toBe('TR');
    expect(resolveCountryCode('de')).toBe('DE');
    expect(resolveCountryCode('Narnia')).toBe('NARNIA');
    expect(resolveCountryCode(null)).toBe('');
  });

  it('enrichment requests: EtsyAddress for orders lacking street/city, listing URLs for titles and Veeqo ids', () => {
    expect(ordersNeedingEtsyAddress(ALL_FIXTURES)).toEqual(expect.arrayContaining(['3891']));
    expect(ordersNeedingEtsyAddress(ALL_FIXTURES)).not.toContain('IG-2026-031');
    const body = listingUrlRequest(ALL_FIXTURES)!;
    expect(body.productIds).toContain(4242);
    expect(body.titles).toContain('Personalized Baby Blanket');
  });

  it('fetchOrderEnrichment swallows failures (partial data)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/etsy-addresses')) return { ok: true, json: async () => ({ success: true, lookup: { '3891': etsyEnrichment } }) } as any;
      throw new Error('network');
    });
    const out = await fetchOrderEnrichment([etsyNoAddress], fetchImpl as any);
    expect(out.etsyAddresses?.['3891']).toBeDefined();
    expect(out.listingUrls).toBeUndefined();
    expect(String(fetchImpl.mock.calls[0][0])).toContain('orderNumbers=3891');
  });
});
