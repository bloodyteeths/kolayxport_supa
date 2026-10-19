import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { jsonbSafe } from '@/lib/research/etsySearch';

describe('jsonbSafe', () => {
  it('drops lone surrogates (an emoji cut in half) and NUL, keeps whole emoji', () => {
    const cut = 'Gift box 🎁'.slice(0, -1); // ends with a lone high surrogate
    expect(jsonbSafe({ t: cut, ok: 'Gift 🎁', n: 'a\u0000b', list: [cut], d: 3 })).toEqual({ t: 'Gift box ', ok: 'Gift 🎁', n: 'ab', list: ['Gift box '], d: 3 });
    expect(() => JSON.parse(JSON.stringify(jsonbSafe(cut)))).not.toThrow();
  });
});
