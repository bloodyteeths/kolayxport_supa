import { describe, expect, it } from 'vitest';
import { foldSkuLoose, normalizeSku } from '@/lib/stock/normalize';

describe('normalizeSku', () => {
  it('returns null for empty / non-string input', () => {
    expect(normalizeSku(null)).toBeNull();
    expect(normalizeSku(undefined)).toBeNull();
    expect(normalizeSku('')).toBeNull();
    expect(normalizeSku('   ')).toBeNull();
    expect(normalizeSku('​﻿')).toBeNull();
    expect(normalizeSku({} as any)).toBeNull();
  });

  it('accepts numbers', () => {
    expect(normalizeSku(12345)).toBe('12345');
  });

  it('trims, collapses whitespace and upper-cases', () => {
    expect(normalizeSku('  abc   def\t12 ')).toBe('ABC DEF 12');
  });

  it('maps Turkish dotted/dotless I to plain I (locale-free)', () => {
    expect(normalizeSku('İpek-ı')).toBe('IPEK-I');
    expect(normalizeSku('kılıç')).toBe('KILIÇ');
    expect(normalizeSku('iİıI')).toBe('IIII');
    // Decomposed I + combining dot above composes (NFKC) to U+0130, then maps to I.
    expect(normalizeSku('İpek')).toBe('IPEK');
  });

  it('strips zero-width characters', () => {
    expect(normalizeSku('AB​C‌D‍E﻿')).toBe('ABCDE');
  });

  it('applies NFKC (full-width, NBSP)', () => {
    expect(normalizeSku('ＡＢＣ１２')).toBe('ABC12');
    expect(normalizeSku('A B')).toBe('A B');
  });

  it('keeps separators (exact identity)', () => {
    expect(normalizeSku('ab-12/x.y_z')).toBe('AB-12/X.Y_Z');
  });
});

describe('foldSkuLoose', () => {
  it('folds Turkish letters and strips separators', () => {
    expect(foldSkuLoose('şğç-öü_1.2/3 x')).toBe('SGCOU123X');
    expect(foldSkuLoose('Kılıç Seti-01')).toBe('KILICSETI01');
  });

  it('matches visually equivalent SKUs', () => {
    expect(foldSkuLoose('BOX-WOOD-01')).toBe(foldSkuLoose('box wood 01'));
    expect(foldSkuLoose('İPEK.ŞAL')).toBe(foldSkuLoose('ipek-sal'));
  });

  it('returns null when nothing remains', () => {
    expect(foldSkuLoose('--__ ./')).toBeNull();
    expect(foldSkuLoose(null)).toBeNull();
  });
});
