import { describe, expect, it } from 'vitest';
import { isReadablePhotoUrl, ownPath } from '@/lib/images/ownImage';

describe('own photo URLs for AI tools', () => {
  it('relative and same-host URLs are ours, read from disk; foreign ones must be public https', () => {
    expect(ownPath('/api/etsy-drafts/media-preview?id=x')?.pathname).toBe('/api/etsy-drafts/media-preview');
    expect(ownPath('https://kolayxport.com/api/clawd/serve-image?path=a')?.searchParams.get('path')).toBe('a');
    expect(ownPath('//evil.example/api/clawd/serve-image')).toBeNull();
    expect(ownPath('https://i.etsystatic.com/x.jpg')).toBeNull();
    expect(isReadablePhotoUrl('/api/etsy-drafts/media-preview?id=x')).toBe(true);
    expect(isReadablePhotoUrl('/api/orders/export')).toBe(false);
    expect(isReadablePhotoUrl('https://i.etsystatic.com/x.jpg')).toBe(true);
    expect(isReadablePhotoUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isReadablePhotoUrl('https://10.0.0.1/x.jpg')).toBe(false);
  });
});
