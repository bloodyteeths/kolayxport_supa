import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(), resolveByPrefix: vi.fn() }));
vi.mock('@/lib/live/publish', () => ({ publishLive: vi.fn() }));

import { decideListingAlerts, listingAlertKeys, liveKindFor } from '@/lib/etsy/listingAlerts';

const base = {
  prevState: 'active',
  newState: 'active',
  attribution: 'external',
  source: 'webhook',
  changedKeys: [] as string[],
  eventTypes: new Set<string>(),
  recentOrderForListing: false,
  hasOpenDraft: false,
  stockManaged: false,
};

describe('decideListingAlerts', () => {
  it('external active -> inactive is a deactivation alert', () => {
    expect(decideListingAlerts({ ...base, newState: 'inactive' })).toEqual(['listingDeactivated']);
  });
  it('no deactivation alert when we did it, or right after an order', () => {
    expect(decideListingAlerts({ ...base, newState: 'inactive', attribution: 'kolayxport_stock' })).toEqual([]);
    expect(decideListingAlerts({ ...base, newState: 'inactive', attribution: 'kolayxport_draft' })).toEqual([]);
    expect(decideListingAlerts({ ...base, newState: 'inactive', recentOrderForListing: true })).toEqual([]);
  });
  it('sold_out after a sale is not alerted; expired is', () => {
    expect(decideListingAlerts({ ...base, newState: 'sold_out' })).toEqual([]);
    expect(decideListingAlerts({ ...base, newState: 'expired' })).toEqual(['listingExpired']);
  });
  it('nightly reconcile discovering a deactivation alerts; the initial import never does', () => {
    expect(decideListingAlerts({ ...base, newState: 'inactive', attribution: 'unknown', source: 'reconcile' })).toEqual(['listingDeactivated']);
    expect(decideListingAlerts({ ...base, newState: 'inactive', attribution: 'unknown', source: 'initial' })).toEqual([]);
    expect(decideListingAlerts({ ...base, newState: 'expired', attribution: 'unknown', source: 'initial' })).toEqual([]);
  });
  it('external content edits alert only when an open draft exists', () => {
    expect(decideListingAlerts({ ...base, changedKeys: ['title'] })).toEqual([]);
    expect(decideListingAlerts({ ...base, changedKeys: ['title'], hasOpenDraft: true })).toEqual(['listingChangedExternally']);
    expect(decideListingAlerts({ ...base, changedKeys: ['materials'], hasOpenDraft: true })).toEqual([]);
  });
  it('out_of_stock event alerts unless stock sync manages the listing', () => {
    expect(decideListingAlerts({ ...base, eventTypes: new Set(['inventory.out_of_stock']) })).toEqual(['stockOutOfStock']);
    expect(decideListingAlerts({ ...base, eventTypes: new Set(['inventory.out_of_stock']), stockManaged: true })).toEqual([]);
  });
  it('a first sighting (prevState null) never alerts transitions', () => {
    expect(decideListingAlerts({ ...base, prevState: null, newState: 'inactive' })).toEqual([]);
  });
});

describe('keys and live kinds', () => {
  it('deactivation dedupes per listing per day; out-of-stock per 6 h bucket', () => {
    expect(listingAlertKeys.deactivated('s', '1', '2026-10-15')).toBe('listing:deactivated:s:1:2026-10-15');
    const h6 = 6 * 3600_000;
    expect(listingAlertKeys.outOfStock('s', '1', h6 * 10 + 1)).toBe(listingAlertKeys.outOfStock('s', '1', h6 * 11 - 1));
    expect(listingAlertKeys.outOfStock('s', '1', h6 * 10)).not.toBe(listingAlertKeys.outOfStock('s', '1', h6 * 11));
  });
  it('maps alerts to the most specific live kind', () => {
    expect(liveKindFor(['listingDeactivated'], 'updated')).toBe('deactivated');
    expect(liveKindFor([], 'updated')).toBe('updated');
  });
});
