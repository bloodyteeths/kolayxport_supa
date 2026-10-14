import { describe, it, expect } from 'vitest';
import { hasStreet, mergeAddressPreferNonEmpty, mergeNamePreferNonEmpty, parseStoredAddress, sameAddress } from '@/lib/orders/addressMerge';

const scraped = { name: 'Jane Doe', street1: '1 Main St', street2: 'Apt 2', city: 'Austin', state: 'TX', postal: '78701', country: 'US', email: 'j@example.com' };
const etsyRedacted = { name: 'Jane Doe', phone: '', street1: '', street2: '', city: '', state: '', postal: '', country: '', isResidential: true, email: '' };

describe('mergeAddressPreferNonEmpty', () => {
  it('keeps an extension-filled address when the marketplace sends an empty one (stored as JSON string)', () => {
    const merged = mergeAddressPreferNonEmpty(JSON.stringify(scraped), etsyRedacted);
    expect(merged).toMatchObject({ street1: '1 Main St', city: 'Austin', postal: '78701', country: 'US', email: 'j@example.com' });
  });

  it('a real incoming address wins, contact fields are filled from the stored one', () => {
    const incoming = { name: 'Jane Doe', street1: '9 New Rd', city: 'Dallas', state: 'TX', postal: '75001', country: 'US', phone: '', email: '' };
    const merged = mergeAddressPreferNonEmpty(scraped, incoming)!;
    expect(merged.street1).toBe('9 New Rd');
    expect(merged.city).toBe('Dallas');
    expect(merged.street2).toBeUndefined(); // never mix lines of two different addresses
    expect(merged.email).toBe('j@example.com');
  });

  it("treats the Veeqo placeholder '—' as empty", () => {
    const veeqo = { name: '— —', street1: '—', city: '—', country: '—' };
    const merged = mergeAddressPreferNonEmpty(scraped, veeqo)!;
    expect(merged.street1).toBe('1 Main St');
    expect(merged.country).toBe('US');
  });

  it('neither side has a street: field-wise incoming non-empty wins', () => {
    const merged = mergeAddressPreferNonEmpty({ country: 'TR', email: 'a@b.c' }, { country: 'US', email: '' })!;
    expect(merged).toEqual({ country: 'US', email: 'a@b.c' });
  });

  it('handles null / unparsable inputs', () => {
    expect(mergeAddressPreferNonEmpty(null, null)).toBeNull();
    expect(mergeAddressPreferNonEmpty('not json', scraped)).toEqual(scraped);
    expect(parseStoredAddress('[1,2]')).toBeNull();
    expect(hasStreet({ line1: '5 Elm' })).toBe(true);
  });
});

describe('helpers', () => {
  it('mergeNamePreferNonEmpty never blanks a stored name', () => {
    expect(mergeNamePreferNonEmpty('Jane', '')).toBe('Jane');
    expect(mergeNamePreferNonEmpty('Jane', 'Janet')).toBe('Janet');
    expect(mergeNamePreferNonEmpty(null, '')).toBe('');
    expect(mergeNamePreferNonEmpty(undefined, undefined)).toBeNull();
  });

  it('sameAddress compares string and object forms, ignoring empty placeholders', () => {
    expect(sameAddress(JSON.stringify(scraped), { ...scraped, phone: '' })).toBe(true);
    expect(sameAddress(scraped, { ...scraped, city: 'Houston' })).toBe(false);
  });
});
