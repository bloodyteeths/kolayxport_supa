import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  mapCatalogItems,
  mapCompetitivePricing,
  fetchProductSignals,
  resetSignalsState,
} from '@/lib/amazon/spapiSignals';

const US = 'ATVPDKIKX0DER';

// Shapes per SP-API docs: Catalog Items 2022-04-01 searchCatalogItems and
// Product Pricing v0 getCompetitivePricing.
const catalogFixture = {
  items: [
    {
      asin: 'B0ORGANIC1',
      summaries: [{ marketplaceId: US, brand: 'Cacala', itemName: 'Turkish Towel' }],
      salesRanks: [
        {
          marketplaceId: 'A1PA6795UKMFR9',
          displayGroupRanks: [{ websiteDisplayGroup: 'home_display_on_website', title: 'Küche', rank: 99 }],
        },
        {
          marketplaceId: US,
          classificationRanks: [{ classificationId: '1063308', title: 'Bath Towels', rank: 5 }],
          displayGroupRanks: [{ websiteDisplayGroup: 'home_display_on_website', title: 'Home & Kitchen', rank: 1234 }],
        },
      ],
    },
    { asin: 'B0NORANK00', summaries: [{ marketplaceId: US, brand: 'X' }], salesRanks: [] },
  ],
};

const pricingFixture = {
  payload: [
    {
      status: 'Success',
      ASIN: 'B0ORGANIC1',
      Product: {
        CompetitivePricing: {
          CompetitivePrices: [
            { CompetitivePriceId: '2', condition: 'Used', Price: { LandedPrice: { CurrencyCode: 'USD', Amount: 15 } } },
            { CompetitivePriceId: '1', condition: 'New', Price: { LandedPrice: { CurrencyCode: 'USD', Amount: 24.99 } } },
          ],
          NumberOfOfferListings: [
            { condition: 'New', Count: 4 },
            { condition: 'Used', Count: 1 },
            { condition: 'Any', Count: 5 },
          ],
        },
      },
    },
    { status: 'ClientError', ASIN: 'B0NORANK00', Product: {} },
  ],
};

describe('mapCatalogItems', () => {
  it('takes the top-level BSR for the requested marketplace', () => {
    const m = mapCatalogItems(catalogFixture.items, US);
    expect(m.B0ORGANIC1).toEqual({
      bsr: 1234,
      bsrCategory: 'Home & Kitchen',
      subRanks: [{ rank: 5, title: 'Bath Towels' }],
      brand: 'Cacala',
    });
    expect(m.B0NORANK00.bsr).toBeNull();
  });
});

describe('mapCompetitivePricing', () => {
  it('reads offer counts and the New buy box', () => {
    const m = mapCompetitivePricing(pricingFixture.payload);
    expect(m.B0ORGANIC1).toEqual({ offerCountNew: 4, offerCountAny: 5, buyBoxPrice: 24.99, currency: 'USD' });
    expect(m.B0NORANK00).toBeUndefined();
  });
});

describe('fetchProductSignals', () => {
  beforeEach(() => resetSignalsState());

  it('merges catalog + pricing and calls the documented endpoints', async () => {
    const fetcher = vi.fn(async (url: string) => (url.startsWith('/catalog') ? catalogFixture : pricingFixture));
    const r = await fetchProductSignals({
      token: 't', region: 'na', marketplaceId: US, asins: ['b0organic1', 'B0NORANK00', 'bad'], sellerKey: 'u1', fetcher: fetcher as any,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain('/catalog/2022-04-01/items?identifiers=B0ORGANIC1,B0NORANK00&identifiersType=ASIN');
    expect(fetcher.mock.calls[0][0]).toContain('includedData=salesRanks,summaries');
    expect(fetcher.mock.calls[1][0]).toContain('/products/pricing/v0/competitivePrice?MarketplaceId=ATVPDKIKX0DER&Asins=B0ORGANIC1,B0NORANK00&ItemType=Asin');
    expect(r.errors).toEqual({});
    expect(r.items.B0ORGANIC1).toMatchObject({ bsr: 1234, offerCountAny: 5, buyBoxPrice: 24.99 });
    // No rank and no pricing → omitted rather than returned as zeros.
    expect(r.items.B0NORANK00).toBeUndefined();

    // Second call is served from cache.
    await fetchProductSignals({ token: 't', region: 'na', marketplaceId: US, asins: ['B0ORGANIC1'], sellerKey: 'u1', fetcher: fetcher as any });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports access_denied on 403 and backs off for that seller', async () => {
    const fetcher = vi.fn(async () => { throw new Error('Amazon SP-API error: 403 - Unauthorized'); });
    const r = await fetchProductSignals({ token: 't', region: 'na', marketplaceId: US, asins: ['B0ORGANIC1'], sellerKey: 'u2', fetcher: fetcher as any });
    expect(r.items).toEqual({});
    expect(r.errors).toEqual({ catalog: 'access_denied', pricing: 'access_denied' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await fetchProductSignals({ token: 't', region: 'na', marketplaceId: US, asins: ['B0ORGANIC2'], sellerKey: 'u2', fetcher: fetcher as any });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps pricing data when only catalog is denied', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith('/catalog')) throw new Error('Amazon SP-API error: 403 - Unauthorized');
      return pricingFixture;
    });
    const r = await fetchProductSignals({ token: 't', region: 'na', marketplaceId: US, asins: ['B0ORGANIC1'], sellerKey: 'u3', fetcher: fetcher as any });
    expect(r.errors).toEqual({ catalog: 'access_denied' });
    expect(r.items.B0ORGANIC1).toMatchObject({ bsr: null, offerCountAny: 5 });
  });
});
