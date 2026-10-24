import { describe, expect, it } from 'vitest';
import { etsyCopyFromTrendyolProduct } from '@/components/domain/listing-editor/crosslistTrendyolToEtsy';
import { parseEtsyCreateQuery, fitEbayCopyToShop } from '@/components/domain/listing-editor/crosslistEbayToEtsy';
import { crosslistCreateHref, parseTrendyolCrosslist } from '@/lib/listings/legacyHandoff';

const product = {
  barcode: 'KX-123',
  title: 'El Yapımı  Bakır Cezve &amp; Fincan Seti',
  description: '<p>Saf bakır.</p><ul><li>350 ml</li><li>Ahşap sap</li></ul>',
  salePrice: 899.9,
  listPrice: 1199,
  quantity: 12,
  currencyType: 'TRY',
  images: [{ url: 'https://cdn.dsmcdn.com/a.jpg' }, { url: 'https://cdn.dsmcdn.com/a.jpg' }, { url: 'http://insecure/b.jpg' }, 'https://cdn.dsmcdn.com/c.jpg'],
  attributes: [
    { attributeId: 47, attributeName: 'Renk', attributeValue: 'Bakır' },
    { attributeId: 14, attributeName: 'Materyal', attributeValue: 'Bakır, Ahşap' },
  ],
};

describe('etsyCopyFromTrendyolProduct', () => {
  it('maps title, plain-text description, materials, price, qty and https images', () => {
    const c = etsyCopyFromTrendyolProduct(product);
    expect(c.source).toBe('trendyol');
    expect(c.title).toBe('El Yapımı Bakır Cezve & Fincan Seti');
    expect(c.description).toBe('Saf bakır.\n• 350 ml\n• Ahşap sap');
    expect(c.materials).toEqual(['Bakır', 'Ahşap']);
    expect(c.tags).toEqual([]);
    expect(c.price).toBe(899.9);
    expect(c.quantity).toBe(12);
    expect(c.imageUrls).toEqual(['https://cdn.dsmcdn.com/a.jpg', 'https://cdn.dsmcdn.com/c.jpg']);
  });
  it('limits: title 140, at most 20 images, no zero price/qty', () => {
    const c = etsyCopyFromTrendyolProduct({ title: 'x'.repeat(200), salePrice: 0, quantity: 0, images: Array.from({ length: 24 }, (_, i) => `https://cdn/x${i}.jpg`) });
    expect(c.title).toHaveLength(140);
    expect(c.imageUrls).toHaveLength(20);
    expect(c.price).toBeUndefined();
    expect(c.quantity).toBeUndefined();
  });
  it('a TRY price is dropped for a USD shop and kept for a TRY shop', () => {
    const c = etsyCopyFromTrendyolProduct(product);
    expect(fitEbayCopyToShop(c, 'TRY', 'USD')).toMatchObject({ priceCleared: true });
    expect(fitEbayCopyToShop(c, 'TRY', 'USD').copy.price).toBeUndefined();
    expect(fitEbayCopyToShop(c, 'TRY', 'TRY')).toMatchObject({ priceCleared: false, copy: { price: 899.9 } });
  });
});

describe('Trendyol crosslist routing', () => {
  it('parses trendyol:<barcode> and rejects other ids', () => {
    expect(parseTrendyolCrosslist('trendyol:KX-123')).toBe('KX-123');
    expect(parseTrendyolCrosslist('trendyol:bad id')).toBeNull();
    expect(parseTrendyolCrosslist('ebay:KX-123')).toBeNull();
  });
  it('the Etsy creator query: draft › copy › ebay › trendyol', () => {
    expect(parseEtsyCreateQuery({ crosslist: 'trendyol:KX-123' })).toMatchObject({ crosslistTrendyolBarcode: 'KX-123', crosslistEbaySku: null, prefill: false });
    expect(parseEtsyCreateQuery({ crosslist: 'trendyol:KX-123', draft: 'd1' })).toMatchObject({ crosslistTrendyolBarcode: null, draftId: 'd1' });
    expect(parseEtsyCreateQuery({ crosslist: 'trendyol:KX-123', prefill: 'session' }).prefill).toBe(false);
  });
  it('row action href from a Trendyol row; not offered for other marketplaces', () => {
    expect(crosslistCreateHref('copyToEtsy', 'trendyol', 'KX-123')).toBe('/app/etsy-listings/new?crosslist=trendyol%3AKX-123');
    expect(crosslistCreateHref('copyToEtsy', 'wix', 'KX-123')).toBeNull();
    expect(crosslistCreateHref('copyToEbay', 'trendyol', 'KX-123')).toBeNull();
  });
});
