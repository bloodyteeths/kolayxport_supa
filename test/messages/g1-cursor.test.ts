import { describe, it, expect } from 'vitest';
import { decodeCursor, encodeCursor, nextTrendyolPage, START_CURSOR } from '@/lib/messages/cursor';

describe('lib/messages/cursor', () => {
  it('absent cursor is the first page of both sources', () => {
    expect(decodeCursor(undefined)).toEqual(START_CURSOR);
    expect(decodeCursor('')).toEqual({ t: 0, w: '' });
  });

  it('round-trips and is url-safe', () => {
    const c = { t: 3, w: 'abc+/=?&é' };
    const enc = encodeCursor(c)!;
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(enc)).toEqual(c);
    expect(decodeCursor(encodeCursor({ t: null, w: 'x' }))).toEqual({ t: null, w: 'x' });
  });

  it('is null when both sources are exhausted', () => {
    expect(encodeCursor({ t: null, w: null })).toBeNull();
  });

  it('rejects malformed cursors', () => {
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(decodeCursor(['a', 'b'])).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":-1,"w":""}').toString('base64'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":1.5,"w":""}').toString('base64'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":1,"w":5}').toString('base64'))).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2]').toString('base64'))).toBeNull();
  });

  it('nextTrendyolPage uses totalPages, else a short page ends', () => {
    expect(nextTrendyolPage(0, 3, 30, 30)).toBe(1);
    expect(nextTrendyolPage(2, 3, 30, 30)).toBeNull();
    expect(nextTrendyolPage(0, 0, 0, 30)).toBeNull();
    expect(nextTrendyolPage(1, undefined, 30, 30)).toBe(2);
    expect(nextTrendyolPage(1, undefined, 12, 30)).toBeNull();
  });
});
