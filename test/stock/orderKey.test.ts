import { describe, expect, it } from 'vitest';
import { deriveOrderKey, orderStatusClass, resolveOrderChannel } from '@/lib/stock/orderKey';

// Fixtures shaped after real production rows (read-only check, 2026-10-15).
const etsyDirect = { id: 'o1', marketplace: 'BelleCoutureGifts', marketplaceKey: '4202333842', orderNumber: '4202333842', rawData: { receipt_id: 4202333842, transactions: [] } };
const veeqoEtsy = {
  id: 'o2',
  marketplace: 'BelleCoutureGifts',
  marketplaceKey: '042eb421568a429281cfa06126407ce3',
  orderNumber: '3642670034',
  rawData: { id: 911730173, number: '3642670034', channel: { type_code: 'etsy', name: 'bellecouturegifts' }, line_items: [] },
};
const veeqoAmazon = {
  id: 'o3',
  marketplace: 'Decorsweetart',
  marketplaceKey: '1515644511',
  orderNumber: '113-9937372-4588213',
  rawData: { id: 1515644511, number: '113-9937372-4588213', channel: { type_code: 'amazon' }, line_items: [] },
};
const veeqoShopify = { id: 'o4', marketplace: 'Mybabybymerry', marketplaceKey: '911730173', orderNumber: '#2720-A', rawData: { id: 911730173, number: '#2720-A', channel: { type_code: 'shopify' }, line_items: [] } };
const veeqoString = {
  id: 'o5',
  marketplace: 'Veeqo',
  marketplaceKey: '811113650',
  orderNumber: '112-3181192-4275434',
  rawData: JSON.stringify({ id: 811113650, number: '112-3181192-4275434', channel: { type_code: 'amazon' }, line_items: [] }),
};
const shippoEtsy = { id: 'o6', marketplace: 'BelleCoutureGifts', marketplaceKey: 'ad2c8cadb703410990cb7227c25dc70e', orderNumber: '3671276581', rawData: { object_id: 'ad2c', shop_app: 'Etsy', order_number: '3671276581', line_items: [] } };
const ebayDirect = { id: 'o7', marketplace: 'eBay', marketplaceKey: '23-15265-11475', orderNumber: '23-15265-11475', rawData: { orderId: '23-15265-11475', lineItems: [], orderFulfillmentStatus: 'FULFILLED' } };
const trendyol = { id: 'o8', marketplace: 'Trendyol', marketplaceKey: '4245792034', orderNumber: '11711477562', status: 'CANCELLED', rawData: { id: 4245792034, orderNumber: '11711477562', lines: [], status: 'Cancelled' } };
const trendyolReturned = { ...trendyol, id: 'o9', rawData: { ...trendyol.rawData, status: 'Returned' } };
const shopifyDirect = { id: 'o10', marketplace: 'shopify', marketplaceKey: '18464875642902', orderNumber: '#1115', rawData: { id: 18464875642902, admin_graphql_api_id: 'gid://shopify/Order/1', line_items: [] } };
const wix = { id: 'o11', marketplace: 'Wix', marketplaceKey: '98dfa30f-9739-4072-95b0-c895be6a4e4e', orderNumber: '10082', rawData: { id: '98dfa30f-9739-4072-95b0-c895be6a4e4e', buyerInfo: {}, lineItems: [] } };
const amazonDirect = { id: 'o12', marketplace: 'amazon', marketplaceKey: '111-3499777-4845048', orderNumber: '111-3499777-4845048', rawData: { orderId: '111-3499777-4845048', salesChannel: 'Amazon.com', rows: [] } };
const manual = { id: 'o13', marketplace: 'Manual', marketplaceKey: 'manual-1', orderNumber: '#2812-A', rawData: { manualOrder: true } };

describe('deriveOrderKey', () => {
  it('Etsy direct, Veeqo copy and Shippo copy of a receipt share one key', () => {
    expect(deriveOrderKey(etsyDirect)).toBe('etsy:4202333842');
    expect(deriveOrderKey(veeqoEtsy)).toBe('etsy:3642670034');
    expect(deriveOrderKey(shippoEtsy)).toBe('etsy:3671276581');
    expect(deriveOrderKey({ ...veeqoEtsy, rawData: { ...veeqoEtsy.rawData, number: '4202333842' } })).toBe(deriveOrderKey(etsyDirect));
  });

  it('Amazon via Veeqo (object or JSON string) and direct', () => {
    expect(deriveOrderKey(veeqoAmazon)).toBe('amazon:113-9937372-4588213');
    expect(deriveOrderKey(veeqoString)).toBe('amazon:112-3181192-4275434');
    expect(deriveOrderKey(amazonDirect)).toBe('amazon:111-3499777-4845048');
  });

  it('Shopify via Veeqo: unresolved when Shopify is connected directly, else aggregator-scoped', () => {
    expect(deriveOrderKey(veeqoShopify, { directChannels: new Set(['shopify']) })).toBeNull();
    expect(deriveOrderKey(veeqoShopify, { directChannels: new Set() })).toBe('shopify:veeqo:911730173');
  });

  it('direct channels', () => {
    expect(deriveOrderKey(ebayDirect)).toBe('ebay:23-15265-11475');
    expect(deriveOrderKey(trendyol)).toBe('trendyol:4245792034');
    expect(deriveOrderKey(shopifyDirect)).toBe('shopify:18464875642902');
    expect(deriveOrderKey(wix)).toBe('wix:98dfa30f-9739-4072-95b0-c895be6a4e4e');
    expect(deriveOrderKey(manual)).toBe('manual:o13');
  });

  it('Order.source wins over shape sniffing', () => {
    expect(resolveOrderChannel({ ...etsyDirect, source: 'etsy-api', rawData: {} })).toMatchObject({ channel: 'etsy', via: 'direct', nativeId: '4202333842' });
  });
});

describe('orderStatusClass', () => {
  it('cancelled restocks, returned does not', () => {
    expect(orderStatusClass(trendyol)).toBe('cancelled');
    expect(orderStatusClass(trendyolReturned)).toBe('returned');
    expect(orderStatusClass({ id: 'x', status: 'shipped' })).toBe('open');
    expect(orderStatusClass({ id: 'x', status: 'refunded' })).toBe('cancelled');
  });
});
