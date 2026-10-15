import { describe, expect, it } from 'vitest';
import { decodeEntities, decodeEntityFields, decodeEntityList } from '@/lib/text/decodeEntities';
import { decodeEntities as fromStats } from '@/lib/research/stats';

describe('lib/text/decodeEntities (DS P5, CRITIQUE V2)', () => {
  it('re-exports the R0 implementation', () => {
    expect(decodeEntities).toBe(fromStats);
  });

  it('decodes named, decimal and hex entities, and double-encoded text', () => {
    expect(decodeEntities('one&#39;s')).toBe("one's");
    expect(decodeEntities('Mom &amp; Baby')).toBe('Mom & Baby');
    expect(decodeEntities('&#x2764; gift')).toBe('❤ gift');
    expect(decodeEntities('&amp;quot;Hi&amp;quot;')).toBe('"Hi"');
    expect(decodeEntities(null)).toBe('');
  });

  it('is idempotent', () => {
    const once = decodeEntities('one&#39;s &amp; two');
    expect(decodeEntities(once)).toBe(once);
  });

  it('list and field helpers', () => {
    expect(decodeEntityList(['baby&#39;s', null, 'gift &amp; box'])).toEqual(["baby's", 'gift & box']);
    expect(decodeEntityList(undefined)).toEqual([]);
    const row = { id: 1, title: 'Mom&#39;s', tags: ['a&amp;b', 'c'], note: null };
    expect(decodeEntityFields(row, ['title', 'tags', 'note'])).toEqual({ id: 1, title: "Mom's", tags: ['a&b', 'c'], note: null });
    expect(row.title).toBe('Mom&#39;s');
  });
});
