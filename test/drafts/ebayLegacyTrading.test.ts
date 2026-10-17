// Listings created on eBay (legacy, Trading API): what KolayXport reads, stages, compares and sends.
import { describe, expect, it } from 'vitest';
import { legacyChanges, legacySnapshots, parseLegacyItem, tradingErrors } from '@/lib/ebay/legacyTrading';
import { legacyConflicts, legacyStageParams } from '@/lib/ebay/draftService';
import { classifyEbayDraftSyncError } from '@/lib/drafts/syncErrors';
import { failureFixFor } from '@/lib/listings/failureFix';
import { isUncountedDraft } from '@/lib/drafts/emptyDraft';

const GET_ITEM = `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item><ItemID>197459138394</ItemID>
<Title>ALL sizes Nike Cortez Women &amp; Kids</Title><Description>&lt;p&gt;Great &amp;amp; new&lt;/p&gt;</Description>
<Quantity>12</Quantity><StartPrice currencyID="USD">89.99</StartPrice>
<SellingStatus><CurrentPrice currencyID="USD">89.99</CurrentPrice><QuantitySold>5</QuantitySold><ListingStatus>Active</ListingStatus></SellingStatus></Item></GetItemResponse>`;

describe('reading a legacy listing', () => {
  it('parses title, description, price, available quantity (Quantity − QuantitySold) and status', () => {
    const it0 = parseLegacyItem(GET_ITEM, '197459138394');
    expect(it0).toMatchObject({ title: 'ALL sizes Nike Cortez Women & Kids', description: '<p>Great &amp; new</p>', price: { value: '89.99', currency: 'USD' }, quantity: 7, status: 'Active', hasVariations: false });
    const snap = legacySnapshots(it0);
    expect(snap.inventory.availability.shipToLocationAvailability.quantity).toBe(7);
    expect(snap.offer.pricingSummary.price.value).toBe('89.99');
  });
  it('reads eBay error lines (warnings ignored)', () => {
    expect(tradingErrors('<Errors><LongMessage>You are not allowed to revise ended listings.</LongMessage><SeverityCode>Error</SeverityCode></Errors><Errors><LongMessage>w</LongMessage><SeverityCode>Warning</SeverityCode></Errors>')).toBe('You are not allowed to revise ended listings.');
  });
});

describe('staging a legacy draft', () => {
  it('keeps title, description, price and quantity; drops what the Trading path cannot send', () => {
    const out = legacyStageParams({
      inventoryFields: { product: { title: 'T', description: 'D', aspects: { Brand: ['x'] } }, condition: 'NEW', availability: { shipToLocationAvailability: { quantity: 3 } } },
      offerFields: { pricingSummary: { price: { value: '10.00', currency: 'USD' } }, listingDescription: 'D', categoryId: '1' },
    });
    expect(out.inventoryFields).toEqual({ product: { title: 'T', description: 'D' }, availability: { shipToLocationAvailability: { quantity: 3 } } });
    expect(out.offerFields).toEqual({ pricingSummary: { price: { value: '10.00', currency: 'USD' } }, listingDescription: 'D' });
  });
  it('refuses photos and listing actions with the reason, before anything is written', () => {
    expect(() => legacyStageParams({ media: [{ operation: 'upload' }] })).toThrow(/title, description, price and quantity/);
    expect(() => legacyStageParams({ queuedActions: [{ type: 'withdraw' }] })).toThrow();
  });
  it('legacy drafts count as unsent changes now', () => {
    expect(isUncountedDraft('EbayListingDraft', { sku: 'legacy-1', status: 'draft', inventoryPatch: { product: { title: 'x' } }, offerPatch: {}, queuedActions: [], _count: { media: 0 } })).toBe(false);
  });
});

describe('sending a legacy draft', () => {
  const base = legacySnapshots(parseLegacyItem(GET_ITEM, '1'));
  it('only the fields the draft changes are compared: eBay editing another field is no conflict', () => {
    const live = JSON.parse(JSON.stringify(base));
    live.offer.pricingSummary.price.value = '79.99';
    expect(legacyConflicts(base, live, legacyChanges({ product: { title: 'New' } }, {}))).toEqual([]);
    expect(legacyConflicts(base, live, legacyChanges({}, { pricingSummary: { price: { value: '99.00', currency: 'USD' } } }))).toEqual(['price']);
  });
  it('changes read from the editor patches; unknown fields are reported, never sent', () => {
    const c = legacyChanges({ product: { title: 'A' }, availability: { shipToLocationAvailability: { quantity: '4' } } }, { listingDescription: '<p>x</p>', categoryId: '9' });
    expect(c).toMatchObject({ title: 'A', description: '<p>x</p>', quantity: 4, unsupported: ['categoryId'] });
  });
  it('typed refusals keep their exact reason and a fix', () => {
    const e = Object.assign(new Error('x'), { name: 'EbayDraftError', key: 'draftSync.legacyVariationsPriceStock' });
    expect(classifyEbayDraftSyncError(e).key).toBe('ebay.draftSync.legacyVariationsPriceStock');
    expect(failureFixFor('ebay.draftSync.legacyVariationsPriceStock').kind).toBe('onMarketplace');
    expect(classifyEbayDraftSyncError(new Error('eBay API error: You are not allowed to revise ended listings.')).key).toBe('ebay.draftSync.listingEnded');
  });
});
