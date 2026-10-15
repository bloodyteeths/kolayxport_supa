import { describe, expect, it } from 'vitest';
import { needsLegacyListingsPage } from '@/lib/listings/legacyHandoff';

describe('needsLegacyListingsPage', () => {
  it('keeps the legacy page for research prefill and cross-list hand-offs', () => {
    expect(needsLegacyListingsPage({ prefill: 'session' })).toBe(true);
    expect(needsLegacyListingsPage({ crosslist: 'ebay:SKU-1' })).toBe(true);
    expect(needsLegacyListingsPage({ crosslist: ['etsy:123'] })).toBe(true);
  });
  it('serves the new grid otherwise', () => {
    expect(needsLegacyListingsPage({})).toBe(false);
    expect(needsLegacyListingsPage({ prefill: 'other', view: 'not_sent', open: '1' })).toBe(false);
    expect(needsLegacyListingsPage({ crosslist: ' ' })).toBe(false);
  });
});
