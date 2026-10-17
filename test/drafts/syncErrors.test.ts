import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import {
  classifyEbayDraftSyncError,
  classifyEtsyDraftSyncError,
  EBAY_DRAFT_ERROR,
  ETSY_DRAFT_ERROR,
  isStoredErrorKey,
  withLegacyLastSyncError,
} from '@/lib/drafts/syncErrors';
import { EtsyDraftError } from '@/lib/etsy/draftErrors';

const get = (obj: any, key: string) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

describe('draft sync error codes', () => {
  it('every code exists in en and tr', () => {
    for (const key of [...Object.values(ETSY_DRAFT_ERROR), ...Object.values(EBAY_DRAFT_ERROR)]) {
      expect(typeof get(en, key), `en ${key}`).toBe('string');
      expect(typeof get(tr, key), `tr ${key}`).toBe('string');
    }
  });

  it('classifies Etsy errors', () => {
    expect(classifyEtsyDraftSyncError(new EtsyDraftError('X', 'm', { key: 'draftSync.processingNotMapped', params: { min: 1, max: 3 } })))
      .toEqual({ key: 'etsy.draftSync.processingNotMapped', params: { min: 1, max: 3 } });
    expect(classifyEtsyDraftSyncError(new Error('Etsy API error: 401 - Invalid access token'))).toEqual({ key: ETSY_DRAFT_ERROR.reauthRequired });
    expect(classifyEtsyDraftSyncError(new Error('Etsy API error: 400 - who_made is required'))).toEqual({ key: ETSY_DRAFT_ERROR.whoMadeRequired });
    expect(classifyEtsyDraftSyncError(new Error('Etsy API error: 429 - slow down'))).toEqual({ key: ETSY_DRAFT_ERROR.rateLimited });
    expect(classifyEtsyDraftSyncError(new Error('Etsy API error: 400 - price must be > 0'))).toEqual({ key: 'etsy.validation.pricePositive' });
    expect(classifyEtsyDraftSyncError(new Error('Etsy API error: 400 - bad'))).toEqual({ key: ETSY_DRAFT_ERROR.rejected });
    expect(classifyEtsyDraftSyncError(new Error('weird'))).toEqual({ key: ETSY_DRAFT_ERROR.failed });
    expect(classifyEbayDraftSyncError(new Error('eBay 503 Service Unavailable'))).toEqual({ key: EBAY_DRAFT_ERROR.unavailable });
  });

  it('keeps API back-compat text for new codes', () => {
    expect(isStoredErrorKey('etsy.draftSync.failed')).toBe(true);
    expect(isStoredErrorKey('Etsy API error: 400 - bad')).toBe(false);
    const d = withLegacyLastSyncError({ status: 'failed', lastSyncError: 'etsy.draftSync.rejected', syncAttempts: [{ status: 'failed', error: 'Etsy API error: 400 - bad' }] });
    expect(d).toMatchObject({ lastSyncError: 'Etsy API error: 400 - bad', lastSyncErrorKey: 'etsy.draftSync.rejected' });
    expect(withLegacyLastSyncError({ status: 'failed', lastSyncError: 'old text' })).toMatchObject({ lastSyncError: 'old text', lastSyncErrorKey: null });
    expect(withLegacyLastSyncError({ status: 'conflict', lastSyncError: 'etsy.draftSync.remoteChanged' })).toMatchObject({ lastSyncError: 'etsy.draftSync.remoteChanged', lastSyncErrorKey: 'etsy.draftSync.remoteChanged' });
  });
});
