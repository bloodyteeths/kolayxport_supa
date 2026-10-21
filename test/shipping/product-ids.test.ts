// EU customs product identifiers per order item: remembered from an earlier label first, then the seller's eBay
// listing (EAN / UPC / ISBN, MPN), else SKU defaults (lib/shipping/productIds.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePrisma, type FakePrisma } from '../partners/fakePrisma';

const h = vi.hoisted(() => ({ db: null as unknown as FakePrisma }));
vi.mock('@/lib/prisma', () => ({ default: new Proxy({}, { get: (_t, k) => (h.db as any)[k] }) }));

import { idsFromEbayAspects, lookupProductIds, productKeys, saveProductIds } from '@/lib/shipping/productIds';

beforeEach(() => { h.db = makeFakePrisma(); });

describe('product ID lookup', () => {
  it('keys: SKU first, then listing id', () => {
    expect(productKeys({ sku: ' ORG-1 ', listingRef: '1500' })).toEqual(['sku:ORG-1', 'listing:1500']);
    expect(productKeys({ sku: '', listingRef: '' })).toEqual([]);
  });

  it('reads the first valid barcode and the MPN from eBay item specifics', () => {
    expect(idsFromEbayAspects({ UPC: ['Does not apply'], EAN: ['4015672111523'], MPN: ['SH123-L'] })).toEqual({ gtin: '4015672111523', mpn: 'SH123-L' });
    expect(idsFromEbayAspects({ UPC: ['123'] })).toEqual({ gtin: '', mpn: '' });
  });

  it('remembered IDs win; else eBay listing; else SKU / listing defaults', async () => {
    await saveProductIds('u1', [{ sku: 'ORG-1', listingRef: null, pid: { merchant: 'ORG-1', manufacturer: 'BELLE-ORG', gtin: '4006381333931' } }]);
    await h.db.ebayListing.create({ data: { userId: 'u1', sku: 'EB-9', listingId: '226000111', aspects: { EAN: ['4015672111523'], MPN: ['Does not apply'] } } });
    const out = await lookupProductIds('u1', [
      { id: 'i1', sku: 'ORG-1', listingRef: '1500' },
      { id: 'i2', sku: null, listingRef: '226000111' },
      { id: 'i3', sku: '', listingRef: '9999' },
    ]);
    expect(out.i1).toEqual({ merchant: 'ORG-1', manufacturer: 'BELLE-ORG', gtin: '4006381333931', source: 'saved' });
    expect(out.i2).toEqual({ merchant: '226000111', manufacturer: '226000111', gtin: '4015672111523', source: 'ebay' });
    expect(out.i3).toEqual({ merchant: '9999', manufacturer: '9999', gtin: '', source: 'default' });
  });

  it('another seller never sees these IDs; incomplete sets are not saved', async () => {
    await saveProductIds('u1', [{ sku: 'ORG-1', pid: { merchant: 'ORG-1', manufacturer: 'X', gtin: '' } }, { sku: 'BAD', pid: { merchant: '', manufacturer: 'X', gtin: '' } }]);
    expect(h.db.productIdentifier.rows.map((r) => r.key)).toEqual(['sku:ORG-1']);
    expect((await lookupProductIds('u2', [{ id: 'i1', sku: 'ORG-1' }])).i1.source).toBe('default');
  });

  it('saving again updates the remembered set (seller corrected the barcode)', async () => {
    await saveProductIds('u1', [{ sku: 'ORG-1', pid: { merchant: 'ORG-1', manufacturer: 'ORG-1', gtin: '' } }]);
    await saveProductIds('u1', [{ sku: 'ORG-1', pid: { merchant: 'ORG-1', manufacturer: 'ORG-1', gtin: '4006381333931' } }]);
    expect(h.db.productIdentifier.rows).toHaveLength(1);
    expect(h.db.productIdentifier.rows[0].gtin).toBe('4006381333931');
  });
});
