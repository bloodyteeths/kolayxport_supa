import { describe, expect, it } from 'vitest';
import { hasListingsHandoff } from '@/lib/listings/legacyHandoff';

describe('hasListingsHandoff', () => {
  it('keeps the legacy page for research prefill and cross-list hand-offs', () => {
    expect(hasListingsHandoff({ prefill: 'session' })).toBe(true);
    expect(hasListingsHandoff({ crosslist: 'ebay:SKU-1' })).toBe(true);
    expect(hasListingsHandoff({ crosslist: ['etsy:123'] })).toBe(true);
  });
  it('serves the new grid otherwise', () => {
    expect(hasListingsHandoff({})).toBe(false);
    expect(hasListingsHandoff({ prefill: 'other', view: 'not_sent', open: '1' })).toBe(false);
    expect(hasListingsHandoff({ crosslist: ' ' })).toBe(false);
  });
});
