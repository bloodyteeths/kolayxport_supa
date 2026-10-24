// eBay ⇄ Etsy cross-list in the new UI: grid row actions link straight to the other marketplace's create route,
// old `/app/{mkt}-listings?crosslist=` links are forwarded, and the Etsy creator maps an eBay listing to its copy data.
import { describe, expect, it, vi } from 'vitest';
import { crosslistCreateHref, editorHandoffHref, parseEbayCrosslist } from '@/lib/listings/legacyHandoff';
import {
  ebayHtmlToPlainText,
  etsyCopyFromEbaySource,
  fitEbayCopyToShop,
  loadEtsyShopCurrency,
  parseEtsyCreateQuery,
} from '@/components/domain/listing-editor/crosslistEbayToEtsy';
import { ebayConfig } from '@/components/domain/listings/config/ebay';
import { etsyConfig } from '@/components/domain/listings/config/etsy';

describe('cross-list hrefs', () => {
  it('forwards eBay → Etsy hand-offs to the Etsy creator (no more legacy-only)', () => {
    expect(editorHandoffHref('etsy', { crosslist: 'ebay:SKU-1' })).toBe('/app/etsy-listings/new?crosslist=ebay%3ASKU-1');
    expect(editorHandoffHref('etsy', { crosslist: 'ebay:SKU 1', shop: '42' })).toBe('/app/etsy-listings/new?shop=42&crosslist=ebay%3ASKU+1');
    expect(editorHandoffHref('ebay', { crosslist: 'etsy:123' })).toBe('/app/ebay-listings/new?crosslist=etsy%3A123');
    // wrong direction / malformed: no editor hand-off
    expect(editorHandoffHref('etsy', { crosslist: 'etsy:123' })).toBeNull();
    expect(editorHandoffHref('ebay', { crosslist: 'ebay:SKU-1' })).toBeNull();
    expect(editorHandoffHref('etsy', { crosslist: `ebay:${'x'.repeat(51)}` })).toBeNull();
  });

  it('parses ebay:<sku>', () => {
    expect(parseEbayCrosslist('ebay:AB-1')).toBe('AB-1');
    expect(parseEbayCrosslist('ebay:')).toBeNull();
    expect(parseEbayCrosslist('ebay:a\u0001b')).toBeNull();
    expect(parseEbayCrosslist(undefined)).toBeNull();
  });

  it('row action hrefs', () => {
    expect(crosslistCreateHref('copyToEbay', 'etsy', '1490012234')).toBe('/app/ebay-listings/new?crosslist=etsy%3A1490012234');
    expect(crosslistCreateHref('copyToEbay', 'etsy', '-17')).toBeNull(); // staged new Etsy listing
    expect(crosslistCreateHref('copyToEtsy', 'ebay', 'BB-PINK')).toBe('/app/etsy-listings/new?crosslist=ebay%3ABB-PINK');
    expect(crosslistCreateHref('copyToEtsy', 'etsy', '123')).toBeNull();
  });

  it('configs offer the row actions', () => {
    expect(ebayConfig.rowActions).toContain('copyToEtsy');
    expect(etsyConfig.rowActions).toContain('copyToEbay');
  });
});

describe('Etsy create query', () => {
  it('reads crosslist=ebay:<sku> with draft › copy › crosslist › prefill precedence', () => {
    expect(parseEtsyCreateQuery({ crosslist: 'ebay:SKU-9' })).toEqual({ draftId: null, copyFromId: null, crosslistEbaySku: 'SKU-9', crosslistTrendyolBarcode: null, prefill: false });
    expect(parseEtsyCreateQuery({ crosslist: 'ebay:SKU-9', draft: 'abc' }).crosslistEbaySku).toBeNull();
    expect(parseEtsyCreateQuery({ crosslist: 'ebay:SKU-9', copy: '12' }).crosslistEbaySku).toBeNull();
    expect(parseEtsyCreateQuery({ crosslist: 'ebay:SKU-9', prefill: 'session' }).prefill).toBe(false);
    expect(parseEtsyCreateQuery({ prefill: 'session' }).prefill).toBe(true);
  });
});

describe('eBay listing → Etsy copy data', () => {
  it('turns HTML into plain text', () => {
    expect(ebayHtmlToPlainText('<p>Soft &amp; warm</p><ul><li>Cotton</li><li>Handmade</li></ul><script>x()</script>')).toBe('Soft & warm\n• Cotton\n• Handmade');
    expect(ebayHtmlToPlainText('')).toBe('');
  });

  it('maps title, text, materials, photos, weight and dimensions; no tags', () => {
    const copy = etsyCopyFromEbaySource({
      source: 'ebay',
      title: 'Brass Lamp &amp; Shade',
      description: '<p>Hello<br>World</p>',
      tags: [],
      price: 24.5,
      quantity: 3,
      imageUrls: ['https://i.ebayimg.com/1.jpg', 'http://insecure/2.jpg', 'https://i.ebayimg.com/1.jpg'],
      ebay: {
        aspects: JSON.stringify({ Material: ['Brass', 'Glass'], Brand: ['Acme'] }),
        currency: 'USD',
        weight: 2,
        weightUnit: 'POUND',
        length: 10,
        width: 5,
        height: 4,
        dimensionUnit: 'INCH',
      },
    });
    expect(copy).toMatchObject({
      source: 'ebay',
      title: 'Brass Lamp & Shade',
      description: 'Hello\nWorld',
      tags: [],
      materials: ['Brass', 'Glass'],
      price: 24.5,
      quantity: 3,
      imageUrls: ['https://i.ebayimg.com/1.jpg'],
      item_weight: 2,
      item_weight_unit: 'lb',
      item_length: 10,
      item_dimensions_unit: 'in',
    });
  });

  it('keeps the price only in the shop currency', () => {
    const copy = { source: 'ebay' as const, title: 't', description: '', tags: [], price: 10 };
    expect(fitEbayCopyToShop(copy, 'USD', 'usd')).toEqual({ copy, priceCleared: false });
    expect(fitEbayCopyToShop(copy, 'USD', 'EUR').copy.price).toBeUndefined();
    expect(fitEbayCopyToShop(copy, null, 'USD').priceCleared).toBe(true);
    expect(fitEbayCopyToShop({ ...copy, price: undefined }, 'USD', 'EUR').priceCleared).toBe(false);
  });

  it('reads the shop currency from the listings API and never throws', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ store: { currency: 'TRY' } }), { status: 200 }));
    expect(await loadEtsyShopCurrency('42', ok as unknown as typeof fetch)).toBe('TRY');
    expect(String((ok.mock.calls[0] as unknown[])[0])).toBe('/api/listings?marketplace=etsy&store=42');
    const bad = vi.fn(async () => new Response('{}', { status: 500 }));
    expect(await loadEtsyShopCurrency('42', bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadEtsyShopCurrency('42', boom as unknown as typeof fetch)).toBeNull();
  });
});
