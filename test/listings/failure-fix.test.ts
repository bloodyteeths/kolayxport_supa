import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';
import { failureFixFor, failureFixLabelKey, marketplaceDetail } from '@/lib/listings/failureFix';
import { etsySpecificKey, ebaySpecificKey } from '@/lib/drafts/syncErrors';
import { draftSendError, legacySendErrorKey } from '@/lib/listings/sendError';

const get = (o: any, key: string) => key.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
/** Every send-failure message family, all marketplaces (Etsy, eBay, Trendyol/Wix/Shopify catalog drafts). */
const FAMILIES = ['etsy.draftSync', 'etsy.validation', 'ebay.draftSync', 'listings.sendError', 'listings.draftError'];
const allKeys = FAMILIES.flatMap((f) => Object.keys(get(en, f)).map((k) => `${f}.${k}`));

describe('every send failure has a fix (all marketplaces)', () => {
  it.each(allKeys)('%s → a fix with a label in en + tr', (key) => {
    const label = failureFixLabelKey(failureFixFor(key, 'failed'));
    expect(typeof get(en, label)).toBe('string');
    expect(typeof get(tr, label)).toBe('string');
  });
  it('unknown / future keys still get a sensible fix', () => {
    expect(failureFixFor('wix.draftSync.someNewTitleProblem').kind).toBe('open');
    expect(failureFixFor('shopify.x.variantPriceWeird')).toMatchObject({ kind: 'open', section: 'variations' });
    expect(failureFixFor('trendyol.x.tokenExpiredSoon').kind).toBe('reconnect');
    expect(failureFixFor('anything.at.all')).toMatchObject({ kind: 'open', target: null });
    expect(failureFixFor('etsy.draftSync.rejected', 'conflict').kind).toBe('review');
  });
  it('every classifier output exists as a message', () => {
    const outputs = [
      'Shop section not found', 'Could not find a Listing with listing_id = 1', 'price must be consistent across linked products',
      'quantity must be consistent across linked products', 'Title is too long', 'Too many tags', 'Invalid return_policy_id',
      'Listing must have at least one image', 'Your shop has unpaid fees due', 'cannot be renewed',
    ].map((m) => etsySpecificKey(m)).concat(
      ['You are not allowed to revise ended listings.', 'exceeded your selling limits', 'Duplicate listing policy', 'item specific Brand is missing', 'Invalid category'].map((m) => ebaySpecificKey(m)),
    );
    for (const k of outputs) {
      expect(k).toBeTruthy();
      expect(typeof get(en, k as string)).toBe('string');
      expect(typeof get(tr, k as string)).toBe('string');
    }
  });
});

describe('real failures on the founder account (2026-10-17)', () => {
  it('a deleted shop section is not a missing listing', () => {
    expect(legacySendErrorKey('failed', 'Etsy API error: 400 - [{"path":"/shop/section/id","type":"invalid_shop_section_id","message":"Shop section not found."}]')).toBe('etsy.validation.shopSectionNotFound');
    expect(failureFixFor('etsy.validation.shopSectionNotFound')).toMatchObject({ kind: 'open', target: 'shop_section_id' });
  });
  it('linked prices open the variations', () => {
    const k = legacySendErrorKey('failed', 'Etsy API error: 400 - {"error":"price must be consistent across linked products"}');
    expect(k).toBe('etsy.validation.inventoryPriceInconsistent');
    expect(failureFixFor(k)).toMatchObject({ section: 'variations' });
  });
  it('a deleted listing offers discard', () => {
    expect(failureFixFor(legacySendErrorKey('failed', 'Etsy API error: 404 - {"error":"Could not find a Listing with listing_id = 4448598921"}')).kind).toBe('discard');
  });
  it('a general key carries the marketplace message', () => {
    const e = draftSendError({ status: 'failed', lastSyncError: 'listings.draftError.remoteFailed', lastSyncErrorParams: { detail: 'Barkod zaten kullanılıyor' } });
    expect(e?.errorParams?.detail).toBe('Barkod zaten kullanılıyor');
    const etsy = draftSendError({ status: 'failed', lastSyncErrorKey: 'etsy.draftSync.rejected', syncAttempts: [{ status: 'failed', error: 'Etsy API error: 400 - {"error":"Some brand new rule"}' }] });
    expect(etsy?.errorParams?.detail).toBe('Some brand new rule');
  });
  it('marketplaceDetail reads JSON bodies and drops our prefix', () => {
    expect(marketplaceDetail('Etsy API error: 400 - [{"message":"Shop section not found."}]')).toBe('Shop section not found.');
    expect(marketplaceDetail('etsy.draftSync.rejected')).toBeNull();
  });
});
